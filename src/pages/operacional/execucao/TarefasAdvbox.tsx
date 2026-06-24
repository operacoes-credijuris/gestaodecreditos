import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { tarefasCrud } from '@/lib/queries'
import type { Tarefa, StatusTarefa, PrioridadeTarefa } from '@/lib/types'
import { invokeFunction } from '@/lib/functions'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
import { getLabel, STATUS_TAREFA, PRIORIDADE_TAREFA } from '@/lib/labels'
import { formatDate } from '@/lib/format'

const VAZIO: Partial<Tarefa> = {
  titulo: '',
  descricao: '',
  responsavel: '',
  prazo: '',
  status: 'pendente',
  prioridade: 'media',
}

export default function TarefasAdvbox() {
  const { useList, useCreate, useUpdate, useRemove } = tarefasCrud
  const { data, isLoading, isError, error } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()
  const qc = useQueryClient()

  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [editing, setEditing] = useState<Partial<Tarefa> | null>(null)
  const [toDelete, setToDelete] = useState<Tarefa | null>(null)
  const [syncing, setSyncing] = useState(false)

  const lista = useMemo(() => {
    let l = data ?? []
    if (filtroStatus !== 'todos') l = l.filter((t) => t.status === filtroStatus)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((t) =>
        [t.titulo, t.descricao, t.responsavel]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca, filtroStatus])

  const abertas = (data ?? []).filter(
    (t) => t.status !== 'concluida',
  ).length

  async function sync() {
    setSyncing(true)
    try {
      const res = await invokeFunction<{ inseridos?: number; mensagem?: string }>(
        'advbox-sync',
      )
      await qc.invalidateQueries({ queryKey: ['tarefas'] })
      toast.success(res?.mensagem ?? 'Sincronização ADVBOX concluída.')
    } catch (err) {
      toast.error(`Falha na sincronização: ${(err as Error).message}`)
    } finally {
      setSyncing(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.titulo?.trim()) {
      toast.error('Informe o título da tarefa.')
      return
    }
    try {
      const { id, created_at, updated_at, ...payload } = editing as Tarefa
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Tarefa atualizada.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Tarefa cadastrada.')
      }
      setEditing(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      await remove.mutateAsync(toDelete.id)
      toast.success('Tarefa excluída.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Tarefas"
        description="Controle das tarefas sincronizadas do ADVBOX e tarefas internas."
        actions={
          <>
            <Button
              variant="outline"
              icon={<RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
              loading={syncing}
              onClick={sync}
            >
              Sincronizar ADVBOX
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...VAZIO })}>
              Nova tarefa
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por título, responsável…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select
            className="sm:w-52"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
          >
            <option value="todos">Todos os status</option>
            {Object.entries(STATUS_TAREFA).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        {abertas > 0 && (
          <p className="mt-3 text-sm text-slate-500">
            <strong>{abertas}</strong> tarefa(s) em aberto.
          </p>
        )}
      </Card>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhuma tarefa"
            description="Sincronize com o ADVBOX ou cadastre uma tarefa."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Tarefa</TH>
                <TH>Responsável</TH>
                <TH>Prazo</TH>
                <TH>Prioridade</TH>
                <TH>Status</TH>
                <TH>Origem</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((t) => {
                const st = getLabel(STATUS_TAREFA, t.status)
                const pr = getLabel(PRIORIDADE_TAREFA, t.prioridade)
                return (
                  <TR key={t.id}>
                    <TD className="font-medium text-slate-800">
                      {t.titulo}
                      {t.descricao && (
                        <div className="line-clamp-1 text-xs font-normal text-slate-400">
                          {t.descricao}
                        </div>
                      )}
                    </TD>
                    <TD>{t.responsavel || '—'}</TD>
                    <TD className="whitespace-nowrap">{formatDate(t.prazo)}</TD>
                    <TD>
                      <Badge tone={pr.tone}>{pr.label}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD>
                      {t.advbox_id ? (
                        <Badge tone="orange">ADVBOX</Badge>
                      ) : (
                        <Badge tone="gray">Interna</Badge>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(t)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(t)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                          title="Excluir"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar tarefa' : 'Nova tarefa'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-tarefa"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-tarefa" onSubmit={handleSubmit} className="space-y-4">
            <Field label="Título" required>
              <Input
                value={editing.titulo ?? ''}
                onChange={(e) => setEditing({ ...editing, titulo: e.target.value })}
              />
            </Field>
            <Field label="Descrição">
              <Textarea
                rows={3}
                value={editing.descricao ?? ''}
                onChange={(e) => setEditing({ ...editing, descricao: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Responsável">
                <Input
                  value={editing.responsavel ?? ''}
                  onChange={(e) => setEditing({ ...editing, responsavel: e.target.value })}
                />
              </Field>
              <Field label="Prazo">
                <Input
                  type="date"
                  value={editing.prazo ?? ''}
                  onChange={(e) => setEditing({ ...editing, prazo: e.target.value })}
                />
              </Field>
              <Field label="Prioridade" required>
                <Select
                  value={editing.prioridade ?? 'media'}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      prioridade: e.target.value as PrioridadeTarefa,
                    })
                  }
                >
                  {Object.entries(PRIORIDADE_TAREFA).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" required>
                <Select
                  value={editing.status ?? 'pendente'}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value as StatusTarefa })
                  }
                >
                  {Object.entries(STATUS_TAREFA).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Excluir a tarefa "${toDelete?.titulo || ''}"?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
