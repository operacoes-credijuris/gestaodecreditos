// IRRF pela tabela progressiva — o desconto que incide sobre os honorários.
//
// POR QUE ISTO É CÓDIGO E NÃO PROMPT. O modelo de planilha trazia, na célula do
// IR dos honorários, o texto "[ESTIMAR CONFORME TABELA PROGRESSIVA DE IR]", à
// espera de que a IA pusesse um número ali. Ela não punha — e como a célula
// guarda TEXTO, a fórmula que a subtrai (`=(K5*0,3)-M7`) devolvia #VALUE!, o
// que contaminava o líquido, o total da operação e a rentabilidade.
//
// Pedir a uma IA que "estime" um tributo é errar de duas formas: ela pode não
// responder (foi o que houve) ou responder um número plausível e errado, que
// ninguém confere porque parece certo. A tabela é pública, tem cinco linhas e
// não muda no meio do exercício: é conta, não julgamento.
//
// SEM DEPENDÊNCIA NENHUMA de propósito, como _shared/emolumentos-calculo.ts:
// assim os testes em src/lib/__tests__ alcançam a conta.

/** Uma linha da tabela progressiva mensal. */
export interface FaixaIr {
  /** Teto da faixa; null na última. */
  ate: number | null
  aliquota: number
  /** A parcela a deduzir já embute o efeito das faixas anteriores. */
  deduzir: number
}

/**
 * Tabela progressiva MENSAL do IRRF vigente em 2026.
 *
 * Conferida em duas fontes independentes. A parcela a deduzir é o que torna a
 * tabela progressiva de fato: sem ela, quem ganha um centavo a mais que o teto
 * de uma faixa pagaria a alíquota cheia sobre tudo.
 *
 * NÃO ENTRA AQUI o redutor da Lei 15.270/2025 (o que zera o imposto até cerca
 * de R$ 5.000 mensais e decresce até R$ 7.350). Ele foi pensado para renda
 * mensal do trabalho, e honorário de requisitório é pagamento único; aplicá-lo
 * seria uma escolha tributária, não uma conta. Para os valores que aparecem
 * nestas operações — dezenas de milhares — ele não mudaria nada de todo modo,
 * porque só alcança bases abaixo de R$ 7.350.
 */
export const TABELA_IRRF_MENSAL: FaixaIr[] = [
  { ate: 2428.80, aliquota: 0, deduzir: 0 },
  { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
  { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
  { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
  { ate: null, aliquota: 0.275, deduzir: 908.73 },
]

/** O ano-exercício da tabela acima. Vira o ano, confira antes de confiar. */
export const ANO_TABELA_IRRF = 2026

export interface CalculoIr {
  /** O imposto, em reais. Nunca negativo. */
  imposto: number
  aliquota: number
  deduzir: number
  /** Base efetiva sobre a qual a alíquota incidiu (uma competência, no RRA). */
  basePorMes: number
  /** Quantas competências foram consideradas. 1 = pagamento único. */
  meses: number
  /** Como o número saiu, em português, para ir na nota da célula. */
  memoria: string
}

const brl = (n: number) =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const pct = (n: number) =>
  (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + '%'

/**
 * O IRRF sobre um valor, pela tabela progressiva.
 *
 * `meses` implementa o regime dos RENDIMENTOS RECEBIDOS ACUMULADAMENTE (art.
 * 12-A da Lei 7.713/88): quando o pagamento se refere a várias competências, a
 * tabela é aplicada ao valor DIVIDIDO pelo número de meses, e o imposto
 * resultante multiplicado de volta. A diferença é enorme — um honorário de
 * R$ 20 mil referente a três anos pode cair de 27,5% para zero —, por isso o
 * padrão é 1 (pagamento único, tributação mais pesada): errar para mais é
 * conservador no preço, errar para menos é prometer um líquido que não vem.
 */
export function irProgressivo(valor: number, meses = 1): CalculoIr {
  const m = Math.max(1, Math.floor(meses) || 1)
  const base = (Number(valor) || 0) / m
  if (base <= 0) {
    return { imposto: 0, aliquota: 0, deduzir: 0, basePorMes: 0, meses: m, memoria: 'sem valor tributável' }
  }

  const faixa = TABELA_IRRF_MENSAL.find((f) => f.ate === null || base <= f.ate)!
  const porMes = Math.max(0, base * faixa.aliquota - faixa.deduzir)
  const imposto = porMes * m

  const memoria = faixa.aliquota === 0
    ? `${brl(base)} está na faixa isenta da tabela ${ANO_TABELA_IRRF}${m > 1 ? ` (RRA: ${brl(valor)} ÷ ${m} meses)` : ''}`
    : m > 1
      ? `RRA: ${brl(valor)} ÷ ${m} meses = ${brl(base)}/mês; ${brl(base)} × ${pct(faixa.aliquota)} − ${brl(faixa.deduzir)} = ${brl(porMes)}/mês × ${m} = ${brl(imposto)} (tabela ${ANO_TABELA_IRRF})`
      : `${brl(base)} × ${pct(faixa.aliquota)} − ${brl(faixa.deduzir)} = ${brl(imposto)} (tabela progressiva mensal ${ANO_TABELA_IRRF}, pagamento único)`

  return { imposto, aliquota: faixa.aliquota, deduzir: faixa.deduzir, basePorMes: base, meses: m, memoria }
}
