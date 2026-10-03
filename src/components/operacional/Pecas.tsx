// Peças de tela das páginas do Operacional (Créditos, Requerimentos, Publicações,
// Tarefas, Contatos e as fichas e janelas delas), no desenho da amostra aprovada.
//
// POR QUE AQUI E NÃO EM ui/: são desenhos que só estas telas usam — a linha de
// rótulo/valor das fichas, o título de grupo com contagem, a caixa de aviso com
// ícone — e os componentes de ui/ são de toda a plataforma, com outra frente
// cuidando deles. Tudo aqui é só apresentação: nenhuma peça busca ou grava dado.
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Info, Search, X, Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Field'
import {
  DICA_EXPECTATIVA,
  tomDaExpectativa,
} from '@/lib/numerosDosCreditos'
import { formatDate } from '@/lib/format'

/* ------------------------------------------------------------------ busca */

/**
 * O campo de busca da tela (o `.input` com a lupa da amostra). O rótulo vai para
 * o leitor de tela pelo `aria-label`: o placeholder some ao digitar.
 */
export function CampoDeBusca({
  valor,
  onChange,
  placeholder,
  className,
}: {
  valor: string
  onChange: (v: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-3"
      />
      <Input
        type="search"
        aria-label={placeholder.replace(/…$/, '')}
        className="pl-9"
        // O FILTRO DA TELA: é aqui que o "/" do teclado leva (layout/Consultas.tsx).
        // A dica "( / )" só no texto de exemplo, como na amostra — o nome do
        // campo para o leitor de tela continua sem ela.
        data-filtro-tela=""
        placeholder={`${placeholder}  ( / )`}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/**
 * A faixa de ferramentas no topo de um painel (o `.panel-tools`): busca e
 * filtros DENTRO do cartão da lista, separados dela por uma borda — a busca é da
 * lista, e não da página.
 */
export function FerramentasDoPainel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-borda px-5 py-4">
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ avisos */

type TomAviso = 'perigo' | 'aviso' | 'info' | 'sucesso'

const TOM_AVISO: Record<TomAviso, { caixa: string; icone: ReactNode }> = {
  perigo: {
    caixa: 'border-perigo-borda bg-perigo-fundo text-perigo',
    icone: <AlertTriangle className="h-[16px] w-[16px]" aria-hidden="true" />,
  },
  aviso: {
    caixa: 'border-aviso-borda bg-aviso-fundo text-aviso',
    icone: <AlertTriangle className="h-[16px] w-[16px]" aria-hidden="true" />,
  },
  info: {
    caixa: 'border-info-borda bg-info-fundo text-info',
    icone: <Info className="h-[16px] w-[16px]" aria-hidden="true" />,
  },
  sucesso: {
    caixa: 'border-sucesso-borda bg-sucesso-fundo text-sucesso',
    icone: <CheckCircle2 className="h-[16px] w-[16px]" aria-hidden="true" />,
  },
}

/**
 * A caixa de aviso (o `.note-box`): o ícone e a borda na cor do tom, o TEXTO na
 * cor de leitura — em vermelho ou âmbar, um parágrafo inteiro cansa mais do que
 * informa. Vermelho impede, âmbar pede providência.
 */
export function Aviso({
  tom,
  children,
  className,
  papel,
}: {
  tom: TomAviso
  children: ReactNode
  className?: string
  /** `alert` para o erro que acabou de acontecer (o leitor de tela anuncia). */
  papel?: 'alert' | 'status'
}) {
  const t = TOM_AVISO[tom]
  return (
    <div
      role={papel}
      className={cn('flex items-start gap-2.5 rounded-campo border px-4 py-3 text-corpo', t.caixa, className)}
    >
      <span className="mt-0.5 shrink-0">{t.icone}</span>
      <div className="min-w-0 flex-1 space-y-1 text-texto">{children}</div>
    </div>
  )
}

/** A caixa suave de orientação (o `.soft-box`): "escolha uma fase acima…". */
export function CaixaSuave({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-campo border border-info-borda bg-marca-leve px-4 py-3 text-corpo text-texto-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ listas */

/**
 * O título de um grupo da lista (o `.group-h`): caixa alta, a contagem numa
 * pílula e, nos grupos que pedem ação, a cor do tom no próprio título.
 */
export function TituloDoGrupo({
  titulo,
  qtd,
  tom = 'neutro',
}: {
  titulo: string
  qtd: number
  tom?: 'neutro' | 'perigo' | 'aviso'
}) {
  return (
    <h2
      className={cn(
        'font-display mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide',
        tom === 'perigo' ? 'text-perigo' : tom === 'aviso' ? 'text-aviso' : 'text-texto-2',
      )}
    >
      {titulo}
      <span className="rounded-full bg-superficie-3 px-2 py-0.5 text-xs font-bold normal-case tabular-nums tracking-normal text-texto-2">
        {qtd}
      </span>
    </h2>
  )
}

/** "Fulano v. Beltrano" — as partes, com o "v." apagado. */
export function Partes({ a, b }: { a?: string | null; b?: string | null }) {
  return (
    <span>
      {a || '—'} <span className="text-texto-3">v.</span> {b || '—'}
    </span>
  )
}

/* ------------------------------------------------------------------ fichas */

/** O cabeçalho da ficha lateral: a etiqueta em cima, o número e a linha de apoio. */
export function CabecalhoDaFicha({
  etiqueta,
  titulo,
  apoio,
}: {
  etiqueta: ReactNode
  titulo: ReactNode
  apoio?: ReactNode
}) {
  return (
    <div className="min-w-0">
      <p className="font-display text-xs font-bold uppercase tracking-wider text-marca-texto">
        {etiqueta}
      </p>
      <h2 className="font-display mt-0.5 break-words text-lg font-extrabold tabular-nums tracking-tight text-texto">
        {titulo}
      </h2>
      {apoio && <p className="mt-0.5 text-xs text-texto-2">{apoio}</p>}
    </div>
  )
}

/** Título de seção da ficha (o `.dsec`). */
export function TituloDaSecao({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between gap-3 first:mt-0">
      <h3 className="font-display text-xs font-bold uppercase tracking-wider text-texto-3">
        {children}
      </h3>
      {acao}
    </div>
  )
}

/**
 * Uma seção de pares rótulo → valor, um por linha (o `.kv.big` da amostra): o
 * rótulo cinza à esquerda, o valor à direita, alinhados numa coluna só. Campo
 * vazio vira "—", como sempre foi na ficha.
 */
export function SecaoDaFicha({
  titulo,
  pares,
}: {
  titulo: string
  pares: (readonly [string, ReactNode] | false | null | undefined)[]
}) {
  const linhas = pares.filter(Boolean) as (readonly [string, ReactNode])[]
  return (
    <section>
      <TituloDaSecao>{titulo}</TituloDaSecao>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-corpo">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="contents">
            <dt className="text-texto-3">{rotulo}</dt>
            <dd className="min-w-0 break-words text-texto">
              {valor === null || valor === undefined || valor === '' ? '—' : valor}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** O cartão de valor da ficha do crédito (capital, valor de face…). */
export function CartaoDeValor({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="rounded-cartao border border-borda bg-superficie px-4 py-3 shadow-nivel-1">
      <p className="text-corpo font-medium text-texto-2">{rotulo}</p>
      <p className="font-display mt-0.5 break-words text-xl font-bold tabular-nums tracking-tight text-texto">
        {valor}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ selos */

/**
 * O SELO DA EXPECTATIVA (item "Novo" da amostra): a data vira selo com ÍCONE e
 * cor — vencida, vence em até 3 meses, com folga —, e a dica diz o que a cor
 * quer dizer. Antes era só a data colorida, e a cor falava sozinha.
 */
export function SeloExpectativa({
  data,
  hoje,
  limiteAlerta,
}: {
  data: string | null | undefined
  hoje: string
  limiteAlerta: string
}) {
  const tom = tomDaExpectativa(data, hoje, limiteAlerta)
  if (!tom) return <span className="text-texto-2">—</span>
  const icone =
    tom === 'vencida' ? (
      <X className="h-3 w-3" aria-hidden="true" />
    ) : tom === 'alerta' ? (
      <Clock className="h-3 w-3" aria-hidden="true" />
    ) : (
      <Check className="h-3 w-3" aria-hidden="true" />
    )
  return (
    <span title={DICA_EXPECTATIVA[tom]}>
      <Badge
        tone={tom === 'vencida' ? 'red' : tom === 'alerta' ? 'yellow' : 'green'}
        className="gap-1 tabular-nums"
      >
        {icone}
        {formatDate(data)}
        <span className="sr-only"> — {DICA_EXPECTATIVA[tom]}</span>
      </Badge>
    </span>
  )
}

/* ------------------------------------------------------------------ formulários */

/** Uma seção do formulário (o `.form-sec`): título pequeno em caixa alta e a grade. */
export function SecaoDoFormulario({
  titulo,
  children,
}: {
  titulo: string
  children: ReactNode
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="font-display mb-3 p-0 text-xs font-bold uppercase tracking-wider text-texto-3">
        {titulo}
      </legend>
      {children}
    </fieldset>
  )
}
