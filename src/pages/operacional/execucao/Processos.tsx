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
  numero_rtdpj: '',
  status: 'ativo',
  data_liquidacao: '',
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
  // Ordenação padrão: data de aquisição, do mais antigo para o mais novo.
  const [sortBy, setSortBy] = useState<
    'data_aquisicao' | 'expectativa_liquidacao'
  >('data_aquisicao')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [editing, setEditing] = useState<Partial<Processo> | null>(null)
  const [toDelete, setToDelete] = useState<Processo | null>(null)

  function toggleSort(col: 'data_aquisicao' | 'expectativa_liquidacao') {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  const lista = useMemo(() => {
    let l = data ?? []
    if (filtroStatus !== 'todos') l = l.filter((p) => p.status === filtroStatus)
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
          p.numero_rtdpj,
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...l].sort((a, b) => {
      const av = a[sortBy] || ''
      const bv = b[sortBy] || ''
      if (!av && !bv) return 0
      if (!av) return 1 // datas vazias sempre por último
      if (!bv) return -1
      return av.localeCompare(bv) * dir
    })
  }, [data, busca, filtroStatus, sortBy, sortDir])

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
      // Data de liquidação só faz sentido para complementar/encerrado.
      if (payload.status === 'ativo') payload.data_liquidacao = null
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
              placeholder="Buscar por número, cedente, cessionário, devedora, comarca, RTDPJ…"
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
          <Table className="table-fixed">
            <THead>
              <tr>
                <TH className="w-[13%]">Processo</TH>
                <TH className="w-[10%]">Comarca / Vara</TH>
                <TH className="w-[13%]">Cedente</TH>
                <TH className="w-[11%]">Cessionário</TH>
                <TH className="w-[11%]">Entidade devedora</TH>
                <TH className="w-[7%]">Nº RTDPJ</TH>
                <TH className="w-[9%]">
                  <button
                    type="button"
                    onClick={() => toggleSort('data_aquisicao')}
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-slate-700"
                    title="Ordenar por data de aquisição"
                  >
                    Aquisição
                    {sortBy === 'data_aquisicao' ? (
                      sortDir === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5 text-brand-600" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 text-brand-600" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
                    )}
                  </button>
                </TH>
                <TH className="w-[9%]">
                  <button
                    type="button"
                    onClick={() => toggleSort('expectativa_liquidacao')}
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-slate-700"
                    title="Ordenar por expectativa de liquidação"
                  >
                    Expectativa
                    {sortBy === 'expectativa_liquidacao' ? (
                      sortDir === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5 text-brand-600" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 text-brand-600" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
                    )}
                  </button>
                </TH>
                <TH className="w-[9%]">Status</TH>
                <TH className="w-[8%] text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((p) => {
                const st = getLabel(STATUS_PROCESSO, p.status)
                return (
                  <TR key={p.id}>
                    <TD className="font-medium text-slate-800">
                      <div className="truncate" title={p.numero_cnj}>
                        {formatCNJ(p.numero_cnj)}
                      </div>
                      <div
                        className="truncate text-xs font-normal text-slate-400"
                        title={p.tribunal ?? ''}
                      >
                        {p.tribunal || '—'}
                      </div>
                    </TD>
                    <TD>
                      <div className="truncate" title={p.comarca ?? ''}>
                        {p.comarca || '—'}
                      </div>
                      <div
                        className="truncate text-xs text-slate-400"
                        title={p.vara ?? ''}
                      >
                        {p.vara || '—'}
                      </div>
                    </TD>
                    <TD>
                      <div className="truncate" title={p.cedente ?? ''}>
                        {p.cedente || '—'}
                      </div>
                      {p.cedente_advogado && (
                        <div
                          className="truncate text-xs text-slate-400"
                          title={p.cedente_advogado}
                        >
                          adv. {p.cedente_advogado}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <div className="truncate" title={p.cessionario ?? ''}>
                        {p.cessionario || '—'}
                      </div>
                    </TD>
                    <TD>
                      <div className="truncate" title={p.entidade_devedora ?? ''}>
                        {p.entidade_devedora || '—'}
                      </div>
                    </TD>
                    <TD>
                      <div className="truncate" title={p.numero_rtdpj ?? ''}>
                        {p.numero_rtdpj || '—'}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-slate-600">
                      {formatDate(p.data_aquisicao)}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-600">
                      {formatDate(p.expectativa_liquidacao)}
                    </TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {p.data_liquidacao && (
                        <div className="truncate text-xs text-slate-400">
                          Liq. {formatDate(p.data_liquidacao)}
                        </div>
                      )}
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
              <Field label="Nº RTDPJ" className="sm:col-span-2">
                <Input
                  value={editing.numero_rtdpj ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, numero_rtdpj: e.target.value })
                  }
                  placeholder="Número do registro no RTDPJ"
                />
              </Field>
              <Field label="Status" required>
                <Select
                  value={editing.status ?? 'ativo'}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      status: e.target.value as StatusProcesso,
                    })
                  }
                >
                  {Object.entries(STATUS_PROCESSO).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {(editing.status === 'complementar' ||
                editing.status === 'encerrado') && (
                <Field label="Data de liquidação">
                  <Input
                    type="date"
                    value={editing.data_liquidacao ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, data_liquidacao: e.target.value })
                    }
                  />
                </Field>
              )}
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
