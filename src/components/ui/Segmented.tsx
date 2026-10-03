import { cn } from '@/lib/cn'

export interface SegmentedItem {
  key: string
  label: string
  /** Contagem exibida ao lado do rótulo (torna o filtro transparente). */
  count?: number
  /**
   * Opção visível mas não selecionável — para o caso de uma visão existir no
   * domínio mas ainda não estar disponível. Deixar visível é melhor do que
   * omitir: o usuário sabe que ela virá.
   */
  disabled?: boolean
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
        // O `.seg` da amostra: trilho na superfície 3 com contorno, e a opção
        // escolhida "levantada" em branco com o texto no azul da marca.
        'inline-flex flex-wrap items-center gap-0.5 rounded-campo border border-borda bg-superficie-3 p-1',
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
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded-controle px-3 py-2 text-sm font-semibold transition-all duration-150',
              item.disabled
                ? 'cursor-not-allowed text-texto-3 opacity-60'
                : active
                  ? 'bg-superficie text-marca-texto shadow-nivel-1'
                  : 'text-texto-2 hover:text-texto',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums leading-none',
                  active ? 'bg-marca-suave text-marca-texto' : 'bg-borda/70 text-texto-2',
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
