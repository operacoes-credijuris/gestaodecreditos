// NÚCLEO COMPARTILHADO — estatística descritiva da carteira.
//
// Existe porque a camada de cálculo atual resolve bem o crédito individual e o
// agregado ponderado, mas não conhece mediana, quartil nem dispersão — e sem
// isso toda comparação vira média isolada, que é justamente o que não se quer.
//
// Duas regras atravessam o arquivo inteiro:
//   1. Ausência de dado NUNCA vira zero. Valor faltante sai da conta e é
//      contado à parte, porque zero afirma "rendeu nada" onde o que houve foi
//      falta de cadastro.
//   2. Nada é excluído por ser extremo. Outliers são MARCADOS, nunca removidos.
//
// Puro TypeScript, sem dependência: roda igual no Vite e no Deno.

/** Descarta null/undefined/NaN e ordena. É o pré-requisito de tudo aqui. */
export function limpar(valores: readonly (number | null | undefined)[]): number[] {
  const vs: number[] = []
  for (const v of valores) {
    if (typeof v === 'number' && Number.isFinite(v)) vs.push(v)
  }
  return vs.sort((a, b) => a - b)
}

/**
 * Percentil por interpolação linear entre postos — mesma convenção do
 * `percentile_cont` do Postgres e do `numpy.percentile` padrão. Fixada aqui
 * para que o número da tela, o do Excel e o de uma conferência no SQL Editor
 * batam exatamente.
 *
 * Recebe a lista JÁ ORDENADA (use `limpar`).
 */
export function percentilOrdenado(ordenados: readonly number[], p: number): number | null {
  const n = ordenados.length
  if (n === 0) return null
  if (n === 1) return ordenados[0]
  const k = (n - 1) * p
  const baixo = Math.floor(k)
  const alto = Math.ceil(k)
  if (baixo === alto) return ordenados[baixo]
  return ordenados[baixo] + (k - baixo) * (ordenados[alto] - ordenados[baixo])
}

export function percentil(valores: readonly (number | null | undefined)[], p: number): number | null {
  return percentilOrdenado(limpar(valores), p)
}

export function mediana(valores: readonly (number | null | undefined)[]): number | null {
  return percentil(valores, 0.5)
}

export function media(valores: readonly (number | null | undefined)[]): number | null {
  const vs = limpar(valores)
  if (vs.length === 0) return null
  return vs.reduce((a, b) => a + b, 0) / vs.length
}

/** Desvio-padrão AMOSTRAL (n−1). Null com menos de 2 observações. */
export function desvioPadrao(valores: readonly (number | null | undefined)[]): number | null {
  const vs = limpar(valores)
  if (vs.length < 2) return null
  const m = vs.reduce((a, b) => a + b, 0) / vs.length
  const soma = vs.reduce((acc, v) => acc + (v - m) ** 2, 0)
  return Math.sqrt(soma / (vs.length - 1))
}

export interface Distribuicao {
  /** Observações efetivamente usadas. */
  n: number
  /** Valores descartados por serem nulos, indefinidos ou não finitos. */
  ausentes: number
  media: number | null
  mediana: number | null
  p10: number | null
  p25: number | null
  p75: number | null
  p90: number | null
  minimo: number | null
  maximo: number | null
  desvioPadrao: number | null
  /** Amplitude interquartil (p75 − p25). */
  iqr: number | null
  /** Limites da regra de outlier: [p25 − 1,5×IQR ; p75 + 1,5×IQR]. */
  limiteInferior: number | null
  limiteSuperior: number | null
  soma: number
}

/**
 * O bloco descritivo completo. Toda métrica agregada do módulo publica isto —
 * média e mediana juntas, sempre, porque a divergência entre as duas É a
 * informação (na carteira de 2026-08, o atraso das previsões tem mediana de 31
 * dias e média de 101).
 */
export function distribuicao(valores: readonly (number | null | undefined)[]): Distribuicao {
  const vs = limpar(valores)
  const n = vs.length
  const p25 = percentilOrdenado(vs, 0.25)
  const p75 = percentilOrdenado(vs, 0.75)
  const iqr = p25 !== null && p75 !== null ? p75 - p25 : null
  return {
    n,
    ausentes: valores.length - n,
    media: n ? vs.reduce((a, b) => a + b, 0) / n : null,
    mediana: percentilOrdenado(vs, 0.5),
    p10: percentilOrdenado(vs, 0.1),
    p25,
    p75,
    p90: percentilOrdenado(vs, 0.9),
    minimo: n ? vs[0] : null,
    maximo: n ? vs[n - 1] : null,
    desvioPadrao: desvioPadrao(vs),
    iqr,
    limiteInferior: p25 !== null && iqr !== null ? p25 - 1.5 * iqr : null,
    limiteSuperior: p75 !== null && iqr !== null ? p75 + 1.5 * iqr : null,
    soma: vs.reduce((a, b) => a + b, 0),
  }
}

/**
 * Média ponderada por peso — a leitura "comportamento do capital", que anda
 * sempre ao lado da mediana ("comportamento da operação típica"). Item sem
 * valor ou sem peso fica fora das duas somas.
 */
export function mediaPonderada(
  itens: readonly { valor: number | null | undefined; peso: number | null | undefined }[],
): { valor: number | null; considerados: number; pesoTotal: number } {
  let somaProduto = 0
  let somaPeso = 0
  let considerados = 0
  for (const it of itens) {
    if (typeof it.valor !== 'number' || !Number.isFinite(it.valor)) continue
    if (typeof it.peso !== 'number' || !Number.isFinite(it.peso) || it.peso <= 0) continue
    somaProduto += it.valor * it.peso
    somaPeso += it.peso
    considerados++
  }
  if (somaPeso === 0) return { valor: null, considerados: 0, pesoTotal: 0 }
  return { valor: somaProduto / somaPeso, considerados, pesoTotal: somaPeso }
}

export interface Extremos<T> {
  dentro: T[]
  /** Marcados como extremos. NUNCA removidos de nenhum cálculo publicado. */
  fora: T[]
  limiteInferior: number | null
  limiteSuperior: number | null
}

/**
 * Marca extremos pela regra do IQR. O nome é `marcarExtremos`, e não
 * `removerOutliers`, de propósito: um resultado extremo pode ser um evento
 * econômico real. Na carteira de 2026-08, um crédito liquidado em 12 dias
 * produz TIR de 40.426% a.a. — número correto para ele.
 */
export function marcarExtremos<T>(
  itens: readonly T[],
  valorDe: (item: T) => number | null | undefined,
): Extremos<T> {
  const d = distribuicao(itens.map(valorDe))
  const dentro: T[] = []
  const fora: T[] = []
  for (const it of itens) {
    const v = valorDe(it)
    if (typeof v !== 'number' || !Number.isFinite(v)) { dentro.push(it); continue }
    if (d.limiteInferior !== null && d.limiteSuperior !== null &&
        (v < d.limiteInferior || v > d.limiteSuperior)) fora.push(it)
    else dentro.push(it)
  }
  return { dentro, fora, limiteInferior: d.limiteInferior, limiteSuperior: d.limiteSuperior }
}

// ---------------------------------------------------------------------------
// Intervalo de confiança da mediana, por estatísticas de ordem
// ---------------------------------------------------------------------------

export interface IntervaloMediana {
  /** Posto (1-indexado) do limite inferior. */
  postoInferior: number
  /** Posto (1-indexado) do limite superior. */
  postoSuperior: number
  /** Cobertura real alcançada (≥ confianca). */
  cobertura: number
  /** Fração da amostra que o intervalo abrange — a medida de "quão vago". */
  larguraRelativa: number
}

/**
 * Postos que delimitam o intervalo de confiança NÃO-PARAMÉTRICO da mediana.
 *
 * Sem suposição de normalidade, o que importa numa carteira assimétrica.
 *
 * Seja B o número de observações abaixo da mediana verdadeira: B ~ Bin(n, ½).
 * Então X_(r) ≤ m ≤ X_(n+1−r) vale exatamente quando r ≤ B ≤ n−r, logo
 *
 *     cobertura(r) = 1 − 2·P(B ≤ r−1)
 *
 * Devolve o intervalo MAIS ESTREITO que ainda atinge a confiança pedida.
 *
 * Devolve null quando NENHUM intervalo a atinge — nem o que vai do menor ao
 * maior valor observado. A 95% isso acontece com n ≤ 5: a cobertura máxima
 * possível é 1 − 2·2⁻ⁿ, que em n=5 dá 93,75%. Não é que o intervalo fique
 * largo; ele não existe. É o fundamento do piso de amostra, e vem da
 * matemática, não de escolha de quem escreveu.
 */
export function intervaloMediana(n: number, confianca = 0.95): IntervaloMediana | null {
  if (n <= 0) return null
  // p percorre P(B = r−1); `acumulado` vira P(B ≤ r−1). Incremental para não
  // estourar o C(n, i) em amostras grandes.
  let p = Math.pow(0.5, n)
  let acumulado = 0
  let melhor: IntervaloMediana | null = null
  for (let r = 1; r <= Math.floor(n / 2) + 1; r++) {
    acumulado += p
    const cobertura = 1 - 2 * acumulado
    if (cobertura >= confianca) {
      melhor = {
        postoInferior: r,
        postoSuperior: n + 1 - r,
        cobertura,
        larguraRelativa: (n + 2 - 2 * r) / n,
      }
    } else break
    p = (p * (n - (r - 1))) / r
  }
  return melhor
}

/** O intervalo aplicado a valores concretos. */
export function icMediana(
  valores: readonly (number | null | undefined)[],
  confianca = 0.95,
): { inferior: number; superior: number; cobertura: number; larguraRelativa: number } | null {
  const vs = limpar(valores)
  const iv = intervaloMediana(vs.length, confianca)
  if (!iv) return null
  return {
    inferior: vs[iv.postoInferior - 1],
    superior: vs[iv.postoSuperior - 1],
    cobertura: iv.cobertura,
    larguraRelativa: iv.larguraRelativa,
  }
}

// ---------------------------------------------------------------------------
// Comparação entre dois grupos
// ---------------------------------------------------------------------------

/** Gerador pseudoaleatório com semente: o bootstrap tem de ser reproduzível. */
function prng(semente: number): () => number {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DiferencaGrupos {
  /** Estimador de Hodges-Lehmann: mediana de todas as diferenças par a par. */
  estimativa: number
  inferior: number
  superior: number
  confianca: number
  nA: number
  nB: number
  /** true quando o intervalo não contém zero. */
  intervaloExcluiZero: boolean
}

/**
 * Diferença entre dois grupos, como INTERVALO — nunca como p-valor.
 *
 * A escolha é deliberada: um p-valor convida à leitura binária "significativo,
 * logo melhor", que é precisamente o raciocínio que o módulo deve impedir. Um
 * intervalo comunica magnitude e incerteza ao mesmo tempo, e deixa evidente
 * quando os dados simplesmente não decidem.
 *
 * Estimador de Hodges-Lehmann com intervalo por bootstrap percentílico.
 * `semente` fixa garante que o mesmo dado produza sempre o mesmo intervalo —
 * requisito de auditabilidade, não capricho.
 *
 * NÃO aplica nenhum portão de amostra: quem decide se a comparação é permitida
 * é `amostra.ts`. Aqui é só a conta.
 */
export function diferencaEntreGrupos(
  grupoA: readonly (number | null | undefined)[],
  grupoB: readonly (number | null | undefined)[],
  opcoes: { reamostragens?: number; confianca?: number; semente?: number } = {},
): DiferencaGrupos | null {
  const { reamostragens = 10000, confianca = 0.95, semente = 20260811 } = opcoes
  const a = limpar(grupoA)
  const b = limpar(grupoB)
  if (a.length === 0 || b.length === 0) return null

  const hodgesLehmann = (x: readonly number[], y: readonly number[]): number => {
    const difs: number[] = []
    for (const xi of x) for (const yj of y) difs.push(xi - yj)
    difs.sort((p, q) => p - q)
    return percentilOrdenado(difs, 0.5)!
  }

  const estimativa = hodgesLehmann(a, b)
  const rnd = prng(semente)
  const amostras: number[] = []
  for (let r = 0; r < reamostragens; r++) {
    const ra: number[] = new Array(a.length)
    const rb: number[] = new Array(b.length)
    for (let i = 0; i < a.length; i++) ra[i] = a[Math.floor(rnd() * a.length)]
    for (let i = 0; i < b.length; i++) rb[i] = b[Math.floor(rnd() * b.length)]
    amostras.push(hodgesLehmann(ra, rb))
  }
  amostras.sort((p, q) => p - q)
  const alfa = (1 - confianca) / 2
  const inferior = percentilOrdenado(amostras, alfa)!
  const superior = percentilOrdenado(amostras, 1 - alfa)!
  return {
    estimativa,
    inferior,
    superior,
    confianca,
    nA: a.length,
    nB: b.length,
    intervaloExcluiZero: (inferior > 0 && superior > 0) || (inferior < 0 && superior < 0),
  }
}
