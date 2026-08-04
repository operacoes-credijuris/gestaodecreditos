import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Plus, Search, Flame, Star, FileText, Users } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invokeFunction } from '@/lib/functions'
import { processosCrud, requerimentosCrud, apensosCrud } from '@/lib/queries'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { Modal } from '@/components/ui/Modal'
import { Combobox, MultiCombobox, type OpcaoCombo } from '@/components/ui/Combobox'
import { useAuth } from '@/contexts/AuthContext'
import { Loading, ErrorState, EmptyState } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { formatCNJ, formatNome, onlyDigits as dig, sentenceCase } from '@/lib/format'

// ---------- Tipos vindos da Edge Function advbox-tarefas ----------
interface TarefaAdvbox {
  id: number
  tipo: string | null
  processo: string
  start_date: string | null
  date_deadline: string | null
  notes: string | null
  responsaveis: string[]
  important: boolean
  urgent: boolean
  created_at: string | null
}
/**
 * Resposta da action 'list'. Quem não é admin recebe só as próprias tarefas
 * (o corte é no servidor); `sem_correspondencia` avisa que o nome do perfil
 * não bate com nenhum usuário do ADVBOX — sem isso a lista viria vazia e a
 * pessoa concluiria que está sem tarefas.
 */
interface RespostaTarefas {
  tarefas: TarefaAdvbox[]
  total?: number
  restrito?: boolean
  sem_correspondencia?: boolean
  perfil_nome?: string | null
}

interface Opcoes {
  users: { id: number; name: string }[]
  tasks: { id: number; name: string }[]
  lawsuits: { id: number; numero: string }[]
}

interface FormState {
  /** Id do lawsuit no ADVBOX, escolhido na lista. */
  lawsuit_id: number | null
  tasks_id: string
  start_date: string
  date_deadline: string
  from: string
  guests: number[]
  important: boolean
  urgent: boolean
  comments: string
}
const FORM_VAZIO: FormState = {
  lawsuit_id: null,
  tasks_id: '',
  start_date: '',
  date_deadline: '',
  from: '',
  guests: [],
  important: false,
  urgent: false,
  comments: '',
}

// Observação com no máximo 3 linhas; mostra "ler mais" quando excede.
function Observacao({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [text])
  return (
    <div className="mt-0.5 text-sm font-normal text-slate-500">
      <div
        ref={ref}
        className={cn('whitespace-normal break-words', !expanded && 'line-clamp-3')}
      >
        {text}
      </div>
      {(clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 font-medium text-brand-600 hover:underline"
        >
          {expanded ? 'ler menos' : 'ler mais'}
        </button>
      )}
    </div>
  )
}

// ---------- Helpers de urgência / data / avatares ----------
const MESES = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
]

// Diferença em dias inteiros entre duas datas ISO (YYYY-MM-DD), horário local.
function diffDias(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime()
  const b = new Date(`${toISO}T00:00:00`).getTime()
  return Math.round((b - a) / 86400000)
}

type Urgencia = 'danger' | 'warning' | 'neutral'

// Classifica o prazo fatal: vence hoje/amanhã (vermelho), nesta semana
// (âmbar) ou depois/sem prazo (neutro). Também devolve o rótulo relativo.
function prazoInfo(
  deadline: string | null | undefined,
  hoje: string,
): { tone: Urgencia; rel: string } | null {
  if (!deadline) return null
  const n = diffDias(hoje, deadline.slice(0, 10))
  if (n <= 1) return { tone: 'danger', rel: n <= 0 ? 'hoje' : 'amanhã' }
  if (n <= 7) return { tone: 'warning', rel: `em ${n} dias` }
  return { tone: 'neutral', rel: '' }
}

// Dia + mês abreviado para o bloco de calendário.
function diaMes(iso?: string | null): { dia: string; mes: string } | null {
  if (!iso) return null
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return null
  return { dia: String(dt.getDate()).padStart(2, '0'), mes: MESES[dt.getMonth()] }
}

const TONE_BAR: Record<Urgencia, string> = {
  danger: 'bg-red-500',
  warning: 'bg-amber-500',
  neutral: 'bg-slate-200',
}
const TONE_BLOCK: Record<Urgencia, string> = {
  danger: 'bg-red-50 text-red-700',
  warning: 'bg-amber-50 text-amber-700',
  neutral: 'bg-slate-100 text-slate-500',
}
const TONE_TEXT: Record<Urgencia, string> = {
  danger: 'text-red-600',
  warning: 'text-amber-600',
  neutral: 'text-slate-400',
}

export default function TarefasAdvbox() {
  const qc = useQueryClient()
  const toast = useToast()

  // Lista ao vivo do ADVBOX — recarrega ao abrir a página e ao focar a aba.
  const { data, isLoading, isError, error, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['advbox-tarefas'],
    queryFn: () =>
      invokeFunction<RespostaTarefas>('advbox-tarefas', { action: 'list' }),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
  // Data de hoje (YYYY-MM-DD, horário local) para classificar os prazos.
  // Precisa acompanhar a virada do dia: a lista recarrega ao focar a janela,
  // e uma data fixa deixaria os dados frescos sendo medidos por uma régua
  // velha — tarefa que vence hoje seguiria marcada "amanhã", e vencida
  // seguiria na lista. Só um F5 corrigia.
  const [hoje, setHoje] = useState(() => new Date().toLocaleDateString('sv-SE'))
  useEffect(() => {
    const sincronizar = () => setHoje(new Date().toLocaleDateString('sv-SE'))
    document.addEventListener('visibilitychange', sincronizar)
    window.addEventListener('focus', sincronizar)
    // Os eventos acima só disparam se alguém interagir; o intervalo cobre o
    // caso real do painel deixado aberto e visível a noite toda. Rechamar com
    // a mesma string é no-op no React, então nos outros 1439 minutos do dia
    // isto não provoca re-render.
    const timer = setInterval(sincronizar, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', sincronizar)
      window.removeEventListener('focus', sincronizar)
      clearInterval(timer)
    }
  }, [])
  // Tarefas com prazo vencido NÃO são mais escondidas: em Fatais elas ficam
  // no grupo "Vencidas", abaixo das pendentes (mesmo padrão de Publicações,
  // com Novas e Tratadas). Sumir com prazo estourado escondia o problema.
  const tarefas = useMemo(() => data?.tarefas ?? [], [data])

  // Cedente/cessionário dos Créditos (exibidos sob o nº do processo). Tarefas de
  // apensos vinculados a um crédito herdam o cedente/cessionário do crédito pai.
  const processos = processosCrud.useList()
  const apensos = apensosCrud.useList()
  const resolveCredito = useMemo(() => {
    type Info = { cedente: string | null; cessionario: string | null }
    const porNumero = new Map<string, Info>()
    const porId = new Map<string, Info>()
    for (const p of processos.data ?? []) {
      const info: Info = { cedente: p.cedente, cessionario: p.cessionario }
      porId.set(p.id, info)
      const d = dig(p.numero_cnj)
      if (d.length >= 6) porNumero.set(d, info)
    }
    // numero do apenso -> id do crédito pai
    const apensoParent = new Map<string, string>()
    for (const a of apensos.data ?? []) {
      const d = dig(a.numero)
      if (d.length >= 6 && a.processo_id) apensoParent.set(d, a.processo_id)
    }
    return (processoNum: string): Info | null => {
      const d = dig(processoNum)
      const direto = porNumero.get(d)
      if (direto) return direto
      const parentId = apensoParent.get(d)
      return parentId ? porId.get(parentId) ?? null : null
    }
  }, [processos.data, apensos.data])

  const [busca, setBusca] = useState('')
  // Padrão ao abrir: tarefas fatais (com prazo). Só duas visões — "Todas"
  // saiu: era a soma de duas listas que não se comparam entre si.
  const [filtroPrazo, setFiltroPrazo] = useState<'fatais' | 'sem_prazo'>('fatais')
  const [novo, setNovo] = useState(false)

  // Busca textual (sem o filtro de prazo) — base para lista e contagens.
  const baseBusca = useMemo(() => {
    if (!busca.trim()) return tarefas
    const q = busca.toLowerCase()
    return tarefas.filter((t) =>
      [t.tipo, t.processo, t.notes, ...(t.responsaveis ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [tarefas, busca])

  // Fatais viram dois grupos (Pendentes / Vencidas); Sem prazo segue lista
  // única — sem termo final não há o que vencer.
  const { pendentes, vencidas, semPrazo } = useMemo(() => {
    const prazo = (t: TarefaAdvbox) => (t.date_deadline || '').slice(0, 10)
    const dataRef = (t: TarefaAdvbox) => t.start_date || t.created_at || ''
    const comPrazo = baseBusca.filter((t) => !!t.date_deadline)
    return {
      // Pendentes: prazo mais próximo primeiro — é o que aperta.
      pendentes: comPrazo
        .filter((t) => prazo(t) >= hoje)
        .sort((a, b) => prazo(a).localeCompare(prazo(b))),
      // Vencidas: a que estourou há menos tempo no topo; quanto mais fundo na
      // lista, mais velho o atraso.
      vencidas: comPrazo
        .filter((t) => prazo(t) < hoje)
        .sort((a, b) => prazo(b).localeCompare(prazo(a))),
      // Sem prazo: data mais nova primeiro.
      semPrazo: baseBusca
        .filter((t) => !t.date_deadline)
        .sort((a, b) => dataRef(b).localeCompare(dataRef(a))),
    }
  }, [baseBusca, hoje])

  const contagemPrazo = useMemo(
    () => ({
      fatais: pendentes.length + vencidas.length,
      sem_prazo: semPrazo.length,
    }),
    [pendentes, vencidas, semPrazo],
  )

  const vazio =
    filtroPrazo === 'fatais'
      ? pendentes.length === 0 && vencidas.length === 0
      : semPrazo.length === 0

  // Cartão de uma tarefa. Função (e não JSX inline) porque os grupos
  // Pendentes e Vencidas renderizam o mesmo cartão.
  const card = (t: TarefaAdvbox) => {
    const cred = resolveCredito(t.processo ?? '')
    const partes =
      cred && (cred.cedente || cred.cessionario)
        ? `${cred.cedente || '—'} v. ${cred.cessionario || '—'}`
        : ''
    const prazo = prazoInfo(t.date_deadline, hoje)
    const tone: Urgencia = prazo?.tone ?? 'neutral'
    const bloco = diaMes(t.date_deadline || t.start_date)
    const resp = t.responsaveis ?? []
    return (
      <div
        key={t.id}
        className="flex overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <div className={cn('w-1 flex-none', TONE_BAR[tone])} />
        <div className="flex min-w-0 flex-1 items-start gap-3 p-3">
          <div
            className={cn('w-12 flex-none rounded-md py-1.5 text-center', TONE_BLOCK[tone])}
          >
            {bloco ? (
              <>
                <div className="text-lg font-bold leading-none">{bloco.dia}</div>
                <div className="text-xs leading-tight">{bloco.mes}</div>
              </>
            ) : (
              <div className="py-1 text-sm">—</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {t.urgent && (
                <span title="Urgente">
                  <Flame className="h-3.5 w-3.5 text-red-500" />
                </span>
              )}
              {t.important && (
                <span title="Importante">
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                </span>
              )}
              <span className="text-sm font-medium text-slate-800">
                {t.tipo ? sentenceCase(t.tipo) : '—'}
              </span>
              {prazo?.rel && (
                <span className={cn('text-xs font-medium', TONE_TEXT[tone])}>
                  · {prazo.rel}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-sm text-slate-500">
              {formatCNJ(t.processo)}
              {partes && ` · ${partes}`}
            </div>
            {t.notes && <Observacao text={t.notes} />}
          </div>
          {/* Responsáveis à esquerda do botão de petição. flex-none: só
              ocupa o que precisa, e a coluna de conteúdo (flex-1) cede o
              espaço — que sobra. O max-w é só teto para lista longa. */}
          {resp.length > 0 && (
            <div className="flex max-w-[20rem] flex-none items-start gap-1.5 text-sm text-slate-600">
              <Users className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" />
              {/* Cada nome é uma unidade que não quebra: com vários
                  responsáveis a quebra cai ENTRE nomes, nunca no meio de um. */}
              <span className="flex flex-wrap gap-x-1.5">
                {resp.map((r, i) => (
                  <span key={i} className="whitespace-nowrap">
                    {formatNome(r)}
                    {i < resp.length - 1 && ','}
                  </span>
                ))}
              </span>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            title="Gerar petição"
            icon={<FileText className="h-4 w-4" />}
            onClick={() =>
              toast.toast('Geração de petição será configurada em breve.', 'info')
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Tarefas"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNovo(true)}>
            Nova tarefa
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Segmented
            ariaLabel="Filtrar tarefas por prazo"
            items={[
              { key: 'fatais', label: 'Fatais', count: contagemPrazo.fatais },
              { key: 'sem_prazo', label: 'Sem prazo', count: contagemPrazo.sem_prazo },
            ]}
            value={filtroPrazo}
            onChange={(k) => setFiltroPrazo(k as typeof filtroPrazo)}
          />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por tipo, processo, responsável…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {/* A lista recarrega em silêncio ao focar a janela; o indicador avisa. */}
      <div className="mb-2">
        <SyncStatus
          syncing={isFetching}
          updatedAt={dataUpdatedAt}
          label="atualizando do ADVBOX…"
        />
      </div>

      {isLoading ? (
        <Card>
          <Loading label="Buscando tarefas no ADVBOX…" />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState message={(error as Error)?.message} />
        </Card>
      ) : data?.sem_correspondencia ? (
        // Lista vazia por falta de vínculo, não por ausência de trabalho — dizer
        // isso evita que a pessoa conclua que não tem tarefas.
        <Card className="p-4">
          <p className="text-sm font-medium text-slate-800">
            Perfil não encontrado no ADVBOX
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {data.perfil_nome
              ? `O nome do seu perfil ("${data.perfil_nome}") não corresponde a nenhum usuário do ADVBOX`
              : 'Seu perfil está sem nome cadastrado'}
            , então não há como identificar quais tarefas são suas. Peça a um
            administrador para acertar o nome em Configurações → Usuários,
            exatamente como aparece no ADVBOX.
          </p>
        </Card>
      ) : vazio ? (
        <Card>
          <EmptyState title="Nenhuma tarefa" />
        </Card>
      ) : filtroPrazo === 'sem_prazo' ? (
        <div className="space-y-2">{semPrazo.map(card)}</div>
      ) : (
        <div className="space-y-5">
          <Secao titulo="Pendentes" qtd={pendentes.length}>
            {pendentes.length ? (
              <div className="space-y-2">{pendentes.map(card)}</div>
            ) : (
              <p className="text-sm text-slate-500">Nenhuma tarefa pendente.</p>
            )}
          </Secao>
          <Secao titulo="Vencidas" qtd={vencidas.length}>
            {vencidas.length ? (
              <div className="space-y-2">{vencidas.map(card)}</div>
            ) : (
              <p className="text-sm text-slate-500">Nenhuma tarefa vencida.</p>
            )}
          </Secao>
        </div>
      )}

      <NovaTarefaModal
        open={novo}
        onClose={() => setNovo(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['advbox-tarefas'] })
          setNovo(false)
          toast.success('Tarefa criada no ADVBOX.')
        }}
      />
    </div>
  )
}

/** Cabeçalho de seção: "Título (n) ————————" (mesmo padrão de Publicações). */
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
        <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {titulo}
        </span>
        <span className="text-xs text-slate-500">({qtd})</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      {children}
    </div>
  )
}

// Opção do combobox: número do processo + descrição já resolvida
// (Cedente v. Cessionário, Requerimento administrativo, etc.).
interface LawOpt {
  id: number
  numero: string
  descricao: string
}


// ----------------------- Modal de criação -----------------------
export function NovaTarefaModal({
  open,
  onClose,
  onCreated,
  processoNumero,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  processoNumero?: string | null
}) {
  const toast = useToast()
  const { profile, isAdmin } = useAuth()
  const [form, setForm] = useState<FormState>({ ...FORM_VAZIO })

  const opcoes = useQuery({
    queryKey: ['advbox-tarefas-options'],
    queryFn: () =>
      invokeFunction<Opcoes>('advbox-tarefas', { action: 'options' }),
    enabled: open,
    // Carrega uma vez e mantém no cache pela sessão inteira: o modal só
    // mostra "Carregando…" na primeira abertura. Depois reusa o cache;
    // após 30 min, atualiza em 2º plano (sem tela de carregamento).
    staleTime: 30 * 60 * 1000,
    gcTime: Infinity,
  })

  // Resolve cada processo do ADVBOX contra os cadastros para exibir
  // "Cedente v. Cessionário" (Créditos) ou "Requerimento administrativo"
  // (Requerimentos), em vez do cliente "CREDIJURIS" devolvido pela API.
  const processos = processosCrud.useList()
  const requerimentos = requerimentosCrud.useList()
  const apensos = apensosCrud.useList()
  const lawOptions = useMemo<LawOpt[]>(() => {
    const credPorNum = new Map<string, string>()
    const credPorId = new Map<string, string>()
    for (const p of processos.data ?? []) {
      const desc = `${p.cedente || '—'} v. ${p.cessionario || '—'}`
      credPorId.set(p.id, desc)
      const d = dig(p.numero_cnj)
      if (d.length >= 15) credPorNum.set(d, desc)
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
        apPorNum.set(d, {
          processo_id: a.processo_id,
          requerimento_id: a.requerimento_id,
        })
    }
    const descricao = (numero: string): string => {
      const d = dig(numero)
      const cred = credPorNum.get(d)
      if (cred) return cred
      if (reqNums.has(d)) return 'Requerimento administrativo'
      const ap = apPorNum.get(d)
      if (ap) {
        if (ap.processo_id && credPorId.has(ap.processo_id))
          return credPorId.get(ap.processo_id)!
        if (ap.requerimento_id) return 'Requerimento administrativo'
      }
      return ''
    }
    return (opcoes.data?.lawsuits ?? []).map((l) => ({
      id: l.id,
      numero: l.numero,
      descricao: descricao(l.numero),
    }))
  }, [opcoes.data, processos.data, requerimentos.data, apensos.data])

  // Ao fechar, limpa o formulário. Ao abrir a partir de uma publicação,
  // pré-seleciona o processo casando pelo número.
  useEffect(() => {
    if (!open) {
      setForm({ ...FORM_VAZIO })
      return
    }
    if (!processoNumero) return
    const d = dig(processoNumero)
    const found = lawOptions.find((o) => dig(o.numero) === d)
    if (found) setForm((f) => (f.lawsuit_id ? f : { ...f, lawsuit_id: found.id }))
  }, [open, lawOptions, processoNumero])

  const criar = useMutation({
    mutationFn: (lawsuitId: number) =>
      invokeFunction('advbox-tarefas', {
        action: 'create',
        lawsuits_id: lawsuitId,
        tasks_id: Number(form.tasks_id),
        start_date: form.start_date,
        date_deadline: form.date_deadline || null,
        from: Number(form.from),
        guests: form.guests,
        important: form.important,
        urgent: form.urgent,
        comments: form.comments || null,
      }),
    onSuccess: () => {
      setForm({ ...FORM_VAZIO })
      onCreated()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.lawsuit_id) return toast.error('Selecione um processo da lista.')
    if (!form.tasks_id) return toast.error('Selecione o tipo de tarefa.')
    if (!form.start_date) return toast.error('Informe a data.')
    if (!form.from) return toast.error('Selecione o remetente.')
    if (form.guests.length === 0) return toast.error('Selecione ao menos um responsável.')
    criar.mutate(form.lawsuit_id)
  }

  const users = opcoes.data?.users ?? []
  const tasks = opcoes.data?.tasks ?? []

  // ---------- Remetente ----------
  // Quem cria a tarefa é quem a envia, então o remetente não deveria ser uma
  // escolha. O vínculo com o ADVBOX é feito pelo NOME do perfil, porque não há
  // campo de id do ADVBOX em profiles — comparação sem acento e sem
  // maiúsculas para tolerar divergência de digitação.
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase()
  const meuUsuarioAdvbox = useMemo(() => {
    const nome = profile?.nome?.trim()
    if (!nome) return null
    return users.find((u) => norm(u.name) === norm(nome)) ?? null
  }, [users, profile?.nome])

  // Só o admin escolhe o remetente (cria tarefa em nome de outros). Para os
  // demais o remetente é sempre a própria pessoa, preenchido sozinho e sem
  // campo na tela.
  const escolheRemetente = isAdmin

  // Não-admin sem correspondência no ADVBOX fica impedido de criar: deixá-lo
  // escolher o remetente seria justamente permitir mandar tarefa em nome de
  // outra pessoa, que é o que esta regra existe para impedir.
  const semRemetente = !isAdmin && !meuUsuarioAdvbox

  useEffect(() => {
    if (!open || escolheRemetente || !meuUsuarioAdvbox) return
    setForm((f) => (f.from ? f : { ...f, from: String(meuUsuarioAdvbox.id) }))
  }, [open, escolheRemetente, meuUsuarioAdvbox])

  const opcoesProcesso = useMemo<OpcaoCombo[]>(
    () =>
      lawOptions.map((l) => ({
        id: l.id,
        titulo: formatCNJ(l.numero),
        subtitulo: l.descricao || null,
      })),
    [lawOptions],
  )
  const opcoesTarefa = useMemo<OpcaoCombo[]>(
    () => tasks.map((t) => ({ id: t.id, titulo: t.name })),
    [tasks],
  )
  const opcoesUsuario = useMemo<OpcaoCombo[]>(
    () => users.map((u) => ({ id: u.id, titulo: u.name })),
    [users],
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova tarefa"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="form-nova-tarefa"
            loading={criar.isPending}
            disabled={semRemetente}
          >
            Criar tarefa
          </Button>
        </>
      }
    >
      {opcoes.isLoading ? (
        <Loading label="Carregando opções do ADVBOX…" />
      ) : opcoes.isError ? (
        <ErrorState message={(opcoes.error as Error)?.message} />
      ) : semRemetente ? (
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-800">
            Perfil não encontrado no ADVBOX
          </p>
          <p className="text-sm text-slate-600">
            {profile?.nome
              ? `O nome do seu perfil ("${profile.nome}") não corresponde a nenhum usuário do ADVBOX`
              : 'Seu perfil está sem nome cadastrado'}
            , e a tarefa precisa sair em seu nome. Peça a um administrador para
            acertar o nome em Configurações → Usuários, exatamente como aparece
            no ADVBOX.
          </p>
        </div>
      ) : (
        <form id="form-nova-tarefa" onSubmit={handleSubmit} className="space-y-4">
          <Field label="Processo" required>
            <Combobox
              opcoes={opcoesProcesso}
              valor={form.lawsuit_id}
              onChange={(id) => setForm((f) => ({ ...f, lawsuit_id: id }))}
              placeholder="Digite o número do processo…"
              vazio="Nenhum processo encontrado."
            />
          </Field>

          <Field label="Tipo de tarefa" required>
            <Combobox
              opcoes={opcoesTarefa}
              valor={form.tasks_id ? Number(form.tasks_id) : null}
              onChange={(id) => setForm((f) => ({ ...f, tasks_id: id ? String(id) : '' }))}
              placeholder="Digite parte do nome…"
              vazio="Nenhum tipo encontrado."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data" required>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </Field>
            <Field label="Prazo">
              <Input
                type="date"
                value={form.date_deadline}
                onChange={(e) => setForm({ ...form, date_deadline: e.target.value })}
              />
            </Field>
          </div>

          {/* Remetente só aparece para quem pode escolher: o admin, que cria em
              nome de outros, e quem não foi encontrado no ADVBOX pelo nome do
              perfil. Para o resto é sempre a própria pessoa, e um campo com uma
              resposta só é campo a menos para preencher. */}
          {escolheRemetente && (
            <Field label="Remetente" required>
              <Combobox
                opcoes={opcoesUsuario}
                valor={form.from ? Number(form.from) : null}
                onChange={(id) => setForm((f) => ({ ...f, from: id ? String(id) : '' }))}
                placeholder="Digite o nome…"
                vazio="Nenhum usuário encontrado."
              />
            </Field>
          )}

          <Field label="Responsáveis" required>
            <MultiCombobox
              opcoes={opcoesUsuario}
              valores={form.guests}
              onChange={(ids) => setForm((f) => ({ ...f, guests: ids }))}
              placeholder="Digite o nome e escolha…"
              vazio="Nenhum usuário encontrado."
            />
          </Field>

          <div className="flex gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="accent-brand-600"
                checked={form.important}
                onChange={(e) => setForm({ ...form, important: e.target.checked })}
              />
              <Star className="h-4 w-4 text-amber-500" /> Importante
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="accent-brand-600"
                checked={form.urgent}
                onChange={(e) => setForm({ ...form, urgent: e.target.checked })}
              />
              <Flame className="h-4 w-4 text-red-500" /> Urgente
            </label>
          </div>

          <Field label="Descrição">
            <Textarea
              rows={3}
              value={form.comments}
              onChange={(e) => setForm({ ...form, comments: e.target.value })}
            />
          </Field>
        </form>
      )}
    </Modal>
  )
}
