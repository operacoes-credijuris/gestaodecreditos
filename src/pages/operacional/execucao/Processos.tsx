import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { processosCrud } from '@/lib/queries'
import type { Processo, StatusProcesso } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
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
import { getLabel, STATUS_PROCESSO } from '@/lib/labels'
import { formatBRL, formatCNJ } from '@/lib/format'

const VAZIO: Partial<Processo> = {
  numero_cnj: '',
  tribunal: '',
  vara: '',
  comarca: '',
  classe: '',
  assunto: '',
  parte_autora: '',
  parte_re: '',
  fase: '',
  valor_causa: null,
  status: 'ativo',
}

export default function Processos() {
  const { useList, useCreate, useUpdate, useRemove } = processosCrud
  const { data, isLoading, isError, error } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [editing, setEditing] = useState<Partial<Processo> | null>(null)
  const [toDelete, setToDelete] = useState<Processo | null>(null)

  const lista = useMemo(() => {
    let l = data ?? []
    if (filtroStatus !== 'todos') l = l.filter((p) => p.status === filtroStatus)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((p) =>
        [p.numero_cnj, p.parte_autora, p.parte_re, p.comarca, p.tribunal, p.classe]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca, filtroStatus])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.numero_cnj?.trim()) {
      toast.error('Informe o número do processo.')
      return
    }
    try {
      const { id, created_at, updated_at, ...payload } = editing as Processo
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Processo atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Processo cadastrado.')
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
      toast.success('Processo excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Processos"
        description="Repositório central dos processos em execução."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...VAZIO })}>
            Novo processo
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por número, partes, comarca, classe…"
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
            {Object.entries(STATUS_PROCESSO).map(([k, v]) => (
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
          <EmptyState title="Nenhum processo" description="Cadastre o primeiro processo." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Processo</TH>
                <TH>Partes</TH>
                <TH>Comarca / Vara</TH>
                <TH>Fase</TH>
                <TH>Valor da causa</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((p) => {
                const st = getLabel(STATUS_PROCESSO, p.status)
                return (
                  <TR key={p.id}>
                    <TD className="font-medium text-slate-800">
                      {formatCNJ(p.numero_cnj)}
                      <div className="text-xs font-normal text-slate-400">
                        {p.tribunal || '—'} {p.classe ? `· ${p.classe}` : ''}
                      </div>
                    </TD>
                    <TD>
                      <div className="text-xs">
                        <span className="text-slate-400">Autor:</span> {p.parte_autora || '—'}
                      </div>
                      <div className="text-xs">
                        <span className="text-slate-400">Réu:</span> {p.parte_re || '—'}
                      </div>
                    </TD>
                    <TD>
                      {p.comarca || '—'}
                      <div className="text-xs text-slate-400">{p.vara || '—'}</div>
                    </TD>
                    <TD>{p.fase || '—'}</TD>
                    <TD>{formatBRL(p.valor_causa)}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => setEditing(p)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setToDelete(p)}
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
        title={editing?.id ? 'Editar processo' : 'Novo processo'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-processo"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-processo" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Número do processo (CNJ)" required className="sm:col-span-2">
                <Input
                  value={editing.numero_cnj ?? ''}
                  onChange={(e) => setEditing({ ...editing, numero_cnj: e.target.value })}
                  placeholder="0000000-00.0000.0.00.0000"
                />
              </Field>
              <Field label="Tribunal">
                <Input
                  value={editing.tribunal ?? ''}
                  onChange={(e) => setEditing({ ...editing, tribunal: e.target.value })}
                />
              </Field>
              <Field label="Comarca">
                <Input
                  value={editing.comarca ?? ''}
                  onChange={(e) => setEditing({ ...editing, comarca: e.target.value })}
                />
              </Field>
              <Field label="Vara">
                <Input
                  value={editing.vara ?? ''}
                  onChange={(e) => setEditing({ ...editing, vara: e.target.value })}
                />
              </Field>
              <Field label="Classe">
                <Input
                  value={editing.classe ?? ''}
                  onChange={(e) => setEditing({ ...editing, classe: e.target.value })}
                />
              </Field>
              <Field label="Parte autora">
                <Input
                  value={editing.parte_autora ?? ''}
                  onChange={(e) => setEditing({ ...editing, parte_autora: e.target.value })}
                />
              </Field>
              <Field label="Parte ré">
                <Input
                  value={editing.parte_re ?? ''}
                  onChange={(e) => setEditing({ ...editing, parte_re: e.target.value })}
                />
              </Field>
              <Field label="Fase">
                <Input
                  value={editing.fase ?? ''}
                  onChange={(e) => setEditing({ ...editing, fase: e.target.value })}
                />
              </Field>
              <Field label="Valor da causa (R$)">
                <Input
                  type="number"
                  step="0.01"
                  value={editing.valor_causa ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      valor_causa: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="Status" required>
                <Select
                  value={editing.status ?? 'ativo'}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value as StatusProcesso })
                  }
                >
                  {Object.entries(STATUS_PROCESSO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Assunto" className="sm:col-span-2">
                <Input
                  value={editing.assunto ?? ''}
                  onChange={(e) => setEditing({ ...editing, assunto: e.target.value })}
                />
              </Field>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Excluir o processo ${toDelete?.numero_cnj || ''}?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
