// _shared/pastaDuplicada.ts
// QUAL PASTA FICA QUANDO DUAS NASCERAM COM O MESMO NOME (auditoria de bugs,
// 09/10/2026).
//
// "Acha ou cria" a pasta no Drive não tem trava: dois pedidos ao mesmo tempo
// (duas abas, duas pessoas no "Executar análise", a planilha e as certidões)
// procuram, não acham, e criam CADA UM a sua — o cedente fica com duas pastas
// de mesmo nome, e os arquivos se dividem entre elas. O Drive não tem chave
// única por nome, e uma trava no banco pediria migração. O que se faz: quem
// criou relê as irmãs de mesmo nome e TODOS escolhem a mesma — a mais antiga
// (desempate pelo id). Quem criou a que não ficou a manda para a lixeira (vazia,
// recém-criada; a lixeira ainda a devolve, se for o caso).
//
// Sem `npm:` e sem `Deno.`, para o vitest.

export interface PastaCandidata {
  id: string
  createdTime?: string | null
}

/** A pasta que fica: a criada primeiro; empate (ou sem data), a de menor id. */
export function pastaQueFica<T extends PastaCandidata>(candidatas: readonly T[]): T | null {
  if (candidatas.length === 0) return null
  const quando = (p: PastaCandidata) => {
    const t = Date.parse(String(p.createdTime ?? ''))
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
  }
  return [...candidatas].sort((a, b) => quando(a) - quando(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
}
