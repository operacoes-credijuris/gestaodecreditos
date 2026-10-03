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

// O `.btn-ghost.btn-icon` da amostra: some até o mouse chegar, e no perigo o
// hover já avisa em vermelho antes do clique.
const variants: Record<Variant, string> = {
  default: 'hover:bg-superficie-3 hover:text-texto',
  danger: 'hover:bg-perigo-fundo hover:text-perigo',
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
        // transition + focus-visible: mesmo acabamento do Button e do X do
        // Drawer — as ações de linha não devem ser as únicas sem foco visível.
        // p-2 (não p-1.5): fecha os 24px mínimos de alvo de clique na densidade
        // de 12px do <html> — ver index.css.
        'rounded-controle p-2 text-texto-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-1',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  )
}
