// djen-publicacoes/regras.ts
// AS LEITURAS DA RESPOSTA DO DJEN QUE PERDIAM INTIMAÇÃO CALADAS (23/10/2026).
//
// Puro (sem `Deno.`, sem rede), para o vitest alcançar. Três defeitos, todos do
// mesmo tipo — a sincronização dizia "ok" com menos do que havia:
//
//   1. SEM `count`, PARAVA NA PRIMEIRA PÁGINA. `Number(j?.count ?? 0)` virava 0,
//      e "já li tudo?" (`lidos >= 0`) era sempre sim: uma OAB com 250
//      comunicações entregava as 100 primeiras.
//   2. MÁSCARA VAZIA DESCARTAVA O ITEM. `numeroprocessocommascara ?? numero_processo`
//      não cai no segundo com texto VAZIO (`??` só pega nulo), e "" não casa com
//      processo nenhum: a intimação contava como "processo não cadastrado".
//   3. `dias_retroativos` NÃO NUMÉRICO DERRUBAVA A FUNÇÃO. `Number('30 dias')` é
//      NaN, e `new Date(NaN).toISOString()` lança RangeError — nenhuma intimação
//      entrava enquanto ninguém corrigisse a configuração.

/** A contagem total que a página informa, ou null quando não informa. */
export function contagemDaResposta(j: unknown): number | null {
  const bruto = (j as { count?: unknown } | null)?.count
  if (bruto == null || bruto === '') return null
  const n = Number(bruto)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Acabou a paginação?
 *
 * Página INCOMPLETA é o fim, com ou sem contagem. Página CHEIA só é o fim quando
 * a contagem existe e já foi alcançada — sem contagem (ou com uma contagem zero
 * que contradiz a página cheia que acabou de chegar), segue pedindo; o teto de
 * páginas de quem chama é a rede contra laço infinito.
 */
export function fimDaPaginacao(
  veioNaPagina: number,
  lidosAteAgora: number,
  total: number | null,
  porPagina: number,
): boolean {
  if (veioNaPagina < porPagina) return true
  return total != null && total > 0 && lidosAteAgora >= total
}

/**
 * O número do processo de uma comunicação: o mascarado, e se ele vier vazio, o
 * sem máscara. Null quando nenhum dos dois tem conteúdo.
 */
export function numeroDoItem(it: Record<string, unknown>): string | null {
  for (const campo of ['numeroprocessocommascara', 'numero_processo', 'numeroProcesso']) {
    const v = it[campo]
    if (v == null) continue
    const t = String(v).trim()
    if (t) return t
  }
  return null
}

export const DIAS_PADRAO = 30
/** Um ano: janela maior que isso é erro de digitação, não intenção. */
export const DIAS_MAXIMO = 365

/**
 * A janela retroativa configurada, validada: inteiro entre 1 e DIAS_MAXIMO.
 * Vazio ou ilegível → DIAS_PADRAO. `ajuste` diz o que foi corrigido, para a
 * resposta mostrar (configuração errada que se corrige calada nunca é corrigida).
 */
export function diasRetroativos(v: unknown): { dias: number; ajuste: string | null } {
  if (v == null || v === '') return { dias: DIAS_PADRAO, ajuste: null }
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  if (!Number.isFinite(n)) {
    return {
      dias: DIAS_PADRAO,
      ajuste: `dias_retroativos ilegível (${String(v)}); usei ${DIAS_PADRAO}`,
    }
  }
  const dias = Math.min(DIAS_MAXIMO, Math.max(1, Math.round(n)))
  return {
    dias,
    ajuste: dias === n ? null : `dias_retroativos ${String(v)} fora da faixa 1–${DIAS_MAXIMO}; usei ${dias}`,
  }
}
