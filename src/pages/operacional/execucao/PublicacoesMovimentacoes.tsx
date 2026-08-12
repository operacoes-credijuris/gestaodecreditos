import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Search, ExternalLink, ListChecks, ChevronDown } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { processosCrud, requerimentosCrud, apensosCrud } from '@/lib/queries'
import { cn } from '@/lib/cn'
import { getLabel, STATUS_PROCESSO } from '@/lib/labels'
import { NovaTarefaModal } from '@/pages/operacional/execucao/TarefasAdvbox'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Field'
import { Tabs } from '@/components/ui/Tabs'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { Loading, ErrorState, EmptyState } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import {
  formatCNJ,
  formatDate,
  normalizarBusca,
  onlyDigits as dig,
} from '@/lib/format'

// Teto de linhas por consulta, para a tela não puxar a tabela inteira. Bater no
// teto ESCONDE registro — e publicação escondida é intimação que ninguém leu —,
// então a tela avisa quando isso acontece.
//
// O AVISO NÃO COMPARA COM ESTE NÚMERO, e é de propósito: o PostgREST tem um
// max-rows próprio e devolve no máximo ele, qualquer que seja o `.limit()`
// pedido. Comparar com o limite pedido só funciona se os dois coincidirem — foi
// assim que uma versão anterior deste aviso, testando `>= 2000` com o servidor
// cortando em 1000, nunca disparou. O aviso compara com a CONTAGEM EXATA da
// janela, que a tela já busca para a pílula: se veio menos linha do que existe,
// truncou, e o número real aparece na mensagem.
const LIMITE_LINHAS = 1000

/**
 * Quantos registros existem na janela (contagem leve: head:true não baixa
 * linha). Serve a DOIS consumidores — a pílula da aba e o aviso de truncamento
 * da lista — e é o MESMO queryKey nos dois, então o React Query deduplica: uma
 * requisição, um número, sem chance de a pílula discordar do aviso.
 *
 * A chave começa com a mesma raiz da lista ('djen_publicacoes') de propósito:
 * invalidateQueries casa por prefixo, então a sincronização, que invalida a
 * raiz, atualiza a contagem junto. Com a chave antiga ('djen_publicacoes_count')
 * nada invalidava esta consulta, e a pílula ficava com o número da abertura da
 * página enquanto o cabeçalho da lista já mostrava outro.
 */
function useContagem(tabela: string, campoData: string, desde: string) {
  return useQuery({
    queryKey: [tabela, 'count', desde],
    queryFn: async () => {
      const { count, error } = await supabase
        .from(tabela)
        .select('*', { count: 'exact', head: true })
        .gte(campoData, desde)
      if (error) throw new Error(error.message)
      return count ?? 0
    },
  })
}

// Data-limite (YYYY-MM-DD, fuso local) de uma janela de N dias — usada em
// dupla pela contagem da pílula e pela lista, que precisam andar juntas.
const isoDiasAtras = (n: number) =>
  new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE')

// Dispara a sincronização UMA vez ao montar (o guard por ref preserva o
// comportamento no StrictMode). Compartilhado pelas abas Publicações e
// Movimentações, que têm o mesmo padrão de sync em 2º plano.
function useSincronizaAoMontar(mutate: () => void) {
  const ja = useRef(false)
  useEffect(() => {
    if (ja.current) return
    ja.current = true
    mutate()
  }, [mutate])
}

interface DjenRow {
  id: number
  data_disponibilizacao: string | null
  numero_processo: string | null
  sigla_tribunal: string | null
  tipo_comunicacao: string | null
  raw: Record<string, unknown>
  tratada: boolean
}

// Resolução do processo da publicação contra os cadastros.
interface ResolveInfo {
  kind: 'credito' | 'requerimento' | null
  status?: string | null
  cedente?: string | null
  cessionario?: string | null
}

// Resolve um número de processo contra os cadastros: Crédito (status + partes),
// Requerimento, ou Apenso (herda do crédito/requerimento pai). Usado pelas
// Publicações e pelas Movimentações.
function useResolveProcesso() {
  const processos = processosCrud.useList()
  const requerimentos = requerimentosCrud.useList()
  const apensos = apensosCrud.useList()
  return useMemo(() => {
    const credPorNum = new Map<string, ResolveInfo>()
    const credPorId = new Map<string, ResolveInfo>()
    for (const p of processos.data ?? []) {
      const info: ResolveInfo = {
        kind: 'credito',
        status: p.status,
        cedente: p.cedente,
        cessionario: p.cessionario,
      }
      credPorId.set(p.id, info)
      const d = dig(p.numero_cnj)
      if (d.length >= 15) credPorNum.set(d, info)
    }
    const reqNums = new Set<string>()
    for (const r of requerimentos.data ?? []) {
      const d = dig(r.numero_protocolo)
      if (d.length >= 15) reqNums.add(d)
    }
    const apPorNum = new Map<
      string,
      { processo_id: string | null; requerimento_id: string | null }
    >()
    for (const a of apensos.data ?? []) {
      const d = dig(a.numero)
      if (d.length >= 15)
        apPorNum.set(d, { processo_id: a.processo_id, requerimento_id: a.requerimento_id })
    }
    return (numProc: string | null): ResolveInfo => {
      const d = dig(numProc)
      const cred = credPorNum.get(d)
      if (cred) return cred
      if (reqNums.has(d)) return { kind: 'requerimento' }
      const ap = apPorNum.get(d)
      if (ap) {
        if (ap.processo_id && credPorId.has(ap.processo_id))
          return credPorId.get(ap.processo_id)!
        if (ap.requerimento_id) return { kind: 'requerimento' }
      }
      return { kind: null }
    }
  }, [processos.data, requerimentos.data, apensos.data])
}

// Decodifica entidades HTML do texto do DJEN (&Aacute; -> Á etc.).
function decodeHtml(s: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = s
  return el.value
}
function textoLimpo(html: unknown): string {
  if (!html) return ''
  const noTags = String(html).replace(/<[^>]+>/g, ' ')
  return decodeHtml(noTags)
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function PublicacoesMovimentacoes() {
  const [aba, setAba] = useState<'publicacoes' | 'movimentacoes'>('publicacoes')
  const [busca, setBusca] = useState('')

  const ini30 = useMemo(() => isoDiasAtras(30), [])
  const ini20 = useMemo(() => isoDiasAtras(20), [])
  const nPub = useContagem('djen_publicacoes', 'data_disponibilizacao', ini30)
  const nMov = useContagem('advbox_movimentacoes', 'data', ini20)

  return (
    <div>
      <PageHeader title="Publicações e Movimentações" />

      {/* Tabs, e não Segmented: Publicações/Movimentações são DUAS VISÕES da aba —
          duas fontes de dados distintas (DJEN e ADVBOX) —, o mesmo papel de
          RPV/Precatórios na Análise e de Investidores/Originadores nos Dados
          cadastrais. A regra da plataforma: sublinhado para visões, pílula para
          filtros dentro da visão. A busca fica no cartão, que é dela. */}
      <div className="mb-4">
        <Tabs
          items={[
            { key: 'publicacoes', label: 'Publicações', count: nPub.data },
            { key: 'movimentacoes', label: 'Movimentações', count: nMov.data },
          ]}
          value={aba}
          onChange={(k) => setAba(k as typeof aba)}
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            className="pl-9"
            placeholder="Buscar por processo, tribunal, órgão, tipo, conteúdo…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </Card>

      {aba === 'publicacoes' ? (
        <Publicacoes busca={busca} />
      ) : (
        <Movimentacoes busca={busca} />
      )}
    </div>
  )
}

/** O que a djen-publicacoes devolve. Só o que a tela usa. */
interface RespostaSync {
  resumo?: string
  diagnostico?: {
    oabs_ativas?: string[]
    oabs_ilegiveis?: string[]
    buscas_falharam: number
  }
}

// ----------------------- Publicações (DJEN) -----------------------
function Publicacoes({ busca }: { busca: string }) {
  const qc = useQueryClient()
  const toast = useToast()

  // Resolve cada publicação contra os cadastros (Crédito/Requerimento/Apenso).
  const resolve = useResolveProcesso()

  // Janela de 30 dias (data de disponibilização >= hoje - 30, horário local).
  const ini30 = useMemo(() => isoDiasAtras(30), [])
  // Mesma chave da pílula: o React Query devolve o valor já em cache, sem
  // segunda requisição. Serve para saber se a lista abaixo veio truncada.
  const total = useContagem('djen_publicacoes', 'data_disponibilizacao', ini30)

  const lista = useQuery({
    queryKey: ['djen_publicacoes', ini30],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('djen_publicacoes')
        .select('*')
        .gte('data_disponibilizacao', ini30)
        .order('data_disponibilizacao', { ascending: false })
        .order('id', { ascending: false })
        .limit(LIMITE_LINHAS)
      if (error) throw new Error(error.message)
      return (data ?? []) as DjenRow[]
    },
  })

  // Sincroniza com o DJEN em segundo plano ao abrir a página.
  //
  // AVISA SÓ QUANDO HÁ O QUE AVISAR. A função devolve um `resumo` com a contagem
  // de cada etapa, e ele NÃO vai para a tela — número que ninguém precisa ler todo
  // dia é poluição. O que vai é o alarme: busca que falhou, OAB ilegível, OAB sem
  // nenhuma comunicação. Em silêncio quando está tudo certo.
  //
  // O motivo de existir alarme: a sincronização já rodou dias devolvendo sucesso
  // com um punhado de linhas, e a descoberta veio de comparar com a plataforma
  // antiga, seis dias depois. O `resumo` completo continua na resposta da função,
  // para quem for diagnosticar.
  const sync = useMutation({
    mutationFn: () => invokeFunction<RespostaSync>('djen-publicacoes', {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['djen_publicacoes'] })
      const d = r?.diagnostico
      if (!d) return
      // Um aviso por vez, do mais grave ao menos: dois toques vermelhos juntos
      // viram ruído e ninguém lê o segundo.
      //
      // OAB sem nenhuma comunicação na janela NÃO avisa mais. Era ruído: ou a OAB
      // está errada — e aí é conserto de uma vez, não de todo dia — ou o advogado
      // realmente não recebeu nada, que é normal. A contagem por OAB continua no
      // `diagnostico` da função, para quem for investigar.
      if (d.buscas_falharam > 0) {
        toast.error(
          `DJEN: a busca falhou em ${d.buscas_falharam} das ${d.oabs_ativas?.length ?? '?'} OABs. ` +
            'Pode haver intimação não capturada — sincronize de novo.',
        )
      } else if (d.oabs_ilegiveis?.length) {
        toast.error(
          `DJEN: ${d.oabs_ilegiveis.length} OAB cadastrada não pôde ser lida ` +
            `(${d.oabs_ilegiveis.join(', ')}). Intimação em nome dela é descartada.`,
        )
      }
    },
    onError: (e) =>
      toast.error(`Sincronização DJEN: ${(e as Error).message}`),
  })
  useSincronizaAoMontar(sync.mutate)

  // Marca/desmarca "tratada" (move entre Novas e Tratadas).
  const toggleTratada = useMutation({
    mutationFn: async (row: DjenRow) => {
      const { error } = await supabase
        .from('djen_publicacoes')
        .update({ tratada: !row.tratada })
        .eq('id', row.id)
      if (error) throw new Error(error.message)
    },
    onMutate: async (row) => {
      const key = ['djen_publicacoes', ini30]
      await qc.cancelQueries({ queryKey: ['djen_publicacoes'] })
      const prev = qc.getQueryData<DjenRow[]>(key)
      qc.setQueryData<DjenRow[]>(key, (old) =>
        (old ?? []).map((r) =>
          r.id === row.id ? { ...r, tratada: !r.tratada } : r,
        ),
      )
      return { prev, key }
    },
    onError: (e, _row, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev)
      toast.error((e as Error).message)
    },
    onSuccess: (_data, row) => {
      // row é o estado ANTES do toggle; "Desfazer" aplica o toggle inverso.
      toast.success(
        row.tratada
          ? 'Publicação devolvida para Novas.'
          : 'Publicação marcada como tratada.',
        {
          action: {
            label: 'Desfazer',
            onClick: () => toggleTratada.mutate({ ...row, tratada: !row.tratada }),
          },
        },
      )
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['djen_publicacoes'] }),
  })

  // Publicação para a qual estamos criando tarefa (abre o modal).
  const [tarefaPub, setTarefaPub] = useState<DjenRow | null>(null)

  // Índice de busca por publicação.
  //
  // O texto do DJEN chega em HTML COM ENTIDADES, e a busca rodava nesse valor
  // cru: procurar "citação" não achava "cita&ccedil;&atilde;o", ou seja, a
  // palavra estava na tela e a lista voltava vazia. Aqui o texto passa pelo
  // MESMO textoLimpo da exibição (o que se procura é o que se lê) e por
  // normalizarBusca, porque ninguém digita acento em caixa de busca.
  //
  // Memoizado pela lista, e não recalculado por tecla: textoLimpo cria elemento
  // de DOM para decodificar entidade, e fazer isso em até 2000 publicações a
  // cada tecla travaria a digitação.
  const indiceBusca = useMemo(() => {
    const m = new Map<number, string>()
    for (const p of lista.data ?? []) {
      const r = p.raw ?? {}
      m.set(
        p.id,
        normalizarBusca(
          [
            p.numero_processo,
            p.sigla_tribunal,
            p.tipo_comunicacao,
            r.nomeOrgao,
            r.nomeClasse,
            textoLimpo(r.texto),
          ]
            .filter(Boolean)
            .join(' '),
        ),
      )
    }
    return m
  }, [lista.data])

  const filtradas = useMemo(() => {
    const all = lista.data ?? []
    const q = normalizarBusca(busca)
    if (!q) return all
    const qd = dig(busca)
    return all.filter((p) => {
      if ((indiceBusca.get(p.id) ?? '').includes(q)) return true
      // Número de processo colado sem pontuação ainda tem de achar o formatado.
      return qd.length >= 4 && dig(p.numero_processo).includes(qd)
    })
  }, [lista.data, busca, indiceBusca])

  if (lista.isLoading) return <Loading label="Carregando publicações…" />
  if (lista.isError)
    return (
      <ErrorState
        message={(lista.error as Error)?.message}
        onRetry={() => void lista.refetch()}
      />
    )

  const novas = filtradas.filter((p) => !p.tratada)
  const providenciadas = filtradas.filter((p) => p.tratada)
  // Truncou = veio menos linha do que existe na janela. Comparar com a contagem
  // real, e não com o limite pedido, é o que faz o aviso valer qualquer que seja
  // o max-rows do servidor.
  const truncou = total.data != null && (lista.data?.length ?? 0) < total.data
  const card = (p: DjenRow) => (
    <PublicacaoCard
      key={p.id}
      p={p}
      info={resolve(p.numero_processo)}
      onToggle={() => toggleTratada.mutate(p)}
      onCriarTarefa={() => setTarefaPub(p)}
    />
  )

  return (
    <div className="space-y-4">
      {/* gap-2, e não gap-3: o "·" do indicador tem 4,5px do próprio lado, e com
          gap-3 ele ficava visivelmente mais perto do texto da direita. */}
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span>
          <strong>{filtradas.length}</strong>{' '}
          {filtradas.length === 1 ? 'publicação' : 'publicações'}
        </span>
        <SyncStatus
          separador
          syncing={sync.isPending}
          updatedAt={lista.dataUpdatedAt}
          label="atualizando do DJEN…"
        />
      </div>


      {truncou && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Mostrando as {lista.data?.length} publicações mais recentes de{' '}
          {total.data} na janela de 30 dias. As mais antigas do período ficaram de
          fora — use a busca para encontrar uma publicação específica.
        </p>
      )}

      {filtradas.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma publicação"
            description={
              sync.isPending ? 'Sincronizando… pode levar ~1 min.' : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Secao titulo="Novas" qtd={novas.length}>
            {novas.length ? (
              novas.map(card)
            ) : (
              <p className="text-sm text-slate-600">Nenhuma publicação nova.</p>
            )}
          </Secao>
          <Secao titulo="Tratadas" qtd={providenciadas.length}>
            {providenciadas.length ? (
              providenciadas.map(card)
            ) : (
              <p className="text-sm text-slate-600">
                Nenhuma publicação tratada.
              </p>
            )}
          </Secao>
        </>
      )}

      <NovaTarefaModal
        open={!!tarefaPub}
        processoNumero={tarefaPub?.numero_processo ?? null}
        onClose={() => setTarefaPub(null)}
        onCreated={() => {
          setTarefaPub(null)
          toast.success('Tarefa criada no ADVBOX.')
        }}
      />
    </div>
  )
}

// Cabeçalho de seção: "Título (n) ————————".
function Secao({
  titulo,
  qtd,
  children,
}: {
  titulo: string
  qtd: number
  children: ReactNode
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 pt-1">
        <span className="text-sm font-semibold uppercase tracking-wide text-slate-600">
          {titulo}
        </span>
        <span className="text-xs text-slate-600">({qtd})</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      {children}
    </div>
  )
}

function PublicacaoCard({
  p,
  info,
  onToggle,
  onCriarTarefa,
}: {
  p: DjenRow
  info: ResolveInfo
  onToggle: () => void
  onCriarTarefa: () => void
}) {
  const raw = p.raw ?? {}
  const texto = useMemo(() => textoLimpo(raw.texto), [raw.texto])
  const st = getLabel(STATUS_PROCESSO, info.status)

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-medium text-slate-800">
              {formatCNJ(p.numero_processo ?? '')}
            </span>
            <label className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                className="accent-brand-600"
                checked={p.tratada}
                onChange={onToggle}
              />
              Tratada
            </label>
          </div>
          {info.kind === 'credito' && (info.cedente || info.cessionario) && (
            <div className="text-xs text-slate-600">
              {info.cedente || '—'} v. {info.cessionario || '—'}
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {p.sigla_tribunal && <Badge tone="blue">{p.sigla_tribunal}</Badge>}
            {info.kind === 'credito' && <Badge tone={st.tone}>{st.label}</Badge>}
            {info.kind === 'requerimento' && (
              <Badge tone="purple">Requerimento</Badge>
            )}
          </div>
          <Button
            size="sm"
            icon={<ListChecks className="h-4 w-4" />}
            onClick={onCriarTarefa}
          >
            Criar tarefa
          </Button>
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-600">
        Data de disponibilização: {formatDate(p.data_disponibilizacao)}
      </div>

      {texto && <TextoExpand text={texto} />}

      {typeof raw.link === 'string' && raw.link && (
        <div className="mt-2 text-xs">
          <a
            href={raw.link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Abrir no DJEN
          </a>
        </div>
      )}
    </Card>
  )
}

// Texto da publicação: até 4 linhas + "ler mais".
function TextoExpand({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [text])
  return (
    <div className="mt-2 text-sm text-slate-700">
      <div
        ref={ref}
        className={cn('whitespace-pre-line break-words', !expanded && 'line-clamp-4')}
      >
        {text}
      </div>
      {(clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-medium text-brand-600 hover:underline"
        >
          {expanded ? 'ler menos' : 'ler mais'}
        </button>
      )}
    </div>
  )
}

// ----------------------- Movimentações (ADVBOX) -----------------------
interface MovRow {
  id: string
  numero_processo: string | null
  data: string | null
  data_ts: string | null
  conteudo: string | null
}

// Chave de ordenação decrescente (mais recente primeiro). ISO ordena como texto.
const movOrdem = (m: MovRow) => m.data_ts ?? m.data ?? ''

// Status por processo (última movimentação) — alimenta o grupo Paralisados.
interface StatusRow {
  numero_processo: string
  ultima_movimentacao: string | null
}

// Dias corridos desde uma data (YYYY-MM-DD), no mínimo 0.
function diasDesde(dateStr: string): number {
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr)
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

// Badge de tempo sem movimentação: texto (dias → meses) e cor escalonando de
// amarelo a vermelho (20–45 / 45–90 / 90–180 / +180 dias). null = nunca moveu.
function badgeParalisado(dias: number | null): {
  classes: string
  texto: string
  borda: string
} {
  if (dias == null)
    return {
      classes: 'bg-red-700 text-white',
      texto: 'sem movimentação',
      borda: 'border-l-red-700',
    }
  const texto = dias < 60 ? `há ${dias} dias` : `há ${Math.floor(dias / 30)} meses`
  let classes = 'bg-amber-100 text-amber-700'
  let borda = 'border-l-amber-400'
  if (dias > 180) {
    classes = 'bg-red-200 text-red-800'
    borda = 'border-l-red-500'
  } else if (dias > 90) {
    classes = 'bg-red-100 text-red-700'
    borda = 'border-l-red-400'
  } else if (dias > 45) {
    classes = 'bg-orange-100 text-orange-700'
    borda = 'border-l-orange-400'
  }
  return { classes, texto, borda }
}

function Movimentacoes({ busca }: { busca: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const resolve = useResolveProcesso()

  // Janela de 20 dias (data do andamento >= hoje - 20, horário local).
  const ini20 = useMemo(() => isoDiasAtras(20), [])
  const total = useContagem('advbox_movimentacoes', 'data', ini20)

  const lista = useQuery({
    queryKey: ['advbox_movimentacoes', ini20],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advbox_movimentacoes')
        .select('*')
        .gte('data', ini20)
        .order('data', { ascending: false })
        .limit(LIMITE_LINHAS)
      if (error) throw new Error(error.message)
      return (data ?? []) as MovRow[]
    },
  })

  // Status por processo (última movimentação) — grupo Paralisados. Se a tabela
  // ainda não existir, falha em silêncio (paralisados = []) sem quebrar a aba.
  const status = useQuery({
    queryKey: ['advbox_processo_status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advbox_processo_status')
        .select('*')
        .limit(5000)
      if (error) throw new Error(error.message)
      return (data ?? []) as StatusRow[]
    },
    retry: false,
  })

  // Sincroniza com o ADVBOX em 2º plano ao abrir a aba.
  const sync = useMutation({
    mutationFn: () => invokeFunction('advbox-movimentacoes', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['advbox_movimentacoes'] })
      qc.invalidateQueries({ queryKey: ['advbox_processo_status'] })
    },
    onError: (e) => toast.error(`Sincronização ADVBOX: ${(e as Error).message}`),
  })
  useSincronizaAoMontar(sync.mutate)

  // Mesma normalização das Publicações: sem acento, e número de processo
  // comparado também por dígito. Antes, "goiania" e "5524530" não achavam nada.
  const q = normalizarBusca(busca)
  const qd = dig(busca)

  // Índice de busca, pelo mesmo motivo do das Publicações logo acima: `conteudo`
  // é a descrição crua do ADVBOX (centenas a alguns milhares de caracteres), e
  // normalizar isso linha por linha A CADA TECLA custava 14 ms medidos em 1.000
  // andamentos — 111 ms só para digitar "goiania". Memoizado pela lista, cai para
  // 0,1 ms por tecla.
  const indice = useMemo(() => {
    const m = new Map<string, { texto: string; dig: string }>()
    for (const mov of lista.data ?? []) {
      const info = resolve(mov.numero_processo)
      m.set(mov.id, {
        texto: normalizarBusca(
          [mov.numero_processo, mov.conteudo, info.cedente, info.cessionario]
            .filter(Boolean)
            .join(' '),
        ),
        dig: dig(mov.numero_processo),
      })
    }
    return m
  }, [lista.data, resolve])

  // NOVAS: processos com movimentação nos últimos 20 dias, agrupados por
  // processo; andamentos e grupos do mais recente para o mais antigo.
  const novas = useMemo(() => {
    const all = lista.data ?? []
    const filtradas = !q
      ? all
      : all.filter((m) => {
          const idx = indice.get(m.id)
          if (idx?.texto.includes(q)) return true
          return qd.length >= 4 && (idx?.dig ?? '').includes(qd)
        })
    const mapa = new Map<string, MovRow[]>()
    for (const m of filtradas) {
      const chave = m.numero_processo ?? '—'
      const arr = mapa.get(chave)
      if (arr) arr.push(m)
      else mapa.set(chave, [m])
    }
    const grupos = [...mapa.entries()].map(([numero, movs]) => {
      movs.sort((a, b) => movOrdem(b).localeCompare(movOrdem(a)))
      return { numero, movs, recente: movOrdem(movs[0]) }
    })
    grupos.sort((a, b) => b.recente.localeCompare(a.recente))
    return grupos
  }, [lista.data, q, qd, indice])

  // Casamento por DÍGITOS, e não pela string crua, porque as duas tabelas
  // gravam o número a partir de payloads DIFERENTES do ADVBOX:
  // advbox_movimentacoes usa o número DO ANDAMENTO
  // (process_number/protocol_number de cada movimentação) e
  // advbox_processo_status usa o número do LAWSUIT. Formatação e até o próprio
  // número divergem — o caso de apenso está documentado na própria Edge
  // Function. Com a comparação crua, o processo aparecia nas duas listas ao
  // mesmo tempo: em Novas com o andamento de hoje e em Paralisados com o selo
  // "há 0 dias", que é a cara do defeito.
  const numerosNovas = useMemo(
    () => new Set(novas.map((g) => dig(g.numero)).filter((d) => d.length > 0)),
    [novas],
  )

  // PARALISADOS: processos cadastrados/casados SEM movimento nos últimos 20
  // dias. Ordenados do menos parado (última mov. mais recente) ao mais parado;
  // quem nunca movimentou vai por último.
  const paralisados = useMemo(() => {
    let l = (status.data ?? [])
      .filter((s) => !numerosNovas.has(dig(s.numero_processo)))
      // Processos encerrados não entram em Paralisados.
      .filter((s) => resolve(s.numero_processo).status !== 'encerrado')
    if (q) {
      l = l.filter((s) => {
        const info = resolve(s.numero_processo)
        if (
          [s.numero_processo, info.cedente, info.cessionario]
            .filter(Boolean)
            .some((v) => normalizarBusca(String(v)).includes(q))
        )
          return true
        return qd.length >= 4 && dig(s.numero_processo).includes(qd)
      })
    }
    return [...l].sort((a, b) => {
      if (!a.ultima_movimentacao && !b.ultima_movimentacao) return 0
      if (!a.ultima_movimentacao) return 1
      if (!b.ultima_movimentacao) return -1
      return b.ultima_movimentacao.localeCompare(a.ultima_movimentacao)
    })
  }, [status.data, numerosNovas, q, resolve])

  if (lista.isLoading) return <Loading label="Carregando movimentações…" />
  if (lista.isError) return (
      <ErrorState
        message={(lista.error as Error)?.message}
        onRetry={() => void lista.refetch()}
      />
    )

  const totalMovs = novas.reduce((s, g) => s + g.movs.length, 0)
  const vazio = novas.length === 0 && paralisados.length === 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span>
          <strong>{totalMovs}</strong>{' '}
          {totalMovs === 1 ? 'movimentação' : 'movimentações'} nos últimos 20 dias
        </span>
        <SyncStatus
          separador
          syncing={sync.isPending}
          updatedAt={lista.dataUpdatedAt}
          label="atualizando do ADVBOX…"
        />
      </div>

      {total.data != null && (lista.data?.length ?? 0) < total.data && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Mostrando as {lista.data?.length} movimentações mais recentes de{' '}
          {total.data} na janela de 20 dias. Com o corte, um processo pode
          aparecer em Paralisados sem estar.
        </p>
      )}

      {/* status.isError entra na conta: sem isto, falha na consulta de status com
          nenhuma movimentação nova cairia no cartão de "nada aqui", que é
          conclusão, e não o que aconteceu. */}
      {vazio && !status.isError ? (
        <Card>
          <EmptyState
            title="Nenhuma movimentação"
            description={
              sync.isPending ? 'Sincronizando… pode levar ~1 min.' : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Secao titulo="Novas" qtd={novas.length}>
            {novas.length ? (
              novas.map((g) => (
                <ProcessoMovimentacoes
                  key={g.numero}
                  numero={g.numero}
                  movs={g.movs}
                  info={resolve(g.numero)}
                />
              ))
            ) : (
              <p className="text-sm text-slate-600">Nenhuma movimentação nova.</p>
            )}
          </Secao>
          <Secao titulo="Paralisados" qtd={paralisados.length}>
            {paralisados.length ? (
              paralisados.map((s) => (
                <ProcessoParalisado
                  key={s.numero_processo}
                  numero={s.numero_processo}
                  ultima={s.ultima_movimentacao}
                  info={resolve(s.numero_processo)}
                />
              ))
            ) : status.isError ? (
              // "Nenhum processo paralisado" é a melhor notícia desta tela, e era
              // exatamente o que aparecia quando a consulta de status falhava.
              // Dizer que nada está parado sem ter conseguido olhar é o pior
              // jeito de errar aqui.
              <p className="text-sm text-amber-700">
                Não foi possível carregar o tempo sem movimentação dos processos:{' '}
                {(status.error as Error).message}
              </p>
            ) : status.isLoading ? (
              <p className="text-sm text-slate-600">Verificando…</p>
            ) : (
              <p className="text-sm text-slate-600">Nenhum processo paralisado.</p>
            )}
          </Secao>
        </>
      )}
    </div>
  )
}

// Card de um processo. Por padrão mostra só o cabeçalho; clicar nele expande a
// lista de andamentos (mais recente no topo). O chevron à direita indica o
// estado de expansão.
function ProcessoMovimentacoes({
  numero,
  movs,
  info,
}: {
  numero: string
  movs: MovRow[]
  info: ResolveInfo
}) {
  const [aberto, setAberto] = useState(false)
  const st = getLabel(STATUS_PROCESSO, info.status)
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-start justify-between gap-2 p-4 text-left transition-colors hover:bg-slate-50"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800">
            {formatCNJ(numero)}
          </div>
          {info.kind === 'credito' && (info.cedente || info.cessionario) && (
            <div className="text-xs text-slate-600">
              {info.cedente || '—'} v. {info.cessionario || '—'}
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone="gray">
              {movs.length} {movs.length === 1 ? 'andamento' : 'andamentos'}
            </Badge>
            {info.kind === 'credito' && <Badge tone={st.tone}>{st.label}</Badge>}
            {info.kind === 'requerimento' && <Badge tone="purple">Requerimento</Badge>}
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600">
            {aberto ? 'ocultar' : 'ver andamentos'}
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')}
            />
          </span>
        </div>
      </button>

      {aberto && (
        <ol className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
          {movs.map((m) => (
            <li key={m.id} className="flex gap-3">
              <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand-400" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-600">
                  {formatDate(m.data)}
                </div>
                {m.conteudo && (
                  <div className="whitespace-pre-line break-words text-sm text-slate-700">
                    {m.conteudo}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

// Card de um processo paralisado: sem andamentos na janela. Mostra a última
// movimentação conhecida e um badge de tempo (cor escalona de amarelo a
// vermelho conforme o tempo parado).
function ProcessoParalisado({
  numero,
  ultima,
  info,
}: {
  numero: string
  ultima: string | null
  info: ResolveInfo
}) {
  const dias = ultima ? diasDesde(ultima) : null
  const b = badgeParalisado(dias)
  const st = getLabel(STATUS_PROCESSO, info.status)
  return (
    // A gravidade do tempo parado vira borda esquerda colorida (o antigo
    // opacity-60 fazia o card parecer desabilitado).
    <Card className={cn('border-l-4 p-4', b.borda)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800">{formatCNJ(numero)}</div>
          {info.kind === 'credito' && (info.cedente || info.cessionario) && (
            <div className="text-xs text-slate-600">
              {info.cedente || '—'} v. {info.cessionario || '—'}
            </div>
          )}
          <div className="text-xs text-slate-600">
            {ultima
              ? `Última movimentação: ${formatDate(ultima)}`
              : 'Sem movimentação registrada no ADVBOX'}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              b.classes,
            )}
          >
            {b.texto}
          </span>
          {info.kind === 'credito' && <Badge tone={st.tone}>{st.label}</Badge>}
          {info.kind === 'requerimento' && <Badge tone="purple">Requerimento</Badge>}
        </div>
      </div>
    </Card>
  )
}
