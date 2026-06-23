import { useMemo, useState, type FormEvent } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react'
import { requerimentosCrud } from '@/lib/queries'
import type { Requerimento, StatusRequerimento } from '@/lib/types'
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
import { getLabel, STATUS_REQUERIMENTO } from '@/lib/labels'
import { formatDate } from '@/lib/format'

const VAZIO: Partial<Requerimento> = {
  assunto: '',
  orgao: '',
  numero_protocolo: '',
  data_protocolo: '',
  status: 'pendente',
  observacoes: '',
}

export default function Requerimentos() {
  const { useList, useCreate, useUpdate, useRemove } = requerimentosCrud
  const { data, isLoading, isError, error } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  // Ordenação padrão: data de protocolo, do mais recente para o mais antigo.
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [editing, setEditing] = useState<Partial<Requerimento> | null>(null)
  const [toDelete, setToDelete] = useState<Requerimento | null>(null)

  function toggleSort() {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  const lista = useMemo(() => {
    let l = data ?? []
    if (filtroStatus !== 'todos') l = l.filter((r) => r.status === filtroStatus)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((r) =>
        [r.assunto, r.orgao, r.numero_protocolo, r.observacoes]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...l].sort((a, b) => {
      const av = a.data_protocolo || ''
      const bv = b.data_protocolo || ''
      if (!av && !bv) return 0
      if (!av) return 1 // datas vazias sempre por último
      if (!bv) return -1
      return av.localeCompare(bv) * dir
    })
  }, [data, busca, filtroStatus, sortDir])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.assunto?.trim()) {
      toast.error('Informe o assunto do requerimento.')
      return
    }
    try {
      const { id, created_at, updated_at, ...payload } = editing as Requerimento
      // Data em branco vira null (o Postgres rejeita "" em coluna date).
      if (!payload.data_protocolo) payload.data_protocolo = null
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Requerimento atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Requerimento cadastrado.')
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
      toast.success('Requerimento excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Requerimentos"
        description="Cadastro dos requerimentos administrativos."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...VAZIO })}>
            Novo requerimento
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por assunto, órgão, protocolo, observações…"
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
            {Object.entries(STATUS_REQUERIMENTO).map(([k, v]) => (
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
            title="Nenhum requerimento"
            description="Cadastre o primeiro requerimento."
          />
        ) : (
          <Table className="[&_th]:px-2.5 [&_td]:px-2.5 [&_td]:text-[13px]">
            <THead>
              <tr>
                <TH>Assunto</TH>
                <TH>Órgão / Entidade</TH>
                <TH>
                  <button
                    type="button"
                    onClick={toggleSort}
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-slate-700"
                    title="Ordenar por data de protocolo"
                  >
                    Protocolo
                    {sortDir === 'asc' ? (
                      <ArrowUp className="h-3.5 w-3.5 text-brand-600" />
                    ) : (
                      <ArrowDown className="h-3.5 w-3.5 text-brand-600" />
                    )}
                  </button>
                </TH>
                <TH>Status</TH>
                <TH className="text-right">
                  <span className="sr-only">Ações</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((r) => {
                const st = getLabel(STATUS_REQUERIMENTO, r.status)
                return (
                  <TR key={r.id}>
                    <TD className="font-medium text-slate-800">{r.assunto}</TD>
                    <TD className="whitespace-nowrap">{r.orgao || '—'}</TD>
                    <TD className="whitespace-nowrap">
                      {r.numero_protocolo || '—'}
                      <div className="text-[11px] text-slate-400">
                        {formatDate(r.data_protocolo)}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(r)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(r)}
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
        title={editing?.id ? 'Editar requerimento' : 'Novo requerimento'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-requerimento"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-requerimento" onSubmit={handleSubmit} className="space-y-4">
            <Field label="Assunto" required>
              <Input
                value={editing.assunto ?? ''}
                onChange={(e) => setEditing({ ...editing, assunto: e.target.value })}
                placeholder="Ex.: Habilitação de crédito, pedido de certidão…"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Órgão / Entidade">
                <Input
                  value={editing.orgao ?? ''}
                  onChange={(e) => setEditing({ ...editing, orgao: e.target.value })}
                />
              </Field>
              <Field label="Número de protocolo">
                <Input
                  value={editing.numero_protocolo ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, numero_protocolo: e.target.value })
                  }
                />
              </Field>
              <Field label="Data de protocolo">
                <Input
                  type="date"
                  value={editing.data_protocolo ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, data_protocolo: e.target.value })
                  }
                />
              </Field>
              <Field label="Status" required>
                <Select
                  value={editing.status ?? 'pendente'}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      status: e.target.value as StatusRequerimento,
                    })
                  }
                >
                  {Object.entries(STATUS_REQUERIMENTO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Observações">
              <Textarea
                rows={3}
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
        message={`Excluir o requerimento ${toDelete?.assunto || ''}?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
