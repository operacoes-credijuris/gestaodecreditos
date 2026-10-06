// O VALOR LÍQUIDO VALIDADO DO CRÉDITO, lido da NOTA DE OPORTUNIDADE do card.
//
// Pedido do dono em 06/10/2026: o spread da cotação de um fundo é sobre o valor
// líquido validado, e não sobre o valor da proposta. "Em todo card do Kommo, ao
// longo das anotações, vai ter um campo chamado valor líquido validado. Ele
// sempre vai estar em uma nota específica: ela começa com 'Oportunidade'… Aí vai
// ter um campo que ou vai se chamar 'Valor', ou 'Valor líquido', ou 'Valor
// líquido validado'."
//
// A NOTA, COMO A PLATAFORMA A ESCREVE (`resumoDaOportunidade`, em
// `anotacaoKommo.ts`), depois de a pessoa a conferir na janela da aprovação:
//
//   Planilha e análise no Drive: https://…        (às vezes)
//
//   Oportunidade Credijuris — Precatório · TJSP/SP
//   Cedente: …
//   Valor líquido validado: R$ 1.234.567,89
//   …
//   — registrado por Fulana pela plataforma Credijuris
//
// E pode ter sido escrita ou editada à mão no Kommo — por isso a leitura é
// tolerante na FORMA (caixa, acento, espaço, marcador de lista, negrito) e
// rígida no SENTIDO: o rótulo tem de ser um dos três, inteiro. "Valor de face",
// "Valor cedido" e "Valor atualizado" são outros números, e um spread calculado
// sobre eles seria uma comissão errada gravada no card.
//
// O QUE NÃO SE LÊ COM SEGURANÇA FICA DE FORA (ver `lerReais`): devolver nada
// deixa o campo da janela vazio e obrigatório, para a pessoa digitar. Um número
// adivinhado viraria a base da comissão sem ninguém conferir.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —: roda no vitest, no navegador (as
// janelas da cotação) e na Edge Function da justificativa técnica.

import { lerReais } from './cotacaoDoFundo.ts'

/** Uma nota do card, no que esta leitura precisa dela (o formato do espelho `kommo_leads.notas`). */
export interface NotaComTexto {
  texto?: string | null
  criado_em?: string | null
}

/** Os três rótulos, na ordem de preferência. */
export const ROTULOS_DO_LIQUIDO = ['Valor líquido validado', 'Valor líquido', 'Valor'] as const
export type RotuloDoLiquido = (typeof ROTULOS_DO_LIQUIDO)[number]

/** O valor achado, e de onde ele saiu — a janela mostra a origem ao lado do campo. */
export interface LiquidoDaNota {
  /** O valor líquido validado, em centavos (> 0). */
  centavos: number
  /** O rótulo que o trouxe. */
  rotulo: RotuloDoLiquido
  /** A data da nota, como veio do espelho (ISO), ou null. */
  criadoEm: string | null
  /** A data da nota em dd/mm/aaaa (horário de Brasília), ou '' sem data. */
  data: string
  /** A linha da nota de onde o valor saiu, como está escrita (aparada). */
  trecho: string
}

/** Sem acento, em minúsculas e com os espaços (inclusive os inseparáveis) num só. */
const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s  ]+/g, ' ')
    .trim()

/**
 * O COMEÇO ÚTIL DA LINHA: sem o marcador de lista, o negrito, o emoji e a
 * assinatura "(Fulana) " que a análise põe na frente de algumas notas.
 */
const semPrefixo = (linha: string) =>
  linha
    .replace(/^[^a-z0-9(]+/, '')
    .replace(/^\([^)]{1,60}\)\s*/, '')
    .replace(/^[^a-z0-9]+/, '')

/** A linha do cabeçalho: "Oportunidade Credijuris — …", "OPORTUNIDADE: precatório"… */
const RE_CABECALHO = /^oportunidade\b/

/**
 * O RÓTULO E O VALOR numa linha já normalizada. O rótulo é inteiro — "valor"
 * seguido de dois-pontos, e não "valor de face:" — e os dois-pontos são
 * obrigatórios: "valor líquido validado pelo jurídico" é frase, não campo.
 */
const RE_ROTULO = /^(valor liquido validado|valor liquido|valor)\s*\**\s*:\s*\**\s*(.*)$/

const ROTULO_DA_CHAVE: Record<string, RotuloDoLiquido> = {
  'valor liquido validado': 'Valor líquido validado',
  'valor liquido': 'Valor líquido',
  valor: 'Valor',
}

/**
 * O DINHEIRO DEPOIS DO RÓTULO, em centavos, ou null.
 *
 * O texto inteiro primeiro ("R$ 1.234.567,89", "1.234.567,89", "800 mil"). Não
 * se lendo, o PRIMEIRO valor do texto, quando o resto é comentário: "R$
 * 800.000,00 (conferido em 02/10)", "R$ 800.000,00 · líquido de IR". Com DOIS
 * valores ("R$ 800.000,00 a R$ 820.000,00"), nada: não há como saber qual vale.
 */
export function lerValorDoRotulo(texto: unknown): number | null {
  const s = String(texto ?? '').replace(/\*+/g, ' ').trim()
  const inteiro = lerReais(s)
  if (inteiro !== null) return inteiro > 0 ? inteiro : null
  const n = normalizar(s)
  // Só um número com cara de dinheiro: "02/10" e "2026" de um comentário não
  // contam, nem o percentual ("27,5%" do IR).
  const dinheiro = [...n.matchAll(/(?:r\s?\$\s?)?\d[\d.]*(?:,\d+)?(?:\s?(?:mil|milhao|milhoes|mi)\b)?/g)]
    .filter((m) => !/^\s*%/.test(n.slice((m.index ?? 0) + m[0].length)))
    .map((m) => m[0].trim())
    .filter((v) => /r\s?\$|,\d{1,2}$|\.\d{3}|\bmil|\bmi/.test(v))
  if (dinheiro.length !== 1) return null
  const c = lerReais(dinheiro[0])
  return c !== null && c > 0 ? c : null
}

/**
 * O VALOR DE UMA NOTA, se ela for uma nota de oportunidade e trouxer um dos
 * rótulos: "Valor líquido validado:", senão "Valor líquido:", senão "Valor:".
 * Com o mesmo rótulo em duas linhas, vale a primeira legível.
 */
export function liquidoDaNota(
  texto: unknown,
): { centavos: number; rotulo: RotuloDoLiquido; trecho: string } | null {
  const linhas = String(texto ?? '').split(/\r?\n/)
  const limpas = linhas.map((l) => semPrefixo(normalizar(l)))
  if (!limpas.some((l) => RE_CABECALHO.test(l))) return null

  const achados: { centavos: number; rotulo: RotuloDoLiquido; trecho: string }[] = []
  limpas.forEach((l, i) => {
    const m = l.match(RE_ROTULO)
    if (!m) return
    const rotulo = ROTULO_DA_CHAVE[m[1]]
    // O VALOR SAI DA LINHA ORIGINAL (depois dos dois-pontos), não da normalizada:
    // a leitura do dinheiro é a de `lerReais`, que faz a própria limpeza.
    const original = linhas[i]
    const depois = original.slice(original.indexOf(':') + 1)
    const centavos = lerValorDoRotulo(depois)
    if (centavos === null) return
    achados.push({ centavos, rotulo, trecho: original.trim().slice(0, 160) })
  })
  for (const rotulo of ROTULOS_DO_LIQUIDO) {
    const a = achados.find((x) => x.rotulo === rotulo)
    if (a) return a
  }
  return null
}

/** A data de uma nota em dd/mm/aaaa (Brasília), ou '' quando não há data. */
export function dataDaNotaBr(iso: unknown): string {
  const t = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(t)) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(t))
}

/**
 * O VALOR LÍQUIDO VALIDADO DO CARD: entre as notas de oportunidade que trazem
 * o valor, a MAIS NOVA (a casa revalidou o crédito). Nota sem data conta como a
 * mais antiga; no empate, vale a que vem depois na lista. Null sem nenhuma.
 */
export function liquidoValidadoDasNotas(
  notas: readonly NotaComTexto[] | null | undefined,
): LiquidoDaNota | null {
  const tempo = (n: NotaComTexto) => {
    const t = Date.parse(String(n.criado_em ?? ''))
    return Number.isFinite(t) ? t : -Infinity
  }
  let melhor: { nota: NotaComTexto; achado: NonNullable<ReturnType<typeof liquidoDaNota>> } | null = null
  for (const nota of notas ?? []) {
    const achado = liquidoDaNota(nota?.texto)
    if (!achado) continue
    if (!melhor || tempo(nota) >= tempo(melhor.nota)) melhor = { nota, achado }
  }
  if (!melhor) return null
  const criadoEm = melhor.nota.criado_em ? String(melhor.nota.criado_em) : null
  return { ...melhor.achado, criadoEm, data: dataDaNotaBr(criadoEm) }
}

/** "da nota de oportunidade de 03/10/2026" — ou "da nota de oportunidade", sem data. */
export function origemDoLiquido(l: Pick<LiquidoDaNota, 'data'>): string {
  return l.data ? `da nota de oportunidade de ${l.data}` : 'da nota de oportunidade'
}
