import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'warning'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

// AS VARIANTES DA AMOSTRA (estilo.css, `.btn-*`). O primário é o azul de títulos
// do contrato chapado (#0A6296, 6,6:1 com o branco); o gradiente que partia do
// azul da logomarca saiu, porque no #0B81C5 o texto branco ficava em 4,2:1.
const variants: Record<Variant, string> = {
  primary: 'bg-marca text-white shadow-nivel-1 hover:bg-marca-hover',
  // A AMOSTRA NÃO TEM BOTÃO ESCURO. O "secundário" dela é o contornado — o que
  // aqui sempre se chamou `outline`. As cinco telas que pediam `secondary` (o
  // "Executar análise" do card, entre elas) ficam iguais ao contornado: na
  // amostra esse mesmo botão é `btn-secondary`.
  secondary: 'border-borda-forte bg-superficie text-texto hover:bg-superficie-3',
  outline: 'border-borda-forte bg-superficie text-texto hover:bg-superficie-3',
  ghost: 'text-texto-2 hover:bg-superficie-3 hover:text-texto',
  // O hover CLAREIA um pouco (o `filter: brightness` da amostra) em vez de
  // escurecer: o vermelho e o verde já estão no tom mais escuro em que o branco
  // passa de 4,5:1 com folga.
  danger: 'bg-perigo-cheio text-white shadow-nivel-1 hover:brightness-105',
  // Desfechos positivo e intermediário, para telas em que as saídas são
  // alternativas legítimas e a cor comunica mais rápido que o rótulo.
  success: 'bg-sucesso-cheio text-white shadow-nivel-1 hover:brightness-105',
  // O aviso da amostra é PÁLIDO (fundo de aviso, texto âmbar escuro), e não o
  // laranja cheio de antes: cheio, ele brigava com o vermelho de perigo.
  warning: 'border-aviso-borda bg-aviso-fundo text-aviso hover:brightness-95',
}

// Alturas na grade de 3px (o <html> é 12px; ver index.css). O `md` fica em 33px,
// o mais perto dos 32px da amostra; o `lg`, em 36px.
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-corpo gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        // whitespace-nowrap: as alturas são fixas (h-9/h-11/h-12), então rótulo
        // que quebra em duas linhas vaza do botão em vez de esticá-lo.
        // BORDA EM TODAS AS VARIANTES (transparente onde não aparece), como a
        // `.btn` da amostra: assim o contornado e o cheio têm a mesma altura
        // quando uma tela troca `h-*` por padding.
        'inline-flex items-center justify-center whitespace-nowrap rounded-controle border border-transparent font-semibold transition-all duration-150',
        // O anel de foco é o mesmo em toda variante (o da amostra): o foco diz
        // "você está aqui", não "isto é perigoso".
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-anel focus-visible:ring-offset-2',
        'active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:brightness-100 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}
