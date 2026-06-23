import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { apensosCrud } from '@/lib/queries'
import type { Apenso } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

type ParentField = 'processo_id' | 'requerimento_id'

const acaoBtn =
  'inline-flex items-center rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700'

/**
 * Gerencia os apensos (incidentes, recursos etc.) atrelados a um principal
 * (crédito ou requerimento). Retorna helpers para embutir na tabela:
 * - actions(parentId): botões de expandir + adicionar (antes de editar/excluir)
 * - detailRow(parentId, colSpan): linha expansível com a lista de apensos
 * - modals(): modal de formulário + confirmação de exclusão (renderizar 1x)
 */
export function useApensosManager(parentField: ParentField) {
  const { data } = apensosCrud.useList()
  const create = apensosCrud.useCreate()
  const update = apensosCrud.useUpdate()
  const remove = apensosCrud.useRemove()
  const toast = useToast()

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<Partial<Apenso> | null>(null)
  const [toDelete, setToDelete] = useState<Apenso | null>(null)

  const porPai = useMemo(() => {
    const m = new Map<string, Apenso[]>()
    for (const a of data ?? []) {
      const pid = a[parentField]
      if (!pid) continue
      const arr = m.get(pid) ?? []
      arr.push(a)
      m.set(pid, arr)
    }
    return m
  }, [data, parentField])

  function toggle(id: string) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }))
  }

  function openNew(parentId: string) {
    const base: Partial<Apenso> = {
      numero: '',
      classe_processual: '',
      tribunal: '',
      comarca: '',
      vara: '',
      polo_ativo: '',
      polo_passivo: '',
    }
    base[parentField] = parentId
    setEditing(base)
    setExpanded((e) => ({ ...e, [parentId]: true }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.numero?.trim()) {
      toast.error('Informe o número do apenso.')
      return
    }
    try {
      const payload: Partial<Apenso> = {
        numero: editing.numero?.trim() || null,
        classe_processual: editing.classe_processual?.trim() || null,
        tribunal: editing.tribunal?.trim() || null,
        comarca: editing.comarca?.trim() || null,
        vara: editing.vara?.trim() || null,
        polo_ativo: editing.polo_ativo?.trim() || null,
        polo_passivo: editing.polo_passivo?.trim() || null,
      }
      payload[parentField] = editing[parentField] ?? null
      if (editing.id) {
        await update.mutateAsync({ id: editing.id, changes: payload })
        toast.success('Apenso atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Apenso adicionado.')
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
      toast.success('Apenso excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  function actions(parentId: string) {
    const count = porPai.get(parentId)?.length ?? 0
    const aberto = !!expanded[parentId]
    return (
      <>
        <button
          type="button"
          onClick={() => toggle(parentId)}
          className={acaoBtn}
          title={aberto ? 'Ocultar apensos' : 'Ver apensos'}
        >
          {aberto ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          {count > 0 && <span className="ml-0.5 text-[11px] font-medium">{count}</span>}
        </button>
        <button
          type="button"
          onClick={() => openNew(parentId)}
          className={acaoBtn}
          title="Adicionar apenso"
        >
          <Plus className="h-4 w-4" />
        </button>
      </>
    )
  }

  function detailRow(parentId: string, colSpan: number) {
    if (!expanded[parentId]) return null
    const apensos = porPai.get(parentId) ?? []
    return (
      <tr className="bg-slate-50">
        <td colSpan={colSpan} className="px-4 py-3">
          {apensos.length === 0 ? (
            <div className="text-sm text-slate-400">
              Nenhum apenso. Use o botão + para adicionar.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Apensos
              </div>
              {apensos.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-white p-2.5 text-[13px]"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium text-slate-800">
                      {a.numero || '—'}
                      {a.classe_processual && (
                        <span className="font-normal text-slate-400">
                          {' '}
                          · {a.classe_processual}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {[a.tribunal, a.comarca, a.vara].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Polo ativo: {a.polo_ativo || '—'} · Polo passivo:{' '}
                      {a.polo_passivo || '—'}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      className={acaoBtn}
                      title="Editar apenso"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setToDelete(a)}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                      title="Excluir apenso"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </td>
      </tr>
    )
  }

  function modals() {
    return (
      <>
        <Modal
          open={!!editing}
          onClose={() => setEditing(null)}
          title={editing?.id ? 'Editar apenso' : 'Novo apenso'}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                form="form-apenso"
                loading={create.isPending || update.isPending}
              >
                Salvar
              </Button>
            </>
          }
        >
          {editing && (
            <form id="form-apenso" onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Número" required>
                  <Input
                    value={editing.numero ?? ''}
                    onChange={(e) => setEditing({ ...editing, numero: e.target.value })}
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
                <Field label="Vara" className="sm:col-span-2">
                  <Input
                    value={editing.vara ?? ''}
                    onChange={(e) => setEditing({ ...editing, vara: e.target.value })}
                  />
                </Field>
                <Field label="Polo ativo" className="sm:col-span-2">
                  <Input
                    value={editing.polo_ativo ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, polo_ativo: e.target.value })
                    }
                  />
                </Field>
                <Field label="Polo passivo" className="sm:col-span-2">
                  <Input
                    value={editing.polo_passivo ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, polo_passivo: e.target.value })
                    }
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
          message={`Excluir o apenso ${toDelete?.numero || ''}?`}
          confirmLabel="Excluir"
          onConfirm={confirmDelete}
          onClose={() => setToDelete(null)}
        />
      </>
    )
  }

  return { actions, detailRow, modals }
}
