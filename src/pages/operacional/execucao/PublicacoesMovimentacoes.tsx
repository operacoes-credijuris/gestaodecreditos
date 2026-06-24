import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Search, ExternalLink, RefreshCw } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { processosCrud, requerimentosCrud, apensosCrud } from '@/lib/queries'
import { cn } from '@/lib/cn'
import { getLabel, STATUS_PROCESSO } from '@/lib/labels'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Field'
import { Loading, ErrorState, EmptyState } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { formatCNJ, formatDate } from '@/lib/format'

interface DjenRow {
  id: number
  data_disponibilizacao: string | null
  numero_processo: string | null
  sigla_tribunal: string | null
  tipo_comunicacao: string | null
  raw: Record<string, unknown>
  sincronizado_em: string
}

// Resolução do processo da publicação contra os cadastros.
interface ResolveInfo {
  kind: 'credito' | 'requerimento' | null
  status?: string | null
  cedente?: string | null
  cessionario?: string | null
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

  return (
    <div>
      <PageHeader
        title="Publicações e Movimentações"
        description="Publicações oficiais do DJEN vinculadas aos processos cadastrados e às OABs configuradas. Atualiza automaticamente."
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por processo, tribunal, órgão, tipo, conteúdo…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select
            className="sm:w-52"
            value={aba}
            onChange={(e) => setAba(e.target.value as typeof aba)}
          >
            <option value="publicacoes">Publicações</option>
            <option value="movimentacoes">Movimentações</option>
          </Select>
        </div>
      </Card>

      {aba === 'publicacoes' ? <Publicacoes busca={busca} /> : <Movimentacoes />}
    </div>
  )
}

// ----------------------- Publicações (DJEN) -----------------------
function Publicacoes({ busca }: { busca: string }) {
  const qc = useQueryClient()
  const toast = useToast()

  // Resolve cada publicação contra os cadastros: Crédito (status + partes),
  // Requerimento, ou Apenso (herda do crédito/requerimento pai).
  const processos = processosCrud.useList()
  const requerimentos = requerimentosCrud.useList()
  const apensos = apensosCrud.useList()
  const resolve = useMemo(() => {
    const dig = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')
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

  // Janela de 30 dias (data de disponibilização >= hoje - 30, horário local).
  const ini30 = useMemo(
    () => new Date(Date.now() - 30 * 86400000).toLocaleDateString('sv-SE'),
    [],
  )

  const lista = useQuery({
    queryKey: ['djen_publicacoes', ini30],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('djen_publicacoes')
        .select('*')
        .gte('data_disponibilizacao', ini30)
        .order('data_disponibilizacao', { ascending: false })
        .order('id', { ascending: false })
        .limit(2000)
      if (error) throw new Error(error.message)
      return (data ?? []) as DjenRow[]
    },
  })

  // Sincroniza com o DJEN em segundo plano ao abrir a página.
  const sync = useMutation({
    mutationFn: () => invokeFunction('djen-publicacoes', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['djen_publicacoes'] }),
    onError: (e) =>
      toast.error(`Sincronização DJEN: ${(e as Error).message}`),
  })
  const jaSincronizou = useRef(false)
  useEffect(() => {
    if (jaSincronizou.current) return
    jaSincronizou.current = true
    sync.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtradas = useMemo(() => {
    const all = lista.data ?? []
    if (!busca.trim()) return all
    const q = busca.toLowerCase()
    return all.filter((p) => {
      const r = p.raw ?? {}
      return [
        p.numero_processo,
        p.sigla_tribunal,
        p.tipo_comunicacao,
        r.nomeOrgao,
        r.nomeClasse,
        r.texto,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [lista.data, busca])

  if (lista.isLoading) return <Loading label="Carregando publicações…" />
  if (lista.isError)
    return <ErrorState message={(lista.error as Error)?.message} />

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-[13px] text-slate-500">
        <span>
          <strong>{filtradas.length}</strong> publicação(ões)
        </span>
        {sync.isPending && (
          <span className="inline-flex items-center gap-1.5 text-brand-600">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> atualizando do DJEN…
          </span>
        )}
      </div>

      {filtradas.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhuma publicação"
            description={
              sync.isPending
                ? 'Sincronizando com o DJEN pela primeira vez… isso pode levar até ~1 min.'
                : 'Não há publicações no DJEN para os processos/OABs configurados.'
            }
          />
        </Card>
      ) : (
        filtradas.map((p) => (
          <PublicacaoCard key={p.id} p={p} info={resolve(p.numero_processo)} />
        ))
      )}
    </div>
  )
}

function PublicacaoCard({ p, info }: { p: DjenRow; info: ResolveInfo }) {
  const raw = p.raw ?? {}
  const [showRaw, setShowRaw] = useState(false)
  const texto = useMemo(() => textoLimpo(raw.texto), [raw.texto])
  const st = getLabel(STATUS_PROCESSO, info.status)

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        {p.sigla_tribunal && <Badge tone="blue">{p.sigla_tribunal}</Badge>}
        {info.kind === 'credito' && <Badge tone={st.tone}>{st.label}</Badge>}
        {info.kind === 'requerimento' && <Badge tone="purple">Requerimentos</Badge>}
      </div>

      <div className="mt-1 text-[13px] font-medium text-slate-800">
        {formatCNJ(p.numero_processo ?? '')}
      </div>
      {info.kind === 'credito' && (info.cedente || info.cessionario) && (
        <div className="text-[11px] text-slate-400">
          {info.cedente || '—'} v. {info.cessionario || '—'}
        </div>
      )}
      <div className="text-[11px] text-slate-500">
        Data de disponibilização: {formatDate(p.data_disponibilizacao)}
      </div>

      {texto && <TextoExpand text={texto} />}

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px]">
        {typeof raw.link === 'string' && raw.link && (
          <a
            href={raw.link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Abrir no DJEN
          </a>
        )}
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-slate-500 hover:underline"
        >
          {showRaw ? 'ocultar campos' : 'todos os campos'}
        </button>
      </div>

      {showRaw && (
        <div className="mt-2 space-y-0.5 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600">
          {Object.entries(raw)
            .filter(([k]) => k !== 'texto')
            .map(([k, v]) => (
              <div key={k} className="break-words">
                <span className="text-slate-400">{k}:</span>{' '}
                {v && typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </div>
            ))}
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
    <div className="mt-2 text-[13px] text-slate-700">
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
          className="mt-0.5 text-[11px] font-medium text-brand-600 hover:underline"
        >
          {expanded ? 'ler menos' : 'ler mais'}
        </button>
      )}
    </div>
  )
}

// ----------------------- Movimentações (fonte a definir) -----------------------
function Movimentacoes() {
  return (
    <Card>
      <EmptyState
        title="Movimentações"
        description="A fonte das movimentações será definida em seguida."
      />
    </Card>
  )
}
