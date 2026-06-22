import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { processosCrud } from '@/lib/queries'
import type { Processo, Instrumento } from '@/lib/types'
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
import { getLabel, INSTRUMENTO } from '@/lib/labels'
import { formatCNJ, formatDate } from '@/lib/format'

const VAZIO: Partial<Processo> = {
  numero_cnj: '',
  tribunal: '',
  comarca: '',
  vara: '',
  cedente: '',
  cedente_advogado: '',
  cessionario: '',
  entidade_devedora: '',
  data_aquisicao: '',
  expectativa_liquidacao: '',
  instrumento: null,
}

export default function Processos() {
  const { useList, useCreate, useUpdate, useRemove } = processosCrud
  const { data, isLoading, isError, error } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [filtroInstrumento, setFiltroInstrumento] = useState('todos')
  const [editing, setEditing] = useState<Partial<Processo> | null>(null)
  const [toDelete, setToDelete] = useState<Processo | null>(null)

  const lista = useMemo(() => {
    let l = data ?? []
    if (filtroInstrumento !== 'todos')
      l = l.filter((p) => p.instrumento === filtroInstrumento)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((p) =>
        [
          p.numero_cnj,
          p.cedente,
          p.cessionario,
          p.entidade_devedora,
          p.comarca,
          p.tribunal,
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca, filtroInstrumento])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.numero_cnj?.trim()) {
      toast.error('Informe o número do processo.')
      return
    }
    try {
      const { id, created_at, updated_at, advbox_lawsuit_id, ...payload } =
        editing as Processo
      if (!payload.instrumento) payload.instrumento = null
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
        description="Registro dos processos das cessões/aquisições de crédito."
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
              placeholder="Buscar por número, cedente, cessionário, devedora, comarca…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select
            className="sm:w-56"
            value={filtroInstrumento}
            onChange={(e) => setFiltroInstrumento(e.target.value)}
          >
            <option value="todos">Todos os instrumentos</option>
            {Object.entries(INSTRUMENTO).map(([k, v]) => (
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
                <TH>Comarca / Vara</TH>
                <TH>Cedente</TH>
                <TH>Cessionário</TH>
                <TH>Entidade devedora</TH>
                <TH>Instrumento</TH>
                <TH>Aquisição</TH>
                <TH>Expectativa</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((p) => {
                const inst = getLabel(INSTRUMENTO, p.instrumento)
                return (
                  <TR key={p.id}>
                    <TD className="font-medium text-slate-800">
                      {formatCNJ(p.numero_cnj)}
                      <div className="text-xs font-normal text-slate-400">
                        {p.tribunal || '—'}
                      </div>
                    </TD>
                    <TD>
                      {p.comarca || '—'}
                      <div className="text-xs text-slate-400">{p.vara || '—'}</div>
                    </TD>
                    <TD>
                      {p.cedente || '—'}
                      {p.cedente_advogado && (
                        <div className="text-xs text-slate-400">
                          adv. {p.cedente_advogado}
                        </div>
                      )}
                    </TD>
                    <TD>{p.cessionario || '—'}</TD>
                    <TD>{p.entidade_devedora || '—'}</TD>
                    <TD>
                      {p.instrumento ? <Badge tone={inst.tone}>{inst.label}</Badge> : '—'}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-600">
                      {formatDate(p.data_aquisicao)}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-600">
                      {formatDate(p.expectativa_liquidacao)}
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
            <Field label="Número do processo" required>
              <Input
                value={editing.numero_cnj ?? ''}
                onChange={(e) => setEditing({ ...editing, numero_cnj: e.target.value })}
                placeholder="0000000-00.0000.0.00.0000"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
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
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cedente">
                <Input
                  value={editing.cedente ?? ''}
                  onChange={(e) => setEditing({ ...editing, cedente: e.target.value })}
                />
              </Field>
              <Field label="Advogado do cedente">
                <Input
                  value={editing.cedente_advogado ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, cedente_advogado: e.target.value })
                  }
                />
              </Field>
              <Field label="Cessionário">
                <Input
                  value={editing.cessionario ?? ''}
                  onChange={(e) => setEditing({ ...editing, cessionario: e.target.value })}
                />
              </Field>
              <Field label="Entidade devedora">
                <Input
                  value={editing.entidade_devedora ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, entidade_devedora: e.target.value })
                  }
                />
              </Field>
              <Field label="Data de aquisição">
                <Input
                  type="date"
                  value={editing.data_aquisicao ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, data_aquisicao: e.target.value })
                  }
                />
              </Field>
              <Field label="Expectativa de liquidação">
                <Input
                  type="date"
                  value={editing.expectativa_liquidacao ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, expectativa_liquidacao: e.target.value })
                  }
                />
              </Field>
              <Field label="Instrumento" className="sm:col-span-2">
                <Select
                  value={editing.instrumento ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      instrumento: (e.target.value || null) as Instrumento | null,
                    })
                  }
                >
                  <option value="">Não informado</option>
                  {Object.entries(INSTRUMENTO).map(([k, v]) => (
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
        message={`Excluir o processo ${toDelete?.numero_cnj || ''}?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
