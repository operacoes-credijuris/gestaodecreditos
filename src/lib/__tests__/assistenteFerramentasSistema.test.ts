/**
 * O TEXTO DE SISTEMA DO ASSISTENTE (reescrito em 12/11/2026).
 *
 * O prompt é a outra metade das ferramentas: se ele manda usar uma que não
 * existe, ou diz que um dado não existe quando existe, o modelo obedece. Estes
 * testes leem o texto de verdade (sistema.ts é texto puro, importável) e o
 * fonte do index.ts, para o que importa não voltar a quebrar calado.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SISTEMA, SISTEMA_BASE_KOMMO, textoDaData } from '../../../supabase/functions/assistente/sistema.ts'
import { FERRAMENTAS_DA_OPERACAO } from '../../../supabase/functions/assistente/ferramentasDaOperacao.ts'
import { ESPELHO_RPV } from '@/lib/kommo'

const raiz = join(__dirname, '..', '..', '..')
const indice = readFileSync(join(raiz, 'supabase/functions/assistente/index.ts'), 'utf8').replace(/\r\n/g, '\n')
const declaradas = new Set([
  ...[...indice.matchAll(/^\s*name: '([a-z_]+)',\s*$/gm)].map((m) => m[1]),
  ...FERRAMENTAS_DA_OPERACAO.map((f) => f.name),
])

describe('SISTEMA: o que mudou', () => {
  it('não afirma mais que não existe fase processual estruturada', () => {
    expect(SISTEMA).not.toMatch(/não existe campo de fase processual/i)
    expect(SISTEMA).toContain('`fase_processual`')
    expect(SISTEMA).toMatch(/Fase processual: a tabela primeiro/)
    // A busca por texto continua, mas como plano B.
    expect(SISTEMA).toMatch(/plano B/)
  })
  it('não manda usar ferramentas que saíram', () => {
    for (const morta of ['listar_analises', 'resumo_cessoes']) expect(SISTEMA).not.toContain(morta)
    expect(SISTEMA).not.toMatch(/\bCessões\*\* —|tabela de cessões/i)
  })
  it('toda ferramenta citada no texto existe de verdade', () => {
    const citadas = [...SISTEMA.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1])
    // Campos de resposta que o texto também cita entre crases.
    const campos = new Set([
      'processos_distintos_encontrados',
      'pode_haver_mais_antigos',
      'ha_andamento_mais_recente_que_o_encontrado',
      'pode_comparar',
      'aviso_limite',
      'numero_cnj',
      // Argumentos de ferramenta (os dois primeiros vêm do ramo assist-t, 12/11/2026).
      'parados_ha_dias',
      'prazo_de',
      'prazo_ate',
    ])
    const fantasmas = citadas.filter((c) => !declaradas.has(c) && !campos.has(c))
    expect(fantasmas).toEqual([])
    expect(citadas.filter((c) => declaradas.has(c)).length).toBeGreaterThan(15)
  })
  it('sem jargão interno nem contradição de número de chamadas', () => {
    expect(SISTEMA).not.toContain('Edge Function')
    expect(SISTEMA).not.toContain('quatro chamadas')
    expect(SISTEMA).toContain('uma chamada no lugar de cinco')
  })
  it('a seção "quatro regras" tem quatro regras', () => {
    const secao = SISTEMA.slice(SISTEMA.indexOf('# Análise econômica: quatro regras'))
    const ate = secao.indexOf('\n# ', 2)
    const itens = secao.slice(0, ate).match(/^\d\. /gm) ?? []
    expect(itens).toHaveLength(4)
  })
  it('o fluxo de conclusos/homologação por texto encolheu', () => {
    // Era um passo a passo de seis itens e quatro caminhos de busca por texto.
    expect(SISTEMA).not.toContain('a lógica é INVERSA à de conclusos')
    const menu = SISTEMA.slice(SISTEMA.indexOf('# Menu "Consultar processos por situação"'))
    const corpo = menu.slice(0, menu.indexOf('\n# ', 2))
    expect(corpo).toContain('`fase_processual` com fase "conclusos"')
    expect(corpo).toContain('"ATV-01"')
    expect(corpo.length).toBeLessThan(1600)
  })
})

describe('SISTEMA: as regras de conduta pedidas', () => {
  it('uma política só de pergunta de volta, preservando o botão de contato', () => {
    expect(SISTEMA).toContain('# Quando perguntar de volta')
    expect(SISTEMA).not.toContain('Se a pergunta for ambígua de um jeito que muda a resposta, pergunte antes de consultar.')
    expect(SISTEMA).toContain('decida sozinho qual é o pedido cabível')
    expect(SISTEMA).toContain('nunca pergunte de volta o que a pessoa quer pedir/cobrar')
  })
  it('recorte, dinheiro, listas longas, vazio por permissão', () => {
    expect(SISTEMA).toContain('# Diga sempre o recorte')
    expect(SISTEMA).toContain('# Dinheiro')
    expect(SISTEMA).toContain('R$ 12,4 milhões')
    expect(SISTEMA).toContain('# Listas longas')
    expect(SISTEMA).toMatch(/planilha/)
    expect(SISTEMA).toMatch(/resultado vazio pode ser falta de permissão/i)
  })
  it('o glossário das telas usa os nomes do menu', () => {
    for (const tela of [
      'Análise de crédito',
      'Créditos',
      'Publicações e movimentações',
      'Fase processual',
      'Paralisados',
      'Requerimentos administrativos',
      'Quadro econômico',
      'Dados cadastrais',
      'Geração de contratos',
      'Configurações',
    ]) {
      expect(SISTEMA, tela).toContain(tela)
    }
    const nav = readFileSync(join(raiz, 'src/components/layout/navigation.ts'), 'utf8')
    for (const aba of ['Visão geral', 'Previsões', 'Performance', 'Recortes', 'Carteiras', 'Radar de precatórios']) {
      expect(nav, aba).toContain(`'${aba}'`)
      expect(SISTEMA, aba).toContain(aba)
    }
  })
  it('manda para a Skill da Base do Kommo as perguntas agregadas do funil', () => {
    expect(SISTEMA).toContain('Base do Kommo (relatórios)')
    const t = readFileSync(join(raiz, 'src/components/Assistente.tsx'), 'utf8')
    expect(t).toContain('Base do Kommo (relatórios)')
  })
  it('coerente com o ramo assist-t: grupos de creditos_a_vencer, prazo_de e funil parado', () => {
    // creditos_a_vencer passou a devolver atrasados / proximos_7_dias / de_8_a_30_dias.
    expect(SISTEMA).not.toMatch(/hoje\/atrasado|esta semana e este mês/)
    expect(SISTEMA).toContain('atrasados, próximos 7 dias e de 8 a 30 dias')
    expect(SISTEMA).toContain('`prazo_de` e `prazo_ate`')
    expect(SISTEMA).toContain('`funil_comercial` (busca rápida de card; com `parados_ha_dias`')
  })
  it('não prevê desfecho de processo', () => {
    expect(SISTEMA).toMatch(/Não preveja o desfecho do processo/)
    expect(SISTEMA).not.toContain('inclusive prazo provável')
  })
})

describe('SISTEMA_BASE_KOMMO', () => {
  it('as colunas de desfecho com os nomes reais do Kommo', () => {
    const nomesRpv = ESPELHO_RPV.map((c) => c.nome)
    for (const c of ['Reprovados operacional', 'Reprovados comercial', 'Sem resposta', 'Não fechado', 'Fechados', 'Pagamento finalizado']) {
      expect(nomesRpv, c).toContain(c)
      expect(SISTEMA_BASE_KOMMO, c).toContain(`"${c}"`)
    }
    const trilhas = readFileSync(join(raiz, 'supabase/functions/_shared/trilhasDoPrecatorio.ts'), 'utf8')
    for (const c of ['Não fechados', 'NÃO FECHADO', 'SEM RESPOSTA', 'FECHADOS']) {
      expect(trilhas, c).toContain(`'${c}'`)
      expect(SISTEMA_BASE_KOMMO, c).toContain(`"${c}"`)
    }
    // O nome genérico de antes ("Reprovados, Sem resposta, Não fechados") como lista de colunas saiu.
    expect(SISTEMA_BASE_KOMMO).not.toContain('(ex.: Reprovados, Sem resposta, Não fechados, Fechados, Pagamento finalizado)')
  })
  it('explica a cotação, a Invest histórica e a data da base', () => {
    expect(SISTEMA_BASE_KOMMO).toContain('**proposta do fundo / comissão da casa**')
    expect(SISTEMA_BASE_KOMMO).toContain('(Spread de 5%)')
    expect(SISTEMA_BASE_KOMMO).toMatch(/Invest Precatórios é fundo histórico/)
    expect(SISTEMA_BASE_KOMMO).toMatch(/campo "Domus" é o antigo campo da Invest/)
    expect(SISTEMA_BASE_KOMMO).toContain('`gerado_em`')
    expect(SISTEMA_BASE_KOMMO).toContain('a sincronização MAIS ANTIGA')
  })
  it('funis de análise, sem o Funil Geral e o antigo por padrão', () => {
    expect(SISTEMA_BASE_KOMMO).toMatch(/Funis de análise\*\*: RPV, Precatório Interno e Precatório Externo/)
    expect(SISTEMA_BASE_KOMMO).toMatch(/Funil Geral/)
    expect(SISTEMA_BASE_KOMMO).toMatch(/deixe os dois FORA das contas/)
  })
})

describe('a data de hoje no sistema', () => {
  it('o texto, em dd/mm/aaaa', () => {
    expect(textoDaData('2026-11-12')).toBe('Hoje é 12/11/2026 (horário de Brasília).')
  })
  it('vai num bloco próprio, DEPOIS do SISTEMA em cache e sem cache_control', () => {
    const bloco = /system: \[\n([\s\S]*?)\n {8}\],/.exec(indice)?.[1] ?? ''
    const linhas = bloco.split('\n').filter((l) => l.trim().startsWith('{') || l.trim().startsWith('...'))
    expect(linhas[0]).toContain("text: SISTEMA, cache_control: { type: 'ephemeral' }")
    expect(linhas[1]).toContain('text: textoDaData(hojeEmBrasilia())')
    expect(linhas[1]).not.toContain('cache_control')
    expect(linhas[2]).toContain('SISTEMA_BASE_KOMMO')
  })
  it('o SISTEMA continua sem nada que varie por pergunta', () => {
    expect(SISTEMA).not.toMatch(/\$\{/)
    expect(SISTEMA).not.toMatch(/\d{2}\/\d{2}\/\d{4}\)?\.?$/m)
  })
  it('os textos moraram para sistema.ts: o index.ts só os importa', () => {
    expect(indice).toContain("import { SISTEMA, SISTEMA_BASE_KOMMO, textoDaData } from './sistema.ts'")
    expect(indice).not.toMatch(/^const SISTEMA/m)
    expect(indice).not.toMatch(/^const SISTEMA_BASE_KOMMO/m)
  })
  it('a descrição da busca por texto não diz mais que é a única forma de ver a fase', () => {
    expect(indice).not.toContain('É a ÚNICA forma de responder sobre fase processual')
    expect(indice).toContain('Para FASE processual use antes `fase_processual`')
  })
})
