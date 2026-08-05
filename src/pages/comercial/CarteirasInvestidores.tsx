import { useMemo, useState } from 'react'
import {
  Wallet,
  Percent,
  Target,
  CheckCircle2,
  Clock,
  Hash,
  CalendarDays,
} from 'lucide-react'
import { processosCrud } from '@/lib/queries'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Combobox, type OpcaoCombo } from '@/components/ui/Combobox'
import { Select } from '@/components/ui/Field'
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
import { formatCNJ } from '@/lib/format'

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

// ---------- Helpers comuns ----------

// Normaliza para agrupar o mesmo investidor escrito de formas diferentes.
function normNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** "2026-08" -> "Agosto de 2026". */
function rotuloMes(iso: string): string {
  const [ano, mes] = iso.split('-').map(Number)
  const s = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Rótulo de seção fora do card, como abertura da tabela. */
function TituloSecao({ children }: { children: string }) {
  return (
    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h3>
  )
}

// ----------------------- Individual -----------------------
// Carteira de UM investidor. Os investidores não têm cadastro próprio: são os
// CESSIONÁRIOS distintos que aparecem nos Créditos.
//
// Fora o nº do processo, as colunas nascem vazias de propósito. O cadastro de
// Créditos não guarda capital, valor de face nem recebimentos, e preencher por
// semelhança de nome produziria número errado com cara de certo numa tabela
// financeira. Cada coluna será ligada de propósito nas próximas edições.
const AGUARDANDO = 'aguardando dados financeiros no cadastro de Créditos'

// Separador entre grupos de colunas.
const SEP = 'border-l border-slate-200'

// Cor do TÍTULO de cada grupo. Tons escolhidos para contrastar com o fundo
// claro do cabeçalho — amarelo e azul-claro puros ficariam ilegíveis.
const COR_GRUPO = {
  identificacao: 'text-sky-500',
  tir: 'text-amber-600',
  credito: 'text-emerald-600',
  recebimento: 'text-red-600',
  complementar: 'text-orange-600',
  vivos: 'text-blue-800',
  calculado: 'text-violet-500',
}

// Caixa alta desligada nos títulos dos grupos (o <thead> aplica uppercase).
const GRUPO = 'text-[13px] font-bold normal-case tracking-normal'

// nowrap também nos <th>: com 25 colunas, um título como "Providências /
// prox. passos" quebrava em quatro linhas e esticava o cabeçalho inteiro.
const CLASSES_CARTEIRA =
  '[&_th]:whitespace-nowrap [&_th]:px-2.5 [&_td]:whitespace-nowrap [&_td]:px-2.5 [&_td]:text-[13px]'

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
  const mesRef = useMemo(() => rotuloMes(new Date().toLocaleDateString('sv-SE')), [])

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
      {/* Sem card: os dois controles ficam soltos sobre o fundo da página,
          lado a lado. A competência acompanha o seletor em vez de ir para a
          borda oposta — separá-los só afastava dois campos que se leem juntos. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-md">
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
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Mês de referência
          </div>
          {/* Fixo no mês corrente: é a competência do relatório, não filtro. */}
          <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            <CalendarDays className="h-4 w-4 text-slate-400" />
            {mesRef}
          </div>
        </div>
      </div>

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

      <div>
        <TituloSecao>Carteira</TituloSecao>
        <Card>
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
            <Table className={CLASSES_CARTEIRA}>
              <THead>
                {/* Nível 1: grupos, cada um na sua cor. Nível 2: as colunas. */}
                <tr>
                  <TH colSpan={5} className={`${GRUPO} ${COR_GRUPO.identificacao}`}>
                    Identificação · fixo na abertura
                  </TH>
                  <TH colSpan={2} className={`${SEP} ${GRUPO} ${COR_GRUPO.tir}`}>
                    TIR obrigatório
                  </TH>
                  <TH colSpan={3} className={`${SEP} ${GRUPO} ${COR_GRUPO.credito}`}>
                    Crédito · fixo na abertura
                  </TH>
                  <TH colSpan={3} className={`${SEP} ${GRUPO} ${COR_GRUPO.recebimento}`}>
                    Recebimento principal
                  </TH>
                  <TH colSpan={1} className={`${SEP} ${GRUPO} ${COR_GRUPO.complementar}`}>
                    Complementar
                  </TH>
                  <TH colSpan={4} className={`${SEP} ${GRUPO} ${COR_GRUPO.vivos}`}>
                    Dados vivos · atualizar mensalmente
                  </TH>
                  <TH colSpan={7} className={`${SEP} ${GRUPO} ${COR_GRUPO.calculado}`}>
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
                {carteira.map((p) => (
                  <TR key={p.id}>
                    {/* Identificação */}
                    <TD className="font-medium text-slate-800">
                      {formatCNJ(p.numero_cnj)}
                    </TD>
                    <TD />
                    <TD />
                    <TD />
                    <TD />

                    {/* TIR obrigatório */}
                    <TD className={SEP} />
                    <TD />

                    {/* Crédito · fixo na abertura */}
                    <TD className={SEP} />
                    <TD />
                    <TD />

                    {/* Recebimento principal */}
                    <TD className={SEP} />
                    <TD />
                    <TD />

                    {/* Complementar */}
                    <TD className={SEP} />

                    {/* Dados vivos */}
                    <TD className={SEP} />
                    <TD />
                    <TD />
                    <TD />

                    {/* Calculado automaticamente */}
                    <TD className={SEP} />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  )
}

// ----------------------- Consolidado -----------------------
// Panorama por mês: um investidor por linha, com o fechamento do período.
// O recorte é pela DATA DE AQUISIÇÃO do crédito — "os processos fechados
// naquele mês". Só investidor e quantidade de operações saem preenchidos; os
// valores financeiros dependem de campos que o cadastro ainda não tem.
function Consolidado() {
  const processos = processosCrud.useList()
  const [mes, setMes] = useState('todos')

  // Meses presentes nos créditos, do mais recente ao mais antigo.
  const meses = useMemo(() => {
    const set = new Set<string>()
    for (const p of processos.data ?? []) {
      const ym = (p.data_aquisicao ?? '').slice(0, 7)
      if (ym.length === 7) set.add(ym)
    }
    return [...set].sort().reverse()
  }, [processos.data])

  const linhas = useMemo(() => {
    const noPeriodo = (processos.data ?? []).filter((p) =>
      mes === 'todos' ? true : (p.data_aquisicao ?? '').slice(0, 7) === mes,
    )
    const porInvestidor = new Map<string, { nome: string; operacoes: number }>()
    for (const p of noPeriodo) {
      const nome = (p.cessionario ?? '').trim()
      if (!nome) continue
      const chave = normNome(nome)
      const atual = porInvestidor.get(chave)
      if (atual) atual.operacoes += 1
      else porInvestidor.set(chave, { nome, operacoes: 1 })
    }
    return [...porInvestidor.values()].sort((a, b) =>
      a.nome.localeCompare(b.nome, 'pt-BR'),
    )
  }, [processos.data, mes])

  const totalOperacoes = linhas.reduce((s, l) => s + l.operacoes, 0)

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
      {/* Solto sobre o fundo da página, como o seletor da aba Individual. */}
      <div className="w-full sm:max-w-xs">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Filtrar por mês
        </label>
        <Select value={mes} onChange={(e) => setMes(e.target.value)}>
          <option value="todos">Tudo</option>
          {meses.map((m) => (
            <option key={m} value={m}>
              {rotuloMes(m)}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Card>
          {linhas.length === 0 ? (
            <EmptyState
              title="Nenhum crédito no período"
              description="Não há créditos adquiridos no mês selecionado."
            />
          ) : (
            <Table className="[&_th]:whitespace-nowrap [&_th]:px-3 [&_td]:px-3 [&_td]:text-[13px]">
              <THead>
                <tr>
                  <TH>Investidor</TH>
                  <TH className="text-right">Capital investido (R$)</TH>
                  <TH className="text-right">A receber (R$)</TH>
                  <TH className="text-right">Já recebido (R$)</TH>
                  <TH className="text-right">Retorno (%)</TH>
                  <TH className="text-right">TIR a.a.</TH>
                  <TH className="text-right">Qtde. operações</TH>
                </tr>
              </THead>
              <TBody>
                {linhas.map((l) => (
                  <TR key={l.nome}>
                    <TD className="font-medium text-slate-800">{l.nome}</TD>
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD className="text-right tabular-nums text-slate-700">
                      {l.operacoes}
                    </TD>
                  </TR>
                ))}
                {/* Fechamento da carteira no período.
                    REGRA DEFINIDA (ago/2026): Capital investido, A receber e
                    Já recebido são SOMA. Retorno (%) e TIR a.a. são MÉDIA
                    PONDERADA PELO CAPITAL INVESTIDO — somar percentual não
                    produz número com significado (12% + 15% não é 27% de
                    carteira), e a média simples daria a um aporte de R$ 10 mil
                    o mesmo peso de um de R$ 500 mil. */}
                <TR className="bg-slate-50 font-semibold">
                  <TD className="text-slate-800">Total da carteira</TD>
                  <TD />
                  <TD />
                  <TD />
                  <TD />
                  <TD />
                  <TD className="text-right tabular-nums text-slate-800">
                    {totalOperacoes}
                  </TD>
                </TR>
              </TBody>
            </Table>
          )}
        </Card>
      </div>
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
