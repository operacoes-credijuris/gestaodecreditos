// A PISTA DE QUE A TABELA CONTINUA À DIREITA (auditoria visual de 03/10/2026,
// Q2). Uma tabela larga que rola de lado sem sinal nenhum parece terminar na
// borda do cartão ("PRAZO MI…" nos Recortes). Enquanto há coluna escondida à
// direita, a borda direita esmaece; rolada até o fim, o esmaecido some — senão
// a última coluna ficaria apagada para sempre.
import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * Há conteúdo escondido à direita da caixa que rola? A folga de 1px absorve o
 * arredondamento do navegador em tela com zoom (o `scrollLeft` fracionário).
 */
export function restaAlemDaBorda(scrollLeft: number, larguraVisivel: number, larguraTotal: number): boolean {
  return larguraTotal - (scrollLeft + larguraVisivel) > 1
}

/** O que está escondido de cada lado de uma fila que rola na horizontal. */
export function ladosEscondidos(
  scrollLeft: number,
  larguraVisivel: number,
  larguraTotal: number,
): { antes: boolean; depois: boolean } {
  return { antes: scrollLeft > 1, depois: restaAlemDaBorda(scrollLeft, larguraVisivel, larguraTotal) }
}

/**
 * O ESMAECIDO DE CADA BORDA, como classe (a máscara some do lado em que não há
 * mais nada). 24px de degradê: o item cortado continua legível, mas se lê como
 * "há mais para lá".
 */
export function classeDaPista({ antes, depois }: { antes: boolean; depois: boolean }): string {
  if (antes && depois)
    return '[mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%_-_24px),transparent)]'
  if (depois) return '[mask-image:linear-gradient(to_right,black_calc(100%_-_24px),transparent)]'
  if (antes) return '[mask-image:linear-gradient(to_left,black_calc(100%_-_24px),transparent)]'
  return ''
}

/**
 * A PISTA NAS FILAS QUE ROLAM DE LADO — abas, segmentado, menu das
 * Configurações (revisão UX, 09/10/2026). No celular elas não cabem e rolam; a
 * opção cortada na borda já dava uma pista, mas fraca ("Encerrad" em Créditos,
 * "Fase p" em Publicações, "Escavado" nas Configurações parecia o fim da fila).
 * Agora a borda que esconde algo esmaece, dos dois lados. No computador, onde
 * tudo cabe, não há máscara nenhuma.
 */
export function usePistaLateral(ref: RefObject<HTMLElement>): { classe: string; aoRolar: () => void } {
  const [lados, setLados] = useState({ antes: false, depois: false })
  const medir = useCallback(() => {
    const el = ref.current
    if (!el) return
    const novo = ladosEscondidos(el.scrollLeft, el.clientWidth, el.scrollWidth)
    setLados((v) => (v.antes === novo.antes && v.depois === novo.depois ? v : novo))
  }, [ref])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    for (const filho of Array.from(el.children)) obs.observe(filho)
    return () => obs.disconnect()
  }, [ref, medir])
  return { classe: classeDaPista(lados), aoRolar: medir }
}
