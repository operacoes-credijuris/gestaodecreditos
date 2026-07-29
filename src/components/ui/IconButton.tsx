import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'default' | 'danger'

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Texto acessível: vira aria-label E title do botão */
  label: string
  icon: ReactNode
  variant?: Variant
}

const variants: Record<Variant, string> = {
  default: 'hover:bg-slate-100 hover:text-brand-700',
  danger: 'hover:bg-red-50 hover:text-red-600',
}

// Botão de ícone das linhas de tabela (Editar/Excluir etc.).
export function IconButton({
  label,
  icon,
  variant = 'default',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'rounded-md p-1.5 text-slate-500',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  )
}
