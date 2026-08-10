import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Wallet,
  Percent,
  Target,
  CheckCircle2,
  Clock,
  Hash,
  Sparkles,
  RefreshCw,
  Download,
  SlidersHorizontal,
  Pencil,
} from 'lucide-react'
import {
  processosCrud,
  useCarteiraResumos,
  useInvestidorDados,
  useParametrosAtualizacao,
  useSalvarInvestidorDados,
  useUltimaMovimentacao,
} from '@/lib/queries'
import type { Processo } from '@/lib/types'
import {
  aReceberEstimado,
  ganhoProjetado,
  retorno,
  retornoProjetadoCarteira,
  tir,
  tirAgregada,
  valorProjetado,
} from '@/lib/projecao'
import { invokeFunction } from '@/lib/functions'
import { exportarCarteiraXlsx } from '@/lib/exportarCarteira'
import { ModalParametrosAtualizacao } from '@/components/ParametrosAtualizacao'
import {
  diasEmCarteira,
  getLabel,
  INDICE_ATUALIZACAO,
  MESES_ALERTA_LIQUIDACAO,
  statusLiquidacao,
  statusTir,
  textosResumo,
} from '@/lib/labels'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Combobox, type OpcaoCombo } from '@/components/ui/Combobox'
import { Field, Input, Select } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
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
  formatDateTime,
  formatPercent,
  hojeISO,
  mesesDepois,
  normalizarNome,
  onlyDigits,
  sentenceCase,
} from '@/lib/format'

// As `key` são internas e não mudam com o rótulo: elas aparecem em estado e em
// comparações pelo arquivo, e renomeá-las não traria nada.
const TABS = [
  { key: 'individual', label: 'Relatórios individuais' },
  { key: 'consolidado', label: 'Visão global' },
  { key: 'dados_pessoais', label: 'Dados dos investidores' },
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

// Agrupa o mesmo investidor escrito de formas diferentes. Vem de lib/format
// porque virou CHAVE de public.investidor_dados: duas versões da normalização
// órfanariam os dados gravados.
const normNome = normalizarNome

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

/**
 * Altura dos botões da barra do investidor.
 *
 * As alturas do Button são em rem (h-10) e o html está em 12px, então h-10 vale
 * 30px. O Input (baseControl em ui/Field) e a caixa do mês usam `px-3 py-2` com
 * text-sm, fechando 33px (6 + 19 de line-height + 6 + 2 de borda). Os dois
 * nunca casam por coincidência, e o botão ficava 3px mais baixo.
 *
 * Solução: soltar a altura fixa e repetir aqui o `py-2` do Input. Reproduzir a
 * receita, em vez de fixar 33px na mão, mantém os três alinhados se os tokens
 * de tipografia mudarem.
 */
const ALTURA_CONTROLE = 'h-auto py-2'

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

/**
 * Célula de Estágio processual / Providências: mostra só o começo do texto,
 * cortado com "…", e abre o texto inteiro numa caixa ao clicar.
 *
 * ESTA É A ÚNICA EXCEÇÃO ao "sem truncamento" das tabelas do app, e é
 * deliberada: são 6 linhas de narrativa numa tabela de 25 colunas. Aqui a
 * célula serve para VER QUE A COLUNA FOI PREENCHIDA; quem quer ler, clica.
 */
function CelulaResumo({
  texto,
  erro,
  carregando,
  onClick,
}: {
  texto: string | null | undefined
  erro: string | null | undefined
  carregando: boolean
  onClick: () => void
}) {
  if (carregando) return <span className="text-slate-300">…</span>
  if (!texto) {
    return (
      <span
        className="text-slate-300"
        title={erro || 'Resumo ainda não gerado para este crédito.'}
      >
        —
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title="Ver o texto completo"
      className="block max-w-[220px] truncate text-left text-slate-700 underline decoration-slate-300 decoration-dotted underline-offset-4 hover:decoration-slate-500"
    >
      {texto}
    </button>
  )
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

  const toast = useToast()
  const qc = useQueryClient()
  // SELIC/IPCA da projeção e a janela que os edita.
  const parametros = useParametrosAtualizacao()
  const [abrirParametros, setAbrirParametros] = useState(false)
  // Enquanto a varredura de todos os créditos corre no servidor, a tela fica
  // perguntando pelos textos que vão chegando.
  const [varrendo, setVarrendo] = useState(false)
  const resumos = useCarteiraResumos(varrendo)
  // Texto aberto na caixa: guarda o id e o campo, não o texto — assim, ao
  // gerar novamente, a caixa mostra o texto novo sem fechar.
  const [aberto, setAberto] = useState<{
    id: string
    cnj: string | null
    status: string | null
    campo: 'estagio' | 'providencias'
  } | null>(null)

  const gerar = useMutation({
    mutationFn: (vars: { processo_id?: string; forcar?: boolean }) =>
      invokeFunction<{ gerados: number; pulados: number; falhas: number; restantes: number }>(
        'carteira-resumo',
        vars,
      ),
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ['carteira_resumos'] })
      if (vars.processo_id) {
        if (r.falhas > 0) toast.error('Não foi possível gerar o resumo deste crédito.')
        else toast.success('Resumo gerado.')
        return
      }
      // Varredura: a resposta volta antes do fim (o servidor segue em lotes).
      if (r.restantes > 0) {
        setVarrendo(true)
        toast.success('Gerando os resumos — os textos vão aparecendo aqui.')
        // Teto do acompanhamento: 95 créditos levam poucos minutos.
        window.setTimeout(() => setVarrendo(false), 6 * 60 * 1000)
      } else {
        toast.success(
          r.gerados > 0
            ? `${r.gerados} resumo(s) gerado(s).`
            : 'Nenhum crédito teve novidade desde a última geração.',
        )
      }
    },
    onError: (e) => toast.error((e as Error).message),
  })

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

  /**
   * Cards que dependem da projeção. Ficam num memo próprio porque recalculam
   * quando os parâmetros mudam, e não só quando a carteira muda.
   */
  const derivados = useMemo(() => {
    const itens = carteira.map((p) => {
      const proj = valorProjetado(p, parametros.data, hoje)
      return { p, proj, t: tir(p.capital_investido, p.data_aquisicao, proj) }
    })
    const media = tirAgregada(
      itens.map(({ p, proj, t }) => ({
        capital: p.capital_investido,
        valor: proj.valor,
        dias: t.dias,
      })),
    )
    const aReceber = aReceberEstimado(
      itens.map(({ p, proj }) => ({
        proj,
        dataLiquidacao: p.data_liquidacao,
        valorComplementar: p.valor_estimado_complementar,
      })),
    )
    const retornoCarteira = retornoProjetadoCarteira(
      itens.map(({ p, proj }) => ({
        ganho: ganhoProjetado(proj, p.capital_investido, p.valor_estimado_complementar),
        capital: p.capital_investido,
      })),
    )
    return { tirMedia: media, aReceber, retorno: retornoCarteira }
  }, [carteira, parametros.data, hoje])

  // "3 de 7 créditos" quando falta cadastro; some quando está tudo lá.
  const cobertura = (n: number) =>
    carteira.length === 0
      ? AGUARDANDO
      : n === carteira.length
        ? 'soma dos créditos deste investidor'
        : `soma de ${n} de ${carteira.length} créditos — os demais sem valor cadastrado`

  // Download do xlsx com o conteúdo da tela. O ExcelJS entra por import
  // dinâmico dentro de exportarCarteiraXlsx: quem clica é que paga o pacote.
  // Declarado antes do primeiro return condicional, senão o hook desapareceria
  // do render enquanto a lista estivesse carregando.
  const [baixando, setBaixando] = useState(false)
  async function baixarXlsx() {
    if (!investidor) return
    setBaixando(true)
    try {
      await exportarCarteiraXlsx({
        investidor,
        mesRef,
        carteira,
        resumos: resumos.data,
        ultimaMov: ultimaMov.data,
        capitalTotal: totais.capital.total,
        jaRecebidoTotal: totais.recebido.total,
        parametros: parametros.data,
      })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBaixando(false)
    }
  }

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
        {/* sm:ml-auto joga o trio de ações para a direita da mesma linha. */}
        <div className="flex gap-2 sm:ml-auto">
          {/* SELIC e IPCA que alimentam a coluna Valor projetado. */}
          <Button
            variant="outline"
            className={ALTURA_CONTROLE}
            icon={<SlidersHorizontal className="h-4 w-4" />}
            onClick={() => setAbrirParametros(true)}
          >
            Parâmetros de atualização
          </Button>
          {/* Regera o estágio e as providências de TODOS os créditos, ignorando
              a checagem de novidade que a rodada semanal faz. */}
          <Button
            variant="outline"
            className={ALTURA_CONTROLE}
            icon={<Sparkles className="h-4 w-4" />}
            loading={gerar.isPending && !gerar.variables?.processo_id}
            onClick={() => gerar.mutate({ forcar: true })}
          >
            Gerar resumos
          </Button>
          {/* Verde do Excel: distingue do botão vizinho sem virar ação
              primária, que continua sendo gerar os resumos. */}
          <Button
            variant="outline"
            className={cn(
              ALTURA_CONTROLE,
              'border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800',
            )}
            icon={<Download className="h-4 w-4" />}
            loading={baixando}
            disabled={!investidor || carteira.length === 0}
            onClick={baixarXlsx}
          >
            Baixar Excel
          </Button>
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
          value={
            investidor && derivados.tirMedia.valor !== null
              ? formatPercent(derivados.tirMedia.valor)
              : '—'
          }
          hint={
            !investidor
              ? 'selecione um investidor'
              : derivados.tirMedia.valor === null
                ? 'nenhum crédito com TIR calculável'
                : `carteira como fluxo único, prazo médio de ${derivados.tirMedia.prazoMedioDias} dias, ${derivados.tirMedia.considerados} de ${carteira.length} créditos`
          }
          icon={<Percent className="h-5 w-5" />}
          tone="green"
        />
        <StatCard
          label="Retorno projetado"
          value={
            investidor && derivados.retorno.valor !== null
              ? formatPercent(derivados.retorno.valor)
              : '—'
          }
          hint={
            !investidor
              ? 'selecione um investidor'
              : derivados.retorno.valor === null
                ? 'nenhum crédito com ganho calculável'
                : `soma dos ganhos sobre a soma do capital, de ${derivados.retorno.considerados} de ${carteira.length} créditos`
          }
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
          value={
            investidor && derivados.aReceber.total !== null
              ? formatBRL(derivados.aReceber.total)
              : '—'
          }
          hint={
            !investidor
              ? 'selecione um investidor'
              : derivados.aReceber.total === null
                ? 'nada a receber nesta carteira'
                : [
                    derivados.aReceber.emAberto > 0 &&
                      `${derivados.aReceber.emAberto} crédito(s) em aberto`,
                    derivados.aReceber.complementares > 0 &&
                      `${derivados.aReceber.complementares} complementar(es) pendente(s)`,
                  ]
                    .filter(Boolean)
                    .join(' + ')
          }
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
                  const resumo = resumos.data?.get(p.id)
                  // Encerrado usa mensagem fixa; o resto vem da IA.
                  const textos = textosResumo(p.status, resumo)
                  const proj = valorProjetado(p, parametros.data, hoje)
                  const tirCred = tir(p.capital_investido, p.data_aquisicao, proj)
                  const ganho = ganhoProjetado(
                    proj,
                    p.capital_investido,
                    p.valor_estimado_complementar,
                  )
                  const ret = retorno(ganho, p.capital_investido)
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
                    <TD>
                      <CelulaResumo
                        texto={textos.estagio}
                        erro={textos.fixo ? null : resumo?.erro}
                        carregando={!textos.fixo && resumos.isLoading}
                        onClick={() =>
                          setAberto({
                            id: p.id,
                            cnj: p.numero_cnj,
                            status: p.status,
                            campo: 'estagio',
                          })
                        }
                      />
                    </TD>
                    <TD>
                      <CelulaResumo
                        texto={textos.providencias}
                        erro={textos.fixo ? null : resumo?.erro}
                        carregando={!textos.fixo && resumos.isLoading}
                        onClick={() =>
                          setAberto({
                            id: p.id,
                            cnj: p.numero_cnj,
                            status: p.status,
                            campo: 'providencias',
                          })
                        }
                      />
                    </TD>
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
                    {/* Liquidado mostra o que entrou; o resto é o face
                        atualizado até a expectativa. O title diz por que está
                        vazio quando falta insumo, em vez de só mostrar "—". */}
                    <TD className={cn(SEP, 'text-right tabular-nums')}>
                      {proj.valor === null ? (
                        <span className="text-slate-400" title={proj.motivo}>
                          —
                        </span>
                      ) : (
                        // O title diz até quando o face foi atualizado. Sem isso,
                        // num crédito de expectativa vencida o número não casa
                        // com a data da coluna ao lado e parece errado.
                        <span
                          title={
                            proj.realizado
                              ? 'Valor efetivamente recebido'
                              : proj.expectativaVencida
                                ? `Expectativa vencida: atualizado até hoje (${formatDate(proj.atualizadoAte)})`
                                : `Atualizado até a data estimada (${formatDate(proj.atualizadoAte)})`
                          }
                        >
                          {formatBRL(proj.valor)}
                        </span>
                      )}
                    </TD>
                    {/* Efetivada = crédito já pago, então a taxa é a que
                        aconteceu; Estimada = ainda projeção. O verde segue a
                        mesma convenção da coluna Status. */}
                    <TD
                      className={
                        p.data_liquidacao
                          ? 'font-medium text-emerald-600'
                          : 'text-slate-500'
                      }
                    >
                      {statusTir(p.data_liquidacao)}
                    </TD>
                    {/* Taxa equivalente do fluxo cessão -> data do valor. O
                        title mostra o prazo usado, que NÃO é "Dias em carteira"
                        quando a expectativa é futura. */}
                    <TD className="text-right tabular-nums">
                      {tirCred.anual === null ? (
                        <span className="text-slate-400" title={tirCred.motivo}>
                          —
                        </span>
                      ) : (
                        <span title={`${tirCred.dias} dias, até ${formatDate(tirCred.ate)}`}>
                          {formatPercent(tirCred.anual)}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {tirCred.mensal === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        formatPercent(tirCred.mensal)
                      )}
                    </TD>
                    {/* Da cessão até hoje enquanto não liquida; liquidado, para
                        na data de recebimento efetivo. Recalculado no render, o
                        número anda sozinho na virada do dia. */}
                    <TD className="text-right tabular-nums">
                      {diasEmCarteira(p.data_aquisicao, p.data_liquidacao, hoje) ?? '—'}
                    </TD>
                    {/* (projetado + complementar) − capital. Negativo em
                        vermelho: prejuízo não pode passar batido. */}
                    <TD className="text-right tabular-nums">
                      {ganho === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={ganho < 0 ? 'font-medium text-red-600' : undefined}
                          title={
                            p.valor_estimado_complementar
                              ? `Inclui ${formatBRL(p.valor_estimado_complementar)} de complementar a receber`
                              : undefined
                          }
                        >
                          {formatBRL(ganho)}
                        </span>
                      )}
                    </TD>
                    {/* Ganho sobre o capital, em %. Negativo em vermelho, como
                        o ganho que o origina. */}
                    <TD className="text-right tabular-nums">
                      {ret === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={ret < 0 ? 'font-medium text-red-600' : undefined}
                        >
                          {formatPercent(ret)}
                        </span>
                      )}
                    </TD>
                  </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <ModalParametrosAtualizacao
        open={abrirParametros}
        onClose={() => setAbrirParametros(false)}
      />

      {/* Texto inteiro do estágio/providências. Guarda id + campo, então o
          conteúdo se atualiza sozinho quando o botão gera de novo. */}
      <Modal
        open={!!aberto}
        onClose={() => setAberto(null)}
        title={aberto?.campo === 'estagio' ? 'Estágio processual' : 'Providências'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setAberto(null)}>
              Fechar
            </Button>
            {/* Crédito encerrado tem texto fixo: não há o que regerar. */}
            {aberto?.status !== 'encerrado' && (
              <Button
                icon={<RefreshCw className="h-4 w-4" />}
                loading={gerar.isPending && !!gerar.variables?.processo_id}
                onClick={() => aberto && gerar.mutate({ processo_id: aberto.id })}
              >
                Gerar novamente
              </Button>
            )}
          </>
        }
      >
        {aberto && (
          <div className="space-y-3">
            <div className="text-xs tabular-nums text-slate-500">
              {formatCNJ(aberto.cnj)}
            </div>
            {(() => {
              const r = resumos.data?.get(aberto.id)
              const t = textosResumo(aberto.status, r)
              const texto = aberto.campo === 'estagio' ? t.estagio : t.providencias
              if (texto) {
                // whitespace-pre-line: preserva os parágrafos do modelo.
                return (
                  <>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                      {texto}
                    </p>
                    {/* Carimbo de geração: sem ele não há como saber se o texto
                        é de ontem ou de dois meses atrás. Não aparece na
                        mensagem fixa dos encerrados, que não é gerada. */}
                    {!t.fixo && r?.gerado_em && (
                      <p className="border-t border-slate-100 pt-2 text-xs tabular-nums text-slate-400">
                        Gerado em {formatDateTime(r.gerado_em)}
                      </p>
                    )}
                  </>
                )
              }
              return (
                <p className="text-sm text-slate-500">
                  {r?.erro || 'Resumo ainda não gerado para este crédito.'}
                </p>
              )
            })()}
          </div>
        )}
      </Modal>
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
  // Os mesmos parâmetros da aba individual: sem eles o valor projetado não
  // existe, e A receber, Retorno e TIR ficam vazios.
  const parametros = useParametrosAtualizacao()
  const hoje = useMemo(() => hojeISO(), [])
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

  /**
   * Uma linha por investidor, POR SAFRA: o recorte é a data de AQUISIÇÃO, então
   * a linha descreve os créditos que aquele investidor comprou no mês escolhido,
   * e as colunas medem como essa safra se comportou ATÉ HOJE.
   *
   * Todas as métricas saem das mesmas funções da aba individual (lib/projecao),
   * o que é o que garante que o consolidado feche com a soma das carteiras.
   */
  const { linhas, total } = useMemo(() => {
    const noPeriodo = (processos.data ?? []).filter((p) =>
      mes === 'todos' ? true : (p.data_aquisicao ?? '').slice(0, 7) === mes,
    )
    const porInvestidor = new Map<string, { nome: string; creditos: Processo[] }>()
    for (const p of noPeriodo) {
      const nome = (p.cessionario ?? '').trim()
      if (!nome) continue
      const chave = normNome(nome)
      const atual = porInvestidor.get(chave)
      if (atual) atual.creditos.push(p)
      else porInvestidor.set(chave, { nome, creditos: [p] })
    }

    // Soma que devolve null quando NENHUM crédito tem o valor: zero afirmaria
    // que não há capital, quando o que falta é cadastro.
    const soma = (cs: Processo[], f: (p: Processo) => number | null | undefined) => {
      let t = 0
      let n = 0
      for (const p of cs) {
        const v = f(p)
        if (typeof v === 'number' && !Number.isNaN(v)) {
          t += v
          n++
        }
      }
      return n > 0 ? Math.round(t * 100) / 100 : null
    }

    const metricas = (creditos: Processo[]) => {
      const itens = creditos.map((p) => {
        const proj = valorProjetado(p, parametros.data, hoje)
        return { p, proj, t: tir(p.capital_investido, p.data_aquisicao, proj) }
      })
      return {
        capital: soma(creditos, (p) => p.capital_investido),
        aReceber: aReceberEstimado(
          itens.map(({ p, proj }) => ({
            proj,
            dataLiquidacao: p.data_liquidacao,
            valorComplementar: p.valor_estimado_complementar,
          })),
        ).total,
        jaRecebido: soma(creditos, (p) => p.ja_recebido),
        retorno: retornoProjetadoCarteira(
          itens.map(({ p, proj }) => ({
            ganho: ganhoProjetado(proj, p.capital_investido, p.valor_estimado_complementar),
            capital: p.capital_investido,
          })),
        ).valor,
        tirAa: tirAgregada(
          itens.map(({ p, proj, t }) => ({
            capital: p.capital_investido,
            valor: proj.valor,
            dias: t.dias,
          })),
        ).valor,
        operacoes: creditos.length,
      }
    }

    const linhas = [...porInvestidor.values()]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((i) => ({ nome: i.nome, ...metricas(i.creditos) }))

    // O total recalcula sobre TODOS os créditos do período, e não soma as linhas:
    // Retorno e TIR são taxas, e somá-las não produz número com significado.
    return { linhas, total: metricas(noPeriodo) }
  }, [processos.data, mes, parametros.data, hoje])

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
                    <TD className="text-right tabular-nums">{formatBRL(l.capital)}</TD>
                    <TD className="text-right tabular-nums">{formatBRL(l.aReceber)}</TD>
                    <TD className="text-right tabular-nums">
                      {formatBRL(l.jaRecebido)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {l.retorno === null ? (
                        '—'
                      ) : (
                        <span className={l.retorno < 0 ? 'font-medium text-red-600' : undefined}>
                          {formatPercent(l.retorno)}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatPercent(l.tirAa)}
                    </TD>
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
                  <TD className="text-right tabular-nums text-slate-800">
                    {formatBRL(total.capital)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-800">
                    {formatBRL(total.aReceber)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-800">
                    {formatBRL(total.jaRecebido)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-800">
                    {total.retorno === null ? '—' : formatPercent(total.retorno)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-800">
                    {formatPercent(total.tirAa)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-800">
                    {total.operacoes}
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
// ----------------------- Dados dos investidores -----------------------
// A LISTA de investidores vem dos cessionários dos Créditos, igual à Visão
// global, só sem filtro de mês. Não há como criar linha aqui: se um investidor
// não aparece, é porque não é cessionário de nenhum crédito.
//
// Os DADOS vêm de public.investidor_dados, indexados pelo nome normalizado, e a
// linha nasce no primeiro salvamento.
const CAMPOS_INVESTIDOR = [
  { chave: 'cpf', rotulo: 'CPF' },
  { chave: 'rg', rotulo: 'RG' },
  { chave: 'banco', rotulo: 'Banco' },
  { chave: 'agencia', rotulo: 'Agência' },
  { chave: 'conta', rotulo: 'Conta' },
  { chave: 'pix', rotulo: 'Pix' },
  { chave: 'endereco', rotulo: 'Endereço' },
] as const

type CampoInvestidor = (typeof CAMPOS_INVESTIDOR)[number]['chave']

function DadosPessoais() {
  const processos = processosCrud.useList()
  const dados = useInvestidorDados()
  const salvar = useSalvarInvestidorDados()
  const toast = useToast()

  // Investidor em edição: guarda a chave e o nome, e o formulário à parte.
  const [editando, setEditando] = useState<{ chave: string; nome: string } | null>(
    null,
  )
  const [form, setForm] = useState<Record<CampoInvestidor, string>>({
    cpf: '',
    rg: '',
    banco: '',
    agencia: '',
    conta: '',
    pix: '',
    endereco: '',
  })

  // Cessionários distintos, em ordem alfabética.
  const investidores = useMemo(() => {
    const porChave = new Map<string, string>()
    for (const p of processos.data ?? []) {
      const nome = (p.cessionario ?? '').trim()
      if (!nome) continue
      const chave = normalizarNome(nome)
      if (!porChave.has(chave)) porChave.set(chave, nome)
    }
    return [...porChave.entries()]
      .map(([chave, nome]) => ({ chave, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [processos.data])

  function abrirEdicao(chave: string, nome: string) {
    const d = dados.data?.get(chave)
    setForm({
      cpf: d?.cpf ?? '',
      rg: d?.rg ?? '',
      banco: d?.banco ?? '',
      agencia: d?.agencia ?? '',
      conta: d?.conta ?? '',
      pix: d?.pix ?? '',
      endereco: d?.endereco ?? '',
    })
    setEditando({ chave, nome })
  }

  async function handleSalvar() {
    if (!editando) return
    // Campo em branco vira null, não string vazia: no banco "não informado" é
    // ausência de valor, e "" faria a célula parecer preenchida com nada.
    const vazioNull = (s: string) => (s.trim() ? s.trim() : null)
    try {
      await salvar.mutateAsync({
        nome_chave: editando.chave,
        nome_exibicao: editando.nome,
        cpf: vazioNull(form.cpf),
        rg: vazioNull(form.rg),
        banco: vazioNull(form.banco),
        agencia: vazioNull(form.agencia),
        conta: vazioNull(form.conta),
        pix: vazioNull(form.pix),
        endereco: vazioNull(form.endereco),
      })
      toast.success('Dados salvos.')
      setEditando(null)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (processos.isLoading) return <Loading label="Carregando investidores…" />
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
      <Card>
        {investidores.length === 0 ? (
          <EmptyState
            title="Nenhum investidor"
            description="Nenhum crédito tem cessionário cadastrado."
          />
        ) : (
          <Table className="[&_th]:whitespace-nowrap [&_th]:px-3 [&_td]:px-3 [&_td]:text-[13px]">
            <THead>
              <tr>
                <TH>Nome do investidor</TH>
                {CAMPOS_INVESTIDOR.map((c) => (
                  <TH key={c.chave}>{c.rotulo}</TH>
                ))}
                <TH className="w-[1%] whitespace-nowrap text-right">
                  <span className="sr-only">Ações</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {investidores.map((i) => {
                const d = dados.data?.get(i.chave)
                return (
                  <TR key={i.chave}>
                    <TD className="font-medium text-slate-800">{i.nome}</TD>
                    {CAMPOS_INVESTIDOR.map((c) => (
                      <TD key={c.chave}>
                        {d?.[c.chave] ?? (
                          <span className="text-slate-300">—</span>
                        )}
                      </TD>
                    ))}
                    <TD className="w-[1%] whitespace-nowrap text-right">
                      <IconButton
                        label={`Editar dados de ${i.nome}`}
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => abrirEdicao(i.chave, i.nome)}
                      />
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        title="Dados do investidor"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button loading={salvar.isPending} onClick={handleSalvar}>
              Salvar
            </Button>
          </>
        }
      >
        {editando && (
          <div className="space-y-4">
            {/* O nome é FIXO: ele vem do cessionário do crédito, e editar aqui
                criaria um investidor que não existe na carteira. */}
            <Field label="Nome do investidor">
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                {editando.nome}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {CAMPOS_INVESTIDOR.filter((c) => c.chave !== 'endereco').map((c) => (
                <Field key={c.chave} label={c.rotulo}>
                  <Input
                    value={form[c.chave]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [c.chave]: e.target.value }))
                    }
                  />
                </Field>
              ))}
            </div>
            {/* Endereço sozinho na largura toda: é o único que costuma passar de
                uma linha. */}
            <Field label="Endereço">
              <Input
                value={form.endereco}
                onChange={(e) => setForm((f) => ({ ...f, endereco: e.target.value }))}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
