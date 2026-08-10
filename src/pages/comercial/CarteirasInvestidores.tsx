import { useMemo, useState } from 'react'
import { Wallet, Percent, Target, CheckCircle2, Clock, Hash } from 'lucide-react'
import { processosCrud, useUltimaMovimentacao } from '@/lib/queries'
import {
  getLabel,
  INDICE_ATUALIZACAO,
  MESES_ALERTA_LIQUIDACAO,
  statusLiquidacao,
} from '@/lib/labels'
import { cn } from '@/lib/cn'
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
import {
  formatBRL,
  formatCNJ,
  formatDate,
  hojeISO,
  mesesDepois,
  onlyDigits,
  sentenceCase,
} from '@/lib/format'

const TABS = [
  { key: 'individual', label: 'Por investidor' },
  { key: 'consolidado', label: 'Consolidado' },
  { key: 'dados_pessoais', label: 'Dados pessoais' },
]

export default function CarteirasInvestidores() {
  const [tab, setTab] = useState('individual')

  return (
    <div>
      <PageHeader title="Carteiras de Investimentos" />
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

/**
 * "2026-08" -> "agosto de 2026". Minúsculo, que é a forma natural em pt-BR;
 * quem precisa de inicial maiúscula (opção de dropdown) aplica sentenceCase.
 */
function rotuloMes(iso: string): string {
  const [ano, mes] = iso.split('-').map(Number)
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Tipos do crédito em texto corrido, não como lista de selos: a carteira é um
 * relatório para ler, não uma tabela para escanear.
 *
 *   principal + contratuais  -> "crédito principal e honorários contratuais"
 *   os três                  -> "crédito principal, honorários contratuais e sucumbenciais"
 *   os dois honorários       -> "honorários contratuais e sucumbenciais"
 *
 * Quando os dois honorários aparecem, o segundo vira só "sucumbenciais" — a
 * palavra "honorários" já foi dita e repetir soa burocrático. Sozinho, ele
 * mantém o substantivo.
 */
function textoTipoCredito(tipos: string[] | null | undefined): string {
  const t = tipos ?? []
  if (t.length === 0) return '—'
  const temContratuais = t.includes('honorarios_contratuais')
  const partes: string[] = []
  if (t.includes('principal')) partes.push('crédito principal')
  if (temContratuais) partes.push('honorários contratuais')
  if (t.includes('honorarios_advocaticios')) {
    partes.push(temContratuais ? 'sucumbenciais' : 'honorários sucumbenciais')
  }
  if (partes.length === 0) return '—'
  if (partes.length === 1) return partes[0]
  // "A, B e C" — vírgula entre os primeiros, "e" antes do último.
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`
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

// Cor do TEXTO da coluna Status. Sem selo/pílula: o nome da cor escrito na
// própria cor já é a informação. Tons alinhados com o semáforo da Expectativa
// na aba Créditos, para a mesma cor significar a mesma coisa nas duas telas.
const COR_STATUS: Record<string, string> = {
  green: 'text-emerald-600',
  blue: 'text-blue-600',
  yellow: 'text-amber-600',
  red: 'text-red-600',
  gray: 'text-slate-400',
}

// nowrap também nos <th>: com 25 colunas, um título como "Providências /
// prox. passos" quebrava em quatro linhas e esticava o cabeçalho inteiro.
const CLASSES_CARTEIRA =
  '[&_th]:whitespace-nowrap [&_th]:px-2.5 [&_td]:whitespace-nowrap [&_td]:px-2.5 [&_td]:text-[13px]'

function Individual() {
  const processos = processosCrud.useList()
  // Última movimentação de cada crédito — mesmo cache do ADVBOX que alimenta a
  // ficha lateral do crédito e a tabela de Créditos.
  const ultimaMov = useUltimaMovimentacao()

  // Réguas do semáforo da coluna Status. Calculadas no render: na virada do dia
  // a cor anda sozinha, sem ninguém reabrir a tela.
  const hoje = useMemo(() => hojeISO(), [])
  const limiteAlerta = useMemo(
    () => mesesDepois(hoje, MESES_ALERTA_LIQUIDACAO),
    [hoje],
  )

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
  const mesRef = useMemo(() => rotuloMes(hoje), [hoje])

  const carteira = useMemo(() => {
    if (!investidor) return []
    const alvo = normNome(investidor)
    // Ordem: data da cessão, do mais ANTIGO para o mais novo — a carteira se lê
    // como a linha do tempo do investidor. Cessão sem data vai para o fim.
    return (processos.data ?? [])
      .filter((p) => normNome(p.cessionario ?? '') === alvo)
      .sort((a, b) => {
        const av = a.data_aquisicao || ''
        const bv = b.data_aquisicao || ''
        if (!av && !bv) return 0
        if (!av) return 1
        if (!bv) return -1
        return av.localeCompare(bv)
      })
  }, [processos.data, investidor])

  /**
   * Somas do que JÁ está cadastrado. `preenchidos` conta quantos créditos têm o
   * valor: sem isso, uma carteira com metade dos cadastros em branco mostraria
   * um total com cara de completo — numa tela financeira, isso é pior que "—".
   */
  const totais = useMemo(() => {
    const soma = (f: (p: (typeof carteira)[number]) => number | null | undefined) => {
      let t = 0
      let n = 0
      for (const p of carteira) {
        const v = f(p)
        if (typeof v === 'number' && !Number.isNaN(v)) {
          t += v
          n++
        }
      }
      return { total: n > 0 ? t : null, preenchidos: n }
    }
    return {
      capital: soma((p) => p.capital_investido),
      recebido: soma((p) => p.ja_recebido),
    }
  }, [carteira])

  // "3 de 7 créditos" quando falta cadastro; some quando está tudo lá.
  const cobertura = (n: number) =>
    carteira.length === 0
      ? AGUARDANDO
      : n === carteira.length
        ? 'soma dos créditos deste investidor'
        : `soma de ${n} de ${carteira.length} créditos — os demais sem valor cadastrado`

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
          <div className="inline-flex items-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            {mesRef}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Capital total"
          value={
            investidor && totais.capital.total !== null
              ? formatBRL(totais.capital.total)
              : '—'
          }
          hint={
            investidor ? cobertura(totais.capital.preenchidos) : 'selecione um investidor'
          }
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
          value={
            investidor && totais.recebido.total !== null
              ? formatBRL(totais.recebido.total)
              : '—'
          }
          hint={
            investidor
              ? cobertura(totais.recebido.preenchidos)
              : 'selecione um investidor'
          }
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
                {carteira.map((p) => {
                  const sl = statusLiquidacao(
                    p.data_liquidacao,
                    p.expectativa_liquidacao,
                    hoje,
                    limiteAlerta,
                  )
                  return (
                  <TR key={p.id}>
                    {/* Identificação — tudo vem do cadastro do crédito. */}
                    <TD className="font-medium text-slate-800">
                      {formatCNJ(p.numero_cnj)}
                    </TD>
                    <TD>{p.cedente || '—'}</TD>
                    <TD>{p.cedente_advogado || '—'}</TD>
                    {/* Numa linha só: a coluna se alarga conforme o texto (a
                        tabela já rola na horizontal) em vez de esticar a altura
                        da linha. Inicial maiúscula, resto minúsculo. */}
                    <TD>{sentenceCase(textoTipoCredito(p.tipo_credito))}</TD>
                    <TD>{p.tribunal || '—'}</TD>

                    {/* TIR obrigatório */}
                    <TD className={`${SEP} text-right tabular-nums`}>
                      {formatBRL(p.capital_investido)}
                    </TD>
                    <TD className="tabular-nums">{formatDate(p.data_aquisicao)}</TD>

                    {/* Crédito · fixo na abertura */}
                    <TD className={`${SEP} text-right tabular-nums`}>
                      {formatBRL(p.valor_face)}
                    </TD>
                    <TD className="tabular-nums">{formatDate(p.data_referencia)}</TD>
                    <TD>
                      {p.indice_atualizacao
                        ? getLabel(INDICE_ATUALIZACAO, p.indice_atualizacao).label
                        : '—'}
                    </TD>

                    {/* Recebimento principal */}
                    <TD className={`${SEP} tabular-nums`}>
                      {formatDate(p.expectativa_liquidacao)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatBRL(p.ja_recebido)}
                    </TD>
                    <TD className="tabular-nums">{formatDate(p.data_liquidacao)}</TD>

                    {/* Complementar */}
                    <TD className={`${SEP} text-right tabular-nums`}>
                      {formatBRL(p.valor_estimado_complementar)}
                    </TD>

                    {/* Dados vivos.
                        Status e Últ. atualização são CALCULADOS — ninguém
                        digita. Estágio processual e Providências seguem
                        pendentes de origem. */}
                    <TD className={SEP}>
                      {/* Só o nome da cor, escrito na cor. O title diz o que
                          cada cor significa — é o que sustenta a coluna para
                          quem não distingue os tons. */}
                      <span
                        title={sl.dica}
                        className={cn('font-medium', COR_STATUS[sl.tone] ?? 'text-slate-400')}
                      >
                        {sl.label}
                      </span>
                    </TD>
                    <TD />
                    <TD />
                    {/* Do cache do ADVBOX, casado por dígitos. Enquanto o mapa
                        carrega mostra vazio em vez de "—", que seria mentira. */}
                    <TD className="tabular-nums">
                      {ultimaMov.isLoading
                        ? ''
                        : formatDate(
                            ultimaMov.data?.get(onlyDigits(p.numero_cnj)) ?? null,
                          )}
                    </TD>

                    {/* Calculado automaticamente */}
                    <TD className={SEP} />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                    <TD />
                  </TR>
                  )
                })}
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
              {sentenceCase(rotuloMes(m))}
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
