import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
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
        // rounded acompanha o canto do Card que embrulha as listagens — sem
        // isso o cabeçalho tingido vazaria quadrado sobre o canto redondo.
        'overflow-x-auto rounded-cartao scrollbar-thin',
        // Densidade compacta usada nas listagens (Processos/Requerimentos/Contatos):
        // aperta o ESPAÇO, não a letra. A célula fica nos 14px do texto corrido,
        // como na tabela de Créditos da amostra.
        dense && '[&_th]:px-2.5 [&_td]:px-2.5 [&_td]:py-3',
      )}
    >
      <table className={cn('w-full border-collapse text-corpo', className)}>
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return (
    // O `.tbl th` da amostra: rótulo pequeno, em caixa alta e no cinza de
    // metadado, sobre a superfície 2. A tinta azul de antes saiu — com o menu
    // navy e o primário azul, o cabeçalho azul competia com o que é clicável.
    <thead className="border-b border-borda bg-superficie-2 text-left text-xs font-bold uppercase tracking-wide text-texto-3">
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
    <th colSpan={colSpan} className={cn('px-5 py-3 font-bold', className)}>
      {children}
    </th>
  )
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-borda">{children}</tbody>
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
        // Hover na superfície 2 + transição: a linha "acende" em vez de piscar.
        'transition-colors duration-100 hover:bg-superficie-2',
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
      className={cn('break-words px-5 py-4 align-top text-corpo text-texto', className)}
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
    // O `.empty` da amostra: o ícone numa placa azul-clara de cantos largos,
    // título em negrito e a explicação em cinza secundário, com largura de leitura.
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-cartao bg-marca-suave text-marca-texto">
        <Inbox className="h-7 w-7" aria-hidden />
      </div>
      <div className="max-w-md">
        <p className="font-display text-lg font-bold text-texto">{title}</p>
        {description && (
          <p className="mt-1 text-corpo text-texto-2">{description}</p>
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
      <div className="skeleton h-9 w-full rounded-controle" />
      <div className="skeleton h-9 w-11/12 rounded-controle" />
      <div className="skeleton h-9 w-full rounded-controle" />
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
    // Mesmo desenho do vazio, com a placa no vermelho de perigo (o `.ill.bad` da
    // amostra). O título fica em vermelho; o motivo, no cinza de leitura — em
    // vermelho, uma mensagem longa de erro cansava mais do que informava.
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 grid h-16 w-16 place-items-center rounded-cartao bg-perigo-fundo text-perigo">
        <AlertTriangle className="h-7 w-7" aria-hidden />
      </div>
      <p className="font-display text-lg font-bold text-perigo">Não foi possível carregar os dados.</p>
      {message && <p className="max-w-md text-corpo text-texto-2">{message}</p>}
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
