// A PISTA DE QUE A TABELA CONTINUA À DIREITA (auditoria visual de 03/10/2026,
// Q2). Uma tabela larga que rola de lado sem sinal nenhum parece terminar na
// borda do cartão ("PRAZO MI…" nos Recortes). Enquanto há coluna escondida à
// direita, a borda direita esmaece; rolada até o fim, o esmaecido some — senão
// a última coluna ficaria apagada para sempre.

/**
 * Há conteúdo escondido à direita da caixa que rola? A folga de 1px absorve o
 * arredondamento do navegador em tela com zoom (o `scrollLeft` fracionário).
 */
export function restaAlemDaBorda(scrollLeft: number, larguraVisivel: number, larguraTotal: number): boolean {
  return larguraTotal - (scrollLeft + larguraVisivel) > 1
}
