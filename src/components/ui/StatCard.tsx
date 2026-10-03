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
  iconPosition = 'right',
  sub,
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
  /**
   * Onde fica o ícone. `'right'` (o padrão) é a placa grande no canto, como
   * sempre. `'left'` é o `.kpi-top` da amostra: uma placa pequena (28px) À
   * ESQUERDA do rótulo, na mesma linha — o ícone fica junto do nome do número.
   */
  iconPosition?: 'right' | 'left'
  /**
   * A linha de apoio VISÍVEL embaixo do número (o `.kpi-s` da amostra), em
   * cinza de metadado: "de 128 créditos", "nos últimos 30 dias". Diferente do
   * `hint`, que fica escondido no ⓘ.
   */
  sub?: ReactNode
}) {
  // A placa do ícone do `.kpi-ic` da amostra: fundo pálido e ícone no tom forte.
  const tones = {
    brand: 'bg-marca-leve text-marca-texto',
    green: 'bg-sucesso-fundo text-sucesso',
    amber: 'bg-aviso-fundo text-aviso',
    red: 'bg-perigo-fundo text-perigo',
    slate: 'bg-superficie-3 text-texto-2',
  }
  const clicavel = !!to || !!onClick
  const iconeAEsquerda = !!icon && iconPosition === 'left'
  const rotulo = (
    <p className="flex min-w-0 items-center gap-1 truncate text-corpo font-medium text-texto-2">
      {label}
      {/* A régua do indicador fica no tooltip do ⓘ — tela limpa,
          informação a um hover de distância. */}
      {typeof hint === 'string' && hint && (
        <span title={hint} aria-label={hint} className="shrink-0 cursor-help">
          <Info className="h-3.5 w-3.5 text-texto-3 transition-colors hover:text-texto-2" />
        </span>
      )}
    </p>
  )
  const card = (
    <Card
      className={cn(
        'h-full p-5',
        clicavel && 'transition hover:border-borda-forte hover:shadow-nivel-2',
        // Selecionado: contorno no azul da logomarca e um halo largo e claro
        // (o `.kpi.click.sel` da amostra).
        active && 'border-marca-viva ring-[3px] ring-marca-viva/15',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {iconeAEsquerda ? (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'grid h-[28px] w-[28px] shrink-0 place-items-center rounded-controle [&_svg]:h-[16px] [&_svg]:w-[16px]',
                  tones[tone],
                )}
              >
                {icon}
              </span>
              {rotulo}
            </div>
          ) : (
            rotulo
          )}
          <p className="font-display mt-1 text-2xl font-bold tabular-nums tracking-tight text-texto">
            {value}
          </p>
          {sub && <p className="mt-1 text-xs text-texto-3">{sub}</p>}
        </div>
        {icon && !iconeAEsquerda && (
          <div className={cn('rounded-controle p-2.5', tones[tone])}>{icon}</div>
        )}
      </div>
    </Card>
  )
  if (to) {
    return (
      <Link to={to} className="block h-full rounded-cartao">
        {card}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block h-full w-full rounded-cartao text-left">
        {card}
      </button>
    )
  }
  return card
}
