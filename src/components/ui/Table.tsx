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
        // A PARTIR DE 1280PX, SEM ROLAGEM PRÓPRIA (auditoria visual, C4): uma
        // caixa com `overflow` vira a referência do `sticky`, e o cabeçalho
        // fixo (THead) ficava preso a ela em vez de acompanhar a página. Abaixo
        // disso a tabela larga ainda precisa rolar de lado. (A tela que embrulha
        // a tabela num cartão com `overflow-hidden` também prende o cabeçalho:
        // tire o `overflow-hidden` do cartão.)
        'xl:overflow-visible',
        // Densidade compacta usada nas listagens (Processos/Requerimentos/Contatos):
        // aperta o ESPAÇO, não a letra. A célula fica nos 14px do texto corrido,
        // como na tabela de Créditos da amostra. Na grade de 4px: 8px de lado.
        dense && '[&_th]:px-s2 [&_td]:px-s2 [&_td]:py-s3',
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
    // FIXO NO TOPO AO ROLAR (auditoria visual, C4): em listas de 49 a 80
    // linhas, o cabeçalho sumia. A linha de baixo é sombra, e não borda: com
    // `border-collapse`, a borda de um `sticky` não acompanha.
    <thead className="sticky top-0 z-cabecalho bg-superficie-2 font-display text-left text-xs font-bold uppercase tracking-[0.06em] text-texto-3 shadow-[inset_0_-1px_0_rgb(var(--borda))]">
      {children}
    </thead>
  )
}

export function TH({
  children,
  className,
  colSpan,
  numero,
}: {
  children?: ReactNode
  className?: string
  /** Agrupa colunas em cabeçalho de dois níveis (ex.: carteira do investidor). */
  colSpan?: number
  /** Coluna de número, moeda ou percentual: o rótulo alinhado à direita, como os valores. */
  numero?: boolean
}) {
  return (
    <th colSpan={colSpan} className={cn('px-s4 py-[10px] font-bold', numero && 'text-right', className)}>
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
        // A linha "acende" sob o mouse, com transição. NA SUPERFÍCIE 3 A 60%
        // (auditoria visual, C4): a superfície 2 de antes (#fcfbf8 sobre o
        // branco) não se via.
        'transition-colors duration-100 hover:bg-superficie-3/60',
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
  numero,
  curto,
}: {
  children?: ReactNode
  className?: string
  /**
   * Número, moeda ou percentual (auditoria visual, §0.9): à direita, com
   * algarismos de largura igual (`tabular-nums`), sem quebrar.
   */
  numero?: boolean
  /**
   * Dado curto que não pode quebrar no meio: número CNJ, CPF/CNPJ, data, selo.
   * (Data fica à esquerda; passe também `className="tabular-nums"`.)
   */
  curto?: boolean
}) {
  return (
    // align-top + break-words: as células mostram o texto INTEIRO, quebrando em
    // linhas quando necessário. A exceção é o dado curto (`curto`, `numero`) e
    // o e-mail/Pix, que vai em `Truncado` — nunca quebrado no meio.
    // Célula na grade de 4px: 16px de lado, 12px em cima e embaixo.
    <td
      className={cn(
        'break-words px-s4 py-s3 align-top text-corpo text-texto',
        (curto || numero) && 'whitespace-nowrap',
        numero && 'text-right tabular-nums',
        className,
      )}
    >
      {children}
    </td>
  )
}

/**
 * E-MAIL, CHAVE PIX E OUTRO TEXTO SEM ESPAÇO numa célula (auditoria visual,
 * §0.9): numa linha só, cortado com "…" e o texto inteiro na dica — nunca
 * quebrado no meio ("financeiro@credijuriscapi / tal.invalid"). A largura
 * máxima é obrigatória: numa tabela, sem ela o texto não tem onde cortar.
 */
export function Truncado({
  texto,
  max = 240,
  className,
}: {
  texto: string
  /** A largura máxima, em px (padrão 240). */
  max?: number
  className?: string
}) {
  return (
    <span title={texto} style={{ maxWidth: max }} className={cn('block truncate', className)}>
      {texto}
    </span>
  )
}

/**
 * NADA COM ESSE FILTRO (auditoria visual, §0.10): a linha simples do "sem
 * resultado", diferente do vazio de verdade (`EmptyState`, tracejado, "ainda
 * não há"). Sem moldura: a lista existe, o filtro é que não achou nada.
 */
export function SemResultado({
  texto = 'Nada com esse filtro',
  onLimpar,
  rotuloLimpar = 'Limpar filtros',
}: {
  texto?: ReactNode
  onLimpar?: () => void
  rotuloLimpar?: string
}) {
  return (
    <p role="status" className="flex flex-wrap items-center justify-center gap-s2 px-s4 py-s8 text-center text-corpo text-texto-2">
      <span>{texto}</span>
      {onLimpar && (
        <>
          <span aria-hidden className="text-borda-forte">·</span>
          <button
            type="button"
            onClick={onLimpar}
            className="rounded-controle font-semibold text-marca-texto underline-offset-2 hover:underline"
          >
            {rotuloLimpar}
          </button>
        </>
      )}
    </p>
  )
}

export function EmptyState({
  title = 'Nada por aqui ainda',
  description,
  action,
  icon,
  embutido = false,
}: {
  title?: string
  description?: ReactNode
  action?: ReactNode
  /**
   * DENTRO DE UM CARTÃO que já tem título (o painel do Quadro, por exemplo): sem a
   * moldura tracejada e sem fundo próprio — senão vira cartão dentro de cartão
   * (§0.4). Revisão visual 2; opcional, nada muda para quem não passa.
   */
  embutido?: boolean
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
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 text-center',
        embutido ? 'py-s8' : 'rounded-cartao border border-dashed border-borda-forte bg-superficie py-14',
      )}
    >
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
            <div className="skeleton h-[14px] w-[40%] rounded-controle" />
            <div className="skeleton h-[14px] w-[70%] rounded-controle" />
            <div className="skeleton h-[14px] w-[60%] rounded-controle" />
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
          icon={<RefreshCw className={cn('h-[16px] w-[16px]', tentando && 'animate-spin')} />}
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
