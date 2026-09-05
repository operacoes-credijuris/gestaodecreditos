// O CÁLCULO do custo de cartório, e nada mais.
//
// Separado de emolumentos.ts porque este arquivo não importa NADA: nem o SDK do
// Anthropic, nem o do Supabase. Duas consequências, e a segunda é o motivo:
//
//   1. Os testes o alcançam. O vitest roda em node e não resolve os
//      especificadores "npm:" do Deno, então enquanto isto morava junto da
//      extração por IA não havia como testar a conta — e é a conta que entra no
//      deságio. Ver src/lib/__tests__/emolumentos.test.ts, e o mesmo arranjo em
//      _shared/nucleo/.
//   2. Fica claro o que é regra de dinheiro e o que é integração. A extração
//      pode falhar, demorar, devolver bobagem; a conta, dada a regra, é
//      determinística e conferida.
//
// emolumentos.ts reexporta tudo o que está aqui, então quem importa de lá
// continua funcionando.

// ---------------------------------------------------------------------------
// O formato da regra
// ---------------------------------------------------------------------------

/**
 * Uma faixa da tabela: até tal valor, o emolumento é este.
 *
 * `valor` OU `percentual` — as tabelas estaduais usam as duas formas, e algumas
 * misturam (percentual sobre o valor, com piso e teto). Aceitar só valor fixo
 * foi o que quebrou a primeira tentativa em Pernambuco.
 */
export interface Faixa {
  /** Piso da faixa em reais, como impresso na tabela ("De X a Y"). */
  de?: number | null
  /** Teto da faixa em reais; null = faixa aberta ("acima de X"). */
  ate: number | null
  /** Emolumento fixo da faixa. */
  valor?: number | null
  /** Ou percentual sobre o valor do ato, como FRAÇÃO (0.005 = 0,5%). */
  percentual?: number | null
  /** Parcela fixa somada ao percentual. */
  fixo?: number | null
  /**
   * O percentual incide só sobre o que EXCEDE o piso da faixa.
   *
   * É a forma "R$ 500 mais 0,5% sobre o que exceder R$ 50.000", comum nas
   * tabelas progressivas. Sem esta distinção o percentual caía sobre o valor
   * inteiro: no exemplo, R$ 800 em vez de R$ 550 — 45% a mais.
   */
  sobre_excedente?: boolean | null
  /** Piso e teto do resultado, quando a faixa é percentual. */
  minimo?: number | null
  maximo?: number | null
}

/**
 * Uma taxa que incide POR CIMA do emolumento — TSNR, selo, fundo, taxa de
 * fiscalização. Vários estados as cobram à parte, e o balcão soma tudo.
 *
 * `teto_emolumento` existe por causa de PE: a TSNR "nunca pode ser superior ao
 * próprio emolumento do ato" (art. 27, Lei 11.404/96). Sem esse campo, o custo
 * sairia maior que o devido nas faixas baixas.
 */
export interface Acrescimo {
  nome: string
  /**
   * Fração. 0.002 = 0,2%. Exclusivo com `valor`.
   *
   * Nem todo acréscimo é percentual: o selo digital de vários estados (BA, PB,
   * RN, SE e outros) é um valor fixo por ato. Aceitar só percentual fazia esses
   * selos sumirem do custo em silêncio.
   */
  percentual?: number | null
  /** Ou um valor fixo em reais, por ato. */
  valor?: number | null
  /** Sobre o que incide o percentual: o valor do ato, ou o emolumento. */
  base: 'valor' | 'emolumento'
  minimo?: number | null
  maximo?: number | null
  teto_emolumento?: boolean | null
}

export interface RegraAto {
  faixas: Faixa[]
  acrescimos?: Acrescimo[]
  observacao?: string | null
}

/** A regra completa do estado. Ato ausente = a IA não achou tabela confiável para ele. */
export interface RegraEmolumentos {
  escritura: RegraAto | null
  registro: RegraAto | null
}

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
])

/** "sp", " SP " -> "SP"; qualquer coisa que não seja UF -> null. */
export function normalizarUf(s: unknown): string | null {
  const t = String(s ?? '').trim().toUpperCase()
  return UFS.has(t) ? t : null
}

const brl = (n: number) =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ---------------------------------------------------------------------------
// Aplicar a regra — a função que a calibragem chama milhares de vezes
// ---------------------------------------------------------------------------

/**
 * Faixas ordenadas por teto, com a aberta por último — memorizadas POR ATO.
 *
 * A calibragem consulta milhares de vezes por análise. Ordenar a cada consulta
 * eram dezenas de milhares de cópias de array por requisição — CPU pura, no
 * worker que já devolveu HTTP 546 uma vez. WeakMap: a entrada some junto com a
 * regra, sem cache a administrar.
 */
const ordenadas = new WeakMap<RegraAto, Faixa[]>()

function faixasOrdenadas(ato: RegraAto): Faixa[] {
  const memo = ordenadas.get(ato)
  if (memo) return memo
  const f = [...ato.faixas].sort((a, b) => {
    if (a.ate === null) return 1
    if (b.ate === null) return -1
    return a.ate - b.ate
  })
  ordenadas.set(ato, f)
  return f
}

/** O emolumento de um ato para um valor, já com os acréscimos. */
function custoDoAto(ato: RegraAto | null, valor: number): number | null {
  if (!ato || ato.faixas.length === 0) return null
  const f = faixasOrdenadas(ato).find((x) => x.ate === null || valor <= x.ate)
  if (!f) return null

  let emolumento: number
  if (f.valor != null) emolumento = f.valor
  else if (f.percentual != null) {
    // "sobre o excedente": o percentual cai só sobre o que passa do piso da
    // faixa. Sem o piso declarado não há excedente a calcular, e a base volta a
    // ser o valor inteiro — errar para cima aqui é melhor que inventar um piso.
    const base = f.sobre_excedente && f.de != null ? Math.max(0, valor - f.de) : valor
    emolumento = base * f.percentual + (f.fixo ?? 0)
    if (f.minimo != null) emolumento = Math.max(emolumento, f.minimo)
    if (f.maximo != null) emolumento = Math.min(emolumento, f.maximo)
  } else return null

  let total = emolumento
  for (const a of ato.acrescimos ?? []) {
    let v: number
    if (a.valor != null) v = a.valor
    else if (a.percentual != null) v = (a.base === 'emolumento' ? emolumento : valor) * a.percentual
    else continue
    if (a.minimo != null) v = Math.max(v, a.minimo)
    if (a.maximo != null) v = Math.min(v, a.maximo)
    // "nunca superior ao próprio emolumento do ato" — regra da TSNR em PE.
    if (a.teto_emolumento) v = Math.min(v, emolumento)
    total += v
  }
  return total
}

export interface CustoCartorio {
  total: number | null
  escritura: number | null
  registro: number | null
  /** Os DOIS atos entraram. Falso = parcial, e a descrição diz o que faltou. */
  completo: boolean
  descricao: string
}

/**
 * Custo de cartório para um preço de cessão: escritura + registro.
 *
 * Pura e instantânea — é o que permite chamá-la de dentro do laço de calibragem
 * e ter o preço certo já na primeira passada, sem consulta nenhuma.
 *
 * `total` soma o que se conhece; null só quando nenhum dos dois atos foi achado.
 * Ato faltando vira custo PARCIAL: somar metade avisando é melhor que sumir com
 * o custo do preço.
 */
export function custoParaPreco(
  regra: RegraEmolumentos | null,
  preco: number,
  rotulo?: string,
): CustoCartorio {
  const sufixo = rotulo ? ` (${rotulo})` : ''
  if (!regra || (!regra.escritura && !regra.registro)) {
    return {
      total: null, escritura: null, registro: null, completo: false,
      descricao: 'Confirmar com cartório — tabela de emolumentos não encontrada',
    }
  }
  const escritura = custoDoAto(regra.escritura, preco)
  const registro = custoDoAto(regra.registro, preco)
  if (escritura === null && registro === null) {
    return {
      total: null, escritura, registro, completo: false,
      descricao: `Confirmar com cartório — ${brl(preco)} fora das faixas da tabela${sufixo}`,
    }
  }
  const partes = [
    escritura === null ? 'escritura NÃO ENCONTRADA' : `Escritura ${brl(escritura)}`,
    registro === null ? 'registro NÃO ENCONTRADO' : `registro ${brl(registro)}`,
  ]
  return {
    total: (escritura ?? 0) + (registro ?? 0),
    escritura,
    registro,
    completo: escritura !== null && registro !== null,
    descricao: `${partes.join(' + ')}${sufixo}`,
  }
}

