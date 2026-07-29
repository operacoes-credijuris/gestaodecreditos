import { cn } from '@/lib/cn'

export interface SegmentedItem {
  key: string
  label: string
  /** Contagem exibida ao lado do rótulo (torna o filtro transparente). */
  count?: number
}

/**
 * Controle segmentado (pílulas): alternativa visível ao <Select> para
 * alternar visões/filtros. Mostra contagens para o usuário saber quantos
 * registros cada opção esconde — nada de filtro silencioso.
 */
export function Segmented({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: SegmentedItem[]
  value: string
  onChange: (key: string) => void
  ariaLabel?: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.key)}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums leading-none',
                  active ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-600',
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
