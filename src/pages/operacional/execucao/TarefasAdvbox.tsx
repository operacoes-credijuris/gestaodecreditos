import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Search, Flame, Star } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invokeFunction } from '@/lib/functions'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
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
import { formatCNJ, formatDate } from '@/lib/format'

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
  const tarefas = data?.tarefas ?? []

  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'pendentes' | 'concluidas'>('pendentes')
  const [novo, setNovo] = useState(false)

  const lista = useMemo(() => {
    let l = tarefas
    if (filtro === 'pendentes') l = l.filter((t) => !t.concluida)
    if (filtro === 'concluidas') l = l.filter((t) => t.concluida)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((t) =>
        [t.tipo, t.processo, t.notes, ...(t.responsaveis ?? [])]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      )
    }
    return l
  }, [tarefas, filtro, busca])

  const abertas = tarefas.filter((t) => !t.concluida).length

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
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as typeof filtro)}
          >
            <option value="pendentes">Pendentes</option>
            <option value="concluidas">Concluídas</option>
            <option value="todas">Todas</option>
          </Select>
        </div>
        {abertas > 0 && (
          <p className="mt-3 text-sm text-slate-500">
            <strong>{abertas}</strong> tarefa(s) pendente(s).
          </p>
        )}
      </Card>

      <Card>
        {isLoading ? (
          <Loading label="Buscando tarefas no ADVBOX…" />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhuma tarefa"
            description="Não há tarefas no ADVBOX para os processos cadastrados (com este filtro)."
          />
        ) : (
          <Table className="[&_th]:px-2.5 [&_td]:px-2.5 [&_td]:text-[13px]">
            <THead>
              <tr>
                <TH>Tarefa</TH>
                <TH>Processo</TH>
                <TH>Responsáveis</TH>
                <TH>Data</TH>
                <TH>Prazo</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((t) => (
                <TR key={t.id}>
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
                      <span>{t.tipo || '—'}</span>
                    </div>
                    {t.notes && (
                      <div className="line-clamp-1 text-xs font-normal text-slate-400">
                        {t.notes}
                      </div>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">{formatCNJ(t.processo)}</TD>
                  <TD>{t.responsaveis?.length ? t.responsaveis.join(', ') : '—'}</TD>
                  <TD className="whitespace-nowrap">{formatDate(t.start_date)}</TD>
                  <TD className="whitespace-nowrap">{formatDate(t.date_deadline)}</TD>
                  <TD>
                    {t.concluida ? (
                      <Badge tone="green">Concluída</Badge>
                    ) : (
                      <Badge tone="yellow">Pendente</Badge>
                    )}
                  </TD>
                </TR>
              ))}
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
