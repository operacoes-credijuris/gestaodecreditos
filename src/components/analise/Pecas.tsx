// As peças visuais repetidas nas janelas e nos cards da Análise de crédito.
//
// POR QUE AQUI, E NÃO EM components/ui. São a tradução de classes da amostra
// (`.note-box`, `.pill`, `.hint-warn`, `.dsec`, `.soft-box`) que SÓ a Análise usa
// hoje — a análise de RPV, a due diligence, as certidões, os cards. Num arquivo
// só elas saem iguais nas cinco telas; em components/ui elas virariam contrato
// comum antes de alguém mais precisar delas (e ui/* está sendo mexido por outras
// frentes do redesenho). Se uma segunda tela pedir, promove.
//
// SÓ APRESENTAÇÃO: nenhuma regra mora aqui.
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

export type TomDaPeca = 'perigo' | 'aviso' | 'sucesso' | 'info' | 'neutro'

/** O ícone padrão de cada tom — a cor nunca vai sozinha (WCAG 1.4.1). */
const ICONE_DO_TOM: Record<TomDaPeca, ReactNode> = {
  perigo: <XCircle className="h-[16px] w-[16px]" aria-hidden />,
  aviso: <AlertTriangle className="h-[16px] w-[16px]" aria-hidden />,
  sucesso: <CheckCircle2 className="h-[16px] w-[16px]" aria-hidden />,
  info: <Info className="h-[16px] w-[16px]" aria-hidden />,
  neutro: <Info className="h-[16px] w-[16px]" aria-hidden />,
}

const CAIXA: Record<TomDaPeca, { caixa: string; icone: string }> = {
  perigo: { caixa: 'border-perigo-borda bg-perigo-fundo', icone: 'text-perigo' },
  aviso: { caixa: 'border-aviso-borda bg-aviso-fundo', icone: 'text-aviso' },
  sucesso: { caixa: 'border-sucesso-borda bg-sucesso-fundo', icone: 'text-sucesso' },
  info: { caixa: 'border-info-borda bg-marca-leve', icone: 'text-info' },
  neutro: { caixa: 'border-borda bg-superficie-2', icone: 'text-texto-3' },
}

/**
 * A CAIXA DE AVISO da amostra (`.note-box`): ícone colorido à esquerda e o texto
 * na cor do corpo — o tom está na moldura e no ícone, e o texto continua legível
 * com contraste de corpo.
 *
 * `icone={null}` tira o ícone; omitido, vai o do tom.
 */
export function CaixaDeAviso({
  tom = 'aviso',
  icone,
  children,
  className,
  role,
}: {
  tom?: TomDaPeca
  icone?: ReactNode | null
  children: ReactNode
  className?: string
  /** `alert` para o erro que acabou de acontecer; o resto é informação parada. */
  role?: 'alert' | 'status'
}) {
  const t = CAIXA[tom]
  const ic = icone === undefined ? ICONE_DO_TOM[tom] : icone
  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-2.5 rounded-campo border px-[14px] py-3 text-corpo text-texto',
        t.caixa,
        className,
      )}
    >
      {ic && <span className={cn('mt-0.5 flex-none', t.icone)}>{ic}</span>}
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}

const SELO: Record<TomDaPeca, string> = {
  perigo: 'border-perigo-borda bg-perigo-fundo text-perigo',
  aviso: 'border-aviso-borda bg-aviso-fundo text-aviso',
  sucesso: 'border-sucesso-borda bg-sucesso-fundo text-sucesso',
  info: 'border-info-borda bg-info-fundo text-info',
  neutro: 'border-transparent bg-superficie-3 text-texto-2',
}

/**
 * O SELO da amostra (`.pill`): 22 px de altura, 12 px em negrito, redondo. Para
 * estado (finalizado, parado, sem número) e para os campos do card (objeto,
 * percentual). As etiquetas do Kommo continuam na Badge, que tem a paleta de
 * reserva delas.
 */
export function Selo({
  tom = 'neutro',
  icone,
  children,
  title,
  className,
}: {
  tom?: TomDaPeca
  icone?: ReactNode
  children: ReactNode
  title?: string
  className?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-[22px] max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-semibold',
        SELO[tom],
        className,
      )}
    >
      {icone}
      <span className="truncate">{children}</span>
    </span>
  )
}

/** O ícone de 13 px que vai dentro do selo. */
export const icSelo = 'h-[13px] w-[13px] flex-none'

/**
 * A DICA DE AVISO sob um campo (`.hint-warn`): âmbar, com ícone, 13 px. Para a
 * regra que ainda não foi cumprida ("escreva a razão por extenso").
 */
export function DicaDeAviso({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('mt-2 flex items-start gap-1.5 text-sm text-aviso', className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/** O RÓTULO DE SEÇÃO dentro de uma janela (`.dsec`): caixa alta, 12 px, discreto. */
export function RotuloDeSecao({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h4
      className={cn(
        'font-display mb-2 mt-6 text-xs font-bold uppercase tracking-[.06em] text-texto-3 first:mt-0',
        className,
      )}
    >
      {children}
    </h4>
  )
}

/**
 * A CAIXA SUAVE (`.soft-box`): o que a plataforma achou e mostra para conferir —
 * fundo azul-claro da marca, sem cara de alerta. `aviso` deixa âmbar
 * (`.soft-box.warn-soft`).
 */
export function CaixaSuave({
  aviso = false,
  children,
  className,
}: {
  aviso?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-campo border px-4 py-[10px] text-corpo text-texto-2',
        aviso ? 'border-aviso-borda bg-aviso-fundo' : 'border-info-borda bg-marca-leve',
        className,
      )}
    >
      {children}
    </div>
  )
}
