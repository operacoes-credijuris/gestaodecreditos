// Peças de tela das páginas do Operacional (Créditos, Requerimentos, Publicações,
// Tarefas, Contatos e as fichas e janelas delas), no desenho da amostra aprovada.
//
// POR QUE AQUI E NÃO EM ui/: são desenhos que só estas telas usam — a linha de
// rótulo/valor das fichas, o título de grupo com contagem, a caixa de aviso com
// ícone — e os componentes de ui/ são de toda a plataforma, com outra frente
// cuidando deles. Tudo aqui é só apresentação: nenhuma peça busca ou grava dado.
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Info, X, Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { CampoDeBusca as CampoDeBuscaComum, BarraDaLista } from '@/components/ui/CampoDeBusca'
import { AcoesDaLinha, type AcaoDoMenu } from '@/components/ui/MenuDeAcoes'
import {
  DICA_EXPECTATIVA,
  tomDaExpectativa,
} from '@/lib/numerosDosCreditos'
import { formatDate } from '@/lib/format'

/* ------------------------------------------------------------------ busca */

/**
 * O campo de busca das telas do Operacional: o `CampoDeBusca` comum (ui/), com
 * a lupa de 16px, a altura de controle e a tecla "/" desenhada à direita
 * (auditoria visual, C3). Antes o atalho ia escrito no texto de exemplo
 * ("…  ( / )"). Este invólucro só mantém o `onChange` que as telas já usam.
 *
 * O TEXTO DE EXEMPLO TEM ATÉ 40 CARACTERES ("Buscar por número, cedente ou
 * devedora"): a lista inteira dos campos lidos vai em `title`. O placeholder de
 * nove campos cortava a 1280px ("…trib").
 */
export function CampoDeBusca({
  valor,
  onChange,
  placeholder,
  title,
  className,
}: {
  valor: string
  onChange: (v: string) => void
  placeholder: string
  /** Onde a busca procura, por extenso (a dica do campo). */
  title?: string
  className?: string
}) {
  return (
    <CampoDeBuscaComum
      valor={valor}
      onMudar={onChange}
      placeholder={placeholder}
      title={title}
      classeDaCaixa={cn('flex-1', className)}
    />
  )
}

/**
 * A faixa de ferramentas no topo de um painel (o `.panel-tools`): busca e
 * filtros DENTRO do cartão da lista, separados dela por uma borda — a busca é da
 * lista, e não da página. Por dentro, a `BarraDaLista` comum (C3): a busca
 * primeiro (cresce até 520px), depois os filtros, e o `fim` encostado à direita.
 */
export function FerramentasDoPainel({ children, fim }: { children: ReactNode; fim?: ReactNode }) {
  return (
    <div className="border-b border-borda px-s5 py-s4">
      <BarraDaLista fim={fim}>{children}</BarraDaLista>
    </div>
  )
}

/* ------------------------------------------------------------------ celular */

/**
 * A TABELA VIRA LISTA DE CARTÕES NO CELULAR (auditoria visual, K1): abaixo de
 * 768px, Créditos, Requerimentos, Contatos e Dados cadastrais rolavam de lado e
 * ficavam inúteis. Cada linha vira um cartão com o título (número ou nome), até
 * duas linhas de metadado e as mesmas ações da tabela ("⋯" e "›"). Os MESMOS
 * dados: a tela renderiza as duas formas, e o CSS escolhe (`md:hidden` aqui, e a
 * tabela dentro de `hidden md:block`).
 *
 * (A especificação previa um `ui/ListaResponsiva`; a base não o criou, e ele
 * mora aqui enquanto só estas telas o usam.)
 */
export function ListaNoCelular({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <ul aria-label={rotulo} className="divide-y divide-borda md:hidden">
      {children}
    </ul>
  )
}

/** Um cartão da `ListaNoCelular`. O toque no cartão abre o registro, como a linha. */
export function CartaoNoCelular({
  titulo,
  linhas,
  onAbrir,
  rotuloAbrir,
  acoes,
  rotuloDasAcoes,
}: {
  titulo: ReactNode
  /** Até duas linhas de metadado; as vazias não aparecem. */
  linhas?: ReactNode[]
  onAbrir?: () => void
  rotuloAbrir?: string
  acoes?: readonly AcaoDoMenu[]
  rotuloDasAcoes?: string
}) {
  const metas = (linhas ?? []).filter((l) => l !== null && l !== undefined && l !== false && l !== '')
  return (
    <li
      onClick={onAbrir}
      // v3: o cartão acende como a linha da tabela (superfície 3 a 70%), com a
      // mesma transição curta — o toque tem resposta, sem sombra nem salto.
      className={cn(
        'flex items-start gap-s2 px-s4 py-s3',
        onAbrir &&
          'cursor-pointer transition-colors duration-rapida ease-saida hover:bg-superficie-3/70 active:bg-superficie-3/70',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-corpo font-semibold text-texto">{titulo}</div>
        {metas.slice(0, 2).map((m, i) => (
          <div key={i} className="mt-s0.5 text-xs text-texto-2">
            {m}
          </div>
        ))}
      </div>
      {/* O "›" É O CAMINHO DO TECLADO, como na tabela: o cartão não recebe foco. */}
      <AcoesDaLinha
        onAbrir={onAbrir}
        rotuloAbrir={rotuloAbrir}
        acoes={acoes}
        rotuloDasAcoes={rotuloDasAcoes}
      />
    </li>
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
      className={cn('flex items-start gap-s2 rounded-campo border px-s4 py-s3 text-corpo', t.caixa, className)}
    >
      <span className="mt-s0.5 shrink-0">{t.icone}</span>
      <div className="min-w-0 flex-1 space-y-s1 text-texto">{children}</div>
    </div>
  )
}

/** A caixa suave de orientação (o `.soft-box`): "escolha uma fase acima…". */
export function CaixaSuave({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-s2 rounded-campo border border-info-borda bg-marca-leve px-s4 py-s3 text-corpo text-texto-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ listas */

/**
 * O título de um grupo da lista (o `.group-h`): caixa alta e a contagem numa
 * pílula.
 *
 * O TÍTULO FICA NO CINZA COMUM, E SÓ A CONTAGEM LEVA O TOM (auditoria visual,
 * T1): em Tarefas, "VENCIDAS" em vermelho somava-se ao bloco de data, ao selo do
 * prazo e ao "Urgente" — quatro sinais vermelhos para a mesma coisa, e a vista
 * deixa de distinguir o que é grave (fadiga de alarme). A pílula colorida basta
 * para dizer que o grupo pede ação.
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
    // v3: o SOBRETÍTULO da casa (`cj-sobretitulo`), um degrau mais escuro que o
    // de tabela — aqui ele abre um grupo da lista, e não uma coluna. A contagem
    // fica na pílula, em algarismos tabulares, sem a caixa alta do título.
    <h2 className="cj-sobretitulo mb-s3 flex items-center gap-s2 text-texto-2">
      {titulo}
      <span
        className={cn(
          'inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-s1.5 text-xs font-semibold normal-case tabular-nums tracking-normal',
          tom === 'perigo'
            ? 'bg-perigo-fundo text-perigo'
            : tom === 'aviso'
              ? 'bg-aviso-fundo text-aviso'
              : 'bg-superficie-3 text-texto-2',
        )}
      >
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
  acao,
}: {
  etiqueta: ReactNode
  titulo: ReactNode
  apoio?: ReactNode
  /**
   * Ao lado do título — o "copiar o número". FORA do <h2>, para o nome da ficha
   * lido pelo leitor de tela continuar sendo só o número.
   */
  acao?: ReactNode
}) {
  return (
    <div className="min-w-0">
      {/* v3: a etiqueta é o sobretítulo em champanhe que se lê (`ouro-texto`), e
          o número vem em seminegrito — SEM `tabular-nums`: no CNJ, a Inter
          tabular alarga também o ponto e o hífen (DESIGN-SYSTEM-V3 §3). */}
      <p className="cj-sobretitulo text-ouro-texto">{etiqueta}</p>
      <div className="mt-s1 flex items-center gap-s1">
        <h2 className="font-display min-w-0 break-words text-lg font-semibold text-texto">
          {titulo}
        </h2>
        {acao}
      </div>
      {apoio && <p className="mt-s0.5 text-xs text-texto-2">{apoio}</p>}
    </div>
  )
}

/** Título de seção da ficha (o `.dsec`). */
export function TituloDaSecao({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-s2 mt-s5 flex items-center justify-between gap-s3 first:mt-0">
      {/* O MESMO TÍTULO DO `DrawerSection` do kit: sobretítulo com o fio
          champanhe antes — as fichas do Operacional e as do kit falam igual. */}
      <h3 className="cj-sobretitulo flex items-center gap-s2 before:h-px before:w-[12px] before:bg-ouro-forte">
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
 *
 * A COLUNA DO RÓTULO TEM LARGURA FIXA, IGUAL EM TODA SEÇÃO (auditoria visual,
 * C9): com `auto`, cada seção media o próprio rótulo mais largo (cerca de 140,
 * 60 e 160px na ficha do crédito), e os valores "pulavam" de uma seção para a
 * outra. 176px cabe "Expectativa de liquidação"; no celular, 40% da largura.
 */
export const GRADE_DA_FICHA =
  'grid grid-cols-[minmax(96px,40%)_minmax(0,1fr)] gap-x-s4 gap-y-s2 sm:grid-cols-[176px_minmax(0,1fr)]'

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
      {/* O LIVRO-RAZÃO (v3): cada par numa linha própria, com o fio fino entre
          as linhas — a grade de relatório financeiro. Cada linha repete a MESMA
          grade de colunas fixas (176px / 40%), então rótulos e valores
          continuam alinhados numa coluna só, de seção a seção (C9). */}
      <dl className="divide-y divide-borda border-y border-borda text-corpo">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className={cn(GRADE_DA_FICHA, 'py-s1.5')}>
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
    // UM BLOCO EMBUTIDO, E NÃO UM CARTÃO DENTRO DA GAVETA (revisão UX,
    // 09/10/2026; §0.4 "cartão dentro de cartão: não"): o fundo do papel, sem
    // borda nem sombra. E DOIS POR LINHA TAMBÉM NO CELULAR (a grade é da ficha),
    // com o número um degrau menor lá: empilhados, os valores empurravam as
    // Partes para a segunda tela.
    //
    // v3: o bloco interno da casa (`rounded-campo bg-superficie-2`, sem borda),
    // com um FIO CHAMPANHE de 2px à esquerda — a régua do indicador, a única
    // cor do bloco. O rótulo em sobretítulo; o número em `cj-numero` (tabular,
    // altura de maiúscula), seminegrito: o número manda.
    <div className="relative min-w-0 overflow-hidden rounded-campo bg-superficie-2 px-s3 py-s3 before:absolute before:inset-y-s3 before:left-0 before:w-[2px] before:rounded-full before:bg-ouro sm:px-s4">
      <p className="cj-sobretitulo">{rotulo}</p>
      <p className="cj-numero font-display mt-s1 break-words text-lg font-semibold text-texto sm:text-xl">
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
      <X className="h-[12px] w-[12px]" aria-hidden="true" />
    ) : tom === 'alerta' ? (
      <Clock className="h-[12px] w-[12px]" aria-hidden="true" />
    ) : (
      <Check className="h-[12px] w-[12px]" aria-hidden="true" />
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
      {/* v3: o sobretítulo com o fio champanhe, como as seções das fichas. */}
      <legend className="cj-sobretitulo mb-s3 flex items-center gap-s2 p-0 before:h-px before:w-[12px] before:bg-ouro-forte">
        {titulo}
      </legend>
      {children}
    </fieldset>
  )
}
