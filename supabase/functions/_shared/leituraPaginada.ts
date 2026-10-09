// _shared/leituraPaginada.ts
// LER O ESPELHO INTEIRO, E SABER QUANDO NÃO DEU (auditoria de bugs, 09/10/2026).
//
// O PostgREST devolve no máximo 1000 linhas por resposta e NÃO AVISA que
// cortou: um `select` sem `range` sobre uma tabela de 1.200 linhas devolve 1.000
// como se fossem todas. No kommo-sync isso era perda de dado, não só número
// errado: as marcações internas de quem ficasse fora do corte eram apagadas como
// "órfãs", e a data da coluna e das etiquetas desses cards era regravada vazia
// por cima da boa, a cada sincronização. Mesmo defeito que `src/lib/kommo.ts`
// já trata do lado da tela.
//
// Sem `Deno.` e sem `npm:` — quem chama passa a consulta de uma página.

export interface PaginaDoBanco<T> {
  data: T[] | null
  error: { message: string } | null
}

export interface LeituraCompleta<T> {
  linhas: T[]
  /** A mensagem do primeiro erro; com erro, `linhas` é só o que veio antes dele. */
  erro: string | null
  /** Bateu no teto de páginas e ainda havia mais: a leitura NÃO é completa. */
  cortada: boolean
}

/**
 * Lê página a página até uma página vir incompleta (o fim dos dados).
 *
 * A consulta deve ter ORDEM estável (`.order(...)`): sem ela, o Postgres não
 * promete a mesma ordem entre duas páginas, e uma linha pode cair em duas e
 * outra em nenhuma. O teto de páginas é rede contra laço infinito.
 */
export async function lerTodasAsLinhas<T>(
  pagina: (de: number, ate: number) => PromiseLike<PaginaDoBanco<T>>,
  { porPagina = 1000, maxPaginas = 100 }: { porPagina?: number; maxPaginas?: number } = {},
): Promise<LeituraCompleta<T>> {
  const linhas: T[] = []
  for (let p = 0; p < maxPaginas; p++) {
    const de = p * porPagina
    const { data, error } = await pagina(de, de + porPagina - 1)
    if (error) return { linhas, erro: error.message, cortada: false }
    const lote = data ?? []
    for (const l of lote) linhas.push(l)
    if (lote.length < porPagina) return { linhas, erro: null, cortada: false }
  }
  return { linhas, erro: null, cortada: true }
}

/**
 * Uma ocorrência por id — a ÚLTIMA lida, que é a mais recente.
 *
 * O mesmo card pode vir em duas leituras de funil (movido entre uma e outra), e
 * um upsert com a mesma chave duas vezes no lote é recusado inteiro pelo
 * Postgres ("ON CONFLICT DO UPDATE command cannot affect row a second time").
 */
export function ultimaPorId<T extends { id: number }>(itens: readonly T[]): T[] {
  const m = new Map<number, T>()
  for (const i of itens) m.set(i.id, i)
  return [...m.values()]
}

/**
 * As marcações órfãs: ids marcados que não estão no espelho.
 *
 * Calculado AQUI, e não com `not in (todos os ids do espelho)` no banco: aquela
 * lista vinha de uma leitura que podia ter sido cortada em 1000 linhas, e então
 * apagava a marcação de cards que existem. Leitura incompleta → nada é órfão.
 */
export function orfas(
  marcados: readonly number[],
  espelho: LeituraCompleta<number>,
): number[] {
  if (espelho.erro || espelho.cortada || espelho.linhas.length === 0) return []
  const existe = new Set(espelho.linhas)
  return [...new Set(marcados)].filter((id) => !existe.has(id))
}
