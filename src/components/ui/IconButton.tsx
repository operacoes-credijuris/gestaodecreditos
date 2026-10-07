import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'default' | 'danger'

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Texto acessível: vira aria-label E title do botão */
  label: string
  icon: ReactNode
  variant?: Variant
  /**
   * `'linha'` (auditoria visual de 03/10/2026, C4): o botão de AÇÃO DE LINHA de
   * tabela, quadrado de 28px (`h-controle-sm`), o ícone centrado — o "›" que
   * abre e o "⋯" do `MenuDeAcoes`. Sem ele, o botão de sempre (`p-2` em volta
   * do ícone).
   */
  tamanho?: 'linha'
}

// O `.btn-ghost.btn-icon` da amostra: some até o mouse chegar, e no perigo o
// hover já avisa em vermelho antes do clique.
const variants: Record<Variant, string> = {
  default: 'hover:bg-superficie-3 hover:text-texto',
  danger: 'hover:bg-perigo-fundo hover:text-perigo',
}

// Botão de ícone das linhas de tabela (Editar/Excluir etc.). Repassa a `ref`
// (o `MenuDeAcoes` devolve o foco a ele ao fechar).
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'default', tamanho, type = 'button', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        // transition + focus-visible: mesmo acabamento do Button e do X do
        // Drawer — as ações de linha não devem ser as únicas sem foco visível.
        // p-2 (não p-1.5): fecha os 24px mínimos de alvo de clique na densidade
        // de 12px do <html> — ver index.css.
        // NO TOQUE, PELO MENOS 36PX (revisão geral, 07/10/2026): os 28px do
        // mouse eram pouco para o dedo. O botão centra o ícone sozinho.
        'rounded-controle p-2 text-texto-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-1 [@media(pointer:coarse)]:min-h-[36px] [@media(pointer:coarse)]:min-w-[36px]',
        tamanho === 'linha' &&
          'grid h-controle-sm w-controle-sm shrink-0 place-items-center p-0 [&_svg]:h-[16px] [&_svg]:w-[16px]',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  )
})
