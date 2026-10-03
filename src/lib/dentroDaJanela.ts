// O BALÃO QUE NÃO SAI DA JANELA (revisão pós-virada, 03/10/2026).
//
// O "?" da tela e as dicas dos termos do glossário abrem um balão ancorado à
// ESQUERDA do que se clicou (`left-0`). No celular, com o "?" depois de um título
// longo, o balão de 340px passava da borda direita: cortado, e o <main> ganhava
// rolagem lateral enquanto ele estivesse aberto. Aqui se mede o balão já aberto
// e, se ele sai da janela, ele é puxado para a esquerda o quanto precisar.

import { useLayoutEffect, useState, type RefObject } from 'react'

/** A margem que o balão guarda das bordas da janela (px). */
export const MARGEM_DA_JANELA = 12

/**
 * Quanto puxar o balão (px, negativo = para a esquerda) para ele caber na
 * janela. Mais largo que a janela: encosta na margem esquerda (o que sobra à
 * direita, o `max-w` do balão resolve).
 */
export function deslocamentoParaCaber(
  esquerda: number,
  largura: number,
  larguraDaJanela: number,
  margem: number = MARGEM_DA_JANELA,
): number {
  const sobraDireita = esquerda + largura - (larguraDaJanela - margem)
  if (sobraDireita <= 0) return 0
  // Não puxa além da margem esquerda.
  return -Math.min(sobraDireita, Math.max(0, esquerda - margem))
}

/**
 * O deslocamento do balão enquanto `aberto`, para usar como
 * `style={{ transform: `translateX(${dx}px)` }}`. Medido depois de desenhar e
 * antes de pintar (useLayoutEffect): o balão não aparece primeiro cortado.
 */
export function useDentroDaJanela(ref: RefObject<HTMLElement | null>, aberto: boolean): number {
  const [dx, setDx] = useState(0)
  useLayoutEffect(() => {
    if (!aberto) {
      setDx(0)
      return
    }
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // A posição SEM o deslocamento anterior: é dela que a conta parte.
    setDx(deslocamentoParaCaber(r.left - dx, r.width, document.documentElement.clientWidth))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, ref])
  return dx
}
