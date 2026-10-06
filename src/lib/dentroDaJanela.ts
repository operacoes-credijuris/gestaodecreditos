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

// AS CAIXAS DO CARD DA ANÁLISE (revisão visual 2, 05/10/2026): anotar, etiquetas,
// escolher proposta, fechado. Elas se ancoram à DIREITA do botão (`right-0`) ou
// à esquerda (`left-0`), conforme o lado da tela em que o botão costuma estar —
// e no celular o botão muda de lugar com a quebra da fileira: a caixa de 360px
// ancorada à direita de um botão na metade esquerda saía pela borda ESQUERDA, e
// a de 460px das etiquetas, pela direita. E no último card da lista, perto do pé
// da tela, a caixa abria para baixo, fora da vista.

/** O ajuste de uma caixa flutuante: o deslocamento lateral e se ela abre para cima. */
export interface AjusteDaCaixa {
  /** px; negativo = para a esquerda. */
  dx: number
  /** Abre ACIMA do botão (sem lugar embaixo, com lugar em cima). */
  acima: boolean
}

/**
 * O ajuste para a caixa caber na janela, a partir da posição em que ela abriu
 * (embaixo do botão, sem deslocamento).
 *
 * - DOS DOIS LADOS: passou da direita, puxa para a esquerda (como
 *   `deslocamentoParaCaber`); passou da esquerda, empurra para a direita. Mais
 *   larga que a janela, encosta na margem esquerda (o `max-w` resolve o resto).
 * - PARA CIMA só quando embaixo não cabe E em cima cabe: abrir para cima
 *   cobrindo o topo da tela seria pior que rolar.
 */
export function ajusteParaCaber(
  caixa: { esquerda: number; largura: number; topo: number; altura: number },
  /** O topo do botão que abre a caixa (onde ela encostaria abrindo para cima). */
  topoDoBotao: number,
  janela: { largura: number; altura: number },
  margem: number = MARGEM_DA_JANELA,
): AjusteDaCaixa {
  let dx = deslocamentoParaCaber(caixa.esquerda, caixa.largura, janela.largura, margem)
  if (caixa.esquerda + dx < margem) dx = margem - caixa.esquerda
  const naoCabeEmbaixo = caixa.topo + caixa.altura > janela.altura - margem
  const cabeEmCima = topoDoBotao - caixa.altura - 4 >= margem
  return { dx, acima: naoCabeEmbaixo && cabeEmCima }
}

/**
 * O ajuste da caixa enquanto `aberta`. A caixa é `absolute` dentro de uma
 * caixa `relative` que embrulha o botão: o topo DESSA caixa é o topo do botão.
 *
 * A POSIÇÃO NATURAL SAI DO LAYOUT (`offsetLeft`, `offsetWidth`), que o
 * `transform` não mexe: dá para medir de novo a qualquer momento sem descontar
 * o ajuste em vigor. E MEDE DE NOVO quando o botão muda de tamanho — o "Anotar"
 * ganha o ponto de rascunho com a primeira letra digitada, e a caixa ancorada
 * nele andava 12px para fora da tela — e quando a janela muda.
 */
export function useCaixaNaTela(ref: RefObject<HTMLElement | null>, aberta: boolean): AjusteDaCaixa {
  const [ajuste, setAjuste] = useState<AjusteDaCaixa>({ dx: 0, acima: false })
  useLayoutEffect(() => {
    if (!aberta) {
      setAjuste({ dx: 0, acima: false })
      return
    }
    const el = ref.current
    const botao = el?.parentElement
    if (!el || !botao) return
    const medir = () => {
      const b = botao.getBoundingClientRect()
      const novo = ajusteParaCaber(
        // Embaixo do botão, a 4px (o `mt-s1`), sem deslocamento.
        { esquerda: b.left + el.offsetLeft, largura: el.offsetWidth, topo: b.bottom + 4, altura: el.offsetHeight },
        b.top,
        { largura: document.documentElement.clientWidth, altura: window.innerHeight },
      )
      setAjuste((antes) => (antes.dx === novo.dx && antes.acima === novo.acima ? antes : novo))
    }
    medir()
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir)
    observador?.observe(botao)
    window.addEventListener('resize', medir)
    return () => {
      observador?.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [aberta, ref])
  return ajuste
}
