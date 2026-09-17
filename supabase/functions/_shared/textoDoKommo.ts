// O texto que o Kommo devolve numa anotação, legível.
//
// O KOMMO GUARDA A NOTA COMO HTML, e a API a devolve escapada: ">" chega como
// `&gt;`, "&" como `&amp;`, aspas como `&quot;`. Num feed que exibe HTML isso é
// invisível; no nosso `<pre>`, que mostra texto cru, aparece literalmente — e a
// anotação de uma triagem automática chegava assim:
//
//   TRIAGEM AUTOMATICA -&gt; PRECATORIO_EXTERNO
//     &gt; Definitivo OFÍCIO Nº: 2025.04011/OFREQ
//
// NÃO É SÓ FEIURA NA TELA. O mesmo texto vai para a IA na análise seguinte: ela
// lê `&gt;` no meio dos dados do card, e um valor com `&amp;` no nome do cedente
// vira ruído que ninguém pediu.
//
// DESFAZER NA GRAVAÇÃO, e não na exibição: assim a tela e a análise recebem a
// mesma coisa, e não há um lugar em que o texto esteja certo e outro em que não.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, então o mesmo arquivo roda no vitest
// do site e na Edge Function.

/** As entidades nomeadas que aparecem em texto de CRM. */
const NOMEADAS: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * Troca as entidades HTML pelo caractere que elas representam.
 *
 * `&amp;` POR ÚLTIMO, e é a única ordem que funciona: o Kommo escapa em
 * cascata, então um ">" digitado dentro de um texto que já tinha entidade chega
 * como `&amp;gt;`. Trocando `&amp;` primeiro, isso viraria `&gt;` e a segunda
 * passada o transformaria em ">" — desfazendo um escape a mais do que houve, e
 * mudando o que a pessoa escreveu. Deixando-o para o fim, `&amp;gt;` vira
 * `&gt;`, que é exatamente o texto original.
 */
export function semEntidadesHtml(bruto: unknown): string {
  const t = String(bruto ?? '')
  if (!t.includes('&')) return t
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codigo(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codigo(Number(dec)))
    .replace(/&(lt|gt|quot|apos|nbsp);/gi, (inteiro, nome: string) => NOMEADAS[nome.toLowerCase()] ?? inteiro)
    .replace(/&amp;/gi, '&')
}

/**
 * O caractere de um código numérico — ou nada, se ele não for representável.
 *
 * FORA DA FAIXA VOLTA VAZIO em vez de estourar: `String.fromCodePoint` lança
 * para valores acima de 0x10FFFF, e uma entidade malformada numa anotação não
 * pode derrubar a sincronização inteira do card.
 */
function codigo(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return ''
  try {
    return String.fromCodePoint(n)
  } catch {
    return ''
  }
}
