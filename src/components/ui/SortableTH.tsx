import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { TH } from './Table'

// Cabeçalho de tabela ordenável (padrão de Processos/Requerimentos).
// Renderiza um <th> via TH; o conteúdo vem de `label` ou de `children`.
export function SortableTH({
  label,
  children,
  active,
  dir,
  onToggle,
  className,
  numero,
}: {
  label?: ReactNode
  children?: ReactNode
  active: boolean
  dir: 'asc' | 'desc'
  onToggle: () => void
  className?: string
  /** Coluna de número ou moeda: rótulo e seta à direita, como os valores (ver `TH`). */
  numero?: boolean
}) {
  return (
    <TH className={className} numero={numero}>
      <button
        type="button"
        onClick={onToggle}
        // py-1.5 amplia o alvo de ordenação para 25px; -my-1.5 devolve o espaço,
        // então a linha do cabeçalho não muda de altura.
        // A COLUNA ORDENADA FICA AZUL INTEIRA (o `.th-sort.on` da amostra), não
        // só a seta: é o rótulo que o olho procura. A seta das outras colunas
        // fica esmaecida, presente só para dizer que dá para ordenar.
        className={cn(
          '-my-1.5 inline-flex items-center gap-1 py-1.5 font-bold uppercase tracking-[0.06em] hover:text-texto',
          active && 'text-marca-texto hover:text-marca-texto',
        )}
      >
        {label ?? children}
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="h-[12px] w-[12px]" />
          ) : (
            <ArrowDown className="h-[12px] w-[12px]" />
          )
        ) : (
          <ArrowUpDown className="h-[12px] w-[12px] opacity-40" />
        )}
      </button>
    </TH>
  )
}
