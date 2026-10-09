// Peças comuns às telas do Quadro econômico (e à aba Carteiras).
//
// Duas ideias atravessam tudo aqui:
//   · nenhum número aparece sem o tamanho da amostra ao lado;
//   · nenhum indicador sofisticado aparece sem explicação a um clique.
//
// O DESENHO É O DA AMOSTRA APROVADA (paginas2.js e estilo2.css): o painel com o
// título sem divisória (`.panel`), o cartão de número com o ícone ao lado do
// rótulo (`.kpi`), as métricas em duas colunas (`.kv.two-col`), o ⓘ de 24px
// (`.info`) e o selo de amostra com ícone (`pill`). As peças moram aqui, e não
// em components/ui, porque o desenho delas é do Quadro: o StatCard e o Card de
// ui/ continuam servindo às outras telas como estão.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, Info } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { ErrorState, Loading } from '@/components/ui/Table'
import { cn } from '@/lib/cn'
import { formatBRL, hojeISO } from '@/lib/format'
import { restaAlemDaBorda } from '@/lib/rolagemLateral'
import { processosCrud, useParametrosAtualizacao } from '@/lib/queries'
import { montarPainel, type PainelEconomico, type ResumoGrupo } from '@/lib/analytics'
import type { ClasseAmostra } from '../../../supabase/functions/_shared/nucleo/amostra.ts'
import { TextoComTermos } from '@/components/layout/TextoComTermos'

/** Percentual a partir de FRAÇÃO (0,3648 -> "36,5%"). */
export function pct(f: number | null | undefined, casas = 1): string {
  if (typeof f !== 'number' || !Number.isFinite(f)) return '—'
  return `${(f * 100).toFixed(casas).replace('.', ',')}%`
}

export function dias(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `${Math.round(v)} d`
}

export function brl(v: number | null | undefined): string {
  return formatBRL(typeof v === 'number' ? v : null)
}

/**
 * Carrega créditos e parâmetros e monta o painel uma única vez.
 *
 * `tentarDeNovo` (etapa 4 do plano): o erro de carga deixava a tela parada no
 * "Não foi possível carregar os dados", e o único jeito de tentar outra vez era
 * recarregar a página inteira. Ele refaz as DUAS leituras — a dos parâmetros
 * também, porque sem ela a conta sai incompleta (ver AvisoParametros).
 *
 * O PAINEL FICA EM useMemo: a montagem percorre a carteira inteira, e sem isto
 * ela era refeita a cada clique da tela (trocar o recorte, abrir um bloco),
 * com os mesmos dados.
 */
export function usePainel(): {
  painel: PainelEconomico | null
  carregando: boolean
  erro: unknown
  tentarDeNovo: () => void
} {
  const processos = processosCrud.useList()
  const params = useParametrosAtualizacao()
  const carregando = processos.isLoading || params.isLoading
  const hoje = hojeISO()
  const painel = useMemo(
    () =>
      carregando || !processos.data
        ? null
        : montarPainel(processos.data, params.data ?? undefined, hoje),
    [carregando, processos.data, params.data, hoje],
  )
  const tentarDeNovo = () => {
    void processos.refetch()
    void params.refetch()
  }
  // ERRO SÓ QUANDO NÃO HÁ CARTEIRA. A cada troca de aba a carteira é relida
  // (passados 30 s); se essa releitura falha, o React Query GUARDA os dados que
  // já tinha e acende o erro junto. Repassar o erro direto trocava o painel
  // inteiro, já calculado, por "Não foi possível carregar" — por um soluço de
  // rede, com os números certos na mão.
  return { painel, carregando, erro: processos.data ? null : processos.error, tentarDeNovo }
}

export function CarregandoPainel() {
  return (
    // SEM O CardBody: o Loading já tem o respiro dele, e os dois somados davam
    // quase 40px de margem (revisão visual 2).
    <Card>
      <Loading label="Calculando a carteira…" />
    </Card>
  )
}

/** O erro de carga das abas do Quadro, agora com "Tentar novamente". */
export function ErroPainel({ tentarDeNovo }: { tentarDeNovo: () => void }) {
  return (
    <Card>
      <ErrorState message="Confira a conexão e tente de novo." onRetry={tentarDeNovo} />
    </Card>
  )
}

/**
 * Dentro do Quadro a aba NÃO REPETE O TÍTULO (o `cab` da amostra): o h1 é o
 * "Quadro econômico" da moldura e a aba aberta já diz onde se está; fica só a
 * frase do que ela mostra. O h2 continua existindo para o leitor de tela, que
 * navega por títulos.
 */
export function CabecalhoDaAba({ titulo, apoio }: { titulo: string; apoio?: ReactNode }) {
  return (
    <div className="-mt-s1">
      <h2 className="sr-only">{titulo}</h2>
      {/* OS TERMOS DO GLOSSÁRIO sublinhados quando o apoio é texto puro (o
          `tab-desc` da amostra); apoio com marcação fica como veio. */}
      {apoio && (
        <p className="text-corpo text-texto-2">
          {typeof apoio === 'string' ? <TextoComTermos texto={apoio} /> : apoio}
        </p>
      )}
    </div>
  )
}

/**
 * O ⓘ da amostra (`.info`): 24px de alvo, focável, e a explicação no `title` e
 * no `aria-label` — funciona em qualquer contexto, inclusive dentro de tabela,
 * sem biblioteca de dica que o projeto não tem.
 *
 * `focavel={false}` quando ele mora dentro de um link (o cartão que leva às
 * Previsões): um alvo de foco dentro de outro confunde o Tab e o leitor de tela.
 */
export function Dica({ texto, focavel = true }: { texto: string; focavel?: boolean }) {
  return (
    <span
      role="img"
      aria-label={texto}
      title={texto}
      tabIndex={focavel ? 0 : undefined}
      className="-my-s1 inline-grid h-[24px] w-[24px] shrink-0 cursor-help place-items-center rounded-controle text-texto-3 transition-colors hover:bg-superficie-3 hover:text-marca-texto focus-visible:bg-superficie-3 focus-visible:text-marca-texto"
    >
      <Info className="h-[14px] w-[14px]" aria-hidden />
    </span>
  )
}

/** Rótulo com o ⓘ ao lado (item 19: nenhum indicador sem explicação). */
export function Explicacao({ texto, children }: { texto: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-s0.5">
      {children}
      <Dica texto={texto} />
    </span>
  )
}

/**
 * O selo de amostra da amostra (`amostra()` em paginas2.js): A CLASSE PELA COR
 * E PELO TEXTO, e com ícone — insuficiente e baixa com alerta, moderada com ⓘ,
 * alta com ✓. Cor nunca sozinha. A explicação de amostra.ts no title, e o selo
 * focável para quem não usa mouse chegar a ela.
 */
const SELO_CLASSE: Record<ClasseAmostra, { cor: string; Icone: typeof Info }> = {
  insuficiente: { cor: 'ring-perigo-borda bg-perigo-fundo text-perigo', Icone: AlertTriangle },
  baixa: { cor: 'ring-aviso-borda bg-aviso-fundo text-aviso', Icone: AlertTriangle },
  moderada: { cor: 'ring-info-borda bg-info-fundo text-info', Icone: Info },
  alta: { cor: 'ring-sucesso-borda bg-sucesso-fundo text-sucesso', Icone: Check },
}

/**
 * Selo de representatividade. É o item 7 tornado visível: sempre que um
 * agregado aparece, o direito de concluir a partir dele aparece junto.
 */
export function SeloAmostra({
  n, classe, rotulo, explicacao, compacto = false,
}: {
  n: number
  classe: ClasseAmostra
  rotulo: string
  explicacao: string
  compacto?: boolean
}) {
  const { cor, Icone } = SELO_CLASSE[classe]
  return (
    <span
      title={explicacao}
      tabIndex={0}
      aria-label={`${rotulo} · n=${n}. ${explicacao}`}
      className={cn(
        // NAS MEDIDAS DA `Badge` (§0.8, revisão visual 2): 20px, contorno por dentro.
        'inline-flex h-[20px] shrink-0 items-center gap-s1 whitespace-nowrap rounded-full px-s2 text-xs font-semibold ring-1 ring-inset dark:ring-opacity-50',
        cor,
      )}
    >
      <Icone className="h-[12px] w-[12px] shrink-0" aria-hidden />
      {compacto ? `n=${n}` : `${rotulo} · n=${n}`}
    </span>
  )
}

export const EXPLICA = {
  mediana:
    'Resultado central das operações: metade ficou acima, metade abaixo. Reduz o efeito de ' +
    'valores extremos e representa melhor o caso típico do que a média.',
  media:
    'Soma dos resultados dividida pelo número de operações. Sensível a extremos — por isso ' +
    'aparece sempre ao lado da mediana.',
  ponderada:
    'Rentabilidade do capital: soma dos ganhos dividida pela soma dos capitais investidos. ' +
    'Dá mais peso às operações que receberam mais dinheiro. Responde "quanto rendeu o ' +
    'capital", enquanto a mediana responde "como se comporta uma operação qualquer".',
  tir:
    'Rentabilidade convertida para taxa ao ano, considerando o prazo de cada operação. ' +
    'Permite comparar um retorno de 30% em 8 meses com outro de 30% em 36 meses — que não ' +
    'são equivalentes.',
  iqr:
    'Amplitude interquartil: distância entre o primeiro e o terceiro quartil. Mede o quanto ' +
    'os resultados se espalham em torno do centro, sem ser afetada por extremos.',
  ic:
    'Faixa onde a mediana verdadeira do grupo deve estar, com 95% de confiança. Quanto menor ' +
    'a amostra, mais larga a faixa. Com 5 operações ou menos, a faixa é toda a amplitude dos ' +
    'dados e não diz nada.',
  extremos:
    'Operações fora do intervalo interquartil ampliado. São marcadas, nunca removidas: um ' +
    'resultado extremo pode ser um evento real. Na maioria dos casos aqui, é efeito de prazo ' +
    'muito curto, não de rentabilidade excepcional.',
  representatividade:
    'Quantas operações sustentam o número. Abaixo de 6, o intervalo de confiança da mediana ' +
    'cobre toda a amplitude observada e nenhuma conclusão é possível. De 6 a 11, baixa; de ' +
    '12 a 29, moderada; 30 ou mais, alta.',
  vencida:
    'Operações cuja data prevista de pagamento já passou sem liquidação. Ficam em bloco ' +
    'próprio: distribuí-las em meses futuros seria atribuir uma data que ninguém estimou.',
  complementar:
    'Operações que receberam o principal e aguardam um valor complementar. Não entram nas ' +
    'métricas de performance porque o resultado final ainda não é conhecido.',
  projetado:
    'Valor de face corrigido pelo índice cadastrado (SELIC ou IPCA+2%), da data-base do ' +
    'cálculo até a data prevista de recebimento. Quando a previsão já venceu, a correção ' +
    'segue até hoje.',
  /** Processo sem CNJ: o identificador interno, com a explicação no title. */
  processo:
    'Número do processo no padrão CNJ. Quando o crédito não tem CNJ cadastrado, aparece ' +
    'o identificador interno do registro.',
} as const

/**
 * O painel da amostra (`.panel` + `.panel-h`): título de 16px na fonte de
 * display, a frase de apoio embaixo e, à direita, o selo ou o controle — SEM a
 * divisória do CardHeader de ui/. O conteúdo vem logo abaixo, e as tabelas
 * encostam nas bordas do painel (como na amostra), sem o recuo do CardBody.
 */
export function Painel({
  titulo, apoio, acao, children, className,
}: {
  titulo: ReactNode
  apoio?: ReactNode
  acao?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('min-w-0 rounded-cartao border border-borda bg-superficie shadow-nivel-1 dark:shadow-none', className)}>
      <div className="flex flex-wrap items-start justify-between gap-s3 px-s5 pb-s2 pt-s4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-s2 font-display text-lg font-bold text-texto">{titulo}</h3>
          {apoio && <p className="mt-s0.5 text-corpo text-texto-2">{apoio}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  )
}

/** Cabeçalho de bloco com o selo de amostra do grupo. */
export function BlocoGrupo({
  titulo, descricao, grupo, children,
}: {
  titulo: string
  descricao?: string
  grupo: ResumoGrupo
  children: ReactNode
}) {
  return (
    <Painel
      titulo={titulo}
      apoio={descricao}
      acao={
        <SeloAmostra
          n={grupo.n}
          classe={grupo.representatividade.classe}
          rotulo={grupo.representatividade.rotulo}
          explicacao={grupo.representatividade.explicacao}
        />
      }
    >
      <div className="px-s5 pb-s5">{children}</div>
    </Painel>
  )
}

/**
 * O cartão de número da amostra (`kpi`): o ícone numa placa de 28px AO LADO do
 * rótulo, o ⓘ, o valor grande embaixo e, quando há, uma linha pequena (`sub`).
 *
 * `to` faz do cartão inteiro um link — e o `sub` então diz PARA ONDE ele leva
 * ("ver previsões por mês →"), o item "Cartões que dizem para onde levam".
 * `tom` pinta a borda esquerda e a placa do ícone (o `tom-warn`/`tom-bad` da
 * amostra): âmbar para o que pede atenção, vermelho para o que passou do ponto.
 */
export function CartaoNumero({
  rotulo, valor, icone, dica, sub, tom, to, tituloDoLink, menor = false,
}: {
  rotulo: string
  valor: ReactNode
  icone?: ReactNode
  dica?: string
  sub?: ReactNode
  tom?: 'aviso' | 'perigo'
  to?: string
  /** O `title` do link, quando há `to`. */
  tituloDoLink?: string
  /**
   * O número da SEGUNDA FAIXA (auditoria visual, Q3): 18px em vez de 22px e
   * menos altura. Na Visão geral, os três de dinheiro ficam grandes em cima e
   * os de taxa e prazo descem um degrau — seis números do mesmo peso não
   * diziam qual olhar primeiro.
   */
  menor?: boolean
}) {
  const placa =
    tom === 'perigo'
      ? 'bg-perigo-fundo text-perigo'
      : tom === 'aviso'
        ? 'bg-aviso-fundo text-aviso'
        : 'bg-marca-leve text-marca-texto'
  const cartao = (
    // A FAIXA DE ESTADO é a do Card de ui/ (auditoria visual, C5): uma barra
    // interna de 3px, recortada pelo canto. O `border-l-4` de antes curvava
    // junto com o raio e parecia borda dupla.
    <Card
      faixa={tom}
      className={cn(
        // Cartão de indicador: 16px de respiro (§0.1).
        'flex h-full min-w-0 flex-col gap-s1 p-s4',
        menor && 'py-s3',
        // NO CELULAR, O DA SEGUNDA FAIXA VIRA UMA LINHA (revisão UX, 09/10/2026):
        // o rótulo à esquerda e o número à direita. Empilhados, os seis cartões
        // da Visão geral ocupavam quase duas telas antes do primeiro gráfico; a
        // taxa e o prazo cabem numa linha só.
        menor && 'max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:gap-s3',
        to && 'transition group-hover:border-marca-viva group-hover:shadow-nivel-2',
      )}
    >
      <div className="flex min-w-0 items-center gap-s2">
        {icone && (
          <span className={cn('grid h-[28px] w-[28px] shrink-0 place-items-center rounded-controle', placa)} aria-hidden>
            {icone}
          </span>
        )}
        <span className="min-w-0 text-corpo font-medium text-texto-2">{rotulo}</span>
        {dica && <Dica texto={dica} focavel={!to} />}
      </div>
      {/* NA FONTE DO CORPO, como o `.kpi-v` da amostra, e não na de display:
          o espaço do "R$ 7.075.026,00" na Plus Jakarta tem 3px, e o valor se
          lia "R$7.075.026,00". */}
      <div className={cn('font-bold tabular-nums tracking-tight text-texto', menor ? 'shrink-0 text-xl' : 'text-2xl')}>
        {valor}
      </div>
      {sub && <div className="text-xs text-texto-3">{sub}</div>}
    </Card>
  )
  if (!to) return cartao
  return (
    <Link to={to} title={tituloDoLink} className="group block h-full rounded-cartao">
      {cartao}
    </Link>
  )
}

/** O tamanho dos ícones dos cartões (16px; `h-4` vale 12px com a raiz de 12px). */
export const ICONE_CARTAO = 'h-[16px] w-[16px]'

/** Três cartões por linha (o `.kpis.three`); um por linha no celular. */
export function GradeCartoes({ children, seis = false }: { children: ReactNode; seis?: boolean }) {
  return (
    <div
      className={cn(
        // 12px entre os cartões no celular (16px no computador): na coluna
        // única, 16px somados seis vezes eram quase um cartão de vão.
        'grid gap-s3 sm:gap-s4',
        seis ? 'grid-cols-2 md:grid-cols-3 min-[1180px]:grid-cols-6' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {children}
    </div>
  )
}

/**
 * SEM OS PARÂMETROS, A CONTA SAI INCOMPLETA E CALADA. Se a leitura de
 * `parametros_atualizacao` falha, o painel é montado sem SELIC e IPCA: os créditos
 * corrigidos por eles ficam sem valor projetado e somem dos totais "a receber",
 * sem nada na tela dizendo por quê. Esta faixa diz.
 */
export function AvisoParametros() {
  const { error } = useParametrosAtualizacao()
  if (!error) return null
  return (
    <Ressalva>
      <span title={(error as Error)?.message ?? 'erro desconhecido'}>
        Não consegui ler os parâmetros de atualização (SELIC e IPCA): as projeções dos créditos
        corrigidos por eles ficam fora dos totais. Recarregue ou confira em Carteiras › Parâmetros.
      </span>
    </Ressalva>
  )
}

/**
 * Faixa de aviso metodológico (o `.note-box.warn` da amostra): o ícone de
 * alerta em âmbar e o texto na cor de leitura. Não é erro — é contexto
 * obrigatório.
 */
export function Ressalva({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-s2 rounded-campo border border-aviso-borda bg-aviso-fundo px-s3 py-s2 text-corpo">
      <AlertTriangle className="mt-s0.5 h-[16px] w-[16px] shrink-0 text-aviso" aria-hidden />
      <p className="text-texto">{children}</p>
    </div>
  )
}

/**
 * As métricas em duas colunas (o `.kv.two-col` da amostra): rótulo à esquerda,
 * no cinza de metadado e com o ⓘ quando há explicação; valor à direita.
 * Envolve as `LinhaMetrica` num `<dl>`.
 */
export function Metricas({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('space-y-s2 px-s5 pb-s5 pt-s1', className)}>{children}</dl>
}

/** Uma linha de `Metricas`. `destaque` em negrito: é o número para usar. */
export function LinhaMetrica({
  rotulo, valor, explicacao, destaque = false,
}: {
  rotulo: string
  valor: ReactNode
  explicacao?: string
  destaque?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-s3">
      <dt className="inline-flex min-w-0 items-center gap-s0.5 text-corpo text-texto-3">
        {rotulo}
        {explicacao && <Dica texto={explicacao} />}
      </dt>
      <dd className={cn('whitespace-nowrap text-right text-corpo tabular-nums text-texto', destaque ? 'font-bold' : 'font-medium')}>
        {valor}
      </dd>
    </div>
  )
}

/** A régua entre dois blocos de métricas do mesmo painel (`hr.sep`). */
export function Separador() {
  return <hr className="mx-s5 my-s1 border-borda" />
}

/**
 * Número do processo, ou o identificador interno COM A DICA de por que ele
 * aparece (o item "Dica no identificador interno": antes a explicação só
 * existia no cabeçalho da Performance, e nas listas das Previsões o código de
 * oito letras aparecia sem dizer o que era).
 */
export function ProcessoOuRef({ cnj, refInterna }: { cnj: ReactNode | null; refInterna: string }) {
  if (cnj) return <span className="whitespace-nowrap tabular-nums">{cnj}</span>
  return (
    <span className="whitespace-nowrap font-mono text-xs text-texto-2" title={EXPLICA.processo}>
      {refInterna}
    </span>
  )
}

/**
 * A dica dos gráficos (o `.viz-tip` da amostra): o rótulo em negrito e uma
 * linha por série, com o quadradinho da cor e o valor alinhado à direita.
 * Recebe as props do <Tooltip content> do Recharts.
 */
export function DicaDoGrafico({
  active, payload, label, formatar, extra,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>
  label?: ReactNode
  formatar: (v: number) => string
  /** Uma linha cinza a mais, montada a partir do ponto (ex.: "3 operações · R$ …"). */
  extra?: (ponto: Record<string, unknown>) => ReactNode
}) {
  if (!active || !payload?.length) return null
  const ponto = payload[0]?.payload ?? {}
  return (
    <div className="min-w-[160px] rounded-campo border border-borda bg-superficie px-s2 py-s2 text-sm text-texto shadow-nivel-2">
      <p className="mb-s1 font-bold">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-s1 text-texto-2">
          <i className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: p.color }} />
          {p.name}
          <span className="ml-auto pl-s2 font-bold tabular-nums text-texto">
            {typeof p.value === 'number' ? formatar(p.value) : '—'}
          </span>
        </div>
      ))}
      {extra && <p className="mt-s1 text-xs text-texto-3">{extra(ponto)}</p>}
    </div>
  )
}

/** A legenda dos gráficos de duas séries ou mais (`.legend`). */
export function LegendaDoGrafico({ itens }: { itens: Array<{ nome: string; cor: string }> }) {
  return (
    <div className="mb-s2 flex flex-wrap gap-x-s4 gap-y-s1 text-sm text-texto-2">
      {itens.map((i) => (
        <span key={i.nome} className="inline-flex items-center gap-s1">
          <i className="h-[10px] w-[10px] shrink-0 rounded-[3px]" style={{ background: i.cor }} aria-hidden />
          {i.nome}
        </span>
      ))}
    </div>
  )
}

/**
 * Para a tabela que encosta nas bordas do Painel: a primeira e a última coluna
 * ganham o mesmo recuo do título do painel (18px), e o texto da tabela fica
 * alinhado com o dele (vence o `dense` da Table, que aperta todas as células).
 * O cabeçalho não quebra linha, como o `.tbl th` da amostra.
 */
export const TABELA_NO_PAINEL =
  '[&_th]:whitespace-nowrap [&_td:first-child]:pl-s5 [&_th:first-child]:pl-s5 [&_td:last-child]:pr-s5 [&_th:last-child]:pr-s5'

/**
 * A CAIXA QUE ROLA DE LADO para as tabelas largas do Quadro (auditoria visual,
 * Q2). A Table de ui/ deixa de rolar a partir de 1280px (para o cabeçalho fixo
 * acompanhar a página), e uma tabela de 10 ou 25 colunas passava da borda do
 * painel. Aqui ela rola dentro do painel, com duas pistas:
 *   - a borda direita ESMAECE enquanto há coluna escondida (some ao chegar ao
 *     fim, para a última coluna não ficar apagada);
 *   - `colunaFixa`: a primeira coluna (o nome do grupo) fica parada ao rolar,
 *     com uma linha à direita — a linha não perde o dono.
 * O preço: dentro de uma caixa que rola, o cabeçalho não fica fixo no topo da
 * página. São tabelas curtas (um grupo por linha), e o nome da linha à vista
 * vale mais aqui.
 */
export function TabelaQueRola({ children, colunaFixa = false }: { children: ReactNode; colunaFixa?: boolean }) {
  const caixa = useRef<HTMLDivElement>(null)
  const [temMais, setTemMais] = useState(false)
  const medir = useCallback(() => {
    const el = caixa.current
    if (el) setTemMais(restaAlemDaBorda(el.scrollLeft, el.clientWidth, el.scrollWidth))
  }, [])
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    medir()
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    if (el.firstElementChild) obs.observe(el.firstElementChild)
    return () => obs.disconnect()
  }, [medir])
  return (
    <div
      ref={caixa}
      onScroll={medir}
      className={cn(
        // A Table de ui/ tem a própria caixa que rola abaixo de 1280px: aqui ela
        // não rola, para a pista e a coluna fixa valerem em qualquer largura.
        'overflow-x-auto scrollbar-thin [&>div]:overflow-visible',
        temMais && '[mask-image:linear-gradient(to_right,black_92%,transparent)]',
        colunaFixa && [
          // A primeira coluna parada. O fundo é opaco (a linha de baixo não pode
          // aparecer através dela ao rolar), e o realce da linha sob o mouse é
          // a mesma tinta do TR, pintada por dentro da célula.
          '[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:z-[1] [&_td:first-child]:bg-superficie',
          '[&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-[1] [&_th:first-child]:bg-superficie-2',
          '[&_td:first-child]:[box-shadow:1px_0_0_rgb(var(--borda))] [&_th:first-child]:[box-shadow:1px_0_0_rgb(var(--borda))]',
          '[&_tr:hover_td:first-child]:[box-shadow:1px_0_0_rgb(var(--borda)),inset_0_0_0_999px_rgb(var(--superficie-3)/0.6)]',
        ],
      )}
    >
      {children}
    </div>
  )
}
