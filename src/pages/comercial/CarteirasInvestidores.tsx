import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Gauge,
  MessageSquareText,
  Settings,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  processosCrud,
  useCarteiraResumos,
  useParametrosAtualizacao,
  useUltimaMovimentacao,
} from '@/lib/queries'
import type { Processo } from '@/lib/types'
// Usadas só na aba Visão global, que agrega por investidor e não por carteira.
// A aba Individual não chama nada disto: ver `calc`, mais abaixo.
import {
  aReceberEstimado,
  ganhoProjetado,
  retornoProjetadoCarteira,
  tir,
  tirAgregada,
  valorProjetado,
} from '@/lib/projecao'
import { invokeFunction } from '@/lib/functions'
import { exportarCarteiraXlsx } from '@/lib/exportarCarteira'
import {
  montarCarteiraDoInvestidor,
  type DadosCarteira,
  type LinhaCarteira,
} from '@/lib/carteiraInvestidor'
import {
  GRUPOS_DA_CARTEIRA,
  TOTAL_DE_COLUNAS,
  alternarGrupo,
  colunasNaTela,
  gruposVisiveis,
  todosLigados,
  type ChaveGrupo,
  type GruposLigados,
} from '@/lib/gruposDaCarteira'
import { iniciais } from '@/lib/iniciais'
import { ModalParametrosAtualizacao } from '@/components/ParametrosAtualizacao'
import { getLabel, INDICE_ATUALIZACAO, textosResumo } from '@/lib/labels'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { Card } from '@/components/ui/Card'
import { Combobox, type OpcaoCombo } from '@/components/ui/Combobox'
import { Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
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
  normalizarNome,
  sentenceCase,
} from '@/lib/format'
import {
  CabecalhoDaAba,
  CartaoNumero,
  GradeCartoes,
  ICONE_CARTAO,
  Painel,
  TABELA_NO_PAINEL,
} from '@/pages/inteligencia/compartilhado'

// As `key` são internas e não mudam com o rótulo: elas aparecem em estado e em
// comparações pelo arquivo, e renomeá-las não traria nada.
// "Dados dos investidores" era a terceira aba daqui e virou página própria
// (Dados pessoais e bancários), no menu, porque não é carteira: não tem investidor
// selecionado, nem mês de referência, nem projeção — e passou a guardar também os
// originadores.
//
// UM SELETOR SEGMENTADO, e não abas: esta tela já é a aba Carteiras do Quadro
// econômico, e aba dentro de aba confunde onde se está (a regra da amostra:
// abas mudam de assunto, seletores mudam o recorte).
const VISOES = [
  { key: 'individual', label: 'Relatórios individuais' },
  { key: 'consolidado', label: 'Visão global' },
]

export default function CarteirasInvestidores() {
  const [tab, setTab] = useState('individual')

  return (
    <div className="space-y-5">
      {/* A aba não repete o título: o h1 é o "Quadro econômico" da moldura
          (pages/inteligencia/Moldura.tsx), e o h2 fica para o leitor de tela. */}
      <CabecalhoDaAba
        titulo="Carteiras de investimento"
        apoio="O relatório de cada investidor e a visão da carteira inteira."
      />
      <Segmented ariaLabel="Visão das carteiras" items={VISOES} value={tab} onChange={setTab} />

      {tab === 'individual' && <Individual />}
      {tab === 'consolidado' && <Consolidado />}
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

/** O rótulo pequeno em caixa alta dos campos da barra (`.field.inline > label`). */
function RotuloDaBarra({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-texto-3">
      {children}
    </span>
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

// Cor de cada GRUPO de colunas — o título do grupo e as colunas dele, com o
// sublinhado grosso na mesma cor (o `th.grp` da amostra). São TONS CATEGÓRICOS
// (`tom-*`): a cor só distingue um grupo do outro, e no claro são as mesmas
// tintas do cabeçalho do Excel (exportarCarteira.ts), escolhidas para contrastar
// com o fundo claro do cabeçalho — amarelo e azul-claro puros ficariam
// ilegíveis. No escuro, as claras da amostra (`.grp-*`).
const COR_GRUPO: Record<ChaveGrupo, string> = {
  ide: 'text-tom-ceu-texto',
  tir: 'text-tom-ambar-texto',
  cre: 'text-tom-esmeralda-texto',
  rec: 'text-tom-vermelho-texto',
  compl: 'text-tom-laranja-texto',
  viv: 'text-tom-azul-forte',
  calc: 'text-tom-violeta-texto',
}

/**
 * O STATUS DA CARTEIRA: o nome da cor, escrito na cor — como no Excel e no
 * relatório, que continuam só com o nome — e agora com ÍCONE (Novo): cor nunca
 * sozinha. O title diz o que cada cor significa. Tons alinhados com o semáforo
 * da Expectativa na aba Créditos, para a mesma cor significar a mesma coisa nas
 * duas telas.
 */
const ESTILO_STATUS: Record<string, { cor: string; Icone: typeof Check | null }> = {
  green: { cor: 'text-sucesso', Icone: Check },
  blue: { cor: 'text-info', Icone: Clock },
  yellow: { cor: 'text-aviso', Icone: Clock },
  red: { cor: 'text-perigo', Icone: AlertTriangle },
  gray: { cor: 'text-texto-3', Icone: null },
}

/**
 * Célula de Estágio processual / Providências: mostra só o começo do texto,
 * cortado com "…", e abre o texto inteiro numa caixa ao clicar.
 *
 * ESTA É A ÚNICA EXCEÇÃO ao "sem truncamento" das tabelas do app, e é
 * deliberada: são 6 linhas de narrativa numa tabela de 25 colunas. Aqui a
 * célula serve para VER QUE A COLUNA FOI PREENCHIDA; quem quer ler, clica.
 *
 * Sem texto, o "—" leva no title O MOTIVO DA FALHA da geração (ex.: "sem
 * andamentos"), e não um vazio mudo.
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
  if (carregando) return <span className="text-texto-3">…</span>
  if (!texto) {
    return (
      <span
        className="text-texto-3"
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
      className="block max-w-[220px] truncate text-left text-texto underline decoration-texto-3 decoration-dotted underline-offset-[3px] hover:text-marca-texto"
    >
      {texto}
    </button>
  )
}

// nowrap também nos <th>: com 25 colunas, um título como "Providências /
// prox. passos" quebrava em quatro linhas e esticava o cabeçalho inteiro.
const CLASSES_CARTEIRA =
  '[&_th]:whitespace-nowrap [&_th]:px-4 [&_td]:whitespace-nowrap [&_td]:px-4 [&_td]:py-3'

/** "—" cinza com o motivo no title, para o valor que não pôde ser calculado. */
function Vazio({ motivo }: { motivo?: string }) {
  return (
    <span className="text-texto-3" title={motivo}>
      —
    </span>
  )
}

/**
 * As células de UM grupo de colunas de uma linha da carteira. Separadas por
 * grupo para o liga/desliga da tela (ver lib/gruposDaCarteira.ts) tirar e pôr
 * colunas inteiras sem que nenhuma conta mude: tudo já veio calculado de
 * `montarCarteiraDoInvestidor`, e aqui só se formata.
 */
function CelulasDoGrupo({
  grupo,
  l,
  erroResumo,
  carregandoResumos,
  carregandoMov,
  abrir,
}: {
  grupo: ChaveGrupo
  l: LinhaCarteira
  erroResumo: string | null | undefined
  carregandoResumos: boolean
  carregandoMov: boolean
  abrir: (campo: 'estagio' | 'providencias') => void
}) {
  const { p, status: sl, textos, proj, tir: tirCred, ganho, retorno: ret } = l
  switch (grupo) {
    // Identificação — tudo vem do cadastro do crédito.
    case 'ide':
      return (
        <>
          <TD className="font-bold tabular-nums text-texto">{formatCNJ(p.numero_cnj)}</TD>
          <TD>{p.cedente || '—'}</TD>
          <TD>{p.cedente_advogado || '—'}</TD>
          {/* Numa linha só: a coluna se alarga conforme o texto (a tabela já
              rola na horizontal) em vez de esticar a altura da linha. */}
          <TD>{l.tipoCredito}</TD>
          <TD>{p.tribunal || '—'}</TD>
        </>
      )
    case 'tir':
      return (
        <>
          <TD className="text-right tabular-nums">{formatBRL(p.capital_investido)}</TD>
          <TD className="tabular-nums">{formatDate(p.data_aquisicao)}</TD>
        </>
      )
    case 'cre':
      return (
        <>
          <TD className="text-right tabular-nums">{formatBRL(p.valor_face)}</TD>
          <TD className="tabular-nums">{formatDate(p.data_referencia)}</TD>
          <TD>
            {p.indice_atualizacao
              ? getLabel(INDICE_ATUALIZACAO, p.indice_atualizacao).label
              : '—'}
          </TD>
        </>
      )
    // ZERO NÃO É VAZIO: R$ 0,00 aparece; só o que não foi cadastrado vira "—".
    case 'rec':
      return (
        <>
          <TD className="tabular-nums">{formatDate(p.expectativa_liquidacao)}</TD>
          <TD className="text-right tabular-nums">{formatBRL(p.ja_recebido)}</TD>
          <TD className="tabular-nums">{formatDate(p.data_liquidacao)}</TD>
        </>
      )
    case 'compl':
      return <TD className="text-right tabular-nums">{formatBRL(p.valor_estimado_complementar)}</TD>
    // Dados vivos. Status e Últ. atualização são CALCULADOS — ninguém digita.
    case 'viv': {
      const estilo = ESTILO_STATUS[sl.tone] ?? ESTILO_STATUS.gray
      return (
        <>
          <TD>
            <span
              title={sl.dica}
              className={cn('inline-flex items-center gap-1 text-sm font-bold', estilo.cor)}
            >
              {estilo.Icone && <estilo.Icone className="h-[13px] w-[13px] shrink-0" aria-hidden />}
              {sl.label}
            </span>
          </TD>
          <TD>
            <CelulaResumo
              texto={textos.estagio}
              erro={textos.fixo ? null : erroResumo}
              carregando={!textos.fixo && carregandoResumos}
              onClick={() => abrir('estagio')}
            />
          </TD>
          <TD>
            <CelulaResumo
              texto={textos.providencias}
              erro={textos.fixo ? null : erroResumo}
              carregando={!textos.fixo && carregandoResumos}
              onClick={() => abrir('providencias')}
            />
          </TD>
          {/* Do cache do ADVBOX, casado por dígitos. Enquanto o mapa carrega
              mostra vazio em vez de "—", que seria mentira. */}
          <TD className="tabular-nums">
            {carregandoMov ? '' : formatDate(l.ultimaMovimentacao)}
          </TD>
        </>
      )
    }
    case 'calc':
      return (
        <>
          {/* Liquidado mostra o que entrou; o resto é o face atualizado até a
              expectativa. O title diz por que está vazio quando falta insumo,
              e até quando o face foi atualizado — sem isso, num crédito de
              expectativa vencida o número não casa com a data ao lado. */}
          <TD className="text-right tabular-nums">
            {proj.valor === null ? (
              <Vazio motivo={proj.motivo} />
            ) : (
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
          {/* Efetivada = crédito já pago, então a taxa é a que aconteceu;
              Estimada = ainda projeção. O verde segue a convenção do Status. */}
          <TD className={l.pago ? 'font-bold text-sucesso' : 'text-texto-2'}>{l.statusTir}</TD>
          {/* Taxa equivalente do fluxo cessão -> data do valor. O title mostra
              o prazo usado, que NÃO é "Dias em carteira" quando a expectativa
              é futura. */}
          <TD className="text-right tabular-nums">
            {tirCred.anual === null ? (
              <Vazio motivo={tirCred.motivo} />
            ) : (
              <span title={`${tirCred.dias} dias, até ${formatDate(tirCred.ate)}`}>
                {formatPercent(tirCred.anual)}
              </span>
            )}
          </TD>
          <TD className="text-right tabular-nums">
            {tirCred.mensal === null ? <Vazio /> : formatPercent(tirCred.mensal)}
          </TD>
          {/* Da cessão até hoje enquanto não liquida; liquidado, para na data
              de recebimento efetivo. */}
          <TD className="text-right tabular-nums">{l.dias ?? '—'}</TD>
          {/* (projetado + complementar) − capital. Negativo em vermelho:
              prejuízo não pode passar batido. */}
          <TD className="text-right tabular-nums">
            {ganho === null ? (
              <Vazio />
            ) : (
              <span
                className={ganho < 0 ? 'font-bold text-perigo' : undefined}
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
          <TD className="text-right tabular-nums">
            {ret === null ? (
              <Vazio />
            ) : (
              <span className={ret < 0 ? 'font-bold text-perigo' : undefined}>
                {formatPercent(ret)}
              </span>
            )}
          </TD>
        </>
      )
  }
}

/** O botão de liga/desliga de um grupo (o `.chipf` da amostra), com ✓ quando ligado. */
function BotaoGrupo({
  ligado,
  onClick,
  children,
}: {
  ligado: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={ligado}
      onClick={onClick}
      className={cn(
        'inline-flex h-[30px] items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors',
        ligado
          ? 'border-texto bg-texto text-superficie'
          : 'border-borda-forte bg-superficie text-texto-2 hover:bg-superficie-3',
      )}
    >
      {ligado && <Check className="h-[13px] w-[13px]" aria-hidden />}
      {children}
    </button>
  )
}

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
  const fimDaVarredura = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(fimDaVarredura.current), [])
  const resumos = useCarteiraResumos(varrendo)
  // Texto aberto na caixa: guarda o id e o campo, não o texto — assim, ao
  // gerar novamente, a caixa mostra o texto novo sem fechar.
  const [aberto, setAberto] = useState<{
    id: string
    cnj: string | null
    status: string | null
    campo: 'estagio' | 'providencias'
  } | null>(null)
  // Os grupos de colunas da tabela (Novo). SÓ A TELA: o Excel, o relatório e a
  // mensagem saem sempre com as 25 colunas (ver lib/gruposDaCarteira.ts).
  const [grupos, setGrupos] = useState<GruposLigados>(todosLigados)

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
        // Teto do acompanhamento: 95 créditos levam poucos minutos. O PRAZO
        // RECOMEÇA a cada varredura: o relógio da anterior, que seguia correndo,
        // desligava o acompanhamento da nova no meio.
        window.clearTimeout(fimDaVarredura.current)
        fimDaVarredura.current = window.setTimeout(() => setVarrendo(false), 6 * 60 * 1000)
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
   * A CARTEIRA CALCULADA — ponto único.
   *
   * Os cards, a tabela, o Excel e o relatório em HTML leem daqui. Antes, cada
   * um refazia o mesmo `valorProjetado -> tir -> tirAgregada` por conta própria;
   * bastava alguém ajustar a conta num só lugar para a plataforma publicar dois
   * números diferentes da mesma carteira. Ver lib/carteiraInvestidor.ts.
   */
  const dadosCarteira = useMemo<DadosCarteira>(
    () => ({
      investidor: investidor ?? '',
      mesRef,
      carteira,
      resumos: resumos.data,
      ultimaMov: ultimaMov.data,
      capitalTotal: totais.capital.total,
      jaRecebidoTotal: totais.recebido.total,
      parametros: parametros.data,
      // O mesmo `hoje` congelado na montagem, para tela e arquivos coincidirem.
      hoje,
    }),
    [
      investidor,
      mesRef,
      carteira,
      resumos.data,
      ultimaMov.data,
      totais.capital.total,
      totais.recebido.total,
      parametros.data,
      hoje,
    ],
  )
  const calc = useMemo(() => montarCarteiraDoInvestidor(dadosCarteira), [dadosCarteira])

  // "3 de 7 créditos" quando falta cadastro; some quando está tudo lá.
  const cobertura = (n: number) =>
    carteira.length === 0
      ? AGUARDANDO
      : n === carteira.length
        ? 'soma dos créditos deste investidor'
        : `soma de ${n} de ${carteira.length} créditos — os demais sem valor cadastrado`

  // Downloads. Os dois pacotes pesados — ExcelJS e a marca em base64 — entram
  // por import dinâmico lá dentro: quem clica é que paga.
  // Declarados antes do primeiro return condicional, senão os hooks
  // desapareceriam do render enquanto a lista estivesse carregando.
  const [baixando, setBaixando] = useState(false)
  const [gerandoHtml, setGerandoHtml] = useState(false)

  async function baixarXlsx() {
    if (!investidor) return
    setBaixando(true)
    try {
      await exportarCarteiraXlsx(dadosCarteira)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBaixando(false)
    }
  }

  /**
   * Relatório do investidor em HTML: baixa o arquivo e abre uma aba para
   * conferência antes do envio. É o documento que hoje é montado à mão fora da
   * plataforma; aqui todo número dele vem do mesmo `calc` que pinta a tela.
   */
  async function gerarRelatorio() {
    if (!investidor) return
    setGerandoHtml(true)
    try {
      const { baixarRelatorioCarteira } = await import('@/lib/relatorioCarteira')
      await baixarRelatorioCarteira(calc)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setGerandoHtml(false)
    }
  }

  /** Texto de acompanhamento, para colar no WhatsApp junto com o arquivo. */
  async function copiarMensagem() {
    if (!investidor) return
    try {
      const { mensagemWhatsapp } = await import('@/lib/relatorioCarteira')
      await navigator.clipboard.writeText(mensagemWhatsapp(calc))
      toast.success('Mensagem copiada. É só colar no WhatsApp junto com o relatório.')
    } catch {
      // Área de transferência bloqueada acontece: contexto não seguro, permissão
      // negada, navegador antigo. Dizer o que houve é melhor que falhar calado.
      toast.error('O navegador não liberou a área de transferência. Gere o relatório e copie o texto de lá.')
    }
  }

  if (processos.isLoading) {
    return (
      <Card className="px-5">
        <Loading label="Carregando créditos…" />
      </Card>
    )
  }
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

  const visiveis = gruposVisiveis(grupos)
  const ativo = !!investidor && carteira.length > 0
  const sel = 'selecione um investidor'

  return (
    <div className="space-y-5">
      {/* A BARRA DO INVESTIDOR, em duas linhas como na amostra: em cima o que
          escolhe e prepara (investidor, competência, parâmetros, resumos);
          embaixo o que sai daqui para o investidor (Excel, relatório,
          mensagem). */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-[300px]">
          <RotuloDaBarra>Investidor</RotuloDaBarra>
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
          <RotuloDaBarra>Mês de referência</RotuloDaBarra>
          {/* Fixo no mês corrente: é a competência do relatório, não filtro. */}
          <div className="inline-flex items-center whitespace-nowrap rounded-campo bg-superficie-3 px-4 py-2 text-corpo text-texto-2">
            {mesRef}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {/* SELIC e IPCA que alimentam a coluna Valor projetado. */}
          <Button
            variant="outline"
            icon={<Settings className="h-[14px] w-[14px]" />}
            onClick={() => setAbrirParametros(true)}
          >
            Parâmetros de atualização
          </Button>
          {/* Regera o estágio e as providências de TODOS os créditos, ignorando
              a checagem de novidade que a rodada semanal faz. A DICA DIZ O
              ALCANCE (Novo): não é só o investidor da tela, e cada crédito é
              uma consulta paga à IA. */}
          <Button
            variant="outline"
            icon={<Sparkles className="h-[14px] w-[14px]" />}
            loading={gerar.isPending && !gerar.variables?.processo_id}
            onClick={() => gerar.mutate({ forcar: true })}
            title="Refaz o estágio processual e as providências de TODOS os créditos com cessionário, não só os deste investidor. Cada crédito é uma consulta à IA."
          >
            Gerar resumos
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          icon={<Download className="h-[14px] w-[14px]" />}
          loading={baixando}
          disabled={!ativo}
          onClick={baixarXlsx}
          title="O arquivo leva as 25 colunas, mesmo as dos grupos desligados na tela."
        >
          Baixar Excel
        </Button>
        {/* O documento que vai ao investidor. Ação primária desta barra: é o
            fim do trabalho do mês, e os outros botões existem para prepará-lo. */}
        <Button
          icon={<FileText className="h-[14px] w-[14px]" />}
          loading={gerandoHtml}
          disabled={!ativo}
          onClick={gerarRelatorio}
        >
          Relatório do investidor
        </Button>
        <Button
          variant="outline"
          icon={<MessageSquareText className="h-[14px] w-[14px]" />}
          disabled={!ativo}
          onClick={copiarMensagem}
          title="Copia o texto de acompanhamento para colar no WhatsApp junto com o relatório"
        >
          Mensagem
        </Button>
      </div>

      <GradeCartoes seis>
        <CartaoNumero
          rotulo="Capital total"
          icone={<Wallet className={ICONE_CARTAO} />}
          valor={
            investidor && totais.capital.total !== null
              ? formatBRL(totais.capital.total)
              : '—'
          }
          dica={investidor ? cobertura(totais.capital.preenchidos) : sel}
        />
        <CartaoNumero
          rotulo="TIR média"
          icone={<TrendingUp className={ICONE_CARTAO} />}
          valor={
            investidor && calc.tirMedia.valor !== null
              ? formatPercent(calc.tirMedia.valor)
              : '—'
          }
          dica={
            !investidor
              ? sel
              : calc.tirMedia.valor === null
                ? 'nenhum crédito com TIR calculável'
                : `carteira como fluxo único, prazo médio de ${calc.tirMedia.prazoMedioDias} dias, ${calc.tirMedia.considerados} de ${carteira.length} créditos`
          }
        />
        <CartaoNumero
          rotulo="Retorno projetado"
          icone={<Gauge className={ICONE_CARTAO} />}
          valor={
            investidor && calc.retornoCarteira.valor !== null
              ? formatPercent(calc.retornoCarteira.valor)
              : '—'
          }
          dica={
            !investidor
              ? sel
              : calc.retornoCarteira.valor === null
                ? 'nenhum crédito com ganho calculável'
                : `soma dos ganhos sobre a soma do capital, de ${calc.retornoCarteira.considerados} de ${carteira.length} créditos`
          }
        />
        <CartaoNumero
          rotulo="Já recebido"
          icone={<CheckCircle2 className={ICONE_CARTAO} />}
          valor={
            investidor && totais.recebido.total !== null
              ? formatBRL(totais.recebido.total)
              : '—'
          }
          dica={investidor ? cobertura(totais.recebido.preenchidos) : sel}
        />
        <CartaoNumero
          rotulo="A receber estimado"
          icone={<Clock className={ICONE_CARTAO} />}
          valor={
            investidor && calc.aReceber.total !== null
              ? formatBRL(calc.aReceber.total)
              : '—'
          }
          dica={
            !investidor
              ? sel
              : calc.aReceber.total === null
                ? // "Nada a receber" é conclusão, e só vale quando não há crédito
                  // em aberto. Com crédito aberto e projeção incalculável (índice
                  // do crédito ou parâmetro de atualização em falta), o card
                  // afirmava que o investidor não tem nada a receber — o oposto
                  // da verdade.
                  calc.aReceber.incalculaveis > 0
                  ? `sem projeção calculável em ${calc.aReceber.incalculaveis} crédito(s) — confira o índice e os Parâmetros de atualização`
                  : 'nada a receber nesta carteira'
                : [
                    calc.aReceber.emAberto > 0 &&
                      `${calc.aReceber.emAberto} crédito(s) em aberto`,
                    calc.aReceber.complementares > 0 &&
                      `${calc.aReceber.complementares} complementar(es) pendente(s)`,
                  ]
                    .filter(Boolean)
                    .join(' + ')
          }
        />
        <CartaoNumero
          rotulo="Nº de operações"
          icone={<FileText className={ICONE_CARTAO} />}
          valor={investidor ? String(carteira.length) : '—'}
          dica={investidor ? 'créditos deste investidor' : sel}
        />
      </GradeCartoes>

      <Painel
        titulo="Carteira"
        apoio={`Da cessão mais antiga para a mais nova. A tabela inteira tem ${TOTAL_DE_COLUNAS} colunas em ${GRUPOS_DA_CARTEIRA.length} grupos — mostre só os que precisar.`}
      >
        <div
          role="group"
          aria-label="Grupos de colunas na tela"
          className="flex flex-wrap items-center gap-2 border-b border-borda px-5 py-4"
        >
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-texto-3">
            Colunas
          </span>
          {GRUPOS_DA_CARTEIRA.map((g) => (
            <BotaoGrupo
              key={g.chave}
              ligado={grupos[g.chave]}
              onClick={() => setGrupos((atual) => alternarGrupo(atual, g.chave))}
            >
              {g.curto}
            </BotaoGrupo>
          ))}
          <span className="text-xs text-texto-3">
            {colunasNaTela(grupos)} de {TOTAL_DE_COLUNAS} na tela · o Excel e o relatório levam
            sempre as {TOTAL_DE_COLUNAS}
          </span>
        </div>

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
        ) : visiveis.length === 0 ? (
          <EmptyState
            title="Nenhum grupo de colunas na tela"
            description="Ligue pelo menos um grupo acima para ver a carteira."
          />
        ) : (
          <Table className={cn(CLASSES_CARTEIRA, TABELA_NO_PAINEL)}>
            <THead>
              {/* Nível 1: os grupos, cada um na sua cor, centralizados e com o
                  sublinhado grosso. Nível 2: as colunas, na cor do grupo. */}
              <tr>
                {visiveis.map((g) => (
                  <TH
                    key={g.chave}
                    colSpan={g.colunas.length}
                    className={cn('border-b-[3px] border-current text-center', COR_GRUPO[g.chave])}
                  >
                    {g.titulo}
                  </TH>
                ))}
              </tr>
              <tr>
                {visiveis.map((g) =>
                  g.colunas.map((c) => (
                    <TH
                      key={`${g.chave}-${c.titulo}`}
                      className={cn(COR_GRUPO[g.chave], c.direita && 'text-right')}
                    >
                      {c.titulo}
                    </TH>
                  )),
                )}
              </tr>
            </THead>
            <TBody>
              {calc.linhas.map((l) => {
                // `resumo` continua sendo lido direto porque a célula precisa
                // do campo `erro`, que não é conteúdo do relatório.
                const resumo = resumos.data?.get(l.p.id)
                return (
                  <TR key={l.p.id}>
                    {visiveis.map((g) => (
                      <CelulasDoGrupo
                        key={g.chave}
                        grupo={g.chave}
                        l={l}
                        erroResumo={resumo?.erro}
                        carregandoResumos={resumos.isLoading}
                        carregandoMov={ultimaMov.isLoading}
                        abrir={(campo) =>
                          setAberto({
                            id: l.p.id,
                            cnj: l.p.numero_cnj,
                            status: l.p.status,
                            campo,
                          })
                        }
                      />
                    ))}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Painel>

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
        description={aberto ? formatCNJ(aberto.cnj) : undefined}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setAberto(null)}>
              Fechar
            </Button>
            {/* Crédito ENCERRADO (pelo status, não pela cor) tem texto fixo:
                não há o que regerar. */}
            {aberto?.status !== 'encerrado' && (
              <Button
                icon={<Sparkles className="h-[14px] w-[14px]" />}
                loading={gerar.isPending && !!gerar.variables?.processo_id}
                onClick={() => aberto && gerar.mutate({ processo_id: aberto.id })}
              >
                Gerar novamente
              </Button>
            )}
          </>
        }
      >
        {aberto &&
          (() => {
            const r = resumos.data?.get(aberto.id)
            const t = textosResumo(aberto.status, r)
            const texto = aberto.campo === 'estagio' ? t.estagio : t.providencias
            if (texto) {
              // whitespace-pre-line: preserva os parágrafos do modelo.
              return (
                <div className="space-y-3">
                  <p className="whitespace-pre-line text-corpo leading-relaxed text-texto">
                    {texto}
                  </p>
                  {/* Carimbo de geração: sem ele não há como saber se o texto
                      é de ontem ou de dois meses atrás. Não aparece na
                      mensagem fixa dos encerrados, que não é gerada. DIZ A
                      ORIGEM (a IA, lendo o ADVBOX), como a amostra: quem lê o
                      texto precisa saber que não foi escrito por uma pessoa. */}
                  {!t.fixo && r?.gerado_em && (
                    <p className="text-xs text-texto-3">
                      Gerado pela IA em <span className="tabular-nums">{formatDateTime(r.gerado_em)}</span>, a
                      partir das movimentações do ADVBOX.
                    </p>
                  )}
                </div>
              )
            }
            return (
              <p className="text-corpo text-texto-3">
                {r?.erro || 'Resumo ainda não gerado para este crédito.'}
              </p>
            )
          })()}
      </Modal>
    </div>
  )
}

// ----------------------- Consolidado -----------------------
// Panorama por mês: um investidor por linha, com o fechamento do período.
// O recorte é pela DATA DE AQUISIÇÃO do crédito — "os processos fechados
// naquele mês". Só investidor e quantidade de operações saem preenchidos; os
// valores financeiros dependem de campos que o cadastro ainda não tem.

/** As iniciais num círculo, ao lado do nome do investidor (Novo). */
function Avatar({ nome }: { nome: string }) {
  return (
    <span
      aria-hidden
      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-marca-suave font-display text-sm font-bold text-marca-texto"
    >
      {iniciais(nome)}
    </span>
  )
}

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
  const { linhas, total, noPeriodo, semCessionario } = useMemo(() => {
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

    // O total RECALCULA (não soma as linhas), porque Retorno e TIR são taxas e
    // somá-las não produz número com significado. Mas recalcula sobre o MESMO
    // conjunto que as linhas mostram: crédito sem cessionário não vira linha
    // nenhuma e, quando entrava no total, a coluna de capital não fechava com a
    // soma visível — quem conferia a olho encontrava diferença sem explicação.
    const creditosDasLinhas = [...porInvestidor.values()].flatMap((i) => i.creditos)
    return {
      linhas,
      total: metricas(creditosDasLinhas),
      // Quantos créditos o período tem de fato, com ou sem cessionário: é isto
      // que distingue "mês sem aquisição" de "mês com aquisição e nenhum
      // cessionário cadastrado", que a tela tratava como a mesma coisa.
      noPeriodo: noPeriodo.length,
      semCessionario: noPeriodo.length - creditosDasLinhas.length,
    }
  }, [processos.data, mes, parametros.data, hoje])

  if (processos.isLoading) {
    return (
      <Card className="px-5">
        <Loading label="Carregando créditos…" />
      </Card>
    )
  }
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
    <Card className="overflow-hidden">
      <div className="border-b border-borda px-5 py-4">
        <label className="block w-full sm:max-w-xs">
          <RotuloDaBarra>Filtrar por mês</RotuloDaBarra>
          <Select value={mes} onChange={(e) => setMes(e.target.value)}>
            <option value="todos">Tudo</option>
            {meses.map((m) => (
              <option key={m} value={m}>
                {sentenceCase(rotuloMes(m))}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {linhas.length === 0 ? (
        // Dois estados que a tela tratava como um só. Sem esta distinção, um
        // mês COM aquisições em que nenhum crédito tem cessionário dizia "não
        // há créditos adquiridos no mês" — e o operador ia procurar erro no
        // cadastro do crédito, quando o que falta é o cessionário.
        noPeriodo > 0 ? (
          <EmptyState
            title="Sem investidor identificado"
            description={`${noPeriodo} crédito(s) adquirido(s) no período, nenhum com cessionário cadastrado. Preencha o cessionário na aba Créditos para eles aparecerem aqui.`}
          />
        ) : (
          <EmptyState
            title="Nenhum crédito no período"
            description={
              mes === 'todos'
                ? 'Nenhum crédito cadastrado com data de cessão.'
                : 'Não há créditos adquiridos no mês selecionado.'
            }
          />
        )
      ) : (
        <>
          <Table className={cn('rounded-none [&_th]:whitespace-nowrap [&_td]:align-middle', TABELA_NO_PAINEL)}>
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
                  <TD>
                    <span className="flex items-center gap-2.5">
                      <Avatar nome={l.nome} />
                      <span className="font-semibold text-texto">{l.nome}</span>
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatBRL(l.capital)}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatBRL(l.aReceber)}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">
                    {formatBRL(l.jaRecebido)}
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">
                    {l.retorno === null ? (
                      '—'
                    ) : (
                      <span className={l.retorno < 0 ? 'font-bold text-perigo' : undefined}>
                        {formatPercent(l.retorno)}
                      </span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">
                    {formatPercent(l.tirAa)}
                  </TD>
                  <TD className="text-right tabular-nums text-texto">
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
              <TR className="bg-superficie-3 font-bold hover:bg-superficie-3">
                <TD className="font-bold text-texto">Total da carteira</TD>
                <TD className="whitespace-nowrap text-right font-bold tabular-nums text-texto">
                  {formatBRL(total.capital)}
                </TD>
                <TD className="whitespace-nowrap text-right font-bold tabular-nums text-texto">
                  {formatBRL(total.aReceber)}
                </TD>
                <TD className="whitespace-nowrap text-right font-bold tabular-nums text-texto">
                  {formatBRL(total.jaRecebido)}
                </TD>
                <TD className="whitespace-nowrap text-right font-bold tabular-nums text-texto">
                  {total.retorno === null ? '—' : formatPercent(total.retorno)}
                </TD>
                <TD className="whitespace-nowrap text-right font-bold tabular-nums text-texto">
                  {formatPercent(total.tirAa)}
                </TD>
                <TD className="text-right font-bold tabular-nums text-texto">
                  {total.operacoes}
                </TD>
              </TR>
            </TBody>
          </Table>
          {/* O total é recalculado sobre os créditos QUE VIRARAM LINHA. Quando há
              crédito sem cessionário no período, ele fica fora da tabela e do
              total, e quem confere a soma a olho precisa saber por que a conta não
              fecha com a aba Créditos. */}
          {semCessionario > 0 && (
            <p className="border-t border-borda px-6 py-4 text-xs text-texto-3">
              {semCessionario} crédito(s) do período estão fora desta tabela por não
              ter cessionário cadastrado, e por isso também não entram no total.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
