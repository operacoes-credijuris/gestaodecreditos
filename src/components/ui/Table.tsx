import type { ReactNode } from 'react'
import { Inbox, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Table({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
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
}: {
  children?: ReactNode
  className?: string
}) {
  return <th className={cn('px-4 py-3 font-semibold', className)}>{children}</th>
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
    <td className={cn('px-4 py-3 align-middle text-slate-700', className)}>
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
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-red-600">
      <p className="font-medium">Não foi possível carregar os dados.</p>
      {message && <p className="text-sm text-red-500">{message}</p>}
    </div>
  )
}
