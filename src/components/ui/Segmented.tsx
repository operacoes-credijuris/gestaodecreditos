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
 * Medidas por tamanho.
 *
 * `sm` existe para a pílula conviver com um controle MAIOR na mesma linha — o
 * caso é a destinação do precatório ao lado das abas RPV/Precatórios, onde no
 * tamanho normal ela ficava mais alta que as abas e roubava a hierarquia de
 * quem manda na tela.
 */
const MEDIDAS = {
  md: { caixa: 'p-1', botao: 'px-3 py-1.5 text-sm', selo: 'px-1.5 py-0.5 text-xs' },
  // O selo muda só de folga: `xs` é o piso legível da escala tipográfica do app
  // (ver fontSize em tailwind.config.js), e não há degrau abaixo dele para usar.
  sm: { caixa: 'p-1', botao: 'px-2.5 py-1.5 text-xs', selo: 'px-1 py-0.5 text-xs' },
} as const

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
  size = 'md',
}: {
  items: SegmentedItem[]
  value: string
  onChange: (key: string) => void
  ariaLabel?: string
  className?: string
  /** `sm` quando o controle é secundário ao lado de algo maior. */
  size?: keyof typeof MEDIDAS
}) {
  const medidas = MEDIDAS[size]
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100',
        medidas.caixa,
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
              'font-display flex items-center gap-1.5 whitespace-nowrap rounded-md font-semibold transition-all duration-150',
              medidas.botao,
              item.disabled
                ? 'cursor-not-allowed text-slate-400 opacity-60'
                : active
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-700',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded-full font-semibold tabular-nums leading-none',
                  medidas.selo,
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
