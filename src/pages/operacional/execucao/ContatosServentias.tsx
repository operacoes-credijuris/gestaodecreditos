import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search, Phone, Mail } from 'lucide-react'
import { contatosCrud } from '@/lib/queries'
import type { ContatoServentia, TipoContato } from '@/lib/types'
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
import { getLabel, TIPO_CONTATO } from '@/lib/labels'

const VAZIO: Partial<ContatoServentia> = {
  tipo: 'serventia',
  nome: '',
  tribunal: '',
  comarca: '',
  telefone: '',
  email: '',
  horario_atendimento: '',
  observacoes: '',
}

export default function ContatosServentias() {
  const { useList, useCreate, useUpdate, useRemove } = contatosCrud
  const { data, isLoading, isError, error } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [editing, setEditing] = useState<Partial<ContatoServentia> | null>(null)
  const [toDelete, setToDelete] = useState<ContatoServentia | null>(null)

  const lista = useMemo(() => {
    let l = data ?? []
    if (filtroTipo !== 'todos') l = l.filter((c) => c.tipo === filtroTipo)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((c) =>
        [c.nome, c.tribunal, c.comarca, c.telefone, c.email]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca, filtroTipo])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.nome?.trim()) {
      toast.error('Informe o nome.')
      return
    }
    try {
      const { id, created_at, updated_at, ...payload } = editing as ContatoServentia
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Contato atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Contato cadastrado.')
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
      toast.success('Contato excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Serventias e Gabinetes"
        description="Telefones e contatos das serventias, cartórios e gabinetes do juízo."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...VAZIO })}>
            Novo contato
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por nome, tribunal, comarca, telefone…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select
            className="sm:w-52"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
          >
            <option value="todos">Todos os tipos</option>
            {Object.entries(TIPO_CONTATO).map(([k, v]) => (
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
          <EmptyState title="Nenhum contato" description="Cadastre o primeiro contato." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Nome</TH>
                <TH>Tipo</TH>
                <TH>Tribunal / Comarca</TH>
                <TH>Contato</TH>
                <TH>Atendimento</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((c) => {
                const tp = getLabel(TIPO_CONTATO, c.tipo)
                return (
                  <TR key={c.id}>
                    <TD className="font-medium text-slate-800">{c.nome}</TD>
                    <TD>
                      <Badge tone={tp.tone}>{tp.label}</Badge>
                    </TD>
                    <TD>
                      {c.tribunal || '—'}
                      <div className="text-xs text-slate-400">{c.comarca || '—'}</div>
                    </TD>
                    <TD>
                      {c.telefone && (
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Phone className="h-3.5 w-3.5 text-slate-400" />
                          {c.telefone}
                        </div>
                      )}
                      {c.email && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Mail className="h-3.5 w-3.5 text-slate-400" />
                          {c.email}
                        </div>
                      )}
                      {!c.telefone && !c.email && '—'}
                    </TD>
                    <TD className="text-slate-600">{c.horario_atendimento || '—'}</TD>
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
        title={editing?.id ? 'Editar contato' : 'Novo contato'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-contato"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-contato" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" required className="sm:col-span-2">
                <Input
                  value={editing.nome ?? ''}
                  onChange={(e) => setEditing({ ...editing, nome: e.target.value })}
                  placeholder="Ex.: 2ª Vara Cível de São Paulo"
                />
              </Field>
              <Field label="Tipo" required>
                <Select
                  value={editing.tipo ?? 'serventia'}
                  onChange={(e) =>
                    setEditing({ ...editing, tipo: e.target.value as TipoContato })
                  }
                >
                  {Object.entries(TIPO_CONTATO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
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
              <Field label="Telefone">
                <Input
                  value={editing.telefone ?? ''}
                  onChange={(e) => setEditing({ ...editing, telefone: e.target.value })}
                  placeholder="(00) 0000-0000"
                />
              </Field>
              <Field label="E-mail">
                <Input
                  type="email"
                  value={editing.email ?? ''}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </Field>
              <Field label="Horário de atendimento">
                <Input
                  value={editing.horario_atendimento ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, horario_atendimento: e.target.value })
                  }
                  placeholder="Ex.: 12h às 19h"
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
        message={`Excluir o contato "${toDelete?.nome || ''}"?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
