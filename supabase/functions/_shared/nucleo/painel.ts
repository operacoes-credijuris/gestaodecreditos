// NÚCLEO COMPARTILHADO — montagem do painel de inteligência econômica.
//
// Transforma Processo[] em OperacaoAnalitica[] aplicando as fórmulas de
// projecao.ts UMA VEZ, e monta o painel completo a partir daí. Toda tela, todo
// relatório e a ferramenta do assistente consomem este mesmo resultado — é o
// que garante que ninguém recalcule um indicador de um jeito diferente.
//
// Nenhuma conta nova mora aqui. Isto é montagem.

import {
  valorProjetado, ganhoProjetado, retorno as retornoPct, tir,
  type ParametrosAtualizacao,
} from './projecao.ts'
import { diasEntre } from './datas.ts'
import type { OperacaoAnalitica } from './tipos.ts'
import { elegivelPerformance } from './tipos.ts'
import {
  resumoGrupo, agruparPor, faixasPorQuartil, curvasDeSafra, aderenciaPrevisao,
  type ResumoGrupo, type FaixasValor, type ComparacaoSafras, type AderenciaPrevisao,
} from './agregacao.ts'
import {
  forecastNominal, ajusteHistorico, desviosObservados,
  type ForecastNominal, type Ajuste,
} from './forecast.ts'
import {
  detectarAnomalias, type RelatorioAnomalias,
} from './anomalias.ts'
import { gerarInsights, type Insight } from './insights.ts'
import { concentracao } from './amostra.ts'
import { normalizarNome } from './texto.ts'

/**
 * O que o núcleo precisa de um crédito. Compatível com `Processo` de
 * src/lib/types.ts, declarado aqui para que as Edge Functions (Deno) não
 * dependam de src/.
 */
export interface CreditoBruto {
  id: string
  numero_cnj: string
  tribunal: string | null
  entidade_devedora: string | null
  cessionario: string | null
  status: string
  data_aquisicao: string | null
  data_referencia: string | null
  expectativa_liquidacao: string | null
  data_liquidacao: string | null
  capital_investido: number | null
  valor_face: number | null
  ja_recebido: number | null
  valor_estimado_complementar: number | null
  indice_atualizacao: string | null
}

export type {
  OperacaoAnalitica, ResumoGrupo, FaixasValor, ComparacaoSafras,
  AderenciaPrevisao, ForecastNominal, Ajuste, RelatorioAnomalias, Insight,
}

/**
 * Aplica as fórmulas da plataforma a um crédito e devolve o registro
 * analítico. É o único ponto onde projecao.ts é chamado pelo módulo.
 */
export function analisar(
  p: CreditoBruto,
  params: ParametrosAtualizacao | undefined,
  hoje: string,
): OperacaoAnalitica {
  const proj = valorProjetado(p, params, hoje)
  const ganho = ganhoProjetado(proj, p.capital_investido, p.valor_estimado_complementar)
  const t = tir(p.capital_investido, p.data_aquisicao, proj)
  const exp = p.expectativa_liquidacao?.slice(0, 10) ?? null
  const vencida = !p.data_liquidacao && !!exp && exp < hoje.slice(0, 10)

  return {
    ref: p.id.slice(0, 8),
    numeroCnj: p.numero_cnj ?? null,
    // trim() porque tribunal e ente são texto livre: a base já tem um ente
    // duplicado por uma TABULAÇÃO no fim do nome.
    tribunal: p.tribunal?.trim() || null,
    ente: p.entidade_devedora?.trim() || null,
    investidor: p.cessionario?.trim() || null,
    status: p.status,
    dataAquisicao: p.data_aquisicao,
    dataReferencia: p.data_referencia,
    expectativaLiquidacao: exp,
    dataLiquidacao: p.data_liquidacao,
    capitalInvestido: p.capital_investido,
    valorFace: p.valor_face,
    jaRecebido: p.ja_recebido,
    valorComplementar: p.valor_estimado_complementar,
    indice: p.indice_atualizacao,
    valor: proj.valor,
    valorAte: proj.atualizadoAte ?? null,
    motivoSemValor: proj.motivo ?? null,
    ganho,
    // Frações, não pontos percentuais: a formatação é da tela.
    retorno: retornoPct(ganho, p.capital_investido) !== null
      ? retornoPct(ganho, p.capital_investido)! / 100
      : null,
    tirAnual: t.anual !== null ? t.anual / 100 : null,
    prazoDias: p.data_liquidacao ? diasEntre(p.data_aquisicao, p.data_liquidacao) : null,
    previsaoVencida: vencida,
    diasVencida: vencida ? diasEntre(exp, hoje) : null,
  }
}

export interface PainelEconomico {
  operacoes: OperacaoAnalitica[]
  /** Só as encerradas de fato, com dados completos. */
  encerradas: OperacaoAnalitica[]
  carteira: ResumoGrupo
  /**
   * Capital investido em TODA a carteira, independente do status: encerradas,
   * em complementar e em aberto somadas.
   *
   * Existe separado de `carteira.capitalInvestido` — que só conta as encerradas
   * elegíveis — porque são perguntas diferentes. "Quanto a casa já colocou de
   * dinheiro na rua" é a primeira; "sobre quanto capital a performance realizada
   * foi medida" é a segunda. Misturar as duas foi confusão real na Visão Geral.
   */
  capitalTotalInvestido: number
  /**
   * Quantas das operações têm capital cadastrado. Se for menor que o total, o
   * capital acima está subestimado por falta de cadastro — e a tela precisa
   * dizer isso em vez de apresentar o número como completo.
   */
  operacoesComCapital: number
  porTribunal: ResumoGrupo[]
  porEnte: ResumoGrupo[]
  porInvestidor: ResumoGrupo[]
  faixas: FaixasValor
  safras: ComparacaoSafras
  aderencia: AderenciaPrevisao
  forecast: ForecastNominal
  ajuste: Ajuste
  anomalias: RelatorioAnomalias
  insights: Insight[]
  concentracao: ReturnType<typeof concentracao>
  hoje: string
  /** Data-base dos parâmetros SELIC/IPCA usados na projeção. */
  parametrosEm: string | null
}

/**
 * Monta o painel inteiro. Uma chamada, um resultado, consumido por todas as
 * telas — nenhuma delas refaz conta.
 */
export function montarPainel(
  processos: readonly CreditoBruto[],
  params: ParametrosAtualizacao | undefined,
  hoje: string,
): PainelEconomico {
  const operacoes = processos.map((p) => analisar(p, params, hoje))
  const encerradas = operacoes.filter(elegivelPerformance)
  const capitalTotal = encerradas.reduce((s, o) => s + (o.capitalInvestido ?? 0), 0)

  // Capital de TODA a carteira, sem filtro de status. Operação sem capital
  // cadastrado não entra como zero: fica fora da soma e é contada à parte,
  // para a tela poder dizer que o total está incompleto em vez de fingir.
  const comCapital = operacoes.filter(
    (o) => typeof o.capitalInvestido === 'number' && Number.isFinite(o.capitalInvestido),
  )
  const capitalTotalInvestido = comCapital.reduce((s, o) => s + (o.capitalInvestido ?? 0), 0)

  const carteira = resumoGrupo('Carteira', operacoes, capitalTotal)
  const porTribunal = agruparPor(operacoes, (o) => o.tribunal, '(sem tribunal)')
  const porEnte = agruparPor(operacoes, (o) => o.ente, '(sem ente devedor)')
  // Investidor: agrupa pelo nome normalizado, que é como a plataforma já une
  // as grafias em Carteiras de Investimentos e em investidor_dados.
  const porInvestidor = agruparPor(
    operacoes,
    (o) => (o.investidor ? normalizarNome(o.investidor) : null),
    '(sem investidor)',
    // A chave agrupa; o rótulo exibe. `normalizarNome` tira acento e baixa a
    // caixa — é chave primária de investidor_dados e não pode mudar —, então
    // a grafia original vem por aqui.
    (o) => o.investidor,
  )
  const forecast = forecastNominal(operacoes, hoje)
  const aderencia = aderenciaPrevisao(operacoes)
  const safras = curvasDeSafra(operacoes, hoje)
  const anomalias = detectarAnomalias(operacoes, hoje)

  return {
    operacoes,
    encerradas,
    carteira,
    capitalTotalInvestido,
    operacoesComCapital: comCapital.length,
    porTribunal,
    porEnte,
    porInvestidor,
    faixas: faixasPorQuartil(operacoes),
    safras,
    aderencia,
    forecast,
    ajuste: ajusteHistorico(desviosObservados(operacoes), operacoes, hoje),
    anomalias,
    insights: gerarInsights({
      operacoes, carteira, porTribunal, porEnte, safras, aderencia, forecast, anomalias,
    }),
    concentracao: concentracao(
      porTribunal.map((g) => ({ nome: g.nome, n: g.total, capital: g.capitalInvestido })),
    ),
    hoje,
    parametrosEm: params?.data_referencia ?? null,
  }
}
