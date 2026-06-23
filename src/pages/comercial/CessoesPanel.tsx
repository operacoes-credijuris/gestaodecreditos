import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { cessoesCrud, processosCrud } from '@/lib/queries'
import type { Cessao, StatusCessao } from '@/lib/types'
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
import { getLabel, STATUS_CESSAO } from '@/lib/labels'
import { formatBRL, formatDate } from '@/lib/format'

const VAZIO: Partial<Cessao> = {
  codigo: '',
  descricao: '',
  processo_id: null,
  valor_face: null,
  valor_aquisicao: null,
  valor_cessao: null,
  desagio: null,
  data_cessao: '',
  status: 'disponivel',
}

export function CessoesPanel() {
  const { useList, useCreate, useUpdate, useRemove } = cessoesCrud
  const { data, isLoading, isError, error } = useList()
  const processos = processosCrud.useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [editing, setEditing] = useState<Partial<Cessao> | null>(null)
  const [toDelete, setToDelete] = useState<Cessao | null>(null)

  const lista = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((c) =>
        [c.codigo, c.descricao]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.codigo?.trim()) {
      toast.error('Informe o código da cessão.')
      return
    }
    try {
      const { id, created_at, updated_at, ...payload } = editing as Cessao
      if (!payload.processo_id) payload.processo_id = null
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Cessão atualizada.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Cessão cadastrada.')
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
      toast.success('Cessão excluída.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Buscar cessão…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...VAZIO })}>
          Nova cessão
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} />
        ) : lista.length === 0 ? (
          <EmptyState title="Nenhuma cessão" description="Cadastre o primeiro crédito da operação." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Código</TH>
                <TH>Valor de face</TH>
                <TH>Aquisição</TH>
                <TH>Cessão</TH>
                <TH>Data</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((c) => {
                const st = getLabel(STATUS_CESSAO, c.status)
                return (
                  <TR key={c.id}>
                    <TD className="font-medium text-slate-800">
                      {c.codigo}
                      {c.descricao && (
                        <div className="line-clamp-1 text-xs font-normal text-slate-400">
                          {c.descricao}
                        </div>
                      )}
                    </TD>
                    <TD>{formatBRL(c.valor_face)}</TD>
                    <TD>{formatBRL(c.valor_aquisicao)}</TD>
                    <TD>{formatBRL(c.valor_cessao)}</TD>
                    <TD className="whitespace-nowrap">{formatDate(c.data_cessao)}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(c)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(c)}
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
        title={editing?.id ? 'Editar cessão' : 'Nova cessão'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-cessao"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-cessao" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Código" required>
                <Input
                  value={editing.codigo ?? ''}
                  onChange={(e) => setEditing({ ...editing, codigo: e.target.value })}
                  placeholder="Ex.: CES-2026-001"
                />
              </Field>
              <Field label="Crédito vinculado">
                <Select
                  value={editing.processo_id ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, processo_id: e.target.value || null })
                  }
                >
                  <option value="">— Nenhum —</option>
                  {(processos.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.numero_cnj}
                    </option>
                  ))}
                </Select>
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
              <Field label="Valor de aquisição (R$)">
                <Input
                  type="number"
                  step="0.01"
                  value={editing.valor_aquisicao ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      valor_aquisicao: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="Valor de cessão (R$)">
                <Input
                  type="number"
                  step="0.01"
                  value={editing.valor_cessao ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      valor_cessao: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="Deságio (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={editing.desagio ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      desagio: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="Data da cessão">
                <Input
                  type="date"
                  value={editing.data_cessao ?? ''}
                  onChange={(e) => setEditing({ ...editing, data_cessao: e.target.value })}
                />
              </Field>
              <Field label="Status" required>
                <Select
                  value={editing.status ?? 'disponivel'}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value as StatusCessao })
                  }
                >
                  {Object.entries(STATUS_CESSAO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Descrição">
              <Textarea
                rows={3}
                value={editing.descricao ?? ''}
                onChange={(e) => setEditing({ ...editing, descricao: e.target.value })}
              />
            </Field>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Excluir a cessão "${toDelete?.codigo || ''}"?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
