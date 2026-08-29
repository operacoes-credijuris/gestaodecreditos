import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card } from './Card'

export function StatCard({
  label,
  value,
  icon,
  hint,
  tone = 'brand',
  to,
  onClick,
  active,
}: {
  label: ReactNode
  value: ReactNode
  icon?: ReactNode
  hint?: ReactNode
  tone?: 'brand' | 'green' | 'amber' | 'red' | 'slate'
  /** Rota de destino: torna o card um atalho clicável para a tela do número. */
  to?: string
  /** Alternativa a `to` para quando o clique filtra em vez de navegar. */
  onClick?: () => void
  /** Realce visual de "selecionado" — só faz sentido junto de `onClick`. */
  active?: boolean
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    slate: 'bg-slate-100 text-slate-600',
  }
  const clicavel = !!to || !!onClick
  const card = (
    <Card
      className={cn(
        'h-full p-5',
        clicavel && 'transition hover:border-brand-300 hover:shadow-md',
        active && 'border-brand-400 ring-1 ring-brand-300',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate text-sm font-medium text-slate-600">
            {label}
            {/* A régua do indicador fica no tooltip do ⓘ — tela limpa,
                informação a um hover de distância. */}
            {typeof hint === 'string' && hint && (
              <span title={hint} aria-label={hint} className="shrink-0 cursor-help">
                <Info className="h-3.5 w-3.5 text-slate-300 transition-colors hover:text-slate-500" />
              </span>
            )}
          </p>
          <p className="font-display mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
            {value}
          </p>
        </div>
        {icon && (
          <div className={cn('rounded-xl p-2.5', tones[tone])}>{icon}</div>
        )}
      </div>
    </Card>
  )
  if (to) {
    return (
      <Link to={to} className="block h-full">
        {card}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block h-full w-full text-left">
        {card}
      </button>
    )
  }
  return card
}
