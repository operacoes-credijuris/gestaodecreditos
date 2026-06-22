import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { analisesCrud } from '@/lib/queries'
import type { AnaliseCredito as Analise, StatusAnalise, RiscoAnalise } from '@/lib/types'
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
import { getLabel, STATUS_ANALISE, RISCO_ANALISE } from '@/lib/labels'
import { formatBRL } from '@/lib/format'

const VAZIO: Partial<Analise> = {
  numero_processo: '',
  cedente: '',
  devedor: '',
  tribunal: '',
  valor_face: null,
  valor_avaliado: null,
  risco: null,
  status: 'pendente',
  observacoes: '',
}

export default function AnaliseCredito() {
  const { useList, useCreate, useUpdate, useRemove } = analisesCrud
  const { data, isLoading, isError, error } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<string>('todos')
  const [editing, setEditing] = useState<Partial<Analise> | null>(null)
  const [toDelete, setToDelete] = useState<Analise | null>(null)

  const lista = useMemo(() => {
    let l = data ?? []
    if (filtroStatus !== 'todos') l = l.filter((a) => a.status === filtroStatus)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((a) =>
        [a.numero_processo, a.cedente, a.devedor, a.tribunal]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca, filtroStatus])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    try {
      const { id, created_at, updated_at, ...payload } = editing as Analise
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Análise atualizada.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Análise cadastrada.')
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
      toast.success('Análise excluída.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Análise de Crédito"
        description="Avaliação e due diligence dos créditos antes da aquisição/cessão."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...VAZIO })}>
            Nova análise
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por processo, cedente, devedor, tribunal…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select
            className="sm:w-56"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
          >
            <option value="todos">Todos os status</option>
            {Object.entries(STATUS_ANALISE).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhuma análise"
            description="Cadastre a primeira análise de crédito."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Processo</TH>
                <TH>Cedente / Devedor</TH>
                <TH>Valor de face</TH>
                <TH>Avaliado</TH>
                <TH>Risco</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((a) => {
                const st = getLabel(STATUS_ANALISE, a.status)
                const ri = getLabel(RISCO_ANALISE, a.risco)
                return (
                  <TR key={a.id}>
                    <TD className="font-medium text-slate-800">
                      {a.numero_processo || '—'}
                      <div className="text-xs font-normal text-slate-400">
                        {a.tribunal || '—'}
                      </div>
                    </TD>
                    <TD>
                      {a.cedente || '—'}
                      <div className="text-xs text-slate-400">
                        Devedor: {a.devedor || '—'}
                      </div>
                    </TD>
                    <TD>{formatBRL(a.valor_face)}</TD>
                    <TD>{formatBRL(a.valor_avaliado)}</TD>
                    <TD>{a.risco ? <Badge tone={ri.tone}>{ri.label}</Badge> : '—'}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(a)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(a)}
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
        title={editing?.id ? 'Editar análise' : 'Nova análise de crédito'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-analise"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-analise" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Número do processo">
                <Input
                  value={editing.numero_processo ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, numero_processo: e.target.value })
                  }
                />
              </Field>
              <Field label="Tribunal">
                <Input
                  value={editing.tribunal ?? ''}
                  onChange={(e) => setEditing({ ...editing, tribunal: e.target.value })}
                />
              </Field>
              <Field label="Cedente">
                <Input
                  value={editing.cedente ?? ''}
                  onChange={(e) => setEditing({ ...editing, cedente: e.target.value })}
                />
              </Field>
              <Field label="Devedor">
                <Input
                  value={editing.devedor ?? ''}
                  onChange={(e) => setEditing({ ...editing, devedor: e.target.value })}
                />
              </Field>
              <Field label="Valor de face (R$)">
                <Input
                  type="number"
                  step="0.01"
                  value={editing.valor_face ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      valor_face: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="Valor avaliado (R$)">
                <Input
                  type="number"
                  step="0.01"
                  value={editing.valor_avaliado ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      valor_avaliado: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="Risco">
                <Select
                  value={editing.risco ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      risco: (e.target.value || null) as RiscoAnalise | null,
                    })
                  }
                >
                  <option value="">Não classificado</option>
                  {Object.entries(RISCO_ANALISE).map(([k, v]) => (
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
                    setEditing({ ...editing, status: e.target.value as StatusAnalise })
                  }
                >
                  {Object.entries(STATUS_ANALISE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Observações">
              <Textarea
                rows={4}
                value={editing.observacoes ?? ''}
                onChange={(e) => setEditing({ ...editing, observacoes: e.target.value })}
              />
            </Field>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Excluir a análise do processo ${toDelete?.numero_processo || ''}? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
