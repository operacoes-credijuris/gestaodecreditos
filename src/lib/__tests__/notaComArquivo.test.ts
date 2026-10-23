/**
 * O TEXTO E O ARQUIVO NUMA NOTA SÓ (22/10/2026): o "Anotar" com arquivo gravava
 * duas notas no card. Agora o primeiro arquivo sobe sem nota e o texto vai na
 * nota dele — conferido: se o Kommo não guardar o texto, sai a nota de texto ao
 * lado, como antes. O fetch aqui é falso: nada chega ao Kommo.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  arquivoNoDrive,
  corpoDaNotaDeArquivo,
  recusouOCampo,
  textoFicou,
} from '../../../supabase/functions/_shared/notaComArquivo.ts'
import { postarNotaComArquivo } from '../../../supabase/functions/_shared/anotarNoKommo.ts'
import { enviarAnotacao, type AnexoDaAnotacao, type ArquivoNoDrive } from '@/lib/anexosDaAnotacao'
import { agruparNotas, desdobrarNotaComArquivo, nomeDoAnexo } from '@/lib/historicoDeNotas'
import type { KommoNota } from '@/lib/types'

const UUID = '0b6f6b2e-3a29-4d30-8953-bac68c05e8e8'
const VERSAO = '1c2d3e4f-4122-4cad-b121-9709882b4cc1'
const ANEXO: ArquivoNoDrive = { file_uuid: UUID, version_uuid: VERSAO, file_name: 'oficio.pdf' }
const raiz = join(__dirname, '..', '..', '..')
const ler = (p: string) => readFileSync(join(raiz, p), 'utf8')

describe('as regras', () => {
  it('o anexo do corpo é conferido', () => {
    expect(arquivoNoDrive({ file_uuid: UUID, version_uuid: VERSAO, file_name: ' oficio.pdf ' })).toEqual(ANEXO)
    expect(arquivoNoDrive({ file_uuid: UUID, file_name: 'a.pdf' })).toEqual({ file_uuid: UUID, file_name: 'a.pdf' })
    expect(arquivoNoDrive({ file_uuid: 'x', file_name: 'a.pdf' })).toBeNull()
    expect(arquivoNoDrive({ file_uuid: UUID, file_name: '' })).toBeNull()
    expect(arquivoNoDrive({ file_uuid: UUID, version_uuid: 'x', file_name: 'a.pdf' })).toBeNull()
    expect(arquivoNoDrive(null)).toBeNull()
  })
  it('a nota de arquivo leva o texto só quando há texto', () => {
    const [com] = corpoDaNotaDeArquivo(7, ANEXO, 'Ofício juntado.')
    expect(com).toMatchObject({ entity_id: 7, note_type: 'attachment', is_need_to_trigger_digital_pipeline: false })
    expect(com.params).toEqual({ file_uuid: UUID, file_name: 'oficio.pdf', version_uuid: VERSAO, text: 'Ofício juntado.' })
    expect(corpoDaNotaDeArquivo(7, ANEXO, null)[0].params).not.toHaveProperty('text')
  })
  it('o texto ficou: pelo começo, com HTML escapado e quebras mexidas', () => {
    const enviado = 'Segue o ofício -> conferir valor.\n\n— registrado por Ana pela plataforma Credijuris'
    expect(textoFicou(enviado, 'Segue o ofício -&gt; conferir valor.<br><br>— registrado por Ana pela plataforma Credijuris')).toBe(true)
    expect(textoFicou(enviado, 'oficio.pdf')).toBe(false)
    expect(textoFicou(enviado, undefined)).toBe(false)
  })
  it('só a recusa de validação tenta de novo sem o texto', () => {
    expect(recusouOCampo(400)).toBe(true)
    expect(recusouOCampo(422)).toBe(true)
    expect(recusouOCampo(500)).toBe(false)
    expect(recusouOCampo(401)).toBe(false)
  })
})

describe('postarNotaComArquivo (fetch falso)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const conta = { token: 't', subdominio: 's' }
  const op = { dePessoa: true, autor: 'Ana' }
  function kommo(roteiro: (url: string, init?: RequestInit) => Response) {
    const chamadas: { url: string; metodo: string; corpo: unknown }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      chamadas.push({ url, metodo: init?.method ?? 'GET', corpo: init?.body ? JSON.parse(String(init.body)) : null })
      return roteiro(url, init)
    })
    return chamadas
  }
  const criada = (id: number) => new Response(JSON.stringify({ _embedded: { notes: [{ id }] } }), { status: 200 })

  it('o Kommo guardou o texto: uma nota só', async () => {
    const ch = kommo((_url, init) =>
      init?.method === 'POST'
        ? criada(10)
        : new Response(JSON.stringify({ params: { text: 'Ofício juntado.<br>— registrado por Ana pela plataforma Credijuris' } }), { status: 200 }),
    )
    const r = await postarNotaComArquivo(conta, 7, 'Ofício juntado.', ANEXO, op)
    expect(r).toEqual({ ok: true, ids: [10], junto: true })
    expect(ch.map((c) => c.metodo)).toEqual(['POST', 'GET'])
    expect(ch[1].url).toContain('/leads/notes/10')
  })
  it('o Kommo pôs o nome do arquivo no lugar: sai também a nota de texto', async () => {
    let posts = 0
    const ch = kommo((_url, init) =>
      init?.method === 'POST'
        ? criada(++posts === 1 ? 10 : 11)
        : new Response(JSON.stringify({ params: { text: 'oficio.pdf' } }), { status: 200 }),
    )
    const r = await postarNotaComArquivo(conta, 7, 'Ofício juntado.', ANEXO, op)
    expect(r).toEqual({ ok: true, ids: [10, 11], junto: false })
    const texto = ch[2].corpo as { note_type: string; params: { text: string } }[]
    expect(texto[0].note_type).toBe('common')
    expect(texto[0].params.text).toContain('Ofício juntado.')
  })
  it('o Kommo recusou o campo (400): a nota de arquivo sem texto e a de texto', async () => {
    let posts = 0
    const ch = kommo(() => (++posts === 1 ? new Response('{"title":"Bad Request"}', { status: 400 }) : criada(posts * 10)))
    const r = await postarNotaComArquivo(conta, 7, 'Ofício juntado.', ANEXO, op)
    expect(r).toMatchObject({ ok: true, junto: false })
    expect((ch[1].corpo as { params: object }[])[0].params).not.toHaveProperty('text')
    expect((ch[2].corpo as { note_type: string }[])[0].note_type).toBe('common')
  })
  it('5xx no primeiro POST: não repete (a nota pode ter entrado) e devolve a falha', async () => {
    const ch = kommo(() => new Response('erro', { status: 502 }))
    const r = await postarNotaComArquivo(conta, 7, 'Ofício juntado.', ANEXO, op)
    expect(r.ok).toBe(false)
    expect(ch).toHaveLength(1)
  })
})

describe('enviarAnotacao com texto e arquivos', () => {
  const arq = (nome: string, tamanho = 10): AnexoDaAnotacao => {
    const arquivo = new File([new Uint8Array(tamanho)], nome)
    return { chave: nome, arquivo, estado: { fase: 'esperando' } }
  }
  it('o primeiro arquivo leva o texto; os outros vão como antes', async () => {
    const log: string[] = []
    const r = await enviarAnotacao('Segue.', [arq('a.pdf'), arq('b.pdf')], {
      anotar: async (t) => void log.push(`anotar:${t}`),
      anexar: async (a) => void log.push(`anexar:${a.name}`),
      subir: async (a) => (log.push(`subir:${a.name}`), { ...ANEXO, file_name: a.name }),
      anotarComArquivo: async (t, d) => void log.push(`junto:${t}:${d.file_name}`),
    }, () => {})
    expect(log).toEqual(['subir:a.pdf', 'junto:Segue.:a.pdf', 'anexar:b.pdf'])
    expect(r).toMatchObject({ textoEnviado: true, erroDoTexto: null, enviados: ['a.pdf', 'b.pdf'], falhas: [] })
  })
  it('o primeiro não sobe: o texto vai sozinho, e ele fica para tentar de novo', async () => {
    const log: string[] = []
    const r = await enviarAnotacao('Segue.', [arq('a.pdf'), arq('b.pdf')], {
      anotar: async (t) => void log.push(`anotar:${t}`),
      anexar: async (a) => void log.push(`anexar:${a.name}`),
      subir: async () => {
        throw new Error('caiu')
      },
      anotarComArquivo: async () => void log.push('junto'),
    }, () => {})
    expect(log).toEqual(['anotar:Segue.', 'anexar:b.pdf'])
    expect(r.textoEnviado).toBe(true)
    expect(r.falhas).toEqual([{ chave: 'a.pdf', nome: 'a.pdf', erro: 'caiu' }])
  })
  it('a nota não sobe: nada mais sai', async () => {
    const log: string[] = []
    const r = await enviarAnotacao('Segue.', [arq('a.pdf'), arq('b.pdf')], {
      anotar: async () => void log.push('anotar'),
      anexar: async () => void log.push('anexar'),
      subir: async () => ANEXO,
      anotarComArquivo: async () => {
        throw new Error('Kommo recusou')
      },
    }, () => {})
    expect(log).toEqual([])
    expect(r.erroDoTexto).toBe('Kommo recusou')
  })
  it('a nota falhou depois de o arquivo subir: a próxima tentativa não o sobe de novo', async () => {
    const log: string[] = []
    const passos = (falhar: boolean) => ({
      anotar: async () => void log.push('anotar'),
      anexar: async () => void log.push('anexar'),
      subir: async () => (log.push('subir'), ANEXO),
      anotarComArquivo: async () => {
        log.push('junto')
        if (falhar) throw new Error('Kommo recusou')
      },
    })
    const a = arq('a.pdf')
    const r1 = await enviarAnotacao('Segue.', [a], passos(true), () => {})
    expect(r1.noDrive).toEqual({ chave: 'a.pdf', arquivo: ANEXO })
    const r2 = await enviarAnotacao('Segue.', [{ ...a, noDrive: r1.noDrive!.arquivo }], passos(false), () => {})
    expect(log).toEqual(['subir', 'junto', 'junto'])
    expect(r2).toMatchObject({ textoEnviado: true, enviados: ['a.pdf'] })
  })
  it('sem os passos novos, a sequência de antes', async () => {
    const log: string[] = []
    await enviarAnotacao('Segue.', [arq('a.pdf')], {
      anotar: async () => void log.push('anotar'),
      anexar: async () => void log.push('anexar'),
    }, () => {})
    expect(log).toEqual(['anotar', 'anexar'])
  })
})

describe('o histórico', () => {
  const nota = (x: Partial<KommoNota>): KommoNota => ({
    id: 10, texto: '', criado_em: '2026-10-22T19:00:00Z', autor: 'Ana', tipo: 'attachment', automatica: false, ...x,
  })
  it('a nota de arquivo com texto vira a anotação com o arquivo junto', () => {
    const n = nota({ texto: 'Segue o ofício.', arquivo_uuid: UUID, arquivo_nome: 'oficio.pdf' })
    const [b] = agruparNotas([n])
    expect(b.nota).toMatchObject({ id: 10, tipo: 'common', texto: 'Segue o ofício.' })
    expect(b.anexos).toHaveLength(1)
    expect(b.anexos[0]).toMatchObject({ id: -10, tipo: 'attachment', arquivo_uuid: UUID })
    expect(nomeDoAnexo(b.anexos[0])).toBe('oficio.pdf')
  })
  it('a de sempre (o texto é o nome do arquivo) não se desdobra', () => {
    expect(desdobrarNotaComArquivo(nota({ texto: 'oficio.pdf', arquivo_nome: 'oficio.pdf' }))).toBeNull()
    expect(desdobrarNotaComArquivo(nota({ texto: '📎 oficio.pdf', arquivo_nome: 'oficio.pdf' }))).toBeNull()
    expect(desdobrarNotaComArquivo(nota({ texto: 'oficio.pdf' }))).toBeNull()
    expect(desdobrarNotaComArquivo(nota({ tipo: 'common', texto: 'x', arquivo_nome: 'a.pdf' }))).toBeNull()
  })
  it('a nota otimista (id negativo) não repete o id no arquivo', () => {
    const d = desdobrarNotaComArquivo(nota({ id: -500, texto: 'Segue.', arquivo_nome: 'a.pdf' }))
    expect(d?.anexo.id).toBe(-501)
  })
})

describe('as funções', () => {
  it('a kommo-anexo-enviar sobe sem nota quando pedido', () => {
    const f = ler('supabase/functions/kommo-anexo-enviar/index.ts')
    expect(f).toContain("if (req.headers.get('x-sem-nota') === '1') {")
    expect(f).toContain('x-tamanho, x-sem-nota')
  })
  it('a kommo-anotar recusa anexo inválido e usa a nota com arquivo', () => {
    const f = ler('supabase/functions/kommo-anotar/index.ts')
    expect(f).toContain('if (temAnexo && !anexo) return json({ erro: "O arquivo informado não é válido." }, 400);')
    expect(f).toContain('await postarNotaComArquivo({ token, subdominio }, leadId, texto, anexo, { dePessoa, autor })')
  })
  it('o espelho guarda o nome do arquivo à parte', () => {
    const f = ler('supabase/functions/kommo-sync/index.ts')
    expect(f).toContain("arquivo_nome: n.note_type === 'attachment' ? nomeDoArquivoDaNota(n) || null : null,")
    expect(f).toContain("automatica: (n.note_type !== 'common' && !arquivoComTexto(n)) || ehNotaNossa(texto, criadoEm),")
  })
})
