import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { investidoresCrud } from '@/lib/queries'
import type { Investidor, TipoPessoa, StatusInvestidor } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { IconButton } from '@/components/ui/IconButton'
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
import { getLabel, STATUS_INVESTIDOR, TIPO_PESSOA } from '@/lib/labels'

const VAZIO: Partial<Investidor> = {
  nome: '',
  documento: '',
  email: '',
  telefone: '',
  tipo: 'pf',
  status: 'ativo',
  observacoes: '',
}

export function InvestidoresPanel() {
  const { useList, useCreate, useUpdate, useRemove } = investidoresCrud
  const { data, isLoading, isError, error, refetch } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [editing, setEditing] = useState<Partial<Investidor> | null>(null)
  const [toDelete, setToDelete] = useState<Investidor | null>(null)
  // Erros de validação por campo, exibidos inline nos <Field>.
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir, para detectar alterações não salvas.
  const snapRef = useRef('')

  const dirty = !!editing && JSON.stringify(editing) !== snapRef.current

  // Abre o formulário guardando o snapshot inicial e limpando erros antigos.
  function abrirForm(valores: Partial<Investidor>) {
    snapRef.current = JSON.stringify(valores)
    setErros({})
    setEditing(valores)
  }

  // Limpa o erro de um campo assim que o usuário o altera.
  function limparErro(campo: string) {
    setErros((prev) => (prev[campo] ? { ...prev, [campo]: '' } : prev))
  }

  // Botões próprios do footer não passam pela confirmação do Modal.
  function cancelar() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    setEditing(null)
  }

  const lista = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((i) =>
        [i.nome, i.documento, i.email, i.telefone]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.nome?.trim()) {
      setErros({ nome: 'Obrigatório' })
      return
    }
    try {
      const { id, created_at, updated_at, ...payload } = editing as Investidor
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Investidor atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Investidor cadastrado.')
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
      toast.success('Investidor excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            className="pl-9"
            placeholder="Buscar investidor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
          Novo investidor
        </Button>
      </div>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhum investidor"
            description="Cadastre o primeiro investidor."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
                Novo investidor
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Nome</TH>
                <TH>Documento</TH>
                <TH>Tipo</TH>
                <TH>Contato</TH>
                <TH>Status</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((i) => {
                const st = getLabel(STATUS_INVESTIDOR, i.status)
                const tp = getLabel(TIPO_PESSOA, i.tipo)
                return (
                  <TR key={i.id}>
                    <TD className="font-medium text-slate-800">{i.nome}</TD>
                    <TD>{i.documento || '—'}</TD>
                    <TD>
                      <Badge tone={tp.tone}>{tp.label}</Badge>
                    </TD>
                    <TD>
                      {i.email || '—'}
                      <div className="text-xs text-slate-600">{i.telefone || ''}</div>
                    </TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label="Editar"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => abrirForm(i)}
                        />
                        <IconButton
                          label="Excluir"
                          variant="danger"
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => setToDelete(i)}
                        />
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
        title={editing?.id ? 'Editar investidor' : 'Novo investidor'}
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" onClick={cancelar}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-investidor"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-investidor" onSubmit={handleSubmit} className="space-y-4">
            <Field label="Nome" required error={erros.nome}>
              <Input
                value={editing.nome ?? ''}
                onChange={(e) => {
                  setEditing({ ...editing, nome: e.target.value })
                  limparErro('nome')
                }}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tipo" required>
                <Select
                  value={editing.tipo ?? 'pf'}
                  onChange={(e) =>
                    setEditing({ ...editing, tipo: e.target.value as TipoPessoa })
                  }
                >
                  {Object.entries(TIPO_PESSOA).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="CPF / CNPJ">
                <Input
                  value={editing.documento ?? ''}
                  onChange={(e) => setEditing({ ...editing, documento: e.target.value })}
                />
              </Field>
              <Field label="E-mail">
                <Input
                  type="email"
                  value={editing.email ?? ''}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </Field>
              <Field label="Telefone">
                <Input
                  value={editing.telefone ?? ''}
                  onChange={(e) => setEditing({ ...editing, telefone: e.target.value })}
                />
              </Field>
              <Field label="Status" required>
                <Select
                  value={editing.status ?? 'ativo'}
                  onChange={(e) =>
                    setEditing({ ...editing, status: e.target.value as StatusInvestidor })
                  }
                >
                  {Object.entries(STATUS_INVESTIDOR).map(([k, v]) => (
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
        message={`Excluir o investidor "${toDelete?.nome || ''}"? Os investimentos vinculados também podem ser afetados.`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
