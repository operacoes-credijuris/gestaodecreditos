import {
  useEffect,
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
  processoBusca: string
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
  processoBusca: '',
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
    <div className="mt-0.5 text-[11px] font-normal text-slate-400">
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
                <TH className="whitespace-nowrap text-center">Gerar petição</TH>
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
                        <div className="text-[11px] font-normal text-slate-400">
                          <div>Ced.: {cred.cedente || '—'}</div>
                          <div>Ces.: {cred.cessionario || '—'}</div>
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
                        <span>{t.tipo ? sentenceCase(t.tipo) : '—'}</span>
                      </div>
                      {t.notes && <Observacao text={t.notes} />}
                    </TD>
                    <TD className="whitespace-nowrap text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        title="Gerar petição"
                        icon={<FileText className="h-4 w-4" />}
                        onClick={() =>
                          toast.toast(
                            'Geração de petição será configurada em breve.',
                            'info',
                          )
                        }
                      />
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

// Caixa de seleção digitável (combobox) para o processo: digita e
// escolhe numa lista filtrada que aparece logo abaixo (estilo busca).
function ProcessoCombobox({
  lawsuits,
  value,
  onChange,
}: {
  lawsuits: Opcoes['lawsuits']
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const dig = (s?: string | null) => (s ?? '').replace(/\D/g, '')
  const q = value.trim().toLowerCase()
  const qd = dig(value)
  const matches = useMemo(() => {
    const list = lawsuits.map((l) => ({
      l,
      label: `${l.numero}${l.cliente ? ` — ${l.cliente}` : ''}`,
    }))
    if (!q) return list.slice(0, 50)
    return list
      .filter(
        ({ l, label }) =>
          label.toLowerCase().includes(q) ||
          (qd.length >= 3 && dig(l.numero).includes(qd)),
      )
      .slice(0, 50)
  }, [lawsuits, q, qd])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const choose = (label: string) => {
    onChange(label)
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={value}
        autoComplete="off"
        placeholder="Digite o número do processo…"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHi(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            setOpen(true)
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHi((h) => Math.min(h + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHi((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter') {
            if (open && matches[hi]) {
              e.preventDefault()
              choose(matches[hi].label)
            }
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((m, i) => (
            <li key={m.l.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(m.label)
                }}
                onMouseEnter={() => setHi(i)}
                className={cn(
                  'block w-full px-3 py-1.5 text-left text-[12px]',
                  i === hi
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && q && matches.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-400 shadow-lg">
          Nenhum processo encontrado.
        </div>
      )}
    </div>
  )
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
  const [form, setForm] = useState<FormState>({ ...FORM_VAZIO })

  const opcoes = useQuery({
    queryKey: ['advbox-tarefas-options'],
    queryFn: () =>
      invokeFunction<Opcoes>('advbox-tarefas', { action: 'options' }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // Ao fechar, limpa o formulário. Ao abrir a partir de uma publicação,
  // pré-preenche o número do processo (casando com a lista quando possível).
  useEffect(() => {
    if (!open) {
      setForm({ ...FORM_VAZIO })
      return
    }
    if (!processoNumero) return
    const dig = (s?: string | null) => (s ?? '').replace(/\D/g, '')
    const found = opcoes.data?.lawsuits?.find(
      (l) => dig(l.numero) === dig(processoNumero),
    )
    const disp = found
      ? `${found.numero}${found.cliente ? ` — ${found.cliente}` : ''}`
      : processoNumero
    setForm((f) => (f.processoBusca ? f : { ...f, processoBusca: disp }))
  }, [open, opcoes.data, processoNumero])

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
    const dig = (s?: string | null) => (s ?? '').replace(/\D/g, '')
    const d = dig(form.processoBusca)
    const law = (opcoes.data?.lawsuits ?? []).find((l) => {
      const disp = `${l.numero}${l.cliente ? ` — ${l.cliente}` : ''}`
      return form.processoBusca === disp || (d.length >= 6 && dig(l.numero) === d)
    })
    if (!law) return toast.error('Selecione um processo válido da lista.')
    if (!form.tasks_id) return toast.error('Selecione o tipo de tarefa.')
    if (!form.start_date) return toast.error('Informe a data.')
    if (!form.from) return toast.error('Selecione o remetente.')
    if (form.guests.length === 0) return toast.error('Selecione ao menos um responsável.')
    criar.mutate(law.id)
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
          <Field
            label="Processo"
            required
            hint="Digite o número e escolha na lista (só processos cadastrados)."
          >
            <ProcessoCombobox
              lawsuits={lawsuits}
              value={form.processoBusca}
              onChange={(v) => setForm((f) => ({ ...f, processoBusca: v }))}
            />
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
