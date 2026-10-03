import { useEffect, useRef, useState, type ReactNode } from 'react'
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
        // `relative`: os `sr-only` das células (rótulos de botão, ordenação) se
        // medem por esta caixa que rola de lado, e não pelo <main>. Sem isso, no
        // celular, o da última coluna — fora da vista — alargava o <main>, e a
        // tela inteira ganhava rolagem lateral.
        'relative overflow-x-auto rounded-cartao scrollbar-thin',
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
  icon,
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  /**
   * O ícone da placa (ex.: `<Search />` para "nada encontrado"). Sem ele, a
   * caixa de entrada de sempre. O tamanho é o da placa: não precisa de classe.
   */
  icon?: ReactNode
}) {
  return (
    // O `.empty` da amostra: o ícone numa placa azul-clara de cantos largos,
    // título em negrito e a explicação em cinza secundário, com largura de leitura.
    // A BORDA TRACEJADA é dela também: diz "aqui caberia algo" — a área existe,
    // só está vazia —, e separa o vazio de um cartão que não carregou.
    <div className="flex flex-col items-center justify-center gap-3 rounded-cartao border border-dashed border-borda-forte bg-superficie px-6 py-14 text-center">
      <div
        className="grid h-16 w-16 place-items-center rounded-cartao bg-marca-suave text-marca-texto [&_svg]:h-7 [&_svg]:w-7"
        aria-hidden
      >
        {icon ?? <Inbox />}
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
  // O `blocoDeEstado('carregando')` da amostra: quatro linhas de esqueleto em
  // três colunas (como uma tabela chegando) e, embaixo, o TEXTO VISÍVEL com o
  // ícone girando. Só o esqueleto não dizia o que estava acontecendo — numa
  // conexão lenta, parecia uma tabela quebrada.
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="px-[18px] pb-[18px] pt-4">
      <div className="mb-3 grid gap-[14px]" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid grid-cols-[2fr_3fr_1fr] items-center gap-[16px]">
            <div className="skeleton h-[14px] w-[40%] rounded-md" />
            <div className="skeleton h-[14px] w-[70%] rounded-md" />
            <div className="skeleton h-[14px] w-[60%] rounded-md" />
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-texto-3">
        <RefreshCw className="h-[14px] w-[14px] animate-spin" aria-hidden />
        {label}
      </p>
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string
  /**
   * Devolvendo a promessa (o `refetch` do React Query devolve), o botão gira e
   * diz "Tentando…" até ela terminar — o item "Novo" da amostra. Sem promessa,
   * o botão é o de sempre.
   */
  onRetry?: () => void | Promise<unknown>
}) {
  const [tentando, setTentando] = useState(false)
  const montado = useRef(true)
  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
    }
  }, [])
  function tentar() {
    if (!onRetry || tentando) return
    const r = onRetry()
    if (r && typeof (r as Promise<unknown>).finally === 'function') {
      setTentando(true)
      void (r as Promise<unknown>)
        .catch(() => {})
        .finally(() => montado.current && setTentando(false))
    }
  }
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
          icon={<RefreshCw className={cn('h-4 w-4', tentando && 'animate-spin')} />}
          onClick={tentar}
          disabled={tentando}
          className="mt-2"
        >
          {tentando ? 'Tentando…' : 'Tentar novamente'}
        </Button>
      )}
    </div>
  )
}
