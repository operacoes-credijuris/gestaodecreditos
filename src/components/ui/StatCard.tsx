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
  iconPosition = 'left',
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
   * Onde fica o ícone. `'left'` (O PADRÃO desde a auditoria visual de
   * 03/10/2026, C12) é o `.kpi-top` da amostra: uma placa pequena (28px) À
   * ESQUERDA do rótulo, na mesma linha — o ícone junto do nome do número
   * (proximidade). Havia dois desenhos na plataforma, um em Créditos e outro no
   * Quadro. `'right'` é a placa grande no canto, o desenho antigo.
   */
  iconPosition?: 'right' | 'left'
  /**
   * A linha de apoio VISÍVEL embaixo do número (o `.kpi-s` da amostra), em
   * cinza de metadado: "de 128 créditos", "nos últimos 30 dias". Diferente do
   * `hint`, que fica escondido no ⓘ.
   */
  sub?: ReactNode
}) {
  // A placa do ícone: fundo pálido, ícone no tom forte e um contorno fino do
  // mesmo tom (v3) — a placa vira um "selo" pequeno e não uma mancha. A da
  // marca é champanhe: é o indicador da casa.
  const tones = {
    brand: 'bg-ouro-suave text-ouro-texto ring-1 ring-inset ring-ouro-borda',
    green: 'bg-sucesso-fundo text-sucesso ring-1 ring-inset ring-sucesso-borda',
    amber: 'bg-aviso-fundo text-aviso ring-1 ring-inset ring-aviso-borda',
    red: 'bg-perigo-fundo text-perigo ring-1 ring-inset ring-perigo-borda',
    slate: 'bg-superficie-3 text-texto-2 ring-1 ring-inset ring-borda',
  }
  const clicavel = !!to || !!onClick
  const iconeAEsquerda = !!icon && iconPosition === 'left'
  // O RÓTULO QUEBRA EM ATÉ DUAS LINHAS (auditoria visual, C12): cortado com
  // "…" ele escondia o que o número conta ("Créditos na sele…" no celular), e
  // solto quebrava em três ("A / receber / estimado", em Carteiras a 1280px).
  const rotulo = (
    <p className="flex min-w-0 items-start gap-s1 text-sm font-medium text-texto-2">
      <span className="line-clamp-2 min-w-0">{label}</span>
      {/* A régua do indicador fica no tooltip do ⓘ — tela limpa,
          informação a um hover de distância. */}
      {typeof hint === 'string' && hint && (
        <span role="img" title={hint} aria-label={hint} className="mt-[3px] shrink-0 cursor-help">
          <Info className="h-[14px] w-[14px] text-texto-3 transition-colors hover:text-texto-2" />
        </span>
      )}
    </p>
  )
  const card = (
    <Card
      className={cn(
        // O INDICADOR DA V3 (12/11/2026): 20px de respiro e, quando clicável,
        // ele SOBE 1PX sob o mouse com a sombra crescendo (`cj-ergue`; parado
        // com movimento reduzido).
        'h-full p-s5 max-sm:p-s4',
        clicavel && 'cj-ergue hover:border-borda-forte',
        // Selecionado: contorno champanhe e um halo largo e fraco.
        active && 'border-marca-viva ring-[3px] ring-marca-viva/20',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {iconeAEsquerda ? (
            <div className="flex items-center gap-s2">
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
          {/* O NÚMERO-HERÓI (v3): 26px em seminegrito na Inter, que nesse
              tamanho sai no desenho Display (tamanho óptico); algarismos
              tabulares e de altura de maiúscula (`cj-numero`). Chega subindo
              4px na primeira vez (`animate-numero`, o "count-up" barato). */}
          <p className="cj-numero animate-numero mt-s3 font-display text-3xl font-semibold text-texto [word-spacing:0.12em] max-sm:text-2xl">
            {value}
          </p>
          {sub && <p className="mt-s1.5 text-xs text-texto-3">{sub}</p>}
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

/**
 * A GRADE DOS CARTÕES DE INDICADOR (auditoria visual, C12): quantas colunas
 * couberem, cada uma com pelo menos 200px, e 16px entre elas. Seis indicadores
 * espremidos a 1280px (Carteiras) passam a descer de linha em vez de quebrar o
 * rótulo em três.
 */
export function GradeDeIndicadores({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-s4', className)}>{children}</div>
}
