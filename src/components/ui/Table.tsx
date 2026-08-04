import type { ReactNode } from 'react'
import { Inbox, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

export function Table({
  children,
  className,
  dense,
}: {
  children: ReactNode
  className?: string
  dense?: boolean
}) {
  return (
    <div
      className={cn(
        'overflow-x-auto scrollbar-thin',
        // Densidade compacta usada nas listagens (Processos/Requerimentos/Contatos)
        dense && '[&_th]:px-2.5 [&_td]:px-2.5 [&_td]:text-sm',
      )}
    >
      <table className={cn('w-full border-collapse text-sm', className)}>
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </thead>
  )
}

export function TH({
  children,
  className,
  colSpan,
}: {
  children?: ReactNode
  className?: string
  /** Agrupa colunas em cabeçalho de dois níveis (ex.: carteira do investidor). */
  colSpan?: number
}) {
  return (
    <th colSpan={colSpan} className={cn('px-4 py-3 font-semibold', className)}>
      {children}
    </th>
  )
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>
}

export function TR({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        'hover:bg-slate-50',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function TD({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    // align-top + break-words: as células mostram o texto INTEIRO, quebrando em
    // linhas quando necessário (o app não usa truncamento com "…" nas tabelas).
    <td
      className={cn('break-words px-4 py-3 align-top text-slate-700', className)}
    >
      {children}
    </td>
  )
}

export function EmptyState({
  title = 'Nada por aqui ainda',
  description,
  action,
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="rounded-full bg-slate-100 p-3 text-slate-400">
        <Inbox className="h-6 w-6" />
      </div>
      <div>
        <p className="font-medium text-slate-700">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  // Skeleton shimmer: sugere o conteúdo que está chegando, sem spinner.
  return (
    <div aria-busy="true" aria-label={label} className="space-y-3 py-8">
      <div className="skeleton h-9 w-full rounded-lg" />
      <div className="skeleton h-9 w-11/12 rounded-lg" />
      <div className="skeleton h-9 w-full rounded-lg" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-red-600">
      <p className="font-medium">Não foi possível carregar os dados.</p>
      {message && <p className="text-sm text-red-500">{message}</p>}
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          icon={<RefreshCw className="h-4 w-4" />}
          onClick={onRetry}
          className="mt-2"
        >
          Tentar novamente
        </Button>
      )}
    </div>
  )
}
