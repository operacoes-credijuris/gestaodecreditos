import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { apensosCrud } from '@/lib/queries'
import type { Apenso } from '@/lib/types'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Field, Input } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Drawer, DrawerField, DrawerSection } from '@/components/ui/Drawer'
import { DrawerMovimentacoes } from '@/components/Movimentacoes'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { formatCNJ, vazioNull } from '@/lib/format'

type ParentField = 'processo_id' | 'requerimento_id'

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
  // Apenso com a ficha aberta (painel lateral). O apenso é um processo por
  // direito próprio — tem os próprios autos e as próprias movimentações; o
  // vínculo com o principal é a única coisa que o distingue de um crédito.
  const [ficha, setFicha] = useState<Apenso | null>(null)
  // Erros de validação por campo, exibidos inline nos <Field>.
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de "dirty".
  const snapshotRef = useRef('')
  const dirty = !!editing && JSON.stringify(editing) !== snapshotRef.current

  // Abre o formulário limpando erros e registrando o snapshot do estado inicial.
  function abrirForm(a: Partial<Apenso>) {
    setErros({})
    snapshotRef.current = JSON.stringify(a)
    setEditing(a)
  }

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
    abrirForm(base)
    setExpanded((e) => ({ ...e, [parentId]: true }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.numero?.trim()) {
      // Validação inline: erro aparece junto ao campo, sem toast.
      setErros({ numero: 'Informe o número do apenso' })
      return
    }
    try {
      const payload: Partial<Apenso> = {
        numero: vazioNull(editing.numero),
        classe_processual: vazioNull(editing.classe_processual),
        tribunal: vazioNull(editing.tribunal),
        comarca: vazioNull(editing.comarca),
        vara: vazioNull(editing.vara),
        polo_ativo: vazioNull(editing.polo_ativo),
        polo_passivo: vazioNull(editing.polo_passivo),
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

  /**
   * Contador de apensos: só o número e a seta, para ficar ao lado do número do
   * processo. O rótulo "Apensos" saiu porque a posição já diz o que é — o
   * contador pertence ao processo, não à coluna de ações.
   * Devolve null quando não há apenso: contador zerado seria ruído em toda linha.
   */
  function contador(parentId: string) {
    const count = porPai.get(parentId)?.length ?? 0
    if (count === 0) return null
    const aberto = !!expanded[parentId]
    return (
      <button
        type="button"
        onClick={(e) => {
          // A linha inteira abre a ficha; o contador não deve disparar isso.
          e.stopPropagation()
          toggle(parentId)
        }}
        aria-expanded={aberto}
        aria-label={`${count} apenso${count > 1 ? 's' : ''} — ${aberto ? 'ocultar' : 'ver'}`}
        title={`${count} apenso${count > 1 ? 's' : ''}`}
        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-xs font-normal text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <span className="tabular-nums">{count}</span>
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', aberto && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
    )
  }

  function actions(parentId: string) {
    return (
      <IconButton
        label="Adicionar apenso"
        icon={<Plus className="h-4 w-4" />}
        onClick={() => openNew(parentId)}
      />
    )
  }

  function detailRow(parentId: string, colSpan: number) {
    if (!expanded[parentId]) return null
    const apensos = porPai.get(parentId) ?? []
    return (
      <tr className="bg-slate-50">
        <td colSpan={colSpan} className="px-4 py-3">
          {apensos.length === 0 ? (
            <div className="flex items-center gap-3 text-sm text-slate-500">
              Nenhum apenso vinculado a este registro.
              <Button
                size="sm"
                variant="outline"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => openNew(parentId)}
              >
                Adicionar apenso
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Apensos
              </div>
              {apensos.map((a) => (
                // Clique abre a ficha do apenso, como nas linhas de Créditos.
                <div
                  key={a.id}
                  onClick={() => setFicha(a)}
                  className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-slate-200 bg-white p-2.5 text-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
                  title="Abrir ficha do apenso"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium text-slate-800">
                      {formatCNJ(a.numero)}
                      {a.classe_processual && (
                        <span className="font-normal text-slate-500">
                          {' '}
                          · {a.classe_processual}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {[a.tribunal, a.comarca, a.vara].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div className="text-xs text-slate-500">
                      Polo ativo: {a.polo_ativo || '—'} · Polo passivo:{' '}
                      {a.polo_passivo || '—'}
                    </div>
                  </div>
                  {/* stopPropagation: os botões não devem abrir a ficha. */}
                  <div
                    className="flex shrink-0 items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconButton
                      label="Editar apenso"
                      icon={<Pencil className="h-4 w-4" />}
                      onClick={() => abrirForm(a)}
                    />
                    <IconButton
                      label="Excluir apenso"
                      variant="danger"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setToDelete(a)}
                    />
                    <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
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
          dirty={dirty}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  // Botão próprio não passa pela confirmação do Modal — checa dirty aqui.
                  if (dirty && !window.confirm('Descartar alterações não salvas?')) return
                  setEditing(null)
                }}
              >
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
                <Field label="Número" required error={erros.numero}>
                  <Input
                    value={editing.numero ?? ''}
                    onChange={(e) => {
                      setEditing({ ...editing, numero: e.target.value })
                      // Digitar no campo limpa o erro de validação dele.
                      if (erros.numero) setErros({})
                    }}
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

        {/* Ficha do apenso — mesmo padrão da ficha de Créditos, com as
            movimentações SÓ dele (autos próprios). */}
        <Drawer
          open={!!ficha}
          onClose={() => setFicha(null)}
          title={
            ficha && (
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold tracking-tight text-slate-800">
                    {formatCNJ(ficha.numero || '')}
                  </h2>
                  {ficha.classe_processual && (
                    <Badge tone="blue">{ficha.classe_processual}</Badge>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Apenso vinculado a{' '}
                  {parentField === 'processo_id' ? 'um crédito' : 'um requerimento'}
                </p>
              </div>
            )
          }
          footer={
            ficha && (
              <Button
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => {
                  setFicha(null)
                  abrirForm(ficha)
                }}
              >
                Editar
              </Button>
            )
          }
        >
          {ficha && (
            <>
              <DrawerSection title="Processo">
                <DrawerField label="Tribunal">{ficha.tribunal || '—'}</DrawerField>
                <DrawerField label="Comarca">{ficha.comarca || '—'}</DrawerField>
                <DrawerField label="Vara">{ficha.vara || '—'}</DrawerField>
                <DrawerField label="Classe processual">
                  {ficha.classe_processual || '—'}
                </DrawerField>
              </DrawerSection>

              <DrawerSection title="Partes">
                <DrawerField label="Polo ativo">{ficha.polo_ativo || '—'}</DrawerField>
                <DrawerField label="Polo passivo">
                  {ficha.polo_passivo || '—'}
                </DrawerField>
              </DrawerSection>

              {/* Aqui o apenso é o principal dos próprios autos. */}
              <DrawerMovimentacoes numero={ficha.numero} />
            </>
          )}
        </Drawer>
      </>
    )
  }

  return { contador, actions, detailRow, modals }
}
