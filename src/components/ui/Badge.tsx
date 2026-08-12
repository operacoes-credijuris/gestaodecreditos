import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone =
  | 'gray'
  | 'green'
  | 'red'
  | 'yellow'
  | 'blue'
  | 'purple'
  | 'orange'
  // Alias semântico (mesmas classes do tom original)
  | 'amber'
  // PREENCHIDOS. Os sete tons acima são todos fundo pálido, e numa tela onde
  // vários campos viram selo eles acabam se parecendo — foi o que aconteceu com
  // espécie do requisitório e instrumento, os dois em azul e violeta. Estes dois
  // se distinguem por FORMA, não por matiz: fundo cheio se separa de qualquer
  // selo pálido mesmo em cor parecida. Reservados para a espécie.
  | 'tealSolid'
  | 'indigoSolid'

type Size = 'md' | 'sm'

const tones: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  yellow: 'bg-amber-50 text-amber-700 ring-amber-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  tealSolid: 'bg-teal-600 text-white ring-teal-600',
  indigoSolid: 'bg-indigo-600 text-white ring-indigo-600',
}

const sizes: Record<Size, string> = {
  md: 'px-2.5 py-0.5 text-xs',
  sm: 'px-1.5 py-0.5 text-xs leading-none',
}

export function Badge({
  tone = 'gray',
  size = 'md',
  children,
  className,
}: {
  tone?: Tone
  size?: Size
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium ring-1 ring-inset',
        sizes[size],
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
