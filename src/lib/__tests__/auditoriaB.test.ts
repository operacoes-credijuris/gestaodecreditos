// AUDITORIA B (12/11/2026): assistente, caixas e janelas da análise. O vitest
// daqui roda em `node`, sem montar o React — o que é de componente é conferido
// no FONTE (sem comentários: o que vale é o código), e o que é de biblioteca é
// exercitado de verdade. Cada asserção falharia no código de antes da correção.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { QueryClient, QueryObserver } from '@tanstack/query-core'

function fonte(caminho: string): string {
  const src = readFileSync(fileURLToPath(new URL(`../../components/${caminho}`, import.meta.url)), 'utf-8')
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
function trecho(codigo: string, de: string, ate: string): string {
  const i = codigo.indexOf(de)
  expect(i, `não achei "${de}"`).toBeGreaterThanOrEqual(0)
  const j = codigo.indexOf(ate, i + de.length)
  return codigo.slice(i, j < 0 ? undefined : j)
}

describe('Assistente', () => {
  const codigo = fonte('Assistente.tsx')

  it('a sugestão não apaga o rascunho do campo nem leva os anexos dele', () => {
    const envia = trecho(codigo, 'function enviar(', 'function tentarDeNovo')
    expect(envia).toMatch(/origem: 'campo' \| 'sugestao' = 'campo'/)
    expect(envia).toMatch(/const anexos = doCampo \? arquivos : \[\]/)
    // O campo só é limpo quando a pergunta veio dele.
    expect(envia).toMatch(/if \(doCampo\) \{\s*setTexto\(''\)/)
    expect(codigo).toMatch(/onClick=\{\(\) => enviar\(s, 'sugestao'\)\}/)
  })

  it('excluir espera a gravação em curso da conversa (o insert atrasado a recriava)', () => {
    const exclui = trecho(codigo, 'async function confirmarExclusao', 'function enviar(')
    const espera = exclui.indexOf('await filaDeGravacao.current.get(id)')
    const apaga = exclui.indexOf(".delete().eq('id', id)")
    expect(espera).toBeGreaterThan(0)
    expect(apaga).toBeGreaterThan(espera)
  })

  it('o Confirmar da petição não roda duas vezes e diz a causa da falha', () => {
    const confirma = trecho(codigo, 'async function confirmarAcao', 'if (!aberto)')
    expect(confirma).toMatch(/if \(confirmando\.current\) return/)
    expect(confirma).toMatch(/confirmando\.current = false/)
    expect(confirma).toMatch(/causa \? `: \$\{causa\}`/)
  })

  it('renovar os links não deixa rejeição sem dono', () => {
    const renova = trecho(codigo, 'async function renovarLinks', 'async function confirmarExclusao')
    expect(renova).toMatch(/try \{\s*resposta = await supabase\.storage/)
  })

  it('escolher conversa ou "Nova" devolve o foco à pergunta', () => {
    expect(trecho(codigo, 'function novaConversa', 'function carregarConversa')).toMatch(/focarPergunta\(\)/)
    expect(trecho(codigo, 'function carregarConversa', 'async function renovarLinks')).toMatch(/focarPergunta\(\)/)
  })
})

describe('EmissaoBullai: a releitura do catálogo que falha não some com a seção', () => {
  it('no TanStack Query 5, a releitura que falha liga `error` e mantém `data`', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let falhar = false
    const obs = new QueryObserver(qc, {
      queryKey: ['bullai', 'catalogo'],
      queryFn: async () => {
        if (falhar) throw new Error('rede caiu')
        return { portais: [1, 2] }
      },
    })
    const parar = obs.subscribe(() => {})
    await obs.refetch()
    falhar = true
    await obs.refetch()
    const r = obs.getCurrentResult()
    parar()
    qc.clear()
    // É ESTE O ESTADO que trocava a seção inteira por "indisponível".
    expect(r.error).toBeTruthy()
    expect(r.data).toEqual({ portais: [1, 2] })
  })

  it('só mostra "indisponível" sem catálogo nenhum', () => {
    const codigo = fonte('EmissaoBullai.tsx')
    expect(codigo).toMatch(/if \(catalogo\.error && !catalogo\.data\)/)
    expect(codigo).not.toMatch(/if \(catalogo\.error\) \{/)
  })
})

describe('PainelCertidoes', () => {
  const codigo = fonte('PainelCertidoes.tsx')

  it('voltar à aba só lendo o cadastro recarrega só o checklist (não desmonta a BullAI)', () => {
    expect(codigo).toMatch(
      /if \(sujoNaVolta\.current \|\| \(carregouUmaVez\.current && soLendoNaVolta\.current\)\) void recarregarItens\(\)/,
    )
    expect(codigo).toMatch(/soLendoNaVolta\.current = !editando/)
  })

  it('o município da IA é conferido com a lista do IBGE mais recente, não a do render', () => {
    const fn = trecho(codigo, 'function municipioDoIbge', 'function aplicarLeitura')
    expect(fn).toMatch(/municipiosRef\.current\[uf\]/)
    expect(codigo).toMatch(/municipiosRef\.current = municipios/)
  })

  it('a leitura que falhou não diz "nenhum sujeito" e oferece tentar de novo', () => {
    expect(codigo).toMatch(/sujeitos\.length === 0 && carregouUmaVez\.current && \(/)
    expect(codigo).toMatch(/!carregando && !carregouUmaVez\.current && \(\s*<Button[^>]*onClick=\{\(\) => void recarregar\(\)\}/)
  })
})

describe('PeticaoModal', () => {
  const codigo = fonte('PeticaoModal.tsx')

  it('"Failed to fetch" seco não é mais "a plataforma foi atualizada"', () => {
    expect(codigo).toMatch(/if \(ehFalhaDeCarga\(err\)\)/)
    expect(codigo).not.toMatch(/Importing a module script failed\|Failed to fetch/)
  })

  it('o aviso da pasta não encontrada aparece nas duas abas', () => {
    const aviso = codigo.indexOf('{semPasta && (')
    const abas = codigo.indexOf('{naIA ? (')
    expect(aviso).toBeGreaterThan(0)
    expect(aviso).toBeLessThan(abas)
    expect(codigo.match(/\{semPasta && \(/g)).toHaveLength(1)
  })

  it('sem tarefa (aberta pelo assistente), a seção do panorama não aparece vazia', () => {
    const ia = trecho(codigo, '{naIA ? (', 'Comando do advogado')
    expect(ia).toMatch(/\{tarefaId && \(\s*<section>/)
  })
})

describe('AnaliseRpvModal: a falha do getUser não vira "sessão expirada"', () => {
  it('lê o erro e diz a causa', () => {
    const codigo = fonte('AnaliseRpvModal.tsx')
    expect(codigo).toMatch(/const \{ data: \{ user \}, error: erroDaSessao \} = await supabase\.auth\.getUser\(\)/)
    expect(codigo).toMatch(/Não consegui confirmar a sessão \(\$\{erroDaSessao\.message\}\)/)
  })
})

describe('DueDiligence: a recusa de uma verba confere quantas linhas pegou', () => {
  it('como o `seguir`, recusa que não grava nada lança antes da nota', () => {
    const codigo = fonte('DueDiligence.tsx')
    const recusa = trecho(codigo, 'async function recusarVerba', 'async function seguir')
    expect(recusa).toMatch(/\.eq\('status', 'APURADO'\)\s*\.select\('id'\)/)
    const confere = recusa.indexOf('data.length === 0')
    const nota = recusa.indexOf("invokeFunction('kommo-anotar'")
    expect(confere).toBeGreaterThan(0)
    expect(nota).toBeGreaterThan(confere)
  })
})

describe('JustificativaTecnica', () => {
  const codigo = fonte('JustificativaTecnica.tsx')

  it('o salvamento do rascunho vale para quem é dono do campo, não para o card aberto', () => {
    expect(codigo).toMatch(/const daJanela = \(\) => carregado\.current\?\.startsWith\(`\$\{doCard\}:`\) \?\? false/)
    expect(codigo).not.toMatch(/cardAberto\.current === doCard \|\| cardAberto\.current === 0/)
  })

  it('o Fechar tenta salvar de novo a edição que falhou', () => {
    expect(trecho(codigo, 'function fechar()', 'travas')).toMatch(/if \(relogio\.current !== null \|\| rascunho === 'erro'\)/)
  })

  it('o envio que falha salva a edição que esperava a pausa', () => {
    const envia = trecho(codigo, 'async function enviar()', 'o que mostrar')
    expect(envia).toMatch(/const haviaEdicaoPorSalvar = relogio\.current !== null\s*cancelarRelogio\(\)/)
    expect(envia).toMatch(/catch \(e\) \{[\s\S]*if \(haviaEdicaoPorSalvar\) void salvarRascunho\(texto\)/)
  })

  it('a janela fechada não chama o próprio card de "outro card"', () => {
    expect(codigo).toMatch(/cardAberto\.current === 0 \? 'A justificativa' : 'A justificativa de outro card'/)
  })
})

describe('JanelaDeDesfecho: o motivo sugerido, intacto, não é alteração', () => {
  it('sujo compara com o motivo sugerido', () => {
    const codigo = fonte('JanelaDeDesfecho.tsx')
    expect(codigo).toMatch(/const sujo = motivo\.trim\(\)\.length > 0 && motivo\.trim\(\) !== \(motivoSugerido \?\? ''\)\.trim\(\)/)
  })
})
