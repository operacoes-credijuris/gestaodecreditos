// NÚCLEO COMPARTILHADO — previsão de recebimentos (item 14).
//
// Duas fases, e a segunda está deliberadamente bloqueada.
//
// FASE 1, disponível: valor nominal por mês, somando o valor projetado das
// operações abertas pelo mês da expectativa. Mais três blocos que NÃO viram
// mês nenhum, porque atribuir data a eles seria inventar:
//   · previsão vencida  · sem previsão  · complementar sem data
//
// FASE 2, bloqueada: estimativa ajustada pelo comportamento histórico. Exige
// 30 pares (previsão → pagamento) com histórico completo. Hoje a carteira tem
// 13, e todos anteriores à implantação do histórico. Até lá a interface diz
// isso em vez de exibir um número inventado — item 14 do briefing proíbe
// fabricar precisão.

import { distribuicao, percentil, type Distribuicao } from './estatistica.ts'
import { classificarAmostra, LIMITE_ALTA } from './amostra.ts'
import { emAberto, type OperacaoAnalitica } from './tipos.ts'
import { diasEntre } from './datas.ts'

export interface MesPrevisto {
  /** 'AAAA-MM'. */
  mes: string
  valor: number
  operacoes: number
  /** Refs, para o usuário chegar da soma até as linhas que a compõem. */
  refs: string[]
}

export interface BlocoSemData {
  rotulo: string
  motivo: string
  valor: number
  operacoes: number
  refs: string[]
}

export interface ForecastNominal {
  meses: MesPrevisto[]
  totalFuturo: number
  blocos: BlocoSemData[]
  /** Futuro + todos os blocos sem data. */
  totalGeral: number
  /** Operações abertas sem valor calculável (falta índice ou parâmetro). */
  incalculaveis: number
  /** Fração do total presa em previsão vencida. 39,5% em 2026-08. */
  fracaoVencida: number
}

/**
 * Forecast nominal. `hoje` decide o que já venceu; vem da tela, não de um
 * relógio interno, para que arquivo e tela não discordem na virada do dia.
 */
export function forecastNominal(
  operacoes: readonly OperacaoAnalitica[],
  hoje: string,
): ForecastNominal {
  const abertas = operacoes.filter(emAberto)

  const porMes = new Map<string, MesPrevisto>()
  const vencidas: OperacaoAnalitica[] = []
  const semPrevisao: OperacaoAnalitica[] = []
  let incalculaveis = 0
  let totalFuturo = 0

  for (const op of abertas) {
    if (op.valor === null) { incalculaveis++; continue }
    if (!op.expectativaLiquidacao) { semPrevisao.push(op); continue }
    const exp = op.expectativaLiquidacao.slice(0, 10)
    if (exp < hoje.slice(0, 10)) { vencidas.push(op); continue }
    const mes = exp.slice(0, 7)
    const atual = porMes.get(mes)
    if (atual) {
      atual.valor += op.valor
      atual.operacoes++
      atual.refs.push(op.ref)
    } else {
      porMes.set(mes, { mes, valor: op.valor, operacoes: 1, refs: [op.ref] })
    }
    totalFuturo += op.valor
  }

  const somaValor = (ops: readonly OperacaoAnalitica[]) =>
    ops.reduce((s, o) => s + (o.valor ?? 0), 0)

  const blocos: BlocoSemData[] = []
  if (vencidas.length) {
    blocos.push({
      rotulo: 'Previsão vencida',
      motivo:
        'A data prevista já passou e o crédito não foi liquidado. Fica em bloco próprio ' +
        'porque distribuir esse valor em meses futuros seria atribuir uma data que ' +
        'ninguém estimou.',
      valor: somaValor(vencidas),
      operacoes: vencidas.length,
      refs: vencidas.map((o) => o.ref),
    })
  }
  if (semPrevisao.length) {
    blocos.push({
      rotulo: 'Sem previsão',
      motivo: 'Operação em aberto sem data prevista cadastrada.',
      valor: somaValor(semPrevisao),
      operacoes: semPrevisao.length,
      refs: semPrevisao.map((o) => o.ref),
    })
  }
  const parciais = operacoes.filter(
    (o) => o.status === 'complementar' && typeof o.valorComplementar === 'number' && o.valorComplementar > 0,
  )
  if (parciais.length) {
    blocos.push({
      rotulo: 'Complementar a receber',
      motivo:
        'Operações que receberam o principal e aguardam o valor complementar. Não há ' +
        'data prevista para esse segundo recebimento no cadastro.',
      valor: parciais.reduce((s, o) => s + (o.valorComplementar ?? 0), 0),
      operacoes: parciais.length,
      refs: parciais.map((o) => o.ref),
    })
  }

  const totalBlocos = blocos.reduce((s, b) => s + b.valor, 0)
  const totalGeral = totalFuturo + totalBlocos
  const vencido = blocos.find((b) => b.rotulo === 'Previsão vencida')?.valor ?? 0

  return {
    meses: [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
    totalFuturo,
    blocos,
    totalGeral,
    incalculaveis,
    fracaoVencida: totalGeral > 0 ? vencido / totalGeral : 0,
  }
}

// ---------------------------------------------------------------------------
// Fase 2 — ajuste histórico
// ---------------------------------------------------------------------------

export interface AjusteHistorico {
  disponivel: false
  observacoes: number
  necessarias: number
  mensagem: string
}

export interface AjusteAplicado {
  disponivel: true
  observacoes: number
  /** Deslocamento mediano observado, em dias. */
  desvioMediano: number
  /** Percentil 75 do atraso: base do cenário conservador. */
  desvioP75: number
  cenarioMediano: MesPrevisto[]
  cenarioConservador: MesPrevisto[]
  metodologia: string
}

export type Ajuste = AjusteHistorico | AjusteAplicado

/**
 * Estimativa ajustada — só existe com base suficiente.
 *
 * `desvios` são os pares (previsão → pagamento) já observados, em dias. Exige
 * classe ALTA (30+), porque abaixo disso o próprio deslocamento mediano teria
 * intervalo de confiança largo demais para corrigir coisa alguma: seria
 * transferir incerteza de um lugar para outro fingindo que virou precisão.
 *
 * Método quando liberado: desloca cada data prevista pelo desvio mediano
 * observado (cenário mediano) e pelo percentil 75 (cenário conservador),
 * reagrupando por mês. Nunca um ponto único sem intervalo.
 */
export function ajusteHistorico(
  desviosObservados: readonly (number | null | undefined)[],
  operacoes: readonly OperacaoAnalitica[],
  hoje: string,
): Ajuste {
  const d = distribuicao(desviosObservados)
  const classe = classificarAmostra(d.n)

  if (classe.classe !== 'alta') {
    return {
      disponivel: false,
      observacoes: d.n,
      necessarias: LIMITE_ALTA,
      mensagem:
        `Histórico insuficiente para estimativa ajustada confiável ` +
        `(${d.n} de ${LIMITE_ALTA} observações necessárias). ` +
        'Exibindo apenas o valor nominal previsto.',
    }
  }

  const mediano = d.mediana ?? 0
  const p75 = percentil(desviosObservados, 0.75) ?? mediano

  const deslocar = (dias: number): MesPrevisto[] => {
    const mapa = new Map<string, MesPrevisto>()
    for (const op of operacoes) {
      if (!emAberto(op) || op.valor === null || !op.expectativaLiquidacao) continue
      const base = op.expectativaLiquidacao.slice(0, 10)
      if (base < hoje.slice(0, 10)) continue
      const alvo = somarDias(base, Math.round(dias))
      const mes = alvo.slice(0, 7)
      const a = mapa.get(mes)
      if (a) { a.valor += op.valor; a.operacoes++; a.refs.push(op.ref) }
      else mapa.set(mes, { mes, valor: op.valor, operacoes: 1, refs: [op.ref] })
    }
    return [...mapa.values()].sort((x, y) => x.mes.localeCompare(y.mes))
  }

  return {
    disponivel: true,
    observacoes: d.n,
    desvioMediano: mediano,
    desvioP75: p75,
    cenarioMediano: deslocar(mediano),
    cenarioConservador: deslocar(p75),
    metodologia:
      `Cada data prevista foi deslocada pelo desvio observado entre previsão e pagamento ` +
      `em ${d.n} operações já liquidadas. Cenário mediano: ${Math.round(mediano)} dias. ` +
      `Cenário conservador (percentil 75): ${Math.round(p75)} dias. ` +
      'Não é uma previsão pontual — são dois pontos de uma distribuição.',
  }
}

function somarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const base = Date.UTC(y, m - 1, d) + dias * 86400000
  const dt = new Date(base)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

/** Extrai os desvios observados, para alimentar `ajusteHistorico`. */
export function desviosObservados(operacoes: readonly OperacaoAnalitica[]): number[] {
  const out: number[] = []
  for (const op of operacoes) {
    if (!op.dataLiquidacao || !op.expectativaLiquidacao) continue
    const d = diasEntre(op.expectativaLiquidacao, op.dataLiquidacao)
    if (d !== null) out.push(d)
  }
  return out
}

export type { Distribuicao }
