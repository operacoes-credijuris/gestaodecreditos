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

const variants: Record<Variant, string> = {
  // gradiente vertical sutil + sombra dão o acabamento "sólido" do primário
  primary:
    'bg-gradient-to-b from-brand-600 to-brand-700 text-white shadow-sm hover:from-brand-500 hover:to-brand-600 focus-visible:ring-brand-500 disabled:from-brand-300 disabled:to-brand-300 disabled:shadow-none',
  secondary:
    'bg-slate-800 text-white hover:bg-slate-900 focus-visible:ring-slate-500',
  outline:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-brand-500',
  ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 disabled:bg-red-300',
  // Desfechos positivo e intermediário, para telas em que as saídas são
  // alternativas legítimas e a cor comunica mais rápido que o rótulo.
  success:
    'bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-600 disabled:bg-emerald-300',
  // orange-600 e não 700: no 700 o laranja escurece para um tijolo que fica
  // perto demais do vermelho de perigo, e as duas ações precisam se distinguir.
  warning:
    'bg-orange-600 text-white hover:bg-orange-700 focus-visible:ring-orange-500 disabled:bg-orange-300',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
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
        // whitespace-nowrap: as alturas são fixas (h-8/h-10/h-11), então rótulo
        // que quebra em duas linhas vaza do botão em vez de esticá-lo.
        'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100',
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
