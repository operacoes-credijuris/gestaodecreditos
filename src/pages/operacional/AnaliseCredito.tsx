import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { analisesCrud } from '@/lib/queries'
import type { AnaliseCredito as Analise, StatusAnalise, RiscoAnalise } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
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
  const { data, isLoading, isError, error, refetch } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<string>('todos')
  const [editing, setEditing] = useState<Partial<Analise> | null>(null)
  const [toDelete, setToDelete] = useState<Analise | null>(null)
  // Erros de validação por campo, exibidos inline nos <Field> (toast fica só
  // para erros de rede/backend).
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário tirado ao abrir — base do cálculo de `dirty`.
  const snapshotRef = useRef<string>('')

  // Abre o formulário zerando erros e registrando o snapshot para o `dirty`.
  function abrirForm(analise: Partial<Analise>) {
    snapshotRef.current = JSON.stringify(analise)
    setErros({})
    setEditing(analise)
  }

  const dirty = editing !== null && JSON.stringify(editing) !== snapshotRef.current

  // Fechamento pelo botão "Cancelar": não passa pela confirmação interna do
  // Modal (que só cobre X/overlay/Escape), então trata o `dirty` aqui.
  function cancelarForm() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    setEditing(null)
  }

  // Busca textual (sem o filtro de status) — base para a lista e as contagens
  // exibidas nas pílulas de filtro.
  const baseBusca = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((a) =>
        [a.numero_processo, a.cedente, a.devedor, a.tribunal]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca])

  const contagemStatus = useMemo(() => {
    const c: Record<string, number> = { todos: baseBusca.length }
    for (const k of Object.keys(STATUS_ANALISE))
      c[k] = baseBusca.filter((a) => a.status === k).length
    return c
  }, [baseBusca])

  const lista = useMemo(
    () =>
      filtroStatus === 'todos'
        ? baseBusca
        : baseBusca.filter((a) => a.status === filtroStatus),
    [baseBusca, filtroStatus],
  )

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    // Validação inline: número do processo é obrigatório.
    if (!editing.numero_processo?.trim()) {
      setErros({ numero_processo: 'Informe o número do processo' })
      return
    }
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
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
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
          <Segmented
            ariaLabel="Filtrar análises por status"
            items={[
              { key: 'todos', label: 'Todas', count: contagemStatus.todos },
              ...Object.entries(STATUS_ANALISE).map(([k, v]) => ({
                key: k,
                label: v.label,
                count: contagemStatus[k] ?? 0,
              })),
            ]}
            value={filtroStatus}
            onChange={setFiltroStatus}
          />
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhuma análise"
            description="Cadastre a primeira análise de crédito."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
                Nova análise
              </Button>
            }
          />
        ) : (
          <Table dense>
            <THead>
              <tr>
                <TH>Processo</TH>
                <TH>Cedente / Devedor</TH>
                <TH className="text-right tabular-nums">Valor de face</TH>
                <TH className="text-right tabular-nums">Avaliado</TH>
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
                      <div className="text-xs font-normal text-slate-500">
                        {a.tribunal || '—'}
                      </div>
                    </TD>
                    <TD>
                      {a.cedente || '—'}
                      <div className="text-xs text-slate-500">
                        Devedor: {a.devedor || '—'}
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums">{formatBRL(a.valor_face)}</TD>
                    <TD className="text-right tabular-nums">{formatBRL(a.valor_avaliado)}</TD>
                    <TD>{a.risco ? <Badge tone={ri.tone}>{ri.label}</Badge> : '—'}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label="Editar"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => abrirForm(a)}
                        />
                        <IconButton
                          label="Excluir"
                          variant="danger"
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => setToDelete(a)}
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
        title={editing?.id ? 'Editar análise' : 'Nova análise de crédito'}
        size="lg"
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" onClick={cancelarForm}>
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
              <Field label="Número do processo" required error={erros.numero_processo}>
                <Input
                  value={editing.numero_processo ?? ''}
                  onChange={(e) => {
                    setEditing({ ...editing, numero_processo: e.target.value })
                    // Limpa o erro do campo assim que o usuário digita.
                    if (erros.numero_processo) setErros({})
                  }}
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
