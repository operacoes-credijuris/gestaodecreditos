// O CANAL DE PUBLICAÇÃO DESTE PACOTE.
//
// 'beta' só no pacote gerado da branch `redesenho`, que o deploy.yml publica em
// /gestaodecreditos/beta/ ao lado da versão oficial (ver
// .github/workflows/deploy.yml). Os dois canais usam o MESMO banco e o MESMO
// Kommo: a beta não é ambiente de teste, é a próxima versão vista antes por
// quem vai aprová-la. Por isso ela se anuncia em toda tela (FaixaBeta) e no
// título da aba — ninguém pode confundir uma com a outra.
//
// Na versão oficial a variável não existe, e nada muda.
export const ehBeta = import.meta.env.VITE_CANAL === 'beta'

/** O título da aba do navegador com a marca do canal. */
export function tituloDoCanal(titulo: string): string {
  return ehBeta ? `[Beta] ${titulo}` : titulo
}
