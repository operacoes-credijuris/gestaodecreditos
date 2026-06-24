import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Plus, Search, Flame, Star, FileText } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invokeFunction } from '@/lib/functions'
import { processosCrud, apensosCrud } from '@/lib/queries'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  Loading,
  ErrorState,
  EmptyState,
} from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { formatCNJ, formatDate, formatNome, sentenceCase } from '@/lib/format'

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
  concluida: boolean
  created_at: string | null
}
interface Opcoes {
  users: { id: number; name: string }[]
  tasks: { id: number; name: string }[]
  lawsuits: { id: number; numero: string; folder: string | null; cliente: string | null }[]
}

interface FormState {
  lawsuits_id: string
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
  lawsuits_id: '',
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
    <div className="mt-0.5 text-xs font-normal text-slate-400">
      <div
        ref={ref}
        className={cn('whitespace-pre-wrap break-words', !expanded && 'line-clamp-3')}
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

export default function TarefasAdvbox() {
  const qc = useQueryClient()
  const toast = useToast()

  // Lista ao vivo do ADVBOX — recarrega ao abrir a página e ao focar a aba.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['advbox-tarefas'],
    queryFn: () =>
      invokeFunction<{ tarefas: TarefaAdvbox[] }>('advbox-tarefas', { action: 'list' }),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
  // Data de hoje (YYYY-MM-DD, horário local) para descartar prazos vencidos.
  const hoje = useMemo(() => new Date().toLocaleDateString('sv-SE'), [])
  // Oculta tarefas com prazo fatal anterior a hoje (vencidas). Sem prazo: mantém.
  const tarefas = useMemo(
    () =>
      (data?.tarefas ?? []).filter(
        (t) => !t.date_deadline || t.date_deadline.slice(0, 10) >= hoje,
      ),
    [data, hoje],
  )

  // Cedente/cessionário dos Créditos (exibidos sob o nº do processo). Tarefas de
  // apensos vinculados a um crédito herdam o cedente/cessionário do crédito pai.
  const processos = processosCrud.useList()
  const apensos = apensosCrud.useList()
  const resolveCredito = useMemo(() => {
    type Info = { cedente: string | null; cessionario: string | null }
    const dig = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')
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
  // Padrão ao abrir: tarefas fatais (com prazo).
  const [filtroPrazo, setFiltroPrazo] = useState<'todos' | 'fatais' | 'sem_prazo'>(
    'fatais',
  )
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

  const contagemPrazo = useMemo(
    () => ({
      todos: baseBusca.length,
      fatais: baseBusca.filter((t) => !!t.date_deadline).length,
      sem_prazo: baseBusca.filter((t) => !t.date_deadline).length,
    }),
    [baseBusca],
  )

  const lista = useMemo(() => {
    const dataRef = (t: TarefaAdvbox) => t.start_date || t.created_at || ''
    // Com prazo: prazo fatal mais próximo primeiro (crescente).
    const comPrazo = baseBusca
      .filter((t) => !!t.date_deadline)
      .sort((a, b) => (a.date_deadline || '').localeCompare(b.date_deadline || ''))
    // Sem prazo: data mais nova primeiro (decrescente).
    const semPrazo = baseBusca
      .filter((t) => !t.date_deadline)
      .sort((a, b) => dataRef(b).localeCompare(dataRef(a)))
    if (filtroPrazo === 'fatais') return comPrazo
    if (filtroPrazo === 'sem_prazo') return semPrazo
    // Todos: primeiro as com prazo, depois as sem prazo (cada uma com seu critério).
    return [...comPrazo, ...semPrazo]
  }, [baseBusca, filtroPrazo])

  return (
    <div>
      <PageHeader
        title="Tarefas"
        description="Tarefas do ADVBOX vinculadas aos processos cadastrados (Créditos, Requerimentos e Apensos). Atualiza automaticamente."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNovo(true)}>
            Nova tarefa
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por tipo, processo, responsável…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select
            className="sm:w-52"
            value={filtroPrazo}
            onChange={(e) => setFiltroPrazo(e.target.value as typeof filtroPrazo)}
          >
            <option value="todos">Todos ({contagemPrazo.todos})</option>
            <option value="fatais">Fatais ({contagemPrazo.fatais})</option>
            <option value="sem_prazo">Sem prazo ({contagemPrazo.sem_prazo})</option>
          </Select>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Loading label="Buscando tarefas no ADVBOX…" />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhuma tarefa"
            description="Não há tarefas no ADVBOX para os processos cadastrados."
          />
        ) : (
          <Table className="[&_th]:px-2.5 [&_td]:px-2.5 [&_td]:text-[13px]">
            <THead>
              <tr>
                <TH className="whitespace-nowrap">Processo</TH>
                <TH className="w-full">Tarefa</TH>
                <TH className="whitespace-nowrap">Gerar petição</TH>
                <TH className="whitespace-nowrap">Responsáveis</TH>
                <TH className="whitespace-nowrap">Data</TH>
                <TH className="whitespace-nowrap">Prazo</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((t) => {
                const cred = resolveCredito(t.processo ?? '')
                return (
                  <TR key={t.id}>
                    <TD className="whitespace-nowrap font-medium text-slate-800">
                      {formatCNJ(t.processo)}
                      {cred && (cred.cedente || cred.cessionario) && (
                        <div className="text-xs font-normal text-slate-400">
                          {cred.cedente || '—'} v. {cred.cessionario || '—'}
                        </div>
                      )}
                    </TD>
                    <TD className="font-medium text-slate-800">
                      <div className="flex items-center gap-1.5">
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
                        <span className="font-bold">
                          {t.tipo ? sentenceCase(t.tipo) : '—'}
                        </span>
                      </div>
                      {t.notes && <Observacao text={t.notes} />}
                    </TD>
                    <TD className="whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<FileText className="h-4 w-4" />}
                        onClick={() =>
                          toast.toast(
                            'Geração de petição será configurada em breve.',
                            'info',
                          )
                        }
                      >
                        Gerar petição
                      </Button>
                    </TD>
                    <TD>
                      {t.responsaveis?.length ? (
                        <div className="space-y-0.5">
                          {t.responsaveis.map((r, i) => (
                            <div key={i} className="whitespace-nowrap">
                              {formatNome(r)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(t.start_date)}</TD>
                    <TD className="whitespace-nowrap">{formatDate(t.date_deadline)}</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

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

// ----------------------- Modal de criação -----------------------
function NovaTarefaModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [form, setForm] = useState<FormState>({ ...FORM_VAZIO })

  const opcoes = useQuery({
    queryKey: ['advbox-tarefas-options'],
    queryFn: () =>
      invokeFunction<Opcoes>('advbox-tarefas', { action: 'options' }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const criar = useMutation({
    mutationFn: () =>
      invokeFunction('advbox-tarefas', {
        action: 'create',
        lawsuits_id: Number(form.lawsuits_id),
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
    if (!form.lawsuits_id) return toast.error('Selecione o processo.')
    if (!form.tasks_id) return toast.error('Selecione o tipo de tarefa.')
    if (!form.start_date) return toast.error('Informe a data.')
    if (!form.from) return toast.error('Selecione o remetente.')
    if (form.guests.length === 0) return toast.error('Selecione ao menos um responsável.')
    criar.mutate()
  }

  function toggleGuest(id: number) {
    setForm((f) => ({
      ...f,
      guests: f.guests.includes(id)
        ? f.guests.filter((g) => g !== id)
        : [...f.guests, id],
    }))
  }

  const users = opcoes.data?.users ?? []
  const tasks = opcoes.data?.tasks ?? []
  const lawsuits = opcoes.data?.lawsuits ?? []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova tarefa"
      description="Cria a tarefa diretamente no ADVBOX."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="form-nova-tarefa" loading={criar.isPending}>
            Criar tarefa
          </Button>
        </>
      }
    >
      {opcoes.isLoading ? (
        <Loading label="Carregando opções do ADVBOX…" />
      ) : opcoes.isError ? (
        <ErrorState message={(opcoes.error as Error)?.message} />
      ) : (
        <form id="form-nova-tarefa" onSubmit={handleSubmit} className="space-y-4">
          <Field label="Processo" required hint="Apenas processos cadastrados (Créditos/Requerimentos/Apensos).">
            <Select
              value={form.lawsuits_id}
              onChange={(e) => setForm({ ...form, lawsuits_id: e.target.value })}
            >
              <option value="">Selecione…</option>
              {lawsuits.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.numero}
                  {l.cliente ? ` — ${l.cliente}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Tipo de tarefa" required>
            <Select
              value={form.tasks_id}
              onChange={(e) => setForm({ ...form, tasks_id: e.target.value })}
            >
              <option value="">Selecione…</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
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

          <Field label="Remetente (de)" required>
            <Select
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            >
              <option value="">Selecione…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Responsáveis" required hint="Marque um ou mais.">
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 scrollbar-thin">
              {users.map((u) => (
                <label
                  key={u.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={form.guests.includes(u.id)}
                    onChange={() => toggleGuest(u.id)}
                  />
                  {u.name}
                </label>
              ))}
            </div>
          </Field>

          <div className="flex gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.important}
                onChange={(e) => setForm({ ...form, important: e.target.checked })}
              />
              <Star className="h-4 w-4 text-amber-500" /> Importante
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.urgent}
                onChange={(e) => setForm({ ...form, urgent: e.target.checked })}
              />
              <Flame className="h-4 w-4 text-red-500" /> Urgente
            </label>
          </div>

          <Field label="Observação">
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
