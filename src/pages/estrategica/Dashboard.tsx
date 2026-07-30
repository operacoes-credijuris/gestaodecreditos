import { useMemo } from 'react'
import { Link } from 'react-router-dom'
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
  investidoresCrud,
  cessoesCrud,
  investimentosCrud,
  contratosCrud,
} from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { Loading } from '@/components/ui/Table'
import { STATUS_ANALISE } from '@/lib/labels'
import { CHART } from '@/lib/chartColors'
import { formatBRL, formatDate } from '@/lib/format'

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
  const analises = analisesCrud.useList()
  const processos = processosCrud.useList()
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

  // Publicações pendentes = as "Novas" da aba Publicações (DJEN, janela de
  // 30 dias, não tratadas) — mesma régua da tela, sem números órfãos.
  const ini30 = useMemo(
    () => new Date(Date.now() - 30 * 86400000).toLocaleDateString('sv-SE'),
    [],
  )
  const pubPendentes = useQuery({
    queryKey: ['djen_publicacoes_pendentes_count', ini30],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('djen_publicacoes')
        .select('*', { count: 'exact', head: true })
        .gte('data_disponibilizacao', ini30)
        .eq('tratada', false)
      if (error) throw new Error(error.message)
      return count ?? 0
    },
  })

  const loading =
    analises.isLoading ||
    processos.isLoading ||
    investimentos.isLoading ||
    investidores.isLoading ||
    cessoes.isLoading ||
    contratos.isLoading ||
    pubPendentes.isLoading

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
    const tarefasAbertas = tarefasLista.filter((t) => !t.concluida).length

    return {
      totalInvestido,
      investidoresAtivos,
      nCessoes,
      nContratos,
      processosTotal,
      analisesAbertas,
      tarefasAbertas,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    investimentos.data,
    investidores.data,
    cessoes.data,
    contratos.data,
    processos.data,
    analises.data,
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

  const hoje = useMemo(() => new Date().toLocaleDateString('sv-SE'), [])
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
      <PageHeader title="Gestão Estratégica" />

      {/* Comercial */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Comercial
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total investido (ativo)"
            value={formatBRL(kpis.totalInvestido)}
            hint="Soma dos investimentos com status ativo"
            icon={<Wallet className="h-5 w-5" />}
            tone="brand"
            to="/comercial/carteiras"
          />
          <StatCard
            label="Investidores ativos"
            value={kpis.investidoresAtivos}
            hint="Investidores com status ativo"
            icon={<Users className="h-5 w-5" />}
            tone="green"
            to="/comercial/carteiras"
          />
          <StatCard
            label="Cessões na operação"
            value={kpis.nCessoes}
            hint="Todas as cessões cadastradas"
            icon={<Layers className="h-5 w-5" />}
            tone="amber"
            to="/comercial/carteiras"
          />
          <StatCard
            label="Contratos gerados"
            value={kpis.nContratos}
            hint="Todos os contratos, em qualquer status"
            icon={<FileSignature className="h-5 w-5" />}
            tone="slate"
            to="/comercial/contratos"
          />
        </div>
      </div>

      {/* Operacional */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Operacional
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Créditos cadastrados"
            value={kpis.processosTotal}
            hint="Todos os status (ativos, complementares, encerrados)"
            icon={<FolderKanban className="h-5 w-5" />}
            tone="brand"
            to="/operacional/execucao/processos"
          />
          <StatCard
            label="Análises em aberto"
            value={kpis.analisesAbertas}
            hint="Status pendente ou em análise"
            icon={<ScanSearch className="h-5 w-5" />}
            tone="amber"
            to="/operacional/analise"
          />
          <StatCard
            label="Publicações pendentes"
            value={pubPendentes.data ?? 0}
            hint="DJEN: novas (não tratadas) nos últimos 30 dias"
            icon={<Newspaper className="h-5 w-5" />}
            tone="red"
            to="/operacional/execucao/publicacoes"
          />
          <StatCard
            label="Tarefas em aberto"
            value={kpis.tarefasAbertas}
            hint="Não concluídas no ADVBOX"
            icon={<ListChecks className="h-5 w-5" />}
            tone="green"
            to="/operacional/execucao/tarefas"
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
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={CHART.grid}
                  />
                  <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip labelStyle={{ color: CHART.ink }} />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {chartAnalises.map((_, i) => (
                      <Cell key={i} fill={CHART.series[i % CHART.series.length]} />
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
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={CHART.grid}
                  />
                  <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip labelStyle={{ color: CHART.ink }} />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {chartProcessos.map((_, i) => (
                      <Cell key={i} fill={CHART.series[i % CHART.series.length]} />
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
        <CardHeader title="Próximas tarefas" />
        <CardBody>
          {proximasTarefas.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Nenhuma tarefa com prazo em aberto.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {proximasTarefas.map((t) => {
                const vencida = (t.date_deadline || '').slice(0, 10) < hoje
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">
                        {t.tipo || '—'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t.responsaveis?.length
                          ? t.responsaveis.join(', ')
                          : 'Sem responsável'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {vencida ? (
                        <Badge tone="red">Vencida</Badge>
                      ) : t.urgent ? (
                        <Badge tone="red">Urgente</Badge>
                      ) : t.important ? (
                        <Badge tone="yellow">Importante</Badge>
                      ) : null}
                      <span
                        className={
                          vencida
                            ? 'whitespace-nowrap text-sm font-semibold text-red-600'
                            : 'whitespace-nowrap text-sm text-slate-500'
                        }
                      >
                        {formatDate(t.date_deadline)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mt-3 border-t border-slate-100 pt-3">
            <Link
              to="/operacional/execucao/tarefas"
              className="text-sm font-medium text-brand-600 hover:underline"
            >
              Ver todas as tarefas →
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
