import { Fragment, useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search, ChevronRight } from 'lucide-react'
import { requerimentosCrud, apensosCrud } from '@/lib/queries'
import { useApensosManager } from '@/components/Apensos'
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
import { IconButton } from '@/components/ui/IconButton'
import { SortableTH } from '@/components/ui/SortableTH'
import { Drawer, DrawerField, DrawerSection } from '@/components/ui/Drawer'
import { DrawerMovimentacoes } from '@/components/Movimentacoes'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/format'

const VAZIO: Partial<Requerimento> = {
  numero_protocolo: '',
  orgao: '',
  tribunal_entidade: '',
  materia: '',
  classe_processual: '',
  data_protocolo: '',
  observacoes: '',
}

// Total de colunas da tabela — usado no colSpan da linha de apensos.
// Tribunal/órgão não têm coluna própria: viram subtítulo do protocolo.
const N_COLUNAS = 5

// Normaliza string vazia (ou só espaços) para null antes de enviar ao backend.
const vazioNull = (s?: string | null) => (s?.trim() ? s.trim() : null)

export default function Requerimentos() {
  const { useList, useCreate, useUpdate, useRemove } = requerimentosCrud
  const { data, isLoading, isError, error, refetch } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()
  const apensos = useApensosManager('requerimento_id')

  const [busca, setBusca] = useState('')
  // Ordenação padrão: data de protocolo, do mais antigo para o mais novo.
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [editing, setEditing] = useState<Partial<Requerimento> | null>(null)
  const [toDelete, setToDelete] = useState<Requerimento | null>(null)
  // Requerimento com a ficha aberta no painel lateral (clique na linha).
  const [detalhe, setDetalhe] = useState<Requerimento | null>(null)
  // Apensos do requerimento em detalhe (lista de leitura na ficha).
  const todosApensos = apensosCrud.useList()
  const apensosDoDetalhe = useMemo(
    () =>
      detalhe
        ? (todosApensos.data ?? []).filter((a) => a.requerimento_id === detalhe.id)
        : [],
    [todosApensos.data, detalhe],
  )
  // Erros de validação por campo (mensagens inline nos <Field>).
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de dirty.
  const snapshotRef = useRef('')

  const dirty = !!editing && JSON.stringify(editing) !== snapshotRef.current

  // Abre o formulário zerando erros e registrando o snapshot inicial.
  function abrirForm(valores: Partial<Requerimento>) {
    snapshotRef.current = JSON.stringify(valores)
    setErros({})
    setEditing(valores)
  }

  // Fecha pelo botão "Cancelar" respeitando alterações pendentes (o Modal já
  // cobre X/overlay/Escape via prop dirty).
  function fecharForm() {
    if (dirty && !window.confirm('Descartar alterações não salvas?')) return
    setEditing(null)
  }

  function toggleSort() {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  const lista = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((r) =>
        [
          r.numero_protocolo,
          r.orgao,
          r.tribunal_entidade,
          r.materia,
          r.classe_processual,
          r.observacoes,
        ]
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
    // Validação inline por campo — toast fica só para erro de rede/backend.
    if (!editing.numero_protocolo?.trim()) {
      setErros({ numero_protocolo: 'Informe o número de protocolo' })
      return
    }
    try {
      const payload = {
        numero_protocolo: vazioNull(editing.numero_protocolo),
        orgao: vazioNull(editing.orgao),
        tribunal_entidade: vazioNull(editing.tribunal_entidade),
        materia: vazioNull(editing.materia),
        classe_processual: vazioNull(editing.classe_processual),
        data_protocolo: vazioNull(editing.data_protocolo),
        observacoes: vazioNull(editing.observacoes),
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
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
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
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        ) : lista.length === 0 ? (
          <EmptyState
            title="Nenhum requerimento"
            description="Cadastre o primeiro requerimento."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
                Novo requerimento
              </Button>
            }
          />
        ) : (
          <Table dense>
            <THead>
              {/* Larguras explícitas: sem elas o layout automático dava quase
                  toda a tabela para Matéria e comprimia o protocolo. Data e
                  Ações usam w-[1%]+nowrap para encolher até o conteúdo. */}
              <tr>
                <TH className="w-[26%]">Protocolo</TH>
                <TH className="w-[18%]">Classe</TH>
                <TH>Matéria</TH>
                <SortableTH
                  label="Data de protocolo"
                  active
                  dir={sortDir}
                  onToggle={toggleSort}
                  className="w-[1%] whitespace-nowrap"
                />
                <TH className="w-[1%] whitespace-nowrap text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((r) => (
                <Fragment key={r.id}>
                <TR onClick={() => setDetalhe(r)}>
                  {/* Sem nowrap na célula: o protocolo não quebra, mas o
                      subtítulo tribunal · órgão pode. */}
                  <TD className="font-medium text-slate-800">
                    <span className="whitespace-nowrap">
                      {r.numero_protocolo || '—'}
                    </span>
                    <div className="text-xs font-normal text-slate-500">
                      {[r.tribunal_entidade, r.orgao].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </TD>
                  <TD>{r.classe_processual || '—'}</TD>
                  <TD>{r.materia || '—'}</TD>
                  <TD className="whitespace-nowrap text-slate-600">
                    {formatDate(r.data_protocolo)}
                  </TD>
                  <TD className="text-right">
                    {/* stopPropagation: os botões não devem abrir a ficha da linha */}
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {apensos.actions(r.id)}
                      <IconButton
                        label="Editar"
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => abrirForm(r)}
                      />
                      <IconButton
                        label="Excluir"
                        variant="danger"
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => setToDelete(r)}
                      />
                      <ChevronRight
                        className="h-4 w-4 text-slate-300"
                        aria-hidden="true"
                      />
                    </div>
                  </TD>
                </TR>
                {apensos.detailRow(r.id, N_COLUNAS)}
                </Fragment>
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
        dirty={dirty}
        footer={
          <>
            <Button variant="outline" onClick={fecharForm}>
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
              <Field label="Número de protocolo" required error={erros.numero_protocolo}>
                <Input
                  value={editing.numero_protocolo ?? ''}
                  onChange={(e) => {
                    setEditing({ ...editing, numero_protocolo: e.target.value })
                    // Digitar no campo limpa o erro inline.
                    if (erros.numero_protocolo) setErros({})
                  }}
                />
              </Field>
              <Field label="Órgão">
                <Input
                  value={editing.orgao ?? ''}
                  onChange={(e) => setEditing({ ...editing, orgao: e.target.value })}
                />
              </Field>
              <Field label="Tribunal / Entidade">
                <Input
                  value={editing.tribunal_entidade ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, tribunal_entidade: e.target.value })
                  }
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
              <Field label="Matéria">
                <Input
                  value={editing.materia ?? ''}
                  onChange={(e) => setEditing({ ...editing, materia: e.target.value })}
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

      {/* Ficha do requerimento — abre ao clicar na linha. Só leitura, como a
          de Créditos: as ações ficam nos botões da própria linha. */}
      <Drawer
        open={!!detalhe}
        onClose={() => setDetalhe(null)}
        title={
          detalhe && (
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight text-slate-800">
                {detalhe.numero_protocolo || '—'}
              </h2>
              <p className="text-xs text-slate-500">
                {[detalhe.tribunal_entidade, detalhe.orgao].filter(Boolean).join(' · ') ||
                  '—'}
              </p>
            </div>
          )
        }
      >
        {detalhe && (
          <>
            <DrawerSection title="Requerimento">
              <DrawerField label="Órgão">{detalhe.orgao || '—'}</DrawerField>
              <DrawerField label="Tribunal / Entidade">
                {detalhe.tribunal_entidade || '—'}
              </DrawerField>
              <DrawerField label="Classe processual">
                {detalhe.classe_processual || '—'}
              </DrawerField>
              <DrawerField label="Matéria">{detalhe.materia || '—'}</DrawerField>
              <DrawerField label="Data de protocolo">
                {formatDate(detalhe.data_protocolo)}
              </DrawerField>
            </DrawerSection>

            {detalhe.observacoes && (
              <DrawerSection title="Observações">
                <p className="col-span-2 whitespace-pre-wrap break-words text-sm text-slate-800">
                  {detalhe.observacoes}
                </p>
              </DrawerSection>
            )}

            <DrawerSection title={`Apensos (${apensosDoDetalhe.length})`}>
              {apensosDoDetalhe.length === 0 ? (
                <p className="col-span-2 text-sm text-slate-500">
                  Nenhum apenso vinculado.
                </p>
              ) : (
                <div className="col-span-2 space-y-2">
                  {apensosDoDetalhe.map((a) => (
                    <div key={a.id} className="rounded-lg border border-slate-200 p-2.5">
                      <div className="text-sm font-medium text-slate-800">
                        {a.numero || '—'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {[a.classe_processual, a.tribunal, a.comarca]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DrawerSection>

            {/* Histórico integral do ADVBOX — inclui os apensos da ficha. */}
            <DrawerMovimentacoes
              principal={detalhe.numero_protocolo}
              numeros={[
                detalhe.numero_protocolo,
                ...apensosDoDetalhe.map((a) => a.numero),
              ]}
            />
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!toDelete}
        danger
        loading={remove.isPending}
        message={`Excluir o requerimento ${toDelete?.numero_protocolo || ''}?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />

      {apensos.modals()}
    </div>
  )
}
