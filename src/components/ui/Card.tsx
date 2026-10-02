import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        // O `.panel` da amostra: borda quente, sombra de um nível só e o raio de
        // cartão (14px). UM RAIO SÓ NO APP INTEIRO: os cartões feitos à mão
        // (Tarefas, Entrar) usam o mesmo `rounded-cartao`.
        'rounded-cartao border border-borda bg-superficie shadow-nivel-1',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-borda px-5 py-4">
      <div>
        {/* 16px em negrito, como o título de painel da amostra. Sem tamanho, o
            título herdava os 12px da raiz e ficava menor que o próprio texto. */}
        <h3 className="font-display text-lg font-bold tracking-tight text-texto">
          {title}
        </h3>
        {description && (
          <p className="mt-0.5 text-corpo text-texto-2">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('p-5', className)}>{children}</div>
}
