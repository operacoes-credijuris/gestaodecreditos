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
 *
 * A REGRA DOS FILTROS (auditoria visual de 03/10/2026, C7):
 * - SEGMENTADO (este): filtro EXCLUSIVO da mesma lista, com até 5 opções.
 * - ABAS (`Tabs`): trocam o conteúdo (outra lista, outra vista).
 * - CHIPS (`Chip`): filtros que se SOMAM.
 * - SELECT: só acima de 5 opções, com `min-w-[220px]` e sem largura fixa.
 *
 * 36px de altura, a mesma do campo e do botão (o trilho com 3px de folga e as
 * opções de 28px): numa barra de filtros, tudo na mesma linha.
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
        'inline-flex flex-wrap items-center gap-s0.5 rounded-campo border border-borda bg-superficie-3 p-[3px]',
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
              'flex h-controle-sm items-center gap-s1.5 whitespace-nowrap rounded-controle px-s3 text-sm font-semibold transition-all duration-150',
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
                  'rounded-full px-s1.5 py-s0.5 text-xs font-semibold tabular-nums leading-none',
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
