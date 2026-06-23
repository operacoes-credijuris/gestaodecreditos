import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search, ArrowUp, ArrowDown } from 'lucide-react'
import { requerimentosCrud } from '@/lib/queries'
import type { Requerimento } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Textarea } from '@/components/ui/Field'
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
import { formatDate } from '@/lib/format'

const VAZIO: Partial<Requerimento> = {
  numero_protocolo: '',
  orgao: '',
  materia: '',
  classe_processual: '',
  data_protocolo: '',
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
  // Ordenação padrão: data de protocolo, do mais recente para o mais antigo.
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [editing, setEditing] = useState<Partial<Requerimento> | null>(null)
  const [toDelete, setToDelete] = useState<Requerimento | null>(null)

  function toggleSort() {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  const lista = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((r) =>
        [r.numero_protocolo, r.orgao, r.materia, r.classe_processual, r.observacoes]
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
  }, [data, busca, sortDir])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.numero_protocolo?.trim()) {
      toast.error('Informe o número de protocolo.')
      return
    }
    try {
      const payload = {
        numero_protocolo: editing.numero_protocolo?.trim() || null,
        orgao: editing.orgao?.trim() || null,
        materia: editing.materia?.trim() || null,
        classe_processual: editing.classe_processual?.trim() || null,
        data_protocolo: editing.data_protocolo || null,
        observacoes: editing.observacoes?.trim() || null,
      }
      if (editing.id) {
        await update.mutateAsync({ id: editing.id, changes: payload })
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
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Buscar por protocolo, órgão, matéria, classe processual…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
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
                <TH>Protocolo</TH>
                <TH>Classe processual</TH>
                <TH>Matéria</TH>
                <TH>
                  <button
                    type="button"
                    onClick={toggleSort}
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-slate-700"
                    title="Ordenar por data de protocolo"
                  >
                    Data de protocolo
                    {sortDir === 'asc' ? (
                      <ArrowUp className="h-3.5 w-3.5 text-brand-600" />
                    ) : (
                      <ArrowDown className="h-3.5 w-3.5 text-brand-600" />
                    )}
                  </button>
                </TH>
                <TH className="text-right">
                  <span className="sr-only">Ações</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium text-slate-800">
                    {r.numero_protocolo || '—'}
                    <div className="text-[11px] font-normal text-slate-400">
                      {r.orgao || '—'}
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">{r.classe_processual || '—'}</TD>
                  <TD>{r.materia || '—'}</TD>
                  <TD className="whitespace-nowrap text-slate-600">
                    {formatDate(r.data_protocolo)}
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
              ))}
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Número de protocolo" required>
                <Input
                  value={editing.numero_protocolo ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, numero_protocolo: e.target.value })
                  }
                />
              </Field>
              <Field label="Órgão / Entidade">
                <Input
                  value={editing.orgao ?? ''}
                  onChange={(e) => setEditing({ ...editing, orgao: e.target.value })}
                />
              </Field>
              <Field label="Matéria">
                <Input
                  value={editing.materia ?? ''}
                  onChange={(e) => setEditing({ ...editing, materia: e.target.value })}
                />
              </Field>
              <Field label="Classe processual">
                <Input
                  value={editing.classe_processual ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, classe_processual: e.target.value })
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
        message={`Excluir o requerimento ${toDelete?.numero_protocolo || ''}?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
