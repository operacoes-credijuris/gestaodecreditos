import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** A cor da faixa de estado do cartão (ver `faixa` no `Card`). */
export type FaixaDoCartao = 'perigo' | 'aviso' | 'sucesso' | 'info' | 'marca'

const FAIXAS: Record<FaixaDoCartao, string> = {
  perigo: 'before:bg-perigo-cheio',
  aviso: 'before:bg-aviso-cheio',
  sucesso: 'before:bg-sucesso-cheio',
  info: 'before:bg-marca-viva',
  marca: 'before:bg-marca-viva',
}

export function Card({
  children,
  className,
  faixa,
}: {
  children: ReactNode
  className?: string
  /**
   * A FAIXA DE ESTADO à esquerda (auditoria visual de 03/10/2026, §0.4/C5): uma
   * barra interna de 3px, recortada pelo canto do cartão. Substitui o
   * `border-l-4` em cartão arredondado, que curvava junto com o raio e parecia
   * borda dupla. Faixa de cor neutra: nenhuma (não passe `faixa`).
   */
  faixa?: FaixaDoCartao
}) {
  return (
    <div
      className={cn(
        // O `.panel` da amostra: borda quente, sombra de um nível só e o raio de
        // cartão (14px). UM RAIO SÓ NO APP INTEIRO: os cartões feitos à mão
        // (Tarefas, Entrar) usam o mesmo `rounded-cartao`. NO ESCURO, SEM
        // SOMBRA (§0.4): quem separa é a borda.
        'rounded-cartao border border-borda bg-superficie shadow-nivel-1 dark:shadow-none',
        faixa &&
          cn(
            'relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[3px]',
            FAIXAS[faixa],
          ),
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
    // NA GRADE DE 4PX (auditoria visual, C5): 20px de lado, 16px em cima e
    // embaixo — o mesmo respiro do corpo, que era 15px contra 20px nas
    // Configurações.
    <div className="flex items-start justify-between gap-s4 border-b border-borda px-s5 py-s4">
      <div>
        {/* 16px em negrito, como o título de painel da amostra. Sem tamanho, o
            título herdava os 12px da raiz e ficava menor que o próprio texto. */}
        <h3 className="font-display text-lg font-bold tracking-tight text-texto">
          {title}
        </h3>
        {description && (
          <p className="mt-s0.5 text-corpo text-texto-2">{description}</p>
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
  return <div className={cn('p-s5', className)}>{children}</div>
}
