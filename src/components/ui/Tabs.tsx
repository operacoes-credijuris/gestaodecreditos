import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  /**
   * Contagem ao lado do rótulo. Existe para o filtro não ser silencioso: quem vê
   * "RPV 38" sabe quantos registros a outra visão esconde.
   */
  count?: number
  /**
   * Visível mas não selecionável — para a visão que existe no domínio mas ainda
   * não está pronta. Deixar à vista é melhor que omitir: o usuário sabe que vem.
   * A navegação por setas pula estas.
   */
  disabled?: boolean
}

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: TabItem[]
  value: string
  onChange: (key: string) => void
}) {
  // Refs dos botões para mover o foco na navegação por setas.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  // Setas Esquerda/Direita movem o foco e selecionam a aba (com wrap).
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const delta = e.key === 'ArrowRight' ? 1 : -1
    // PULA AS DESABILITADAS. Sem isto a seta selecionaria uma aba que o clique
    // recusa: o teclado abriria uma visão que não existe. O laço tem teto no número
    // de abas para não girar para sempre quando todas estão desabilitadas.
    let next = index
    for (let i = 0; i < items.length; i++) {
      next = (next + delta + items.length) % items.length
      if (!items[next].disabled) break
    }
    if (items[next].disabled || next === index) return
    onChange(items[next].key)
    tabRefs.current[next]?.focus()
  }

  return (
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto border-b border-slate-200 scrollbar-thin"
    >
      {items.map((item, index) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            ref={(el) => {
              tabRefs.current[index] = el
            }}
            role="tab"
            aria-selected={active}
            // Roving tabindex: só a aba ativa entra na ordem de tabulação.
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'font-display flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
              item.disabled
                ? 'cursor-not-allowed border-transparent text-slate-400'
                : active
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-slate-500 hover:border-brand-200 hover:text-slate-700',
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none tabular-nums',
                  active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
