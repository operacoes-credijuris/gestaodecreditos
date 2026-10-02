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
  // TRÊS TONS SEM SIGNIFICADO PRÓPRIO, para quando o que se colore é uma
  // etiqueta livre — o nome que o comercial deu à tag do Kommo, por exemplo.
  // Ali a cor não diz nada sobre estado; ela só precisa DISTINGUIR, e três
  // matizes não bastavam para meia dúzia de etiquetas.
  | 'teal'
  | 'pink'
  | 'indigo'
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

// OS TONS QUE DIZEM ESTADO são tokens (os `.pill-*` da amostra: neutro, ok, aviso,
// ruim). Os de etiqueta livre — azul, violeta, laranja, verde-água, rosa, anil —
// CONTINUAM FIXOS DE PROPÓSITO: só distinguem um nome de outro, e a amostra os
// mantém com estes mesmos valores (`.pill-tom-*`, estilo5.css). No modo escuro
// eles ganham a versão própria, que a amostra também já traz.
const tones: Record<Tone, string> = {
  gray: 'bg-superficie-3 text-texto-2 ring-borda',
  green: 'bg-sucesso-fundo text-sucesso ring-sucesso-borda',
  red: 'bg-perigo-fundo text-perigo ring-perigo-borda',
  yellow: 'bg-aviso-fundo text-aviso ring-aviso-borda',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  purple: 'bg-violet-50 text-violet-700 ring-violet-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
  pink: 'bg-pink-50 text-pink-700 ring-pink-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  amber: 'bg-aviso-fundo text-aviso ring-aviso-borda',
  tealSolid: 'bg-teal-600 text-white ring-teal-600',
  indigoSolid: 'bg-indigo-600 text-white ring-indigo-600',
}

// `md` com 22px de altura, a da pílula da amostra (16 de linha + 3 + 3).
const sizes: Record<Size, string> = {
  md: 'px-2.5 py-1 text-xs',
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
        'inline-flex items-center rounded-full font-semibold ring-1 ring-inset',
        sizes[size],
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
