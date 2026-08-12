import type { ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocoPreso, useTravaScroll } from '@/lib/dialogo'

/**
 * Modal acessível com focus trap.
 *
 * - Fecha com Escape, clique no overlay ou no botão X.
 * - Ao abrir, foca o primeiro elemento focável do painel; Tab/Shift+Tab
 *   circulam apenas entre os focáveis do modal; ao fechar, o foco volta ao
 *   elemento que estava focado antes da abertura.
 * - `dirty`: quando true, QUALQUER tentativa de fechar (X, overlay, Escape)
 *   pede confirmação com `window.confirm('Descartar alterações não salvas?')`
 *   antes de chamar `onClose`. Útil em formulários com alterações pendentes.
 *
 * VAI PARA O <body> POR PORTAL, e isto não é preferência de organização — é o que
 * faz o escurecimento cobrir a tela INTEIRA.
 *
 * O defeito que isso conserta: `position: fixed` não se mede pela janela quando
 * algum ancestral tem `transform`; passa a se medir por esse ancestral. O
 * AppLayout envolve toda página num `.animate-page`, que anima com
 * `translateY(4px)` a cada troca de rota — e, renderizado ali dentro, o overlay
 * saía com o tamanho do conteúdo e começando ABAIXO da barra do topo, deixando
 * uma faixa clara em cima. Medido no navegador: com o transform ativo o overlay
 * ficava 961x54 em top:52; no <body>, 961x910, a janela toda.
 *
 * Mesmo raciocínio vale para qualquer `hover:-translate-y` de cartão ou
 * `active:scale` de botão que venha a envolver um modal no futuro: no <body>,
 * nada disso alcança o overlay.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dirty = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Quando true, fechar exige confirmação antes de descartar alterações. */
  dirty?: boolean
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Foco inicial no primeiro CAMPO (não no X) e preso ao painel; scroll do fundo
  // travado. As três regras moram em lib/dialogo.ts, compartilhadas com o Drawer
  // e com o menu lateral do celular.
  useFocoPreso(open, panelRef, true)
  useTravaScroll(open)

  // Centraliza a checagem de "dirty" para todas as formas de fechar
  // (X, overlay e Escape passam TODOS por aqui — uma única fonte da regra).
  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, requestClose])

  if (!open) return null

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
  }

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-[2px] sm:p-6"
      onClick={(e) => {
        // Fecha só quando o clique é no próprio overlay, não dentro do painel.
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'animate-modal-in mt-6 w-full rounded-2xl bg-white shadow-xl outline-none',
          sizes[size],
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2
              id={titleId}
              className="font-display text-lg font-bold tracking-tight text-slate-900"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-sm text-slate-600">{description}</p>
            )}
          </div>
          <button
            onClick={requestClose}
            className="rounded-lg p-1 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 scrollbar-thin">
          {children}
        </div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
