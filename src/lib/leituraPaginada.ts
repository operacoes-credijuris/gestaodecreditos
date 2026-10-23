// LEITURA EM PÁGINAS DO TETO DO SERVIDOR (varredura C, 23/10/2026).
//
// O PostgREST tem um max-rows próprio (1000 no Supabase) e devolve no máximo
// isso, QUALQUER QUE SEJA o `.limit()` pedido — e não avisa que cortou. Um
// `.limit(5000)` se lê como "até cinco mil" e entrega mil, calado: foi assim que
// a Fase processual e os Paralisados das Movimentações ficaram presos num teto
// que ninguém via. Aqui a leitura anda página a página até vir uma incompleta.
//
// QUEM CHAMA DÁ A ORDEM ESTÁVEL (`.order(...)` por coluna única ou id): sem ela,
// duas páginas podem repetir ou pular linhas.

/** Uma página: recebe o intervalo fechado [de, ate] e devolve o que o `.range()` devolve. */
export type PaginaDaLeitura = (
  de: number,
  ate: number,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>

export const LINHAS_POR_PAGINA = 1000

/**
 * Lê todas as páginas (até `maxPaginas`) e devolve as linhas juntas. Erro em
 * qualquer página LANÇA — lista pela metade não pode passar por lista inteira.
 */
export async function lerTodasAsPaginas<T>(
  pagina: PaginaDaLeitura,
  { porPagina = LINHAS_POR_PAGINA, maxPaginas = 50 }: { porPagina?: number; maxPaginas?: number } = {},
): Promise<T[]> {
  const todas: T[] = []
  for (let i = 0; i < maxPaginas; i++) {
    const de = i * porPagina
    const { data, error } = await pagina(de, de + porPagina - 1)
    if (error) throw new Error(error.message)
    const lote = (data ?? []) as T[]
    todas.push(...lote)
    if (lote.length < porPagina) break
  }
  return todas
}
