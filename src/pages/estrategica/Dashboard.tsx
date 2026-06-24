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
import { useQuery } from '@tanstack/react-query'
import {
  analisesCrud,
  processosCrud,
  publicacoesCrud,
  investidoresCrud,
  cessoesCrud,
  investimentosCrud,
  contratosCrud,
} from '@/lib/queries'
import { invokeFunction } from '@/lib/functions'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { Loading } from '@/components/ui/Table'
import { useAuth } from '@/contexts/AuthContext'
import { STATUS_ANALISE } from '@/lib/labels'
import { formatBRL, formatDate } from '@/lib/format'

const CORES = ['#234e88', '#2f64ab', '#4d83c6', '#7ba7da', '#cda032', '#e3b84d']

// Tarefas vêm do ADVBOX (fonte única), via Edge Function advbox-tarefas.
interface TarefaAdvbox {
  id: number
  tipo: string | null
  processo: string
  date_deadline: string | null
  responsaveis: string[]
  important: boolean
  urgent: boolean
  concluida: boolean
}

export default function Dashboard() {
  const { profile, user } = useAuth()
  const analises = analisesCrud.useList()
  const processos = processosCrud.useList()
  const publicacoes = publicacoesCrud.useList()
  // Tarefas ao vivo do ADVBOX (não bloqueia o dashboard se demorar/falhar).
  const tarefas = useQuery({
    queryKey: ['advbox-tarefas'],
    queryFn: () =>
      invokeFunction<{ tarefas: TarefaAdvbox[] }>('advbox-tarefas', { action: 'list' }),
    staleTime: 0,
  })
  const tarefasLista = tarefas.data?.tarefas ?? []
  const investidores = investidoresCrud.useList()
  const cessoes = cessoesCrud.useList()
  const investimentos = investimentosCrud.useList()
  const contratos = contratosCrud.useList()

  const loading =
    analises.isLoading ||
    processos.isLoading ||
    publicacoes.isLoading ||
    investimentos.isLoading

  const kpis = useMemo(() => {
    const invsAtivos = (investimentos.data ?? []).filter((i) => i.status === 'ativo')
    const totalInvestido = invsAtivos.reduce((s, i) => s + (i.valor_investido || 0), 0)
    const investidoresAtivos = (investidores.data ?? []).filter(
      (i) => i.status === 'ativo',
    ).length
    const nCessoes = (cessoes.data ?? []).length
    const nContratos = (contratos.data ?? []).length

    const processosTotal = (processos.data ?? []).length
    const analisesAbertas = (analises.data ?? []).filter(
      (a) => a.status === 'pendente' || a.status === 'em_analise',
    ).length
    const pubPendentes = (publicacoes.data ?? []).filter((p) => !p.tratada).length
    const tarefasAbertas = tarefasLista.filter((t) => !t.concluida).length

    return {
      totalInvestido,
      investidoresAtivos,
      nCessoes,
      nContratos,
      processosTotal,
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
    for (const p of processos.data ?? []) {
      const t = p.tribunal?.trim() || 'Sem tribunal'
      counts[t] = (counts[t] || 0) + 1
    }
    return Object.entries(counts)
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
  }, [processos.data])

  const proximasTarefas = useMemo(() => {
    return tarefasLista
      .filter((t) => !t.concluida && t.date_deadline)
      .sort((a, b) => (a.date_deadline || '').localeCompare(b.date_deadline || ''))
      .slice(0, 6)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            label="Créditos cadastrados"
            value={kpis.processosTotal}
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
          <CardHeader title="Créditos por tribunal" />
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
              {proximasTarefas.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{t.tipo || '—'}</p>
                    <p className="text-xs text-slate-400">
                      {t.responsaveis?.length
                        ? t.responsaveis.join(', ')
                        : 'Sem responsável'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {t.urgent ? (
                      <Badge tone="red">Urgente</Badge>
                    ) : t.important ? (
                      <Badge tone="yellow">Importante</Badge>
                    ) : null}
                    <span className="whitespace-nowrap text-sm text-slate-500">
                      {formatDate(t.date_deadline)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
