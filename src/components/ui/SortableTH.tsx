import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
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
}: {
  label?: ReactNode
  children?: ReactNode
  active: boolean
  dir: 'asc' | 'desc'
  onToggle: () => void
  className?: string
}) {
  return (
    <TH className={className}>
      <button
        type="button"
        onClick={onToggle}
        // py-1.5 com -my-1.5: o alvo de clique passa de 16px para 25px de
        // altura, e a margem negativa devolve o espaço, então a linha do
        // cabeçalho não muda de altura nenhuma. Antes, só a faixa exata do texto
        // ordenava — clicar no respiro em volta não fazia nada.
        className="-my-1.5 inline-flex items-center gap-1 py-1.5 font-semibold uppercase tracking-wide hover:text-slate-700"
      >
        {label ?? children}
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5 text-brand-600" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 text-brand-600" />
          )
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
        )}
      </button>
    </TH>
  )
}
