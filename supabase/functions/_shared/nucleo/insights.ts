// NÚCLEO COMPARTILHADO — insights automáticos (item 16).
//
// GERADOS POR REGRA, NUNCA POR TEXTO LIVRE DE MODELO.
//
// Cada insight é um template preenchido com números que a camada de cálculo já
// produziu. O assistente pode EXPLICAR um insight; não pode inventar um. Isso
// fecha a porta para o sistema afirmar algo que os dados não sustentam — que é
// o risco central de gerar análise econômica com modelo de linguagem.
//
// Todo insight carrega n e, quando cabe, participação no capital. Insight
// sobre grupo em classe insuficiente NÃO É GERADO — nem com ressalva, porque
// ressalva em texto curto não é lida.

import { concentracao } from './amostra.ts'
import { elegivelPerformance, type OperacaoAnalitica } from './tipos.ts'
import type { ResumoGrupo, ComparacaoSafras, AderenciaPrevisao } from './agregacao.ts'
import type { ForecastNominal } from './forecast.ts'
import type { RelatorioAnomalias } from './anomalias.ts'

export type TomInsight = 'neutro' | 'atencao' | 'metodologico'

export interface Insight {
  chave: string
  tom: TomInsight
  texto: string
  /** A base que sustenta a frase. Sempre exibida junto. */
  base: string
  /** Ordem de exibição: menor primeiro. */
  prioridade: number
}

const pct = (f: number | null, casas = 1) =>
  f === null ? '—' : `${(f * 100).toFixed(casas).replace('.', ',')}%`
const brl = (v: number | null) =>
  v === null ? '—' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dias = (v: number | null) => (v === null ? '—' : `${Math.round(v)} dias`)

export interface EntradaInsights {
  operacoes: readonly OperacaoAnalitica[]
  carteira: ResumoGrupo
  porTribunal: readonly ResumoGrupo[]
  porEnte: readonly ResumoGrupo[]
  safras: ComparacaoSafras
  aderencia: AderenciaPrevisao
  forecast: ForecastNominal
  anomalias: RelatorioAnomalias
}

export function gerarInsights(e: EntradaInsights): Insight[] {
  const out: Insight[] = []
  const add = (i: Insight) => out.push(i)

  // ---- 1. Previsão vencida: o número mais acionável da carteira ----
  const vencidas = e.operacoes.filter((o) => !o.dataLiquidacao && (o.diasVencida ?? 0) > 0)
  const abertas = e.operacoes.filter((o) => !o.dataLiquidacao)
  if (vencidas.length && abertas.length) {
    const mais180 = vencidas.filter((o) => (o.diasVencida ?? 0) > 180).length
    add({
      chave: 'previsao_vencida',
      tom: 'atencao',
      prioridade: 1,
      texto:
        `${pct(vencidas.length / abertas.length)} das operações em aberto ` +
        `(${vencidas.length} de ${abertas.length}) estão com a previsão de pagamento vencida` +
        (mais180 ? `, e ${mais180} ${mais180 === 1 ? 'está' : 'estão'} vencidas há mais de 180 dias` : '') +
        `. Isso representa ${pct(e.forecast.fracaoVencida)} de tudo que a carteira tem a receber.`,
      base:
        `${brl(e.forecast.blocos.find((b) => b.rotulo === 'Previsão vencida')?.valor ?? null)} ` +
        `sem data crível associada. Esse valor fica em bloco próprio no forecast, e não é ` +
        'distribuído em meses futuros.',
    })
  }

  // ---- 2. Concentração: define o que o módulo pode e não pode responder ----
  const conc = concentracao(
    e.porTribunal.map((g) => ({ nome: g.nome, n: g.total, capital: g.capitalInvestido })),
  )
  if (conc?.concentrada) {
    add({
      chave: 'concentracao',
      tom: 'metodologico',
      prioridade: 2,
      texto:
        `${pct(conc.fracaoOperacoes)} das operações são do ${conc.maior}. Com essa ` +
        'concentração, não há grupos a comparar: perguntar qual tribunal performa melhor ' +
        'compararia um grupo grande contra ruído.',
      base:
        'Os números de cada tribunal continuam visíveis, cada um com sua classe de ' +
        'representatividade. O que fica bloqueado é a comparação entre eles.',
    })
  }

  // ---- 3. Média × mediana: só quando a divergência é material ----
  const { media, mediana, n } = e.carteira.retorno
  if (media !== null && mediana !== null && n >= 6 && Math.abs(media - mediana) / Math.abs(mediana || 1) > 0.1) {
    add({
      chave: 'assimetria_retorno',
      tom: 'metodologico',
      prioridade: 4,
      texto:
        `A rentabilidade mediana das operações encerradas é ${pct(mediana)} e a média é ` +
        `${pct(media)}. A diferença indica distribuição assimétrica: a média isolada não ` +
        'representa bem o caso típico.',
      base: `${n} operações encerradas. Mediana e média são apresentadas sempre juntas.`,
    })
  }

  // ---- 4. TIR: onde a média realmente engana ----
  const tir = e.carteira.tir
  if (tir.media !== null && tir.mediana !== null && tir.n >= 6 && tir.media > tir.mediana * 2) {
    add({
      chave: 'tir_extrema',
      tom: 'metodologico',
      prioridade: 3,
      texto:
        `A rentabilidade anualizada mediana é ${pct(tir.mediana)}, mas a média aritmética ` +
        `chega a ${pct(tir.media, 0)}. A diferença vem de operações de prazo muito curto, ` +
        'cuja taxa anualizada fica altíssima sem que o ganho seja excepcional.',
      base:
        `${e.carteira.extremosTir.length} ${e.carteira.extremosTir.length === 1 ? 'operação foi marcada' : 'operações foram marcadas'} ` +
        'como extremo. Nenhuma foi excluída de nenhum cálculo — a defesa é usar a mediana ' +
        'e a taxa agregada, não remover o dado.',
    })
  }

  // ---- 5. Operação típica × comportamento do capital ----
  if (mediana !== null && e.carteira.retornoPonderado !== null && n >= 6) {
    const dif = Math.abs(e.carteira.retornoPonderado - mediana)
    if (dif > 0.03) {
      add({
        chave: 'tipica_vs_capital',
        tom: 'metodologico',
        prioridade: 5,
        texto:
          `A operação típica rendeu ${pct(mediana)}, mas o capital investido rendeu ` +
          `${pct(e.carteira.retornoPonderado)}. Os dois números respondem perguntas diferentes: ` +
          'o primeiro descreve uma operação qualquer, o segundo descreve o dinheiro.',
        base: `${n} operações, ${brl(e.carteira.capitalInvestido)} de capital analisado.`,
      })
    }
  }

  // ---- 6. Aderência das previsões ----
  if (e.aderencia.representatividade.permiteInsight) {
    const d = e.aderencia.desvioDias
    add({
      chave: 'aderencia',
      tom: d.mediana !== null && d.mediana > 0 ? 'atencao' : 'neutro',
      prioridade: 6,
      texto:
        `Nas operações pagas que tinham previsão registrada, o desvio mediano foi de ` +
        `${dias(d.mediana)} e o médio, de ${dias(d.media)}. ` +
        `${e.aderencia.pagasAteAPrevisao} ${e.aderencia.pagasAteAPrevisao === 1 ? 'foi paga' : 'foram pagas'} ` +
        `até a data prevista e ${e.aderencia.pagasDepois}, depois.`,
      base:
        `${e.aderencia.n} observações. ${e.aderencia.semPrevisao} operações pagas não tinham ` +
        'previsão registrada e ficaram fora da conta. ' +
        `Classe: ${e.aderencia.representatividade.rotulo.toLowerCase()}.`,
    })
  }

  // ---- 7. (removido) Safras ----
  //
  // Havia aqui um insight comparando safras na mesma idade. Foi retirado a
  // pedido do cliente, em 28/08/2026, e a decisão é boa por dois motivos:
  //
  //   · O texto era um parágrafo de metodologia — explicava viés de
  //     sobrevivência antes de dizer qualquer coisa útil. Insight que precisa
  //     de aula não é insight.
  //   · Tinha um defeito real: `safrasFracasNoTeto` não era filtrado pelas
  //     safras efetivamente citadas, então a ressalva chegava a alertar sobre
  //     uma safra que a frase nem mencionava (2024 num texto sobre 2025 e 2026).
  //
  // A comparação por curva de safra continua existindo em Recortes → Safra,
  // onde a tabela mostra a maturidade de cada uma ao lado do número. Lá o
  // contexto é escolhido por quem foi procurar; aqui era empurrado.
  //
  // `e.safras` segue na entrada de propósito: o dado continua correto e
  // disponível caso um insight melhor apareça.

  // ---- 8. Recortes sem base, ditos em voz alta (item 7) ----
  const semBase = [...e.porTribunal, ...e.porEnte].filter(
    (g) => g.total > 0 && !g.representatividade.permiteComparacao,
  )
  if (semBase.length) {
    add({
      chave: 'sem_base',
      tom: 'metodologico',
      prioridade: 8,
      texto:
        `${semBase.length} ${semBase.length === 1 ? 'recorte tem' : 'recortes têm'} amostra ` +
        'abaixo do mínimo para comparação. Os números continuam visíveis, mas não sustentam ' +
        'conclusão sobre desempenho.',
      base: semBase.map((g) => `${g.nome} (${g.n})`).join(', '),
    })
  }

  // ---- 9. Inconsistências ----
  const graves = e.anomalias.achados.filter((a) => a.gravidade === 'alta')
  if (graves.length) {
    add({
      chave: 'anomalias',
      tom: 'atencao',
      prioridade: 9,
      texto:
        `${e.anomalias.operacoesComAchado} ${e.anomalias.operacoesComAchado === 1 ? 'operação aparece' : 'operações aparecem'} ` +
        `na lista de revisão, sendo ${graves.length} ${graves.length === 1 ? 'tipo' : 'tipos'} de achado de gravidade alta.`,
      base: graves.map((a) => a.titulo).join('; ') + '. Nenhum dado foi alterado.',
    })
  }

  // ---- 10. Complementar: por que a carteira não é o que parece ----
  const parciais = e.operacoes.filter((o) => o.status === 'complementar')
  if (parciais.length) {
    const encerradas = e.operacoes.filter(elegivelPerformance).length
    add({
      chave: 'complementar',
      tom: 'metodologico',
      prioridade: 10,
      texto:
        `${parciais.length} operações receberam o principal mas aguardam valor complementar. ` +
        `Elas ficam fora das métricas de performance: incluí-las dividiria um valor recebido ` +
        'incompleto por um capital completo, subestimando a rentabilidade.',
      base:
        `A performance realizada é calculada sobre ${encerradas} operações encerradas de fato.`,
    })
  }

  return out.sort((a, b) => a.prioridade - b.prioridade)
}
