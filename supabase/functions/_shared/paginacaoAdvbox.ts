// _shared/paginacaoAdvbox.ts
// A PAGINAÇÃO DO ADVBOX ({ offset, limit, totalCount, data }) — pura, para o vitest.
//
// TRÊS DEFEITOS do laço antigo do `fetchAll` (auditoria de bugs, 09/10/2026):
//   1. O deslocamento andava o que se PEDIU (200), não o que VEIO. Endpoint que
//      entrega menos por página — o /last_movements vem de 100 em 100 — pulava
//      metade dos registros, página sim, página não. Agora anda o que veio.
//   2. Bater no teto (de registros ou de páginas) parava CALADO, e a lista
//      cortada seguia como se fosse inteira: no /lawsuits, os processos de fora
//      saíam dos "casáveis" e a poda das movimentações APAGAVA o histórico
//      deles. Agora o corte é erro — quem chama já trata erro como "não sei".
//   3. Sem `totalCount`, o total virava "o que já veio" e o laço parava na
//      primeira página. Agora, sem total, para na página incompleta (a última) —
//      e não segue indefinidamente numa resposta que ignora o offset e devolve
//      tudo de uma vez (é o que a doc diz do /history).

export function arrayDaResposta(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[]
  const obj = (json ?? {}) as Record<string, unknown>
  for (const k of ['data', 'items', 'movements', 'results', 'movimentacoes', 'posts']) {
    if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[]
  }
  return []
}

export async function paginarAdvbox(
  buscar: (offset: number, limit: number) => Promise<unknown>,
  { cap = 8000, limit = 200, maxPaginas = 80, rotulo = 'ADVBOX' }: {
    cap?: number
    limit?: number
    maxPaginas?: number
    rotulo?: string
  } = {},
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let offset = 0
  for (let i = 0; i < maxPaginas; i++) {
    const j = await buscar(offset, limit)
    const data = arrayDaResposta(j)
    out.push(...data)
    const bruto = (j as { totalCount?: unknown } | null)?.totalCount
    const total = bruto == null || bruto === '' ? null : Number(bruto)
    if (data.length === 0) return out
    if (total != null && Number.isFinite(total)) {
      if (out.length >= total) return out
    } else if (data.length < limit || data.length > limit) {
      // Sem total: página incompleta é a última; página MAIOR que o pedido é a
      // resposta que ignora a paginação e já trouxe tudo.
      return out
    }
    if (out.length >= cap) {
      throw new Error(`${rotulo}: mais de ${cap} registros — a lista foi cortada, e seguir com ela pela metade apagaria o que ficou de fora.`)
    }
    offset += data.length
  }
  throw new Error(`${rotulo}: a paginação passou de ${maxPaginas} páginas sem chegar ao fim.`)
}
