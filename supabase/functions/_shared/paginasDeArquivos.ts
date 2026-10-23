// A PRÓXIMA PÁGINA DA ABA ARQUIVOS DO CARD (GET /leads/{id}/files).
//
// A DOCUMENTAÇÃO DO KOMMO só fala em `limit` e `before_id` para esta lista, e o
// exemplo de resposta não traz `_links.next` (auditoria de 23/10/2026). A leitura
// seguia só o `next`: num card com mais arquivos que o limite — processo em
// dezenas de peças —, os mais antigos (muitas vezes o ofício) podiam ficar de
// fora sem aviso nenhum. Agora: havendo `next`, ele; não havendo e a página
// veio cheia, pede de novo com `before_id` = o menor id da página.
//
// QUEM LÊ PARA quando uma página não traz arquivo novo (o Kommo ignorando o
// `before_id` devolveria a mesma página para sempre).
//
// Sem `Deno.` e sem `npm:`: testável no vitest.

/** O caminho (absoluto ou relativo) da página seguinte, ou null quando acabou. */
export function proximaPaginaDeArquivos(atual: string, pagina: unknown, limite: number): string | null {
  const j = (pagina ?? {}) as { _links?: { next?: { href?: unknown } }; _embedded?: { files?: unknown[] } }
  const next = j._links?.next?.href
  if (typeof next === 'string' && next) return next
  const arquivos = (j._embedded?.files ?? []) as { id?: unknown }[]
  if (arquivos.length < limite) return null
  const ids = arquivos.map((f) => Number(f?.id)).filter((n) => Number.isFinite(n) && n > 0)
  if (ids.length === 0) return null
  const menor = Math.min(...ids)
  const semAnterior = atual.replace(/([?&])before_id=\d+(&|$)/, (_m, a: string, b: string) => (b ? a : '')).replace(/[?&]$/, '')
  const proxima = `${semAnterior}${semAnterior.includes('?') ? '&' : '?'}before_id=${menor}`
  return proxima === atual ? null : proxima
}
