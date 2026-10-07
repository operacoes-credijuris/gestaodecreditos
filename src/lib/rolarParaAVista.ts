/**
 * TRAZ À VISTA, DE LADO, O ITEM ESCOLHIDO NUMA FILA QUE ROLA NA HORIZONTAL (as
 * abas e o segmentado). No celular a fila não cabe e rola; sem isto, quem abria
 * "Carteiras" no Quadro via as abas "Visão geral, Previsões, Performance, Recor…"
 * e não sabia em qual estava (revisão geral, 07/10/2026).
 *
 * Mexe SÓ na rolagem lateral da fila — o `scrollIntoView` levaria a página
 * junto, na vertical. A fila precisa ser posicionada (`relative`), para o
 * `offsetLeft` do item se medir por ela. Uma folga de 16px mostra que há mais
 * itens do lado.
 */
export function rolarParaAVista(fila: HTMLElement | null, item: HTMLElement | null, folga = 16): void {
  if (!fila || !item || fila.scrollWidth <= fila.clientWidth) return
  const inicio = item.offsetLeft
  const fim = inicio + item.offsetWidth
  if (inicio < fila.scrollLeft) fila.scrollLeft = Math.max(0, inicio - folga)
  else if (fim > fila.scrollLeft + fila.clientWidth) fila.scrollLeft = fim - fila.clientWidth + folga
}
