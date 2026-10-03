// As iniciais do avatar redondo (Visão global das Carteiras, Usuários nas
// Configurações) — o item "Iniciais ao lado do nome" da amostra.
//
// SAEM DO PRÓPRIO NOME, sem dado novo: primeira letra do primeiro nome e da
// última palavra que conta. As partículas ("da", "de", "dos"…) não contam —
// "José da Silva" é "JS", e não "JD" — e um sufixo de empresa ("Ltda.", "S/A",
// "ME") também não: "Atlas Capital Ltda." é "AC", e não "AL".
// Nome de uma palavra só dá uma letra; nome vazio dá "?", para o círculo
// nunca nascer em branco.

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la'])
const SUFIXOS = new Set(['ltda', 'sa', 's/a', 'me', 'epp', 'eireli', 'cia'])

export function iniciais(nome: string | null | undefined): string {
  const palavras = String(nome ?? '')
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}/]+$/gu, ''))
    .filter(Boolean)
    .filter((p) => !PARTICULAS.has(p.toLowerCase()))
  const uteis = palavras.length > 1
    ? palavras.filter((p, i) => i === 0 || !SUFIXOS.has(p.toLowerCase().replace(/\.$/, '')))
    : palavras
  if (uteis.length === 0) return '?'
  const primeira = uteis[0].charAt(0)
  const ultima = uteis.length > 1 ? uteis[uteis.length - 1].charAt(0) : ''
  return (primeira + ultima).toLocaleUpperCase('pt-BR')
}
