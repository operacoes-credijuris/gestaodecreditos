import { useMemo, useState, type FormEvent } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Wallet,
  Users,
  Layers,
  TrendingUp,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { investidoresCrud, cessoesCrud, investimentosCrud } from '@/lib/queries'
import type { Investimento, StatusInvestimento } from '@/lib/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Tabs } from '@/components/ui/Tabs'
import {
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  Loading,
  EmptyState,
} from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { getLabel, STATUS_INVESTIMENTO } from '@/lib/labels'
import { formatBRL, formatPercent, formatDate } from '@/lib/format'
import { InvestidoresPanel } from './InvestidoresPanel'
import { CessoesPanel } from './CessoesPanel'

const TABS = [
  { key: 'consolidado', label: 'Consolidado' },
  { key: 'individual', label: 'Por Investidor' },
  { key: 'investidores', label: 'Investidores' },
  { key: 'cessoes', label: 'Cessões' },
]

export default function CarteirasInvestidores() {
  const [tab, setTab] = useState('consolidado')

  return (
    <div>
      <PageHeader
        title="Carteiras de Investidores"
        description="Carteira individual de cada investidor e visão consolidada da operação."
      />
      <div className="mb-5">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'consolidado' && <Consolidado />}
      {tab === 'individual' && <PorInvestidor />}
      {tab === 'investidores' && <InvestidoresPanel />}
      {tab === 'cessoes' && <CessoesPanel />}
    </div>
  )
}

// ----------------------- Consolidado -----------------------
function Consolidado() {
  const investidores = investidoresCrud.useList()
  const investimentos = investimentosCrud.useList()
  const cessoes = cessoesCrud.useList()

  const loading =
    investidores.isLoading || investimentos.isLoading || cessoes.isLoading

  const stats = useMemo(() => {
    const invs = investimentos.data ?? []
    const ativos = invs.filter((i) => i.status === 'ativo')
    const totalInvestido = ativos.reduce((s, i) => s + (i.valor_investido || 0), 0)
    const totalCessoes = (cessoes.data ?? []).reduce(
      (s, c) => s + (c.valor_cessao || 0),
      0,
    )
    const investidoresAtivos = new Set(ativos.map((i) => i.investidor_id)).size
    const rentMedia =
      totalInvestido > 0
        ? ativos.reduce(
            (s, i) => s + (i.rentabilidade_esperada || 0) * (i.valor_investido || 0),
            0,
          ) / totalInvestido
        : 0

    // Investido por investidor (top 8)
    const porInvestidor = new Map<string, number>()
    for (const i of ativos) {
      porInvestidor.set(
        i.investidor_id,
        (porInvestidor.get(i.investidor_id) || 0) + (i.valor_investido || 0),
      )
    }
    const nomeDe = (id: string) =>
      (investidores.data ?? []).find((x) => x.id === id)?.nome ?? '—'
    const chart = [...porInvestidor.entries()]
      .map(([id, valor]) => ({ nome: nomeDe(id), valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8)

    return {
      totalInvestido,
      totalCessoes,
      investidoresAtivos,
      rentMedia,
      nCessoes: (cessoes.data ?? []).length,
      chart,
    }
  }, [investimentos.data, cessoes.data, investidores.data])

  if (loading) return <Loading />

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total investido (ativo)"
          value={formatBRL(stats.totalInvestido)}
          icon={<Wallet className="h-5 w-5" />}
          tone="brand"
        />
        <StatCard
          label="Investidores ativos"
          value={stats.investidoresAtivos}
          icon={<Users className="h-5 w-5" />}
          tone="green"
        />
        <StatCard
          label="Cessões na operação"
          value={stats.nCessoes}
          hint={formatBRL(stats.totalCessoes)}
          icon={<Layers className="h-5 w-5" />}
          tone="amber"
        />
        <StatCard
          label="Rentabilidade média esperada"
          value={formatPercent(stats.rentMedia)}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="slate"
        />
      </div>

      <Card>
        <CardHeader
          title="Investido por investidor"
          description="Maiores posições ativas da carteira consolidada."
        />
        <CardBody>
          {stats.chart.length === 0 ? (
            <EmptyState
              title="Sem investimentos ainda"
              description="Cadastre investidores, cessões e registre os aportes."
            />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.chart} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="nome"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `R$${(v / 1000).toLocaleString('pt-BR')}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => formatBRL(v)}
                    labelStyle={{ color: '#0f223d' }}
                  />
                  <Bar dataKey="valor" fill="#234e88" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

// ----------------------- Por Investidor -----------------------
const INV_VAZIO: Partial<Investimento> = {
  investidor_id: '',
  cessao_id: null,
  valor_investido: 0,
  percentual: null,
  rentabilidade_esperada: null,
  data_investimento: '',
  status: 'ativo',
}

function PorInvestidor() {
  const investidores = investidoresCrud.useList()
  const cessoes = cessoesCrud.useList()
  const { useList, useCreate, useUpdate, useRemove } = investimentosCrud
  const investimentos = useList()
  const create = useCreate()
  const update = useUpdate()
  const remove = useRemove()
  const toast = useToast()

  const [selecionado, setSelecionado] = useState('')
  const [editing, setEditing] = useState<Partial<Investimento> | null>(null)
  const [toDelete, setToDelete] = useState<Investimento | null>(null)

  const codigoCessao = (id: string | null) =>
    id ? (cessoes.data ?? []).find((c) => c.id === id)?.codigo ?? '—' : '—'

  const daCarteira = useMemo(
    () => (investimentos.data ?? []).filter((i) => i.investidor_id === selecionado),
    [investimentos.data, selecionado],
  )

  const totais = useMemo(() => {
    const ativos = daCarteira.filter((i) => i.status === 'ativo')
    const total = ativos.reduce((s, i) => s + (i.valor_investido || 0), 0)
    const rent =
      total > 0
        ? ativos.reduce(
            (s, i) => s + (i.rentabilidade_esperada || 0) * (i.valor_investido || 0),
            0,
          ) / total
        : 0
    return { total, rent, posicoes: daCarteira.length }
  }, [daCarteira])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.investidor_id) {
      toast.error('Selecione o investidor.')
      return
    }
    try {
      const { id, created_at, updated_at, ...payload } = editing as Investimento
      if (!payload.cessao_id) payload.cessao_id = null
      payload.valor_investido = Number(payload.valor_investido || 0)
      if (id) {
        await update.mutateAsync({ id, changes: payload })
        toast.success('Investimento atualizado.')
      } else {
        await create.mutateAsync(payload)
        toast.success('Investimento registrado.')
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
      toast.success('Investimento excluído.')
      setToDelete(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Field label="Investidor" className="w-full sm:max-w-sm">
            <Select
              value={selecionado}
              onChange={(e) => setSelecionado(e.target.value)}
            >
              <option value="">Selecione um investidor…</option>
              {(investidores.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nome}
                </option>
              ))}
            </Select>
          </Field>
          {selecionado && (
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() =>
                setEditing({ ...INV_VAZIO, investidor_id: selecionado })
              }
            >
              Novo investimento
            </Button>
          )}
        </div>
      </Card>

      {!selecionado ? (
        <Card>
          <EmptyState
            title="Selecione um investidor"
            description="Escolha um investidor para ver a carteira individual."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Total investido (ativo)"
              value={formatBRL(totais.total)}
              icon={<Wallet className="h-5 w-5" />}
            />
            <StatCard
              label="Posições"
              value={totais.posicoes}
              icon={<Layers className="h-5 w-5" />}
              tone="amber"
            />
            <StatCard
              label="Rentabilidade média esperada"
              value={formatPercent(totais.rent)}
              icon={<TrendingUp className="h-5 w-5" />}
              tone="green"
            />
          </div>

          <Card>
            {investimentos.isLoading ? (
              <Loading />
            ) : daCarteira.length === 0 ? (
              <EmptyState
                title="Carteira vazia"
                description="Registre o primeiro investimento deste investidor."
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Cessão</TH>
                    <TH>Valor investido</TH>
                    <TH>Participação</TH>
                    <TH>Rentab. esperada</TH>
                    <TH>Data</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Ações</TH>
                  </tr>
                </THead>
                <TBody>
                  {daCarteira.map((i) => {
                    const st = getLabel(STATUS_INVESTIMENTO, i.status)
                    return (
                      <TR key={i.id}>
                        <TD className="font-medium text-slate-800">
                          {codigoCessao(i.cessao_id)}
                        </TD>
                        <TD>{formatBRL(i.valor_investido)}</TD>
                        <TD>{formatPercent(i.percentual)}</TD>
                        <TD>{formatPercent(i.rentabilidade_esperada)}</TD>
                        <TD className="whitespace-nowrap">
                          {formatDate(i.data_investimento)}
                        </TD>
                        <TD>
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => setEditing(i)}
                              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"
                              title="Editar"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setToDelete(i)}
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
        </>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar investimento' : 'Novo investimento'}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="form-investimento"
              loading={create.isPending || update.isPending}
            >
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <form id="form-investimento" onSubmit={handleSubmit} className="space-y-4">
            <Field label="Investidor" required>
              <Select
                value={editing.investidor_id ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, investidor_id: e.target.value })
                }
              >
                <option value="">Selecione…</option>
                {(investidores.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cessão (crédito)">
              <Select
                value={editing.cessao_id ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, cessao_id: e.target.value || null })
                }
              >
                <option value="">— Não vinculado —</option>
                {(cessoes.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Valor investido (R$)" required>
                <Input
                  type="number"
                  step="0.01"
                  value={editing.valor_investido ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      valor_investido: e.target.value ? Number(e.target.value) : 0,
                    })
                  }
                />
              </Field>
              <Field label="Participação (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={editing.percentual ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      percentual: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </Field>
              <Field label="Rentabilidade esperada (%)">
                <Input
                  type="number"
                  step="0.01"
                  value={editing.rentabilidade_esperada ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      rentabilidade_esperada: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </Field>
              <Field label="Data do investimento">
                <Input
                  type="date"
                  value={editing.data_investimento ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, data_investimento: e.target.value })
                  }
                />
              </Field>
              <Field label="Status" required>
                <Select
                  value={editing.status ?? 'ativo'}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      status: e.target.value as StatusInvestimento,
                    })
                  }
                >
                  {Object.entries(STATUS_INVESTIMENTO).map(([k, v]) => (
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
        message="Excluir este investimento?"
        confirmLabel="Excluir"
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </div>
  )
}
