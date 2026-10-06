import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

/** Quanto a dica espera para aparecer (ms): o `title` nativo levava cerca de 1s. */
const ATRASO_MS = 150

/**
 * A DICA PRÓPRIA (auditoria visual, 03/10/2026, §1): o nome de um botão que só
 * tem ícone, ao lado dele. Nasceu para o menu recolhido, onde o `title` nativo
 * aparecia depois de cerca de 1s, sem estilo e NUNCA pelo teclado.
 *
 * - Aparece em 150ms sob o mouse e na hora com o foco do teclado
 *   (`:focus-visible`); some ao sair, ao perder o foco, com Escape (WCAG 1.4.13)
 *   e ao rolar.
 * - VAI PARA O <body> POR PORTAL, com `position: fixed`: precisa sair por cima
 *   do `overflow` do <nav> que rola, e de qualquer cartão.
 * - `role="tooltip"`, mas NÃO é o nome do botão: o nome continua no
 *   `aria-label` dele (o leitor de tela não ouve duas vezes).
 *
 * Uso: `<Dica texto="Tarefas · 6 tarefas vencidas"><Link …/></Dica>`. O filho
 * fica dentro de uma caixa (`className` dela) que mede onde a dica sai.
 * `desligada` deixa só o filho (no menu aberto, o nome já está à vista).
 */
export function Dica({
  texto,
  children,
  lado = 'direita',
  desligada = false,
  className,
}: {
  texto: ReactNode
  children: ReactNode
  /** De que lado do elemento a dica sai. */
  lado?: 'direita' | 'baixo'
  desligada?: boolean
  /** Classes da caixa que embrulha o filho (por padrão, `block`). */
  className?: string
}) {
  const caixaRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const id = useId()

  const limpar = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const mostrar = useCallback(() => {
    const r = caixaRef.current?.getBoundingClientRect()
    if (!r) return
    setPos(lado === 'direita' ? { x: r.right + 8, y: r.top + r.height / 2 } : { x: r.left + r.width / 2, y: r.bottom + 6 })
  }, [lado])
  const esconder = useCallback(() => {
    limpar()
    setPos(null)
  }, [])

  // Aberta: Escape fecha (sem fechar mais nada — o Escape segue para quem
  // estiver embaixo) e qualquer rolagem fecha (a posição ficaria velha).
  useEffect(() => {
    if (!pos) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') esconder()
    }
    document.addEventListener('keydown', tecla)
    window.addEventListener('scroll', esconder, true)
    window.addEventListener('resize', esconder)
    return () => {
      document.removeEventListener('keydown', tecla)
      window.removeEventListener('scroll', esconder, true)
      window.removeEventListener('resize', esconder)
    }
  }, [pos, esconder])

  useEffect(() => limpar, [])
  // Desligada no meio do caminho (o menu abriu): some.
  useEffect(() => {
    if (desligada) esconder()
  }, [desligada, esconder])

  if (desligada) return <>{children}</>

  return (
    <div
      ref={caixaRef}
      className={cn('block', className)}
      onMouseEnter={() => {
        limpar()
        timer.current = window.setTimeout(mostrar, ATRASO_MS)
      }}
      onMouseLeave={esconder}
      onFocus={(e) => {
        // SÓ O FOCO DO TECLADO: o clique também foca, e a dica sobre o item
        // recém-clicado atrapalharia.
        const alvo = e.target as HTMLElement
        if (alvo.matches?.(':focus-visible')) mostrar()
      }}
      onBlur={esconder}
      onClick={esconder}
    >
      {children}
      {pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{ left: pos.x, top: pos.y }}
            className={cn(
              'animate-fade-in pointer-events-none fixed z-aviso w-max max-w-[280px] rounded-controle bg-texto px-s2 py-s1 text-sm text-superficie shadow-nivel-2',
              lado === 'direita' ? '-translate-y-1/2' : '-translate-x-1/2',
            )}
          >
            {texto}
          </div>,
          document.body,
        )}
    </div>
  )
}
