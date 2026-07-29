import { Fragment, useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { processosCrud } from '@/lib/queries'
import { useApensosManager } from '@/components/Apensos'
import type { Processo, StatusProcesso, Instrumento } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Field, Input, Select } from '@/components/ui/Field'
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
import { IconButton } from '@/components/ui/IconButton'
import { SortableTH } from '@/components/ui/SortableTH'
import { useToast } from '@/components/ui/Toast'
import { getLabel, STATUS_PROCESSO, INSTRUMENTO } from '@/lib/labels'
import { formatCNJ, formatDate } from '@/lib/format'

// Separa múltiplos nº RTDPJ (digitados com "e", vírgula, ";", "/" ou quebra)
// para exibir um por linha.
function splitRtdpj(v: string): string[] {
  return v
    .split(/\s*(?:\be\b|,|;|\/|\n)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Converte string vazia/só espaços em null (o Postgres rejeita "" em coluna date).
const vazioNull = (s?: string | null) => (s?.trim() ? s.trim() : null)

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
  numero_rtdpj: '',
  status: 'ativo',
  data_liquidacao: '',
}

// Nº de colunas da tabela de créditos — usado no colSpan da linha de apensos.
// Atualizar ao adicionar/remover colunas para a linha continuar ocupando a largura toda.
const N_COLUNAS = 10

export default function Processos() {
  const { useList, useCreate, useUpdate, useRemove } = processosCrud
  const { data, isLoading, isError, error, refetch } = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()
  const apensos = useApensosManager('processo_id')

  const [busca, setBusca] = useState('')
  // Padrão ao abrir a página: mostra apenas processos ativos.
  const [filtroStatus, setFiltroStatus] = useState('ativo')
  // Ordenação padrão: data de aquisição, do mais antigo para o mais novo.
  const [sortBy, setSortBy] = useState<
    'data_aquisicao' | 'expectativa_liquidacao'
  >('data_aquisicao')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [editing, setEditing] = useState<Partial<Processo> | null>(null)
  const [toDelete, setToDelete] = useState<Processo | null>(null)
  // Erros de validação por campo, exibidos inline nos <Field>.
  const [erros, setErros] = useState<Record<string, string>>({})
  // Snapshot do formulário ao abrir — base do cálculo de "dirty".
  const snapshotRef = useRef('')
  const dirty = !!editing && JSON.stringify(editing) !== snapshotRef.current

  // Abre o formulário limpando erros e registrando o snapshot do estado inicial.
  function abrirForm(p: Partial<Processo>) {
    setErros({})
    snapshotRef.current = JSON.stringify(p)
    setEditing(p)
  }

  function toggleSort(col: 'data_aquisicao' | 'expectativa_liquidacao') {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  // Busca textual (sem o filtro de status) — reaproveitada na lista e nas
  // contagens exibidas no seletor de status.
  const baseBusca = useMemo(() => {
    let l = data ?? []
    if (busca.trim()) {
      const q = busca.toLowerCase()
      l = l.filter((p) =>
        [
          p.numero_cnj,
          p.cedente,
          p.cedente_advogado,
          p.cessionario,
          p.entidade_devedora,
          p.comarca,
          p.tribunal,
          p.numero_rtdpj,
          p.instrumento ? getLabel(INSTRUMENTO, p.instrumento).label : null,
        ]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    }
    return l
  }, [data, busca])

  const contagemStatus = useMemo(() => {
    const c: Record<string, number> = { todos: baseBusca.length }
    for (const k of Object.keys(STATUS_PROCESSO))
      c[k] = baseBusca.filter((p) => p.status === k).length
    return c
  }, [baseBusca])

  const lista = useMemo(() => {
    let l = baseBusca
    if (filtroStatus !== 'todos') l = l.filter((p) => p.status === filtroStatus)
    const dir = sortDir === 'asc' ? 1 : -1
    return [...l].sort((a, b) => {
      const av = a[sortBy] || ''
      const bv = b[sortBy] || ''
      if (!av && !bv) return 0
      if (!av) return 1 // datas vazias sempre por último
      if (!bv) return -1
      return av.localeCompare(bv) * dir
    })
  }, [baseBusca, filtroStatus, sortBy, sortDir])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.numero_cnj?.trim()) {
      // Validação inline: erro aparece junto ao campo, sem toast.
      setErros({ numero_cnj: 'Informe o número do processo' })
      return
    }
    try {
      const { id, created_at, updated_at, advbox_lawsuit_id, ...payload } =
        editing as Processo
      // Data de liquidação só faz sentido para complementar/encerrado.
      if (payload.status === 'ativo') payload.data_liquidacao = null
      // Nº RTDPJ só se aplica a registro público e é opcional (vazio = nulo).
      payload.numero_rtdpj =
        payload.instrumento === 'registro_publico'
          ? vazioNull(payload.numero_rtdpj)
          : null
      // Datas em branco viram null.
      payload.data_aquisicao = vazioNull(payload.data_aquisicao)
      payload.expectativa_liquidacao = vazioNull(payload.expectativa_liquidacao)
      payload.data_liquidacao = vazioNull(payload.data_liquidacao)
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Crédito atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Crédito cadastrado.')
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
      toast.success('Crédito excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title="Créditos"
        description="Registro dos créditos adquiridos via cessão/aquisição."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => abrirForm({ ...VAZIO })}>
            Novo crédito
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por número, cedente, advogado, cessionário, devedora, comarca, tribunal, instrumento, RTDPJ…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Segmented
            ariaLabel="Filtrar créditos por status"
            items={[
              ...Object.entries(STATUS_PROCESSO).map(([k, v]) => ({
                key: k,
                label: v.label,
                count: contagemStatus[k] ?? 0,
              })),
              { key: 'todos', label: 'Todos', count: contagemStatus.todos },
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
            title="Nenhum crédito"
            description="Cadastre o primeiro crédito."
            action={
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => abrirForm({ ...VAZIO })}
              >
                Novo crédito
              </Button>
            }
          />
        ) : (
          <Table dense>
            <THead>
              <tr>
                <TH>Processo</TH>
                <TH>Comarca / Vara</TH>
                <TH>Cedente</TH>
                <TH>Cessionário</TH>
                <TH>Entidade devedora</TH>
                <TH>Instrumento</TH>
                <SortableTH
                  label="Aquisição"
                  active={sortBy === 'data_aquisicao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('data_aquisicao')}
                />
                <SortableTH
                  label="Expectativa"
                  active={sortBy === 'expectativa_liquidacao'}
                  dir={sortDir}
                  onToggle={() => toggleSort('expectativa_liquidacao')}
                />
                <TH>Status</TH>
                <TH className="text-right">
                  <span className="sr-only">Ações</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {lista.map((p) => {
                const st = getLabel(STATUS_PROCESSO, p.status)
                const inst = getLabel(INSTRUMENTO, p.instrumento)
                return (
                  <Fragment key={p.id}>
                  <TR>
                    <TD className="whitespace-nowrap font-medium text-slate-800">
                      {formatCNJ(p.numero_cnj)}
                      <div className="text-xs font-normal text-slate-500">
                        {p.tribunal || '—'}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {p.comarca || '—'}
                      <div className="text-xs text-slate-500">{p.vara || '—'}</div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {p.cedente || '—'}
                      {p.cedente_advogado && (
                        <div className="text-xs text-slate-500">
                          adv. {p.cedente_advogado}
                        </div>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{p.cessionario || '—'}</TD>
                    <TD className="whitespace-nowrap">{p.entidade_devedora || '—'}</TD>
                    <TD className="whitespace-nowrap">
                      {p.instrumento ? <Badge tone={inst.tone}>{inst.label}</Badge> : '—'}
                      {p.instrumento === 'registro_publico' && p.numero_rtdpj && (
                        <div className="text-xs text-slate-500">
                          {splitRtdpj(p.numero_rtdpj).map((n, i) => (
                            <div key={i}>{n}</div>
                          ))}
                        </div>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-600">
                      {formatDate(p.data_aquisicao)}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-600">
                      {formatDate(p.expectativa_liquidacao)}
                    </TD>
                    <TD className="whitespace-nowrap">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {p.data_liquidacao && (
                        <div className="text-xs text-slate-500">
                          Liq. {formatDate(p.data_liquidacao)}
                        </div>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        {apensos.actions(p.id)}
                        <IconButton
                          label="Editar"
                          icon={<Pencil className="h-4 w-4" />}
                          onClick={() => abrirForm(p)}
                        />
                        <IconButton
                          label="Excluir"
                          variant="danger"
                          icon={<Trash2 className="h-4 w-4" />}
                          onClick={() => setToDelete(p)}
                        />
                      </div>
                    </TD>
                  </TR>
                  {apensos.detailRow(p.id, N_COLUNAS)}
                  </Fragment>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar crédito' : 'Novo crédito'}
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
            <Field label="Número do processo" required error={erros.numero_cnj}>
              <Input
                value={editing.numero_cnj ?? ''}
                onChange={(e) => {
                  setEditing({ ...editing, numero_cnj: e.target.value })
                  // Digitar no campo limpa o erro de validação dele.
                  if (erros.numero_cnj) setErros({})
                }}
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
              <Field
                label="Instrumento"
                // Avisa que o campo condicional oculto será descartado no salvamento.
                hint={
                  editing.instrumento !== 'registro_publico' &&
                  editing.numero_rtdpj?.trim()
                    ? 'Ao salvar sem "Registro público", o nº RTDPJ será descartado.'
                    : undefined
                }
              >
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
              {editing.instrumento === 'registro_publico' && (
                <Field label="Nº RTDPJ" hint="Opcional. Para mais de um, separe por vírgula.">
                  <Input
                    value={editing.numero_rtdpj ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, numero_rtdpj: e.target.value })
                    }
                    placeholder="Número do registro no RTDPJ"
                  />
                </Field>
              )}
              <Field
                label="Status"
                required
                // Avisa que o campo condicional oculto será descartado no salvamento.
                hint={
                  editing.status === 'ativo' && editing.data_liquidacao
                    ? 'Ao salvar como Ativo, a data de liquidação será descartada.'
                    : undefined
                }
              >
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
        message={`Excluir o crédito ${toDelete?.numero_cnj || ''}?`}
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />

      {apensos.modals()}
    </div>
  )
}
