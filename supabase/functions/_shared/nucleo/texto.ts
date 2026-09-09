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

/**
 * A forma de comparar dois nomes que deveriam ser o mesmo.
 *
 * Sem caixa, sem acento e sem os separadores que ninguém digita igual — ponto,
 * hífen, barra, parêntese e espaço. É o que faz "Procedência parcial" casar com
 * "procedencia parcial" e o nome de uma pasta do Drive casar com o do card.
 *
 * MORAVA EM credijuris.ts, que importa o SDK do Supabase — então nada que
 * dependesse dela era alcançável pelos testes, incluindo a normalização das
 * listas suspensas da planilha, que decide se a célula sai válida ou não.
 */
export function normalizarParaComparar(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\-/() ]/g, '')
}
