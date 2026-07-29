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
  // Aliases semânticos (mesmas classes dos tons originais)
  | 'amber'
  | 'violet'

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
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
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
