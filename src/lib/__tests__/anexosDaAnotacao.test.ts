import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  type AnexoDaAnotacao,
  type EstadoDoAnexo,
  type PassosDaAnotacao,
  LIMITE_DO_ANEXO,
  acrescentarAnexos,
  chaveDoArquivo,
  enviarAnotacao,
  nomearColado,
  resumoDaAnotacao,
  tamanhoLegivel,
} from '@/lib/anexosDaAnotacao'

/**
 * OS ARQUIVOS DO "ANOTAR": a lista, o limite, a ordem das chamadas e a falha
 * parcial — sem Kommo nem navegador. Nada aqui move card.
 */

/** Um arquivo de verdade, pequeno. */
const arq = (nome: string, bytes = 10, tipo = 'application/pdf', em = 1) =>
  new File([new Uint8Array(bytes)], nome, { type: tipo, lastModified: em })

/** Um "arquivo" só com o tamanho declarado — para passar de 100 MB sem alocar 100 MB. */
const grande = (nome: string, size: number) =>
  ({ name: nome, size, type: 'application/pdf', lastModified: 1 }) as unknown as File

const naLista = (...arquivos: File[]): AnexoDaAnotacao[] => acrescentarAnexos([], arquivos).lista

/** Passos falsos: registram a ordem e falham onde se pedir. */
function passosFalsos(o: { falhaTexto?: string; falhaArquivo?: Record<string, string>; aviso?: Record<string, string> } = {}) {
  const chamadas: string[] = []
  const estados: string[] = []
  const passos: PassosDaAnotacao = {
    anotar: async (t) => {
      chamadas.push(`anotar:${t}`)
      if (o.falhaTexto) throw new Error(o.falhaTexto)
    },
    anexar: async (a, onProgresso) => {
      chamadas.push(`anexar:${a.name}`)
      onProgresso({ fase: 'enviando', pct: 50 })
      if (o.falhaArquivo?.[a.name]) throw new Error(o.falhaArquivo[a.name])
      onProgresso({ fase: 'enviando', pct: 100 })
      onProgresso({ fase: 'processando' })
      return { aviso: o.aviso?.[a.name] ?? null }
    },
  }
  const onEstado = (chave: string, e: EstadoDoAnexo) =>
    estados.push(`${chave.split(':')[0]}=${e.fase}${e.fase === 'enviando' ? e.pct : ''}`)
  return { passos, chamadas, estados, onEstado }
}

describe('tamanhoLegivel', () => {
  it('KB abaixo de 1 MB (nunca 0), MB com uma casa até 10, inteiro depois', () => {
    expect(tamanhoLegivel(10)).toBe('1 KB')
    expect(tamanhoLegivel(48 * 1024)).toBe('48 KB')
    expect(tamanhoLegivel(1.4 * 1024 * 1024)).toBe('1,4 MB')
    expect(tamanhoLegivel(37.6 * 1024 * 1024)).toBe('38 MB')
  })
})

describe('acrescentarAnexos — a lista antes de enviar', () => {
  it('entra na ordem, esperando, e não mexe na lista de antes', () => {
    const antes = naLista(arq('a.pdf'))
    const r = acrescentarAnexos(antes, [arq('b.png', 20, 'image/png'), arq('c.docx')])
    expect(r.lista.map((a) => a.arquivo.name)).toEqual(['a.pdf', 'b.png', 'c.docx'])
    expect(r.lista.every((a) => a.estado.fase === 'esperando')).toBe(true)
    expect(r.recusados).toEqual([])
    expect(antes).toHaveLength(1)
  })

  it('o limite é o da função (100 MB): o maior fica fora, avisado antes de enviar', () => {
    expect(LIMITE_DO_ANEXO).toBe(100 * 1024 * 1024)
    const funcao = readFileSync(
      fileURLToPath(new URL('../../../supabase/functions/kommo-anexo-enviar/index.ts', import.meta.url)),
      'utf-8',
    )
    expect(funcao).toMatch(/const MAX_BYTES = 100 \* 1024 \* 1024/)

    const r = acrescentarAnexos([], [grande('autos.pdf', LIMITE_DO_ANEXO + 1), grande('ok.pdf', LIMITE_DO_ANEXO)])
    expect(r.lista.map((a) => a.arquivo.name)).toEqual(['ok.pdf'])
    expect(r.recusados).toEqual(['autos.pdf (100 MB) passa do limite de 100 MB por arquivo.'])
    expect(acrescentarAnexos([], [grande('enorme.pdf', 250 * 1024 * 1024)]).recusados[0]).toBe(
      'enorme.pdf (250 MB) passa do limite de 100 MB por arquivo.',
    )
  })

  it('o vazio fica fora (a função o recusaria), e o repetido também', () => {
    const a = arq('a.pdf')
    const r = acrescentarAnexos(naLista(a), [arq('vazio.txt', 0), a])
    expect(r.lista).toHaveLength(1)
    expect(r.recusados).toEqual(['vazio.txt está vazio (0 KB).', 'a.pdf já está na lista.'])
    // Mesmo nome, outro arquivo (outro tamanho): entra.
    expect(acrescentarAnexos(naLista(a), [arq('a.pdf', 99)]).lista).toHaveLength(2)
    expect(chaveDoArquivo(a)).toBe('a.pdf:10:1')
  })
})

describe('nomearColado — o print colado com Ctrl+V', () => {
  const agora = new Date(2026, 9, 5, 14, 3, 9)
  it('"image.png" ganha nome com a data e a ordem; o tipo fica', () => {
    const f = nomearColado(arq('image.png', 5, 'image/png'), agora, 2)
    expect(f.name).toBe('imagem-colada-2026-10-05-140309-2.png')
    expect(f.type).toBe('image/png')
    expect(f.size).toBe(5)
    expect(nomearColado(arq('', 5, 'image/jpeg'), agora, 1).name).toBe('imagem-colada-2026-10-05-140309-1.jpg')
  })
  it('dois prints colados juntos não viram o mesmo arquivo na lista', () => {
    const r = acrescentarAnexos([], [
      nomearColado(arq('image.png', 5, 'image/png', 0), agora, 1),
      nomearColado(arq('image.png', 5, 'image/png', 0), agora, 2),
    ])
    expect(r.lista).toHaveLength(2)
  })
  it('arquivo com nome de verdade não muda', () => {
    const f = arq('RG do cedente.jpg', 5, 'image/jpeg')
    expect(nomearColado(f, agora, 1)).toBe(f)
  })
})

describe('enviarAnotacao — a sequência das chamadas', () => {
  it('texto e arquivos: o texto UMA vez, primeiro; depois cada arquivo, um de cada vez', async () => {
    const f = passosFalsos()
    const r = await enviarAnotacao('  Chegou o RG.  ', naLista(arq('rg.pdf'), arq('cpf.png', 9, 'image/png')), f.passos, f.onEstado)
    expect(f.chamadas).toEqual(['anotar:Chegou o RG.', 'anexar:rg.pdf', 'anexar:cpf.png'])
    expect(r).toEqual({ textoEnviado: true, erroDoTexto: null, enviados: ['rg.pdf', 'cpf.png'], falhas: [], avisos: [] })
    // O andamento de cada arquivo, na ordem: a barra da lista.
    expect(f.estados).toEqual([
      'rg.pdf=enviando0', 'rg.pdf=enviando50', 'rg.pdf=enviando100', 'rg.pdf=gravando',
      'cpf.png=enviando0', 'cpf.png=enviando50', 'cpf.png=enviando100', 'cpf.png=gravando',
    ])
    expect(resumoDaAnotacao(r)).toEqual({ completo: true, tom: 'sucesso', texto: '2 arquivos anexados ao card no Kommo.' })
  })

  it('só arquivo, sem texto: a kommo-anotar não é chamada', async () => {
    const f = passosFalsos()
    const r = await enviarAnotacao('   ', naLista(arq('memorando.pdf')), f.passos, f.onEstado)
    expect(f.chamadas).toEqual(['anexar:memorando.pdf'])
    expect(resumoDaAnotacao(r)).toEqual({ completo: true, tom: 'sucesso', texto: 'Arquivo anexado ao card no Kommo.' })
  })

  it('só texto: como antes, uma chamada', async () => {
    const f = passosFalsos()
    const r = await enviarAnotacao('Fundo pediu a certidão.', [], f.passos, f.onEstado)
    expect(f.chamadas).toEqual(['anotar:Fundo pediu a certidão.'])
    expect(resumoDaAnotacao(r).completo).toBe(true)
  })

  it('o texto falhando, NENHUM arquivo sai — e a mensagem diz que nada entrou', async () => {
    const f = passosFalsos({ falhaTexto: 'HTTP 502' })
    const r = await enviarAnotacao('Texto', naLista(arq('a.pdf')), f.passos, f.onEstado)
    expect(f.chamadas).toEqual(['anotar:Texto'])
    expect(r.textoEnviado).toBe(false)
    expect(r.erroDoTexto).toBe('HTTP 502')
    expect(f.estados).toEqual([])
    const s = resumoDaAnotacao(r)
    expect(s.completo).toBe(false)
    expect(s.tom).toBe('perigo')
    expect(s.texto).toBe('A anotação não subiu para o Kommo (HTTP 502). Nada foi enviado — o texto e os arquivos continuam aqui.')
  })
})

describe('enviarAnotacao — a falha parcial', () => {
  it('um arquivo falha, os outros seguem; a mensagem diz o que entrou e o que não', async () => {
    const f = passosFalsos({ falhaArquivo: { 'b.pdf': 'A conexão caiu durante o envio do arquivo.' } })
    const lista = naLista(arq('a.pdf'), arq('b.pdf'), arq('c.pdf'))
    const r = await enviarAnotacao('Docs do cedente', lista, f.passos, f.onEstado)
    expect(f.chamadas).toEqual(['anotar:Docs do cedente', 'anexar:a.pdf', 'anexar:b.pdf', 'anexar:c.pdf'])
    expect(r.enviados).toEqual(['a.pdf', 'c.pdf'])
    expect(r.falhas).toEqual([{ chave: lista[1].chave, nome: 'b.pdf', erro: 'A conexão caiu durante o envio do arquivo.' }])
    expect(f.estados).toContain('b.pdf=falhou')
    const s = resumoDaAnotacao(r)
    expect(s).toEqual({
      completo: false,
      tom: 'aviso',
      texto:
        'Entrou no card: a anotação, a.pdf e c.pdf. Não entrou: b.pdf (A conexão caiu durante o envio do arquivo.). ' +
        'Ele continua na lista: Enviar tenta só ele.',
    })
  })

  it('TENTAR DE NOVO não repete o que já foi: só o que falhou, sem o texto', async () => {
    // O que a caixa faz depois da falha: tira da lista o que entrou e apaga o
    // texto que subiu. Sobra só o que falhou.
    const f = passosFalsos({ falhaArquivo: { 'b.pdf': 'HTTP 500' } })
    const lista = naLista(arq('a.pdf'), arq('b.pdf'))
    const r1 = await enviarAnotacao('Texto', lista, f.passos, f.onEstado)
    const falharam = new Set(r1.falhas.map((x) => x.chave))
    const sobra = lista.filter((a) => falharam.has(a.chave))
    const texto = r1.textoEnviado ? '' : 'Texto'

    const g = passosFalsos()
    const r2 = await enviarAnotacao(texto, sobra, g.passos, g.onEstado)
    expect(g.chamadas).toEqual(['anexar:b.pdf'])
    expect(resumoDaAnotacao(r2)).toEqual({ completo: true, tom: 'sucesso', texto: 'Arquivo anexado ao card no Kommo.' })
  })

  it('sem texto e todos falhando: perigo, e "nenhum arquivo entrou"', async () => {
    const f = passosFalsos({ falhaArquivo: { 'a.pdf': 'HTTP 413', 'b.pdf': 'HTTP 413' } })
    const r = await enviarAnotacao('', naLista(arq('a.pdf'), arq('b.pdf')), f.passos, f.onEstado)
    const s = resumoDaAnotacao(r)
    expect(s.tom).toBe('perigo')
    expect(s.texto).toBe(
      'Nenhum arquivo entrou no card. Não entrou: a.pdf (HTTP 413); b.pdf (HTTP 413). Eles continuam na lista: Enviar tenta só eles.',
    )
  })

  it('o arquivo que entrou com aviso da função (a nota dele não subiu) conta como enviado — não sobe de novo', async () => {
    const aviso = 'O arquivo foi anexado ao card, mas a nota do arquivo não subiu (HTTP 400).'
    const f = passosFalsos({ aviso: { 'a.pdf': aviso } })
    const r = await enviarAnotacao('', naLista(arq('a.pdf')), f.passos, f.onEstado)
    expect(r.enviados).toEqual(['a.pdf'])
    expect(r.falhas).toEqual([])
    const s = resumoDaAnotacao(r)
    expect(s.completo).toBe(true)
    expect(s.tom).toBe('aviso')
    expect(s.texto).toBe(`Arquivo anexado ao card no Kommo. a.pdf: ${aviso}`)
  })

  it('arquivo acima do limite que chegue à lista não é enviado (a função o recusaria depois de subir inteiro)', async () => {
    const f = passosFalsos()
    const lista: AnexoDaAnotacao[] = [
      { chave: 'x', arquivo: grande('x.pdf', LIMITE_DO_ANEXO + 1), estado: { fase: 'esperando' } },
    ]
    const r = await enviarAnotacao('', lista, f.passos, f.onEstado)
    expect(f.chamadas).toEqual([])
    expect(r.falhas[0].nome).toBe('x.pdf')
  })
})

describe('a caixa chama a função do jeito que evita o texto repetido', () => {
  const ler = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')
  it('cada arquivo vai à kommo-anexo-enviar com x-texto VAZIO', () => {
    const caixa = ler('../../components/CaixaDeAnotacao.tsx')
    expect(caixa).toMatch(/'kommo-anexo-enviar'/)
    expect(caixa).toMatch(/'x-texto': ''/)
  })
  it('e a função só grava a nota de texto quando há texto', () => {
    const funcao = ler('../../../supabase/functions/kommo-anexo-enviar/index.ts')
    expect(funcao).toMatch(/if \(texto\) \{\s*const falhaDoTexto = await gravarNota/)
  })
})
