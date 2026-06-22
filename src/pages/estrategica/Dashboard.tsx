import { useMemo } from 'react'
import {
  Wallet,
  Users,
  Layers,
  FileSignature,
  FolderKanban,
  ScanSearch,
  Newspaper,
  ListChecks,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import {
  analisesCrud,
  processosCrud,
  publicacoesCrud,
  tarefasCrud,
  investidoresCrud,
  cessoesCrud,
  investimentosCrud,
  contratosCrud,
} from '@/lib/queries'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { Loading } from '@/components/ui/Table'
import { useAuth } from '@/contexts/AuthContext'
import { STATUS_ANALISE, STATUS_PROCESSO, getLabel, PRIORIDADE_TAREFA } from '@/lib/labels'
import { formatBRL, formatDate } from '@/lib/format'

const CORES = ['#234e88', '#2f64ab', '#4d83c6', '#7ba7da', '#cda032', '#e3b84d']

export default function Dashboard() {
  const { profile, user } = useAuth()
  const analises = analisesCrud.useList()
  const processos = processosCrud.useList()
  const publicacoes = publicacoesCrud.useList()
  const tarefas = tarefasCrud.useList()
  const investidores = investidoresCrud.useList()
  const cessoes = cessoesCrud.useList()
  const investimentos = investimentosCrud.useList()
  const contratos = contratosCrud.useList()

  const loading =
    analises.isLoading ||
    processos.isLoading ||
    publicacoes.isLoading ||
    tarefas.isLoading ||
    investimentos.isLoading

  const kpis = useMemo(() => {
    const invsAtivos = (investimentos.data ?? []).filter((i) => i.status === 'ativo')
    const totalInvestido = invsAtivos.reduce((s, i) => s + (i.valor_investido || 0), 0)
    const investidoresAtivos = (investidores.data ?? []).filter(
      (i) => i.status === 'ativo',
    ).length
    const nCessoes = (cessoes.data ?? []).length
    const nContratos = (contratos.data ?? []).length

    const processosAtivos = (processos.data ?? []).filter(
      (p) => p.status === 'ativo',
    ).length
    const analisesAbertas = (analises.data ?? []).filter(
      (a) => a.status === 'pendente' || a.status === 'em_analise',
    ).length
    const pubPendentes = (publicacoes.data ?? []).filter((p) => !p.tratada).length
    const tarefasAbertas = (tarefas.data ?? []).filter(
      (t) => t.status !== 'concluida',
    ).length

    return {
      totalInvestido,
      investidoresAtivos,
      nCessoes,
      nContratos,
      processosAtivos,
      analisesAbertas,
      pubPendentes,
      tarefasAbertas,
    }
  }, [
    investimentos.data,
    investidores.data,
    cessoes.data,
    contratos.data,
    processos.data,
    analises.data,
    publicacoes.data,
    tarefas.data,
  ])

  const chartAnalises = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of analises.data ?? [])
      counts[a.status] = (counts[a.status] || 0) + 1
    return Object.entries(STATUS_ANALISE).map(([k, v]) => ({
      nome: v.label,
      total: counts[k] || 0,
    }))
  }, [analises.data])

  const chartProcessos = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of processos.data ?? [])
      counts[p.status] = (counts[p.status] || 0) + 1
    return Object.entries(STATUS_PROCESSO).map(([k, v]) => ({
      nome: v.label,
      total: counts[k] || 0,
    }))
  }, [processos.data])

  const proximasTarefas = useMemo(() => {
    return (tarefas.data ?? [])
      .filter((t) => t.status !== 'concluida' && t.prazo)
      .sort((a, b) => (a.prazo || '').localeCompare(b.prazo || ''))
      .slice(0, 6)
  }, [tarefas.data])

  if (loading) return <Loading label="Carregando indicadores…" />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Gestão Estratégica</h1>
        <p className="mt-1 text-sm text-slate-500">
          Olá, {profile?.nome || user?.email}. Visão consolidada dos setores
          Comercial e Operacional.
        </p>
      </div>

      {/* Comercial */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Comercial
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total investido (ativo)"
            value={formatBRL(kpis.totalInvestido)}
            icon={<Wallet className="h-5 w-5" />}
            tone="brand"
          />
          <StatCard
            label="Investidores ativos"
            value={kpis.investidoresAtivos}
            icon={<Users className="h-5 w-5" />}
            tone="green"
          />
          <StatCard
            label="Cessões na operação"
            value={kpis.nCessoes}
            icon={<Layers className="h-5 w-5" />}
            tone="amber"
          />
          <StatCard
            label="Contratos gerados"
            value={kpis.nContratos}
            icon={<FileSignature className="h-5 w-5" />}
            tone="slate"
          />
        </div>
      </div>

      {/* Operacional */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Operacional
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Processos ativos"
            value={kpis.processosAtivos}
            icon={<FolderKanban className="h-5 w-5" />}
            tone="brand"
          />
          <StatCard
            label="Análises em aberto"
            value={kpis.analisesAbertas}
            icon={<ScanSearch className="h-5 w-5" />}
            tone="amber"
          />
          <StatCard
            label="Publicações pendentes"
            value={kpis.pubPendentes}
            icon={<Newspaper className="h-5 w-5" />}
            tone="red"
          />
          <StatCard
            label="Tarefas em aberto"
            value={kpis.tarefasAbertas}
            icon={<ListChecks className="h-5 w-5" />}
            tone="green"
          />
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Análises de crédito por status" />
          <CardBody>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartAnalises}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {chartAnalises.map((_, i) => (
                      <Cell key={i} fill={CORES[i % CORES.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Processos por status" />
          <CardBody>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartProcessos}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {chartProcessos.map((_, i) => (
                      <Cell key={i} fill={CORES[i % CORES.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Próximas tarefas */}
      <Card>
        <CardHeader
          title="Próximas tarefas"
          description="Tarefas em aberto com prazo mais próximo."
        />
        <CardBody>
          {proximasTarefas.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              Nenhuma tarefa com prazo em aberto.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {proximasTarefas.map((t) => {
                const pr = getLabel(PRIORIDADE_TAREFA, t.prioridade)
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{t.titulo}</p>
                      <p className="text-xs text-slate-400">
                        {t.responsavel || 'Sem responsável'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={pr.tone}>{pr.label}</Badge>
                      <span className="whitespace-nowrap text-sm text-slate-500">
                        {formatDate(t.prazo)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
