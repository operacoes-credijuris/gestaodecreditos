import { useMemo, useState } from 'react'
import {
  Wallet,
  Users,
  Layers,
  TrendingUp,
  Percent,
  Target,
  CheckCircle2,
  Clock,
  Hash,
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
import {
  investidoresCrud,
  cessoesCrud,
  investimentosCrud,
  processosCrud,
} from '@/lib/queries'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { Combobox, type OpcaoCombo } from '@/components/ui/Combobox'
import { Tabs } from '@/components/ui/Tabs'
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
import { getLabel, STATUS_PROCESSO } from '@/lib/labels'
import { formatBRL, formatPercent, formatDate, formatCNJ } from '@/lib/format'
import { CHART } from '@/lib/chartColors'

const TABS = [
  { key: 'individual', label: 'Individual' },
  { key: 'consolidado', label: 'Consolidado' },
  { key: 'dados_pessoais', label: 'Dados pessoais' },
]

export default function CarteirasInvestidores() {
  const [tab, setTab] = useState('individual')

  return (
    <div>
      <PageHeader title="Carteiras de Investidores" />
      <div className="mb-5">
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === 'individual' && <Individual />}
      {tab === 'consolidado' && <Consolidado />}
      {tab === 'dados_pessoais' && <DadosPessoais />}
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
  const erro = investidores.isError || investimentos.isError || cessoes.isError

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

  // Sem este tratamento, erro em qualquer query aparecia como carteira "zerada".
  if (erro) {
    return (
      <Card>
        <ErrorState
          message={
            ((investidores.error ?? investimentos.error ?? cessoes.error) as Error)?.message
          }
          onRetry={() => {
            investidores.refetch()
            investimentos.refetch()
            cessoes.refetch()
          }}
        />
      </Card>
    )
  }

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
        <CardHeader title="Investido por investidor" />
        <CardBody>
          {stats.chart.length === 0 ? (
            <EmptyState
              title="Sem investimentos ainda"
              description="Registre o primeiro aporte."
            />
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.chart} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART.grid} />
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
                    labelStyle={{ color: CHART.ink }}
                  />
                  <Bar dataKey="valor" fill={CHART.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

// ----------------------- Individual -----------------------
// Carteira de UM investidor. Os investidores não têm cadastro próprio aqui:
// são os CESSIONÁRIOS distintos que aparecem nos Créditos — quem comprou o
// crédito é o investidor daquela operação.
//
// Os cinco cards financeiros ainda não têm de onde puxar número: o cadastro de
// Créditos não guarda valor de aquisição, valor projetado nem recebimentos.
// Exibir zero se leria como "não rendeu nada", então mostram travessão e dizem
// do que dependem. "Nº de operações" e a tabela já saem com dado real.
const AGUARDANDO = 'aguardando dados financeiros no cadastro de Créditos'

// Separador entre grupos de colunas da carteira.
const SEP = 'border-l border-slate-200'
// Célula cujo dado ainda não existe no cadastro — cinza claro para o olho
// distinguir "não temos esse campo" de "o campo está vazio neste crédito".
const VAZIO = 'text-slate-300'

// Normaliza para agrupar o mesmo investidor escrito de formas diferentes.
function normNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function Individual() {
  const processos = processosCrud.useList()

  // Cessionários distintos, em ordem alfabética.
  const investidores = useMemo(() => {
    const porChave = new Map<string, string>()
    for (const p of processos.data ?? []) {
      const nome = (p.cessionario ?? '').trim()
      if (!nome) continue
      const chave = normNome(nome)
      if (!porChave.has(chave)) porChave.set(chave, nome)
    }
    return [...porChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [processos.data])

  // Guarda o NOME, não o índice: a lista muda quando os créditos carregam, e
  // um índice guardado passaria a apontar para outro investidor.
  const [investidor, setInvestidor] = useState<string | null>(null)
  const indice = investidor ? investidores.indexOf(investidor) : -1

  const opcoes = useMemo<OpcaoCombo[]>(
    () => investidores.map((nome, i) => ({ id: i, titulo: nome })),
    [investidores],
  )

  // Mês de referência: sempre o corrente, sem opção de troca.
  const mesRef = useMemo(() => {
    const s = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return s.charAt(0).toUpperCase() + s.slice(1)
  }, [])

  const carteira = useMemo(() => {
    if (!investidor) return []
    const alvo = normNome(investidor)
    return (processos.data ?? [])
      .filter((p) => normNome(p.cessionario ?? '') === alvo)
      .sort((a, b) => (b.data_aquisicao || '').localeCompare(a.data_aquisicao || ''))
  }, [processos.data, investidor])

  if (processos.isLoading) return <Loading label="Carregando créditos…" />
  if (processos.isError) {
    return (
      <Card>
        <ErrorState
          message={(processos.error as Error)?.message}
          onRetry={() => processos.refetch()}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full sm:max-w-sm">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Investidor
            </label>
            <Combobox
              opcoes={opcoes}
              valor={indice >= 0 ? indice : null}
              onChange={(id) =>
                setInvestidor(id === null ? null : investidores[id] ?? null)
              }
              placeholder="Digite o nome…"
              vazio="Nenhum investidor nos créditos."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              Mês de referência
            </label>
            {/* Fixo no mês corrente: é a competência do relatório, não filtro. */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {mesRef}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Capital total"
          value="—"
          hint={AGUARDANDO}
          icon={<Wallet className="h-5 w-5" />}
          tone="brand"
        />
        <StatCard
          label="TIR média"
          value="—"
          hint={AGUARDANDO}
          icon={<Percent className="h-5 w-5" />}
          tone="green"
        />
        <StatCard
          label="Retorno projetado"
          value="—"
          hint={AGUARDANDO}
          icon={<Target className="h-5 w-5" />}
          tone="amber"
        />
        <StatCard
          label="Já recebido"
          value="—"
          hint={AGUARDANDO}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
        />
        <StatCard
          label="A receber estimado"
          value="—"
          hint={AGUARDANDO}
          icon={<Clock className="h-5 w-5" />}
          tone="slate"
        />
        <StatCard
          label="Nº de operações"
          value={investidor ? carteira.length : '—'}
          hint={investidor ? 'créditos deste investidor' : 'selecione um investidor'}
          icon={<Hash className="h-5 w-5" />}
          tone="brand"
        />
      </div>

      <Card>
        <CardHeader
          title={investidor ? `Carteira — ${investidor}` : 'Carteira do investidor'}
        />
        {!investidor ? (
          <EmptyState
            title="Selecione um investidor"
            description="Escolha acima para ver a carteira dele."
          />
        ) : carteira.length === 0 ? (
          <EmptyState
            title="Nenhum crédito"
            description="Este investidor não consta como cessionário em nenhum crédito."
          />
        ) : (
          <Table className="[&_th]:px-2.5 [&_td]:px-2.5 [&_td]:whitespace-nowrap [&_td]:text-[13px]">
            <THead>
              {/* Nível 1: os grupos. Nível 2: as colunas. A borda à esquerda
                  marca onde um grupo começa — com 25 colunas, sem isso o
                  cabeçalho vira uma fileira indistinta. */}
              <tr>
                <TH colSpan={5}>Identificação</TH>
                <TH colSpan={2} className={SEP}>
                  TIR obrigatório
                </TH>
                <TH colSpan={3} className={SEP}>
                  Crédito · fixo na abertura
                </TH>
                <TH colSpan={3} className={SEP}>
                  Recebimento principal
                </TH>
                <TH colSpan={1} className={SEP}>
                  Complementar
                </TH>
                <TH colSpan={4} className={SEP}>
                  Dados vivos · atualizar mensalmente
                </TH>
                <TH colSpan={7} className={SEP}>
                  Calculado automaticamente
                </TH>
              </tr>
              <tr className="border-t border-slate-200 text-[11px] font-medium normal-case tracking-normal text-slate-400">
                <TH>Nº processo</TH>
                <TH>Cedente</TH>
                <TH>Advogado</TH>
                <TH>Tipo de crédito</TH>
                <TH>Tribunal</TH>

                <TH className={SEP}>Capital investido</TH>
                <TH>Data da cessão</TH>

                <TH className={SEP}>Valor de face</TH>
                <TH>Data ref. do face</TH>
                <TH>Índice de atualização</TH>

                <TH className={SEP}>Data est. recebimento</TH>
                <TH>Já recebido</TH>
                <TH>Data receb. efetivo</TH>

                <TH className={SEP}>Valor est. complementar</TH>

                <TH className={SEP}>Status</TH>
                <TH>Estágio processual</TH>
                <TH>Providências / prox. passos</TH>
                <TH>Últ. atualização</TH>

                <TH className={SEP}>Valor projetado</TH>
                <TH>Status TIR</TH>
                <TH>TIR a.a.</TH>
                <TH>TIR mensal</TH>
                <TH>Dias em carteira</TH>
                <TH>Ganho projetado</TH>
                <TH>Retorno</TH>
              </tr>
            </THead>
            <TBody>
              {carteira.map((p) => {
                const st = getLabel(STATUS_PROCESSO, p.status)
                return (
                  <TR key={p.id}>
                    {/* Identificação */}
                    <TD className="font-medium text-slate-800">
                      {formatCNJ(p.numero_cnj)}
                    </TD>
                    <TD>{p.cedente || '—'}</TD>
                    <TD>{p.cedente_advogado || '—'}</TD>
                    <TD className={VAZIO}>—</TD>
                    <TD>{p.tribunal || '—'}</TD>

                    {/* TIR obrigatório */}
                    <TD className={cn(SEP, VAZIO)}>—</TD>
                    <TD className="tabular-nums text-slate-600">
                      {formatDate(p.data_aquisicao)}
                    </TD>

                    {/* Crédito · fixo na abertura */}
                    <TD className={cn(SEP, VAZIO)}>—</TD>
                    <TD className={VAZIO}>—</TD>
                    <TD className={VAZIO}>—</TD>

                    {/* Recebimento principal */}
                    <TD className={cn(SEP, 'tabular-nums text-slate-600')}>
                      {formatDate(p.expectativa_liquidacao)}
                    </TD>
                    <TD className={VAZIO}>—</TD>
                    <TD className="tabular-nums text-slate-600">
                      {formatDate(p.data_liquidacao)}
                    </TD>

                    {/* Complementar */}
                    <TD className={cn(SEP, VAZIO)}>—</TD>

                    {/* Dados vivos */}
                    <TD className={SEP}>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD className={VAZIO}>—</TD>
                    <TD className={VAZIO}>—</TD>
                    <TD className={VAZIO}>—</TD>

                    {/* Calculado automaticamente */}
                    <TD className={cn(SEP, VAZIO)}>—</TD>
                    <TD className={VAZIO}>—</TD>
                    <TD className={VAZIO}>—</TD>
                    <TD className={VAZIO}>—</TD>
                    <TD className={VAZIO}>—</TD>
                    <TD className={VAZIO}>—</TD>
                    <TD className={VAZIO}>—</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

// ----------------------- Dados pessoais -----------------------
function DadosPessoais() {
  return (
    <Card>
      <EmptyState
        title="Em construção"
        description="O conteúdo desta aba ainda será definido."
      />
    </Card>
  )
}

