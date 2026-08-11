import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem {
  key: string
  label: ReactNode
  icon?: ReactNode
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
    const next = (index + delta + items.length) % items.length
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
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-600 hover:text-slate-700',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
