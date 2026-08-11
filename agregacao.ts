// NÚCLEO COMPARTILHADO — agregação e recortes.
//
// Aqui mora a regra central do módulo: toda métrica agregada sai em DUAS
// leituras que nunca se substituem —
//
//   "operação típica"        mediana dos resultados individuais
//   "comportamento do capital"  Σganhos / Σcapitais
//
// Quando as duas divergem, a divergência É a informação. Escolher uma delas
// seria enganoso nos dois sentidos.
//
// Todo grupo carrega a classe de representatividade e quantas operações
// ficaram de fora do cálculo. Silêncio sobre exclusão equivale a fabricar
// completude.

import { distribuicao, mediaPonderada, marcarExtremos, icMediana, type Distribuicao } from './estatistica.ts'
import { classificarAmostra, type Representatividade } from './amostra.ts'
import { elegivelPerformance, type OperacaoAnalitica } from './tipos.ts'
import { diasEntre } from './datas.ts'

export interface ResumoGrupo {
  nome: string
  /** Operações no grupo, de qualquer população. */
  total: number
  /** Elegíveis para performance (encerradas com dados completos). */
  n: number
  /** Elegíveis descartadas por falta de dado, com o motivo agregado. */
  excluidas: number

  capitalInvestido: number
  valorRecebido: number
  complementar: number
  ganhoNominal: number

  /** Σganho / Σcapital — o comportamento do capital. Fração. */
  retornoPonderado: number | null
  /** Distribuição dos retornos individuais — a operação típica. Frações. */
  retorno: Distribuicao
  /** IC de 95% da mediana do retorno. null quando n ≤ 5. */
  retornoIC: { inferior: number; superior: number; larguraRelativa: number } | null
  tir: Distribuicao
  prazo: Distribuicao

  /** Refs marcadas como extremas na TIR. Marcadas, nunca removidas. */
  extremosTir: string[]

  representatividade: Representatividade
  /** Participação do grupo no capital analisado. Fração. */
  pesoCapital: number | null
}

/**
 * Resume um grupo. `capitalTotalCarteira` alimenta o peso econômico, que anda
 * ao lado da classe estatística e nunca é fundido com ela num índice único.
 */
export function resumoGrupo(
  nome: string,
  operacoes: readonly OperacaoAnalitica[],
  capitalTotalCarteira?: number | null,
): ResumoGrupo {
  const elegiveis = operacoes.filter(elegivelPerformance)
  const encerradas = operacoes.filter((o) => o.status === 'encerrado')

  const capitalInvestido = soma(elegiveis.map((o) => o.capitalInvestido))
  const valorRecebido = soma(elegiveis.map((o) => o.jaRecebido))
  const complementar = soma(elegiveis.map((o) => o.valorComplementar))

  const ponderado = mediaPonderada(
    elegiveis.map((o) => ({ valor: o.retorno, peso: o.capitalInvestido })),
  )
  const retornos = elegiveis.map((o) => o.retorno)
  const ic = icMediana(retornos)
  const extremos = marcarExtremos(elegiveis, (o) => o.tirAnual)

  return {
    nome,
    total: operacoes.length,
    n: elegiveis.length,
    excluidas: encerradas.length - elegiveis.length,
    capitalInvestido,
    valorRecebido,
    complementar,
    ganhoNominal: valorRecebido + complementar - capitalInvestido,
    retornoPonderado: ponderado.valor,
    retorno: distribuicao(retornos),
    retornoIC: ic
      ? { inferior: ic.inferior, superior: ic.superior, larguraRelativa: ic.larguraRelativa }
      : null,
    tir: distribuicao(elegiveis.map((o) => o.tirAnual)),
    prazo: distribuicao(elegiveis.map((o) => o.prazoDias)),
    extremosTir: extremos.fora.map((o) => o.ref),
    representatividade: classificarAmostra(elegiveis.length, capitalInvestido, capitalTotalCarteira),
    pesoCapital:
      typeof capitalTotalCarteira === 'number' && capitalTotalCarteira > 0
        ? capitalInvestido / capitalTotalCarteira
        : null,
  }
}

function soma(vs: readonly (number | null | undefined)[]): number {
  let s = 0
  for (const v of vs) if (typeof v === 'number' && Number.isFinite(v)) s += v
  return s
}

/**
 * Agrupa por uma chave textual e resume cada grupo.
 *
 * A chave passa por `trim()` porque tribunal e ente são texto livre sem
 * normalização no banco — e a carteira real já tem uma duplicata provada:
 * "Município de Goiânia" convive com a mesma grafia terminada em TABULAÇÃO.
 * Atenção: `btrim()` do Postgres sem segundo argumento NÃO remove tabulação;
 * só o `trim()` do JavaScript, que remove todo espaço em branco, resolve.
 */
export function agruparPor(
  operacoes: readonly OperacaoAnalitica[],
  chave: (op: OperacaoAnalitica) => string | null | undefined,
  rotuloVazio = '(não informado)',
): ResumoGrupo[] {
  const capitalTotal = soma(operacoes.filter(elegivelPerformance).map((o) => o.capitalInvestido))
  const mapa = new Map<string, OperacaoAnalitica[]>()
  for (const op of operacoes) {
    const bruto = chave(op)
    const k = typeof bruto === 'string' && bruto.trim() ? bruto.trim() : rotuloVazio
    const lista = mapa.get(k)
    if (lista) lista.push(op)
    else mapa.set(k, [op])
  }
  return [...mapa.entries()]
    .map(([nome, ops]) => resumoGrupo(nome, ops, capitalTotal))
    .sort((a, b) => b.total - a.total)
}

// ---------------------------------------------------------------------------
// Faixas de valor por quartil observado (item 11)
// ---------------------------------------------------------------------------

export interface FaixasValor {
  cortes: { q1: number | null; mediana: number | null; q3: number | null }
  grupos: ResumoGrupo[]
  /**
   * Razão p90/p10 do capital investido. Na carteira de 2026-08 vale 2,2× — a
   * carteira é homogênea em tamanho, então o recorte por faixa dificilmente
   * revela comportamento distinto. O aviso vai junto do dado.
   */
  amplitude: number | null
  homogenea: boolean
}

/**
 * Faixas derivadas dos quartis OBSERVADOS, recalculadas a cada carga. Nunca
 * valores fixos: um corte em "R$ 50 mil" seria arbitrário e envelheceria.
 */
export function faixasPorQuartil(operacoes: readonly OperacaoAnalitica[]): FaixasValor {
  const d = distribuicao(operacoes.map((o) => o.capitalInvestido))
  const { p25, mediana, p75, p10, p90 } = { ...d, mediana: d.mediana }
  const rotulo = (op: OperacaoAnalitica): string => {
    const c = op.capitalInvestido
    if (typeof c !== 'number') return '(sem capital)'
    if (p25 !== null && c <= p25) return `Q1 — até ${moeda(p25)}`
    if (mediana !== null && c <= mediana) return `Q2 — ${moeda(p25)} a ${moeda(mediana)}`
    if (p75 !== null && c <= p75) return `Q3 — ${moeda(mediana)} a ${moeda(p75)}`
    return `Q4 — acima de ${moeda(p75)}`
  }
  const amplitude = p10 !== null && p90 !== null && p10 > 0 ? p90 / p10 : null
  return {
    cortes: { q1: p25, mediana, q3: p75 },
    grupos: agruparPor(operacoes, rotulo),
    amplitude,
    // Abaixo de 3× entre o percentil 10 e o 90, as faixas descrevem operações
    // parecidas demais para que a diferença entre elas signifique algo.
    homogenea: amplitude !== null && amplitude < 3,
  }
}

function moeda(v: number | null): string {
  if (v === null) return '—'
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}

// ---------------------------------------------------------------------------
// Curva de safra (item 12)
// ---------------------------------------------------------------------------

export interface PontoCurva {
  /** Idade em meses desde a aquisição. */
  idadeMeses: number
  /** Fração do capital devolvida até essa idade. */
  fracaoDevolvida: number
  /** Operações da safra que já tiveram tempo de alcançar essa idade. */
  nDisponivel: number
  capitalDisponivel: number
}

export interface CurvaSafra {
  safra: string
  pontos: PontoCurva[]
  /** Maior idade que a safra já alcançou. */
  idadeMaxima: number
  totalOperacoes: number
  taxaEncerramento: number
}

export interface ComparacaoSafras {
  curvas: CurvaSafra[]
  /**
   * Idade até onde a comparação é legítima: a idade máxima da safra mais nova.
   * Comparar além disso é comparar maturidades diferentes.
   */
  tetoComparavel: number
  /** Safras cuja amostra na idade-teto é insuficiente (n ≤ 5). */
  safrasFracasNoTeto: string[]
}

function idadeEmMeses(de: string, ate: string): number {
  const a = de.slice(0, 10), b = ate.slice(0, 10)
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0)
}

/**
 * Curvas de safra — o único jeito honesto de comparar coortes de maturidades
 * diferentes.
 *
 * Em vez de comparar o resultado final (a safra de 2025 está 78,7% encerrada,
 * a de 2026 está 18,2%), compara-se cada safra NA MESMA IDADE: quanto do
 * capital voltou até m meses após a aquisição, contando em cada idade só as
 * operações que já tiveram tempo de chegar lá.
 *
 * Isso não atenua o viés de sobrevivência — elimina. Sem ele, "2026 paga mais
 * rápido" seria só o efeito de que apenas as operações rápidas de 2026 tiveram
 * tempo de encerrar.
 */
export function curvasDeSafra(
  operacoes: readonly OperacaoAnalitica[],
  hoje: string,
  passoMeses = 2,
): ComparacaoSafras {
  const porSafra = new Map<string, OperacaoAnalitica[]>()
  for (const op of operacoes) {
    if (!op.dataAquisicao || typeof op.capitalInvestido !== 'number') continue
    const ano = op.dataAquisicao.slice(0, 4)
    const l = porSafra.get(ano)
    if (l) l.push(op)
    else porSafra.set(ano, [op])
  }

  const curvas: CurvaSafra[] = []
  for (const [safra, ops] of [...porSafra.entries()].sort()) {
    const idadeMaxima = Math.max(...ops.map((o) => idadeEmMeses(o.dataAquisicao!, hoje)))
    const pontos: PontoCurva[] = []
    for (let m = 0; m <= idadeMaxima; m += passoMeses) {
      const disponiveis = ops.filter((o) => idadeEmMeses(o.dataAquisicao!, hoje) >= m)
      if (disponiveis.length === 0) continue
      const capital = soma(disponiveis.map((o) => o.capitalInvestido))
      const devolvido = soma(
        disponiveis
          .filter((o) => o.dataLiquidacao && idadeEmMeses(o.dataAquisicao!, o.dataLiquidacao) <= m)
          .map((o) => o.jaRecebido),
      )
      pontos.push({
        idadeMeses: m,
        fracaoDevolvida: capital > 0 ? devolvido / capital : 0,
        nDisponivel: disponiveis.length,
        capitalDisponivel: capital,
      })
    }
    curvas.push({
      safra,
      pontos,
      idadeMaxima,
      totalOperacoes: ops.length,
      taxaEncerramento: ops.filter((o) => o.dataLiquidacao).length / ops.length,
    })
  }

  const tetoComparavel = curvas.length ? Math.min(...curvas.map((c) => c.idadeMaxima)) : 0
  const safrasFracasNoTeto = curvas
    .filter((c) => {
      const p = [...c.pontos].reverse().find((x) => x.idadeMeses <= tetoComparavel)
      return !p || p.nDisponivel <= 5
    })
    .map((c) => c.safra)

  return { curvas, tetoComparavel, safrasFracasNoTeto }
}

// ---------------------------------------------------------------------------
// Aderência das previsões, com o que dá para medir hoje (item 13, parcial)
// ---------------------------------------------------------------------------

export interface AderenciaPrevisao {
  /** Pagas que tinham previsão registrada. Na carteira atual: 13 de 54. */
  n: number
  /** Pagas sem previsão registrada — não entram na conta, e o número aparece. */
  semPrevisao: number
  desvioDias: Distribuicao
  pagasAteAPrevisao: number
  pagasDepois: number
  representatividade: Representatividade
}

/**
 * Mede previsão contra realidade usando apenas a ÚLTIMA previsão conhecida.
 *
 * É o teto do que se pode medir sem o histórico: previsão original e número de
 * reprogramações só existem depois que processos_historico começa a acumular.
 */
export function aderenciaPrevisao(
  operacoes: readonly OperacaoAnalitica[],
): AderenciaPrevisao {
  const pagas = operacoes.filter((o) => o.dataLiquidacao)
  const comAmbas = pagas.filter((o) => o.expectativaLiquidacao)
  const desvios = comAmbas.map((o) => diasEntre(o.expectativaLiquidacao, o.dataLiquidacao!))
  return {
    n: comAmbas.length,
    semPrevisao: pagas.length - comAmbas.length,
    desvioDias: distribuicao(desvios),
    pagasAteAPrevisao: desvios.filter((d) => d !== null && d <= 0).length,
    pagasDepois: desvios.filter((d) => d !== null && d > 0).length,
    representatividade: classificarAmostra(comAmbas.length),
  }
}
