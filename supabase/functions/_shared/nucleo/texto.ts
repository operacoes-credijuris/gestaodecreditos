// NÚCLEO COMPARTILHADO — normalização de texto.
//
// `normalizarNome` é CHAVE PRIMÁRIA de public.investidor_dados. Duas versões
// da normalização órfanariam os dados gravados, então ela mora aqui, num só
// lugar, e o frontend a reexporta por src/lib/format.ts.

/**
 * Nome normalizado: sem acento, sem espaço duplicado, minúsculo. Serve para
 * agrupar o mesmo investidor escrito de formas diferentes ("José da Silva" e
 * "jose da  silva" caem no mesmo lugar).
 *
 * ⚠️ É CHAVE PRIMÁRIA de public.investidor_dados. Mudar esta função órfã as
 * linhas já gravadas, porque a chave deixaria de casar. Se algum dia precisar
 * mudar, migre os dados junto.
 *
 * A faixa ̀-ͯ é a dos diacríticos combinantes, que é o que sobra
 * depois do normalize('NFD') separar letra e acento.
 */
export function normalizarNome(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
