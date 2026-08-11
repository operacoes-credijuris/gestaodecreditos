// NÚCLEO COMPARTILHADO — detecção de inconsistências (item 15).
//
// Duas naturezas, rotuladas de forma diferente porque significam coisas
// diferentes:
//
//   IMPOSSIBILIDADE LÓGICA  o dado se contradiz. É erro.
//   SINAL ESTATÍSTICO       o dado é atípico. PODE ser um evento real.
//
// Nada é alterado automaticamente, em nenhuma hipótese (itens 15 e 31). A
// saída é uma lista de revisão para uma pessoa decidir.
//
// Uma regra que NÃO existe aqui, de propósito: "data de referência anterior à
// aquisição". A data-base do cálculo homologado é, por natureza, anterior à
// compra do crédito — na carteira real a defasagem mediana é de 259 dias.
// Marcá-la como anomalia acusaria praticamente toda a carteira.

import { marcarExtremos } from './estatistica.ts'
import { type OperacaoAnalitica } from './tipos.ts'
import { diasEntre } from './datas.ts'

export type Natureza = 'impossibilidade' | 'sinal'
export type Gravidade = 'alta' | 'media' | 'baixa'

export interface Achado {
  regra: string
  natureza: Natureza
  gravidade: Gravidade
  titulo: string
  /** O que fazer com isto, em linguagem de quem opera. */
  orientacao: string
  refs: string[]
}

export interface RelatorioAnomalias {
  achados: Achado[]
  totalOperacoes: number
  operacoesComAchado: number
  /** Rótulo obrigatório: nada aqui é conclusão. */
  aviso: string
}

/**
 * `hoje` vem da tela. Os cortes de 90 e 180 dias em previsão vencida são
 * CONVENÇÃO OPERACIONAL declarada, não limiar estatístico: com 13 observações
 * de desvio, a distribuição observada não tem base para definir o corte, e
 * fingir que tem seria pior do que assumir a convenção.
 */
export function detectarAnomalias(
  operacoes: readonly OperacaoAnalitica[],
  hoje: string,
): RelatorioAnomalias {
  const achados: Achado[] = []
  const add = (
    regra: string, natureza: Natureza, gravidade: Gravidade,
    titulo: string, orientacao: string, ops: readonly OperacaoAnalitica[],
  ) => {
    if (ops.length) achados.push({ regra, natureza, gravidade, titulo, orientacao, refs: ops.map((o) => o.ref) })
  }

  // ---- impossibilidades lógicas ----
  add('encerrado_sem_data', 'impossibilidade', 'alta',
    'Operação encerrada sem data de liquidação',
    'O status diz encerrado, mas não há data de pagamento. Sem ela, prazo e rentabilidade ' +
    'não podem ser calculados e a operação fica fora de toda análise de performance.',
    operacoes.filter((o) => o.status === 'encerrado' && !o.dataLiquidacao))

  add('encerrado_sem_valor', 'impossibilidade', 'alta',
    'Operação encerrada sem valor recebido',
    'O status diz encerrado, mas o valor recebido está vazio ou zerado. Confirmar quanto entrou.',
    operacoes.filter((o) => o.status === 'encerrado' && !(typeof o.jaRecebido === 'number' && o.jaRecebido > 0)))

  add('valor_sem_data', 'impossibilidade', 'alta',
    'Valor recebido sem data de pagamento',
    'Há valor recebido registrado, mas nenhuma data. Sem a data não há prazo, e sem prazo ' +
    'não há rentabilidade anualizada.',
    operacoes.filter((o) => typeof o.jaRecebido === 'number' && o.jaRecebido > 0 && !o.dataLiquidacao))

  add('data_sem_valor', 'impossibilidade', 'media',
    'Data de pagamento sem valor recebido',
    'Consta data de liquidação, mas nenhum valor. Confirmar se o pagamento ocorreu.',
    operacoes.filter((o) => !!o.dataLiquidacao && !(typeof o.jaRecebido === 'number' && o.jaRecebido > 0)))

  add('liquidacao_antes_aquisicao', 'impossibilidade', 'alta',
    'Pagamento anterior à compra do crédito',
    'A data de liquidação é anterior à de aquisição. Normalmente é erro de ano numa das duas.',
    operacoes.filter((o) => {
      const d = diasEntre(o.dataAquisicao, o.dataLiquidacao ?? '')
      return o.dataLiquidacao !== null && d !== null && d < 0
    }))

  add('referencia_no_futuro', 'impossibilidade', 'media',
    'Data-base do cálculo no futuro',
    'A data de referência do valor de face é posterior a hoje. A projeção fica sem sentido.',
    operacoes.filter((o) => !!o.dataReferencia && o.dataReferencia.slice(0, 10) > hoje.slice(0, 10)))

  add('valores_negativos', 'impossibilidade', 'alta',
    'Valor negativo',
    'Capital, face ou recebido com sinal negativo. Corrigir antes de qualquer análise.',
    operacoes.filter((o) =>
      (typeof o.capitalInvestido === 'number' && o.capitalInvestido < 0) ||
      (typeof o.valorFace === 'number' && o.valorFace < 0) ||
      (typeof o.jaRecebido === 'number' && o.jaRecebido < 0)))

  add('sem_capital', 'impossibilidade', 'alta',
    'Operação sem capital investido',
    'Sem capital não há rentabilidade possível. A operação fica fora de toda métrica de ' +
    'performance — não entra como zero, simplesmente não entra.',
    operacoes.filter((o) => !(typeof o.capitalInvestido === 'number' && o.capitalInvestido > 0)))

  add('sem_indice', 'impossibilidade', 'media',
    'Operação em aberto sem índice de atualização',
    'Sem SELIC ou IPCA+2 cadastrado, o valor projetado não pode ser calculado e a operação ' +
    'não aparece no forecast.',
    operacoes.filter((o) => !o.dataLiquidacao && !o.indice))

  // CNJ duplicado: pode ser aquisição complementar legítima no mesmo processo.
  const porCnj = new Map<string, OperacaoAnalitica[]>()
  for (const o of operacoes) {
    if (!o.numeroCnj) continue
    const l = porCnj.get(o.numeroCnj)
    if (l) l.push(o); else porCnj.set(o.numeroCnj, [o])
  }
  add('cnj_duplicado', 'sinal', 'media',
    'Mesmo processo em mais de uma operação',
    'Pode ser aquisição complementar legítima no mesmo processo — ou cadastro em duplicidade. ' +
    'Se for legítimo, as duas linhas somam capital e a análise por processo precisa consolidá-las.',
    [...porCnj.values()].filter((l) => l.length > 1).flat())

  // Texto livre com espaço em branco nas pontas: cria grupo fantasma.
  add('texto_com_espaco', 'impossibilidade', 'media',
    'Tribunal ou ente com espaço invisível',
    'O texto termina ou começa com espaço ou tabulação. Isso cria um grupo separado nas ' +
    'análises: a carteira já tem "Município de Goiânia" convivendo com a mesma grafia ' +
    'terminada em tabulação, contadas como dois entes diferentes.',
    operacoes.filter((o) =>
      (o.tribunal !== null && o.tribunal !== o.tribunal?.trim()) ||
      (o.ente !== null && o.ente !== o.ente?.trim())))

  // ---- sinais estatísticos ----
  add('previsao_vencida_180', 'sinal', 'alta',
    'Previsão vencida há mais de 180 dias',
    'A data prevista passou há mais de seis meses e não houve pagamento nem nova estimativa. ' +
    'Corte operacional, não estatístico. Rever a expectativa com base no andamento processual.',
    operacoes.filter((o) => !o.dataLiquidacao && (o.diasVencida ?? 0) > 180))

  add('previsao_vencida_90', 'sinal', 'media',
    'Previsão vencida entre 90 e 180 dias',
    'Corte operacional. Vale conferir se o processo teve movimentação que justifique nova data.',
    operacoes.filter((o) => !o.dataLiquidacao && (o.diasVencida ?? 0) > 90 && (o.diasVencida ?? 0) <= 180))

  add('sem_previsao_aberta', 'sinal', 'media',
    'Operação em aberto sem data prevista',
    'Não entra em nenhum mês do forecast. Fica num bloco à parte até receber uma estimativa.',
    operacoes.filter((o) => !o.dataLiquidacao && !o.expectativaLiquidacao))

  // Extremos: marcados pela distribuição observada, nunca por número fixo.
  const elegiveis = operacoes.filter((o) => o.status === 'encerrado' && o.tirAnual !== null)
  const extTir = marcarExtremos(elegiveis, (o) => o.tirAnual)
  add('tir_extrema', 'sinal', 'baixa',
    'Rentabilidade anualizada muito fora do padrão',
    'Fora do intervalo interquartil ampliado da carteira. Quase sempre é efeito de prazo ' +
    'muito curto, não de rentabilidade excepcional: o dado está certo, a leitura é que exige ' +
    'ver o prazo ao lado. Não foi excluído de nenhum cálculo.',
    extTir.fora)

  const extRet = marcarExtremos(elegiveis, (o) => o.retorno)
  add('retorno_extremo', 'sinal', 'baixa',
    'Rentabilidade total muito fora do padrão',
    'Fora do intervalo interquartil ampliado. Pode ser um evento econômico real. ' +
    'Não foi excluído de nenhum cálculo.',
    extRet.fora)

  const refs = new Set(achados.flatMap((a) => a.refs))
  const ordem: Record<Gravidade, number> = { alta: 0, media: 1, baixa: 2 }
  achados.sort((a, b) =>
    ordem[a.gravidade] - ordem[b.gravidade] ||
    (a.natureza === b.natureza ? 0 : a.natureza === 'impossibilidade' ? -1 : 1))

  return {
    achados,
    totalOperacoes: operacoes.length,
    operacoesComAchado: refs.size,
    aviso:
      'Possível inconsistência — requer revisão. Nenhum dado foi alterado. ' +
      'Um resultado estatisticamente atípico não é necessariamente um erro.',
  }
}
