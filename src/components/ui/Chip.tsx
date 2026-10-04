import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * O CHIP DE FILTRO (auditoria visual de 03/10/2026, C7): filtro que SE SOMA a
 * outros ("Atrasados" + "Sem responsável"). Para filtro exclusivo da mesma
 * lista, o `Segmented`; para trocar de vista, as abas (`Tabs`).
 *
 * Aceso, o azul suave da marca — e não o preto (`bg-texto`) de antes, que era o
 * elemento mais escuro da tela e roubava a hierarquia (Análise "Todos 10",
 * colunas de Carteiras). Apagado, a superfície com contorno. 28px de altura.
 * `aria-pressed` diz ao leitor de tela se está aceso.
 *
 * Uso: `<Chip ativo={so} contagem={3} onClick={…}>Atrasados</Chip>`, vários
 * lado a lado num `<div className="flex flex-wrap gap-s2">`.
 */
export function Chip({
  ativo,
  contagem,
  icone,
  children,
  className,
  type = 'button',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & {
  ativo: boolean
  /** O número ao lado do nome (quantos a opção mostra). */
  contagem?: number
  /** Ícone de 16px antes do nome. */
  icone?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type={type}
      aria-pressed={ativo}
      className={cn(
        'inline-flex h-controle-sm items-center gap-s1.5 whitespace-nowrap rounded-full px-s3 text-sm font-semibold ring-1 ring-inset transition-colors',
        '[&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:shrink-0',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel',
        'disabled:cursor-not-allowed disabled:opacity-50',
        ativo
          ? 'bg-marca-suave text-marca-texto ring-marca-viva/30'
          : 'bg-superficie text-texto-2 ring-borda hover:bg-superficie-3 hover:text-texto',
        className,
      )}
      {...rest}
    >
      {icone}
      {children}
      {contagem !== undefined && (
        <span className={cn('tabular-nums', ativo ? 'text-marca-texto' : 'text-texto-3')}>{contagem}</span>
      )}
    </button>
  )
}
