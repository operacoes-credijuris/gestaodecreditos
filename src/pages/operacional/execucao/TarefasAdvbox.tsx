import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Plus, Flame, Star, FileText, X, Clock, Users } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invokeFunction } from '@/lib/functions'
import { processosCrud, requerimentosCrud, apensosCrud } from '@/lib/queries'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { CampoDeBusca, Partes, TituloDoGrupo } from '@/components/operacional/Pecas'
import { casaBusca } from '@/lib/buscaDaTela'
import {
  agruparPorPrazo,
  diasAtePrazo,
  GRUPOS_DO_PRAZO,
  prazoCurto,
  seloDoPrazo,
  type GrupoDoPrazo,
  type TomDoPrazo,
} from '@/lib/prazoDasTarefas'
import { tarefaAlterada } from '@/lib/formularioDaTarefa'
import { Segmented } from '@/components/ui/Segmented'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { Modal } from '@/components/ui/Modal'
import { Combobox, MultiCombobox, type OpcaoCombo } from '@/components/ui/Combobox'
import { PeticaoModal } from '@/components/PeticaoModal'
import { NumeroProcessoDrive } from '@/components/NumeroProcessoDrive'
import type { Apenso, Processo } from '@/lib/types'
import { useAuth } from '@/contexts/AuthContext'
import { Loading, ErrorState, EmptyState, SemResultado } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { formatCNJ, formatNome, hojeISO, onlyDigits as dig, sentenceCase } from '@/lib/format'
import { perguntarDescarte } from '@/lib/descarte'
import { LEMBRAR, useEscolhaLembrada } from '@/lib/lembrarNaTela'
import { BotaoCopiar } from '@/components/BotaoCopiar'

const VISOES_DO_PRAZO = ['fatais', 'sem_prazo'] as const

// ---------- Tipos vindos da Edge Function advbox-tarefas ----------
interface TarefaAdvbox {
  id: number
  tipo: string | null
  processo: string
  start_date: string | null
  date_deadline: string | null
  notes: string | null
  responsaveis: string[]
  important: boolean
  urgent: boolean
  created_at: string | null
}
/**
 * Resposta da action 'list'. Quem não é admin recebe só as próprias tarefas
 * (o corte é no servidor); `sem_correspondencia` avisa que o nome do perfil
 * não bate com nenhum usuário do ADVBOX — sem isso a lista viria vazia e a
 * pessoa concluiria que está sem tarefas.
 */
interface RespostaTarefas {
  tarefas: TarefaAdvbox[]
  total?: number
  restrito?: boolean
  sem_correspondencia?: boolean
  perfil_nome?: string | null
}

interface Opcoes {
  users: { id: number; name: string }[]
  tasks: { id: number; name: string }[]
  lawsuits: { id: number; numero: string }[]
}

interface FormState {
  /** Id do lawsuit no ADVBOX, escolhido na lista. */
  lawsuit_id: number | null
  tasks_id: string
  start_date: string
  date_deadline: string
  from: string
  guests: number[]
  important: boolean
  urgent: boolean
  comments: string
}
const FORM_VAZIO: FormState = {
  lawsuit_id: null,
  tasks_id: '',
  start_date: '',
  date_deadline: '',
  from: '',
  guests: [],
  important: false,
  urgent: false,
  comments: '',
}

// Observação com no máximo 3 linhas; mostra "ler mais" quando excede.
function Observacao({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [text])
  return (
    <div className="mt-s1 text-corpo font-normal text-texto-2">
      <div
        ref={ref}
        className={cn('whitespace-normal break-words', !expanded && 'line-clamp-3')}
      >
        {text}
      </div>
      {(clamped || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-0.5 min-h-[24px] text-sm font-semibold text-marca-texto hover:underline"
        >
          {expanded ? 'ler menos' : 'ler mais'}
        </button>
      )}
    </div>
  )
}

// ---------- Helpers de urgência / data / avatares ----------
const MESES = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
]

// O prazo — grupo, cor e texto relativo — mora em lib/prazoDasTarefas.ts, com
// teste: o grupo e a cor do selo dizem a mesma coisa e não podem discordar.

/**
 * Some até o mouse chegar ao cartão ou o foco entrar nele (auditoria visual,
 * T2). Em tela de toque, sem hover, fica à vista: lá não há outro jeito de
 * achar o botão.
 */
const SO_NO_HOVER =
  '[@media(hover:hover)]:opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'

// Dia + mês abreviado para o bloco de calendário.
function diaMes(iso?: string | null): { dia: string; mes: string } | null {
  if (!iso) return null
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return null
  return { dia: String(dt.getDate()).padStart(2, '0'), mes: MESES[dt.getMonth()] }
}

// A folhinha do calendário na cor do prazo (a amostra): vermelho até amanhã,
// âmbar até 7 dias, e a superfície neutra depois disso. É O ÚNICO SINAL
// COLORIDO DO PRAZO (auditoria visual, T1): o "há 2 dias" foi para dentro dela.
const TOM_CALENDARIO: Record<TomDoPrazo, string> = {
  perigo: 'border-perigo-borda bg-perigo-fundo text-perigo',
  aviso: 'border-aviso-borda bg-aviso-fundo text-aviso',
  neutro: 'border-borda bg-superficie-2 text-texto',
}
// O selo do prazo, com ícone (a amostra): a cor nunca sozinha. SÓ NO CELULAR,
// onde a folhinha não cabe e o selo é quem diz o prazo.
const TOM_SELO: Record<TomDoPrazo, string> = {
  perigo: 'bg-perigo-fundo text-perigo ring-perigo-borda',
  aviso: 'bg-aviso-fundo text-aviso ring-aviso-borda',
  neutro: 'bg-superficie-3 text-texto-2 ring-borda',
}
// O tom da CONTAGEM de cada grupo: o título fica no cinza comum (T1, ver
// TituloDoGrupo), e só o número leva a cor do prazo.
const TOM_GRUPO: Record<GrupoDoPrazo, 'perigo' | 'aviso' | 'neutro'> = {
  vencidas: 'perigo',
  hoje_amanha: 'perigo',
  proximos_7: 'aviso',
  mais_adiante: 'neutro',
}

/** Iniciais para o avatar do responsável ("Luiz Guilherme…" → "LG"). */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  return partes
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
}

export default function TarefasAdvbox() {
  const qc = useQueryClient()
  const toast = useToast()

  // Lista ao vivo do ADVBOX — recarrega ao abrir a página e ao focar a aba.
  const { data, isLoading, isError, error, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['advbox-tarefas'],
    queryFn: () =>
      invokeFunction<RespostaTarefas>('advbox-tarefas', { action: 'list' }),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
  // Data de hoje (YYYY-MM-DD, horário local) para classificar os prazos.
  // Precisa acompanhar a virada do dia: a lista recarrega ao focar a janela,
  // e uma data fixa deixaria os dados frescos sendo medidos por uma régua
  // velha — tarefa que vence hoje seguiria marcada "amanhã", e vencida
  // seguiria na lista. Só um F5 corrigia.
  const [hoje, setHoje] = useState(() => new Date().toLocaleDateString('sv-SE'))
  useEffect(() => {
    const sincronizar = () => setHoje(new Date().toLocaleDateString('sv-SE'))
    document.addEventListener('visibilitychange', sincronizar)
    window.addEventListener('focus', sincronizar)
    // Os eventos acima só disparam se alguém interagir; o intervalo cobre o
    // caso real do painel deixado aberto e visível a noite toda. Rechamar com
    // a mesma string é no-op no React, então nos outros 1439 minutos do dia
    // isto não provoca re-render.
    const timer = setInterval(sincronizar, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', sincronizar)
      window.removeEventListener('focus', sincronizar)
      clearInterval(timer)
    }
  }, [])
  // Tarefas com prazo vencido NÃO são mais escondidas: em Fatais elas ficam
  // no grupo "Vencidas", abaixo das pendentes (mesmo padrão de Publicações,
  // com Novas e Tratadas). Sumir com prazo estourado escondia o problema.
  const tarefas = useMemo(() => data?.tarefas ?? [], [data])

  // Cedente/cessionário dos Créditos (exibidos sob o nº do processo). Tarefas de
  // apensos vinculados a um crédito herdam o cedente/cessionário do crédito pai.
  const processos = processosCrud.useList()
  const apensos = apensosCrud.useList()
  // Devolve o CRÉDITO INTEIRO, e não só cedente/cessionário: a geração de petição
  // precisa também de vara, comarca, número e tipo do crédito. Um segundo
  // resolvedor ao lado deste montaria os mesmos dois mapas para responder a mesma
  // pergunta, e os dois poderiam divergir sobre qual crédito é o de uma tarefa.
  const resolveCredito = useMemo(() => {
    const porNumero = new Map<string, Processo>()
    const porId = new Map<string, Processo>()
    for (const p of processos.data ?? []) {
      porId.set(p.id, p)
      const d = dig(p.numero_cnj)
      if (d.length >= 6) porNumero.set(d, p)
    }
    // numero do apenso -> id do crédito pai
    const apensoParent = new Map<string, string>()
    for (const a of apensos.data ?? []) {
      const d = dig(a.numero)
      if (d.length >= 6 && a.processo_id) apensoParent.set(d, a.processo_id)
    }
    return (processoNum: string): Processo | null => {
      const d = dig(processoNum)
      const direto = porNumero.get(d)
      if (direto) return direto
      const parentId = apensoParent.get(d)
      return parentId ? porId.get(parentId) ?? null : null
    }
  }, [processos.data, apensos.data])

  /**
   * O APENSO cujos autos são os da tarefa — quando é o caso.
   *
   * Existe por causa de um defeito relatado: a petição de uma tarefa de apenso saía
   * com o número e o juízo do processo PRINCIPAL. É que resolveCredito devolve o
   * crédito pai de propósito (é dele que saem as partes do card e os dados da
   * cessão), e quem gera a peça precisa saber, além do crédito, EM QUAIS AUTOS ela
   * vai ser protocolada.
   *
   * Número que casa direto com um crédito nunca é tratado como apenso: crédito é
   * sempre o principal, e uma coincidência de número não pode reescrever os autos
   * dele.
   */
  const resolveApenso = useMemo(() => {
    const doCredito = new Set<string>()
    for (const p of processos.data ?? []) {
      const d = dig(p.numero_cnj)
      if (d.length >= 6) doCredito.add(d)
    }
    const porNumero = new Map<string, Apenso>()
    for (const a of apensos.data ?? []) {
      const d = dig(a.numero)
      if (d.length >= 6 && !doCredito.has(d)) porNumero.set(d, a)
    }
    return (numero: string): Apenso | null => porNumero.get(dig(numero)) ?? null
  }, [processos.data, apensos.data])

  // Tarefa cuja janela de petição está aberta. Guarda a tarefa toda, e não só o
  // id: a janela precisa da descrição para sugerir o modelo.
  const [peticaoDe, setPeticaoDe] = useState<TarefaAdvbox | null>(null)

  const [busca, setBusca] = useState('')
  // Padrão ao abrir: tarefas fatais (com prazo). Só duas visões — "Todas"
  // saiu: era a soma de duas listas que não se comparam entre si.
  // A visão escolhida fica lembrada entre visitas (lib/lembrarNaTela.ts).
  const [filtroPrazo, setFiltroPrazo] = useEscolhaLembrada(
    LEMBRAR.tarefasPrazo,
    VISOES_DO_PRAZO,
    'fatais',
  )
  const [novo, setNovo] = useState(false)

  // Busca textual (sem o filtro de prazo) — base para lista e contagens.
  //
  // normalizarBusca, e não toLowerCase cru: tipo e responsável chegam do ADVBOX
  // em CAIXA ALTA e com acento, e ninguém digita acento em caixa de busca. E o
  // número do processo é comparado também por dígito, porque na tela ele aparece
  // formatado — colar o número cru não achava nada. Mesmo padrão das outras
  // telas.
  //
  // BUSCA MAIS LARGA (item "Novo" da amostra): também as PARTES do crédito da
  // tarefa — o cedente e o cessionário que o cartão mostra sob o número. Com 4
  // dígitos ou mais, o número casa com qualquer campo (lib/buscaDaTela.ts).
  const baseBusca = useMemo(() => {
    if (!busca.trim()) return tarefas
    return tarefas.filter((t) => {
      const cred = resolveCredito(t.processo ?? '')
      return casaBusca(
        [t.tipo, t.processo, t.notes, ...(t.responsaveis ?? []), cred?.cedente, cred?.cessionario],
        busca,
      )
    })
  }, [tarefas, busca, resolveCredito])

  // AS FATAIS EM QUATRO GRUPOS PELO PRAZO (item "Novo" da amostra): Vencidas,
  // Hoje e amanhã, Próximos 7 dias e Mais adiante — no lugar de "Pendentes" e
  // "Vencidas", com as vencidas embaixo. O que pede ação vem primeiro. Sem prazo
  // segue lista única: sem termo final não há o que vencer.
  const { grupos, fatais, semPrazo } = useMemo(() => {
    const dataRef = (t: TarefaAdvbox) => t.start_date || t.created_at || ''
    const comPrazo = baseBusca.filter((t) => !!t.date_deadline)
    return {
      grupos: agruparPorPrazo(comPrazo, hoje, (t) => t.date_deadline),
      fatais: comPrazo.length,
      // Sem prazo: data mais nova primeiro.
      semPrazo: baseBusca
        .filter((t) => !t.date_deadline)
        .sort((a, b) => dataRef(b).localeCompare(dataRef(a))),
    }
  }, [baseBusca, hoje])

  const contagemPrazo = { fatais, sem_prazo: semPrazo.length }

  const vazio = filtroPrazo === 'fatais' ? fatais === 0 : semPrazo.length === 0

  // Cartão de uma tarefa. Função (e não JSX inline) porque os grupos
  // renderizam o mesmo cartão — o desenho é o da amostra: a folhinha do
  // calendário, o tipo com os selos, o número e as partes, a observação, os
  // responsáveis e "Gerar petição" no canto.
  const card = (t: TarefaAdvbox) => {
    const cred = resolveCredito(t.processo ?? '')
    const dias = t.date_deadline ? diasAtePrazo(hoje, t.date_deadline) : null
    const prazo = dias !== null ? seloDoPrazo(dias) : null
    const curto = dias !== null ? prazoCurto(dias) : ''
    const tom: TomDoPrazo = prazo?.tom ?? 'neutro'
    const bloco = diaMes(t.date_deadline || t.start_date)
    const resp = t.responsaveis ?? []
    return (
      // `group`: a pasta e o copiar depois do número só aparecem no hover ou no
      // foco do cartão (T2).
      <Card
        key={t.id}
        className="group grid grid-cols-1 items-start gap-s4 px-s4 py-s3 sm:grid-cols-[60px_minmax(0,1fr)_auto]"
      >
        {/* Folhinha de calendário: o prazo é O dado desta tela, então ele é o
            maior elemento do cartão — e o ÚNICO VERMELHO dela (auditoria visual,
            T1): o "há 2 dias" mora aqui dentro, no lugar do selo vermelho ao
            lado do título. No celular ela sai, e o selo volta. */}
        <div
          className={cn(
            'hidden w-[60px] flex-col items-center rounded-campo border px-s1 py-s1.5 text-center sm:flex',
            TOM_CALENDARIO[tom],
          )}
          aria-hidden="true"
        >
          {bloco ? (
            <>
              <div className="font-display text-xl font-bold leading-none tabular-nums">
                {bloco.dia}
              </div>
              <div className="mt-s1 text-xs font-semibold uppercase leading-none tracking-wider">
                {bloco.mes}
              </div>
              {curto && (
                <div className="mt-s1 whitespace-nowrap text-xs font-semibold leading-none">{curto}</div>
              )}
            </>
          ) : (
            <div className="py-s1.5 text-sm">—</div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-s3 gap-y-s1">
            <span className="font-display text-base font-bold tracking-tight text-texto">
              {t.tipo ? sentenceCase(t.tipo) : '—'}
            </span>
            {/* O prazo por extenso para o leitor de tela: a folhinha é só
                desenho (`aria-hidden`). */}
            {prazo?.rel && <span className="sr-only">Prazo: {prazo.rel}.</span>}
            {prazo?.rel && (
              <span
                aria-hidden="true"
                className={cn(
                  'inline-flex h-[20px] items-center gap-s1 whitespace-nowrap rounded-full px-s2 text-xs font-semibold ring-1 ring-inset sm:hidden',
                  TOM_SELO[tom],
                )}
              >
                {tom === 'perigo' ? (
                  <X className="h-[12px] w-[12px]" aria-hidden="true" />
                ) : (
                  <Clock className="h-[12px] w-[12px]" aria-hidden="true" />
                )}
                {prazo.rel}
              </span>
            )}
            {/* A PRIORIDADE COMO ÍCONE E TEXTO, SEM SELO (T1): "Urgente" em
                vermelho somava um terceiro sinal vermelho por tarefa. Só o
                Urgente leva cor, e é a do aviso. */}
            {t.urgent && (
              <span className="inline-flex items-center gap-s1 text-sm font-semibold text-aviso">
                <Flame className="h-[16px] w-[16px]" aria-hidden="true" /> Urgente
              </span>
            )}
            {t.important && (
              <span className="inline-flex items-center gap-s1 text-sm font-semibold text-texto-2">
                <Star className="h-[16px] w-[16px]" aria-hidden="true" /> Importante
              </span>
            )}
          </div>
          {/* Sem truncate: medido a 375px, esta linha mostrava 9% do conteúdo
              — e as PARTES do processo, que é o que identifica a tarefa de
              relance, ficavam invisíveis. Quebrar em duas linhas custa altura;
              esconder o nome da parte custa o entendimento. */}
          <div className="mt-s1 break-words text-corpo text-texto-2">
            {/* Mesmo componente da tela de Créditos: o clique no número tem de
                levar à mesma pasta nas duas telas. `cred` é o crédito que a tarefa
                casou — nulo quando o processo não está cadastrado, e aí o número
                aparece como texto comum. A PASTA E O COPIAR SÓ NO HOVER OU NO
                FOCO do cartão (T2): em toda tarefa, os dois ícones depois do
                número poluíam a linha. No toque (sem hover), ficam à vista. */}
            <NumeroProcessoDrive
              processo={cred}
              numero={t.processo}
              className="font-semibold tabular-nums text-texto"
              classeDoIcone={SO_NO_HOVER}
            />
            {/* COPIAR O NÚMERO (qualidade de vida): clicar nele abre a pasta, e o
                duplo clique pega só um pedaço do CNJ — copiar para o PJe era
                selecionar à mão. */}
            {t.processo && (
              <BotaoCopiar
                valor={formatCNJ(t.processo)}
                rotulo="Copiar o número do processo"
                aviso="Número copiado."
                tamanho="linha"
                className={cn('-my-s1.5 align-middle', SO_NO_HOVER)}
              />
            )}
            {cred && (cred.cedente || cred.cessionario) && (
              <>
                {' · '}
                <Partes a={cred.cedente} b={cred.cessionario} />
              </>
            )}
          </div>
          {t.notes && <Observacao text={t.notes} />}
          {/* Responsáveis: um chip com as iniciais por pessoa — cada nome é uma
              unidade que não quebra; com vários, a quebra cai ENTRE chips. */}
          {resp.length > 0 && (
            <div className="mt-s2 flex flex-wrap gap-s1.5">
              {resp.map((r, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-s1.5 rounded-full bg-superficie-3 py-s0.5 pl-s0.5 pr-s2 text-xs font-medium text-texto-2"
                >
                  <span
                    aria-hidden="true"
                    className="font-display grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-marca-suave text-xs font-bold leading-none text-marca-texto"
                  >
                    {iniciais(r)}
                  </span>
                  {formatNome(r)}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* "GERAR PETIÇÃO" FANTASMA (T2): secundário em todo cartão, a lista
            inteira repetia o mesmo botão em destaque. */}
        <div className="flex sm:justify-end">
          <Button
            size="sm"
            variant="ghost"
            title="Gerar petição"
            icon={<FileText className="h-[16px] w-[16px]" />}
            onClick={() => setPeticaoDe(t)}
          >
            Gerar petição
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div>
      <PageHeader
        title="Tarefas"
        description="Prazos dos processos, sincronizados com o ADVBOX."
        actions={
          // No celular, o primário ocupa a largura (auditoria visual, K2).
          <Button
            icon={<Plus className="h-[16px] w-[16px]" />}
            onClick={() => setNovo(true)}
            className="w-full sm:w-auto"
          >
            Nova tarefa
          </Button>
        }
      />

      {/* A BARRA DA AMOSTRA, sem cartão: o filtro de prazo, a busca e, no canto,
          a sincronização — a lista recarrega em silêncio ao focar a janela, e o
          indicador avisa. */}
      <div className="mb-s5 flex flex-col gap-s2 lg:flex-row lg:items-center">
        <Segmented
          ariaLabel="Filtrar tarefas por prazo"
          items={[
            { key: 'fatais', label: 'Fatais', count: contagemPrazo.fatais },
            { key: 'sem_prazo', label: 'Sem prazo', count: contagemPrazo.sem_prazo },
          ]}
          value={filtroPrazo}
          onChange={(k) => setFiltroPrazo(k as typeof filtroPrazo)}
        />
        <CampoDeBusca
          valor={busca}
          onChange={setBusca}
          placeholder="Buscar por tipo, processo ou responsável"
          title="Busca em: tipo, número do processo (com ou sem pontuação), observação, responsáveis e as partes do crédito"
          className="lg:max-w-[520px]"
        />
        <SyncStatus
          syncing={isFetching}
          updatedAt={dataUpdatedAt}
          label="atualizando do ADVBOX…"
        />
      </div>

      {isLoading ? (
        <Card>
          <Loading label="Buscando tarefas no ADVBOX…" />
        </Card>
      ) : isError ? (
        <Card>
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        </Card>
      ) : data?.sem_correspondencia ? (
        // Lista vazia por falta de vínculo, não por ausência de trabalho — dizer
        // isso evita que a pessoa conclua que não tem tarefas.
        // O VAZIO DA PLATAFORMA (ui/EmptyState), e não uma cópia dele dentro de um
        // cartão (revisão visual 2).
        <EmptyState
          icon={<Users />}
          title="Perfil não encontrado no ADVBOX"
          description={
            <>
              {data.perfil_nome
                ? `O nome do seu perfil ("${data.perfil_nome}") não corresponde a nenhum usuário do ADVBOX`
                : 'Seu perfil está sem nome cadastrado'}
              , então não há como identificar quais tarefas são suas. Peça a um
              administrador para acertar o nome em Configurações → Usuários,
              exatamente como aparece no ADVBOX.
            </>
          }
        />
      ) : vazio && busca.trim() ? (
        // COM BUSCA, A LINHA SIMPLES (§0.10): o filtro é que esvaziou a lista.
        <SemResultado texto="Nenhuma tarefa com essa busca" rotuloLimpar="Limpar a busca" onLimpar={() => setBusca('')} />
      ) : vazio ? (
        // O VAZIO DIZ POR QUE ESTÁ VAZIO (a amostra): a visão sem prazo, ou de
        // fato nada com prazo no ADVBOX. Sozinho, sem cartão em volta.
        <EmptyState
          title="Nenhuma tarefa"
          description={
            filtroPrazo === 'sem_prazo'
              ? 'Nenhuma tarefa sem prazo no ADVBOX.'
              : 'Nada com prazo no ADVBOX por enquanto.'
          }
        />
      ) : filtroPrazo === 'sem_prazo' ? (
        <div className="space-y-s2">{semPrazo.map(card)}</div>
      ) : (
        <div className="space-y-s5">
          {/* Só os grupos com tarefa (a amostra): um grupo vazio no meio da lista
              só afasta o próximo prazo de quem está olhando. */}
          {GRUPOS_DO_PRAZO.filter((g) => grupos[g.chave].length > 0).map((g) => (
            <section key={g.chave}>
              <TituloDoGrupo titulo={g.titulo} qtd={grupos[g.chave].length} tom={TOM_GRUPO[g.chave]} />
              <div className="space-y-s2">{grupos[g.chave].map(card)}</div>
            </section>
          ))}
        </div>
      )}

      <NovaTarefaModal
        open={novo}
        onClose={() => setNovo(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['advbox-tarefas'] })
          setNovo(false)
          toast.success('Tarefa criada no ADVBOX.')
        }}
      />

      {/* O crédito é resolvido AQUI, e não dentro da janela: é esta tela que tem
          os mapas de número e de apenso montados, e é aqui que a regra de "tarefa
          de apenso herda o crédito pai" já vale. */}
      <PeticaoModal
        open={!!peticaoDe}
        onClose={() => setPeticaoDe(null)}
        // TIPO **E** OBSERVAÇÃO. O tipo é o catálogo do ADVBOX ("Petição
        // simples") e quase nunca diz qual peça é; quem diz é a observação
        // ("Elaborar petição de sequestro dos valores"). Passando só o tipo, a
        // sugestão não achava nada em tarefa nenhuma — era o caso real que
        // apareceu no primeiro teste.
        descricao={[peticaoDe?.tipo, peticaoDe?.notes].filter(Boolean).join(' — ')}
        processo={peticaoDe ? resolveCredito(peticaoDe.processo) : null}
        // O crédito diz DE QUEM é a peça; o apenso, EM QUAIS AUTOS ela entra.
        apenso={peticaoDe ? resolveApenso(peticaoDe.processo ?? '') : null}
        numeroTarefa={peticaoDe?.processo ?? ''}
        // Chave do cache do panorama da IA: a análise é por TAREFA, não por
        // crédito — cada tarefa se escreve com um recorte diferente do processo.
        tarefaId={peticaoDe ? String(peticaoDe.id) : null}
      />
    </div>
  )
}

// Opção do combobox: número do processo + descrição já resolvida
// (Cedente v. Cessionário, Requerimento administrativo, etc.).
interface LawOpt {
  id: number
  numero: string
  descricao: string
}


// ----------------------- Modal de criação -----------------------
export function NovaTarefaModal({
  open,
  onClose,
  onCreated,
  processoNumero,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  processoNumero?: string | null
}) {
  const toast = useToast()
  const { profile, isAdmin } = useAuth()
  const [form, setForm] = useState<FormState>({ ...FORM_VAZIO })
  /**
   * O processo com que a janela ABRIU escolhida (o da publicação). Guardado à
   * parte porque chega depois, quando a lista do ADVBOX carrega — e o que a tela
   * preencheu sozinha não pode contar como alteração no "Descartar alterações?".
   */
  const [processoInicial, setProcessoInicial] = useState<number | null>(null)
  /** A data com que a janela abre: hoje, tirado A CADA ABERTURA (a tela vira o dia aberta). */
  const dataInicial = useMemo(() => (open ? hojeISO() : ''), [open])

  const opcoes = useQuery({
    queryKey: ['advbox-tarefas-options'],
    queryFn: () =>
      invokeFunction<Opcoes>('advbox-tarefas', { action: 'options' }),
    enabled: open,
    // Carrega uma vez e mantém no cache: o modal só mostra "Carregando…" na
    // primeira abertura, e depois reusa.
    //
    // 2 min, e não 30: com 30 minutos, o crédito recém-cadastrado não aparecia na
    // lista de processos do modal — e quem acabou de cadastrar vai justamente
    // criar a primeira tarefa dele. O cache continua evitando a tela de
    // carregamento; só o dado envelhece menos.
    staleTime: 2 * 60 * 1000,
    gcTime: Infinity,
  })

  // Resolve cada processo do ADVBOX contra os cadastros para exibir
  // "Cedente v. Cessionário" (Créditos) ou "Requerimento administrativo"
  // (Requerimentos), em vez do cliente "CREDIJURIS" devolvido pela API.
  const processos = processosCrud.useList()
  const requerimentos = requerimentosCrud.useList()
  const apensos = apensosCrud.useList()
  const lawOptions = useMemo<LawOpt[]>(() => {
    const credPorNum = new Map<string, string>()
    const credPorId = new Map<string, string>()
    for (const p of processos.data ?? []) {
      const desc = `${p.cedente || '—'} v. ${p.cessionario || '—'}`
      credPorId.set(p.id, desc)
      const d = dig(p.numero_cnj)
      if (d.length >= 15) credPorNum.set(d, desc)
    }
    const reqNums = new Set<string>()
    for (const r of requerimentos.data ?? []) {
      const d = dig(r.numero_protocolo)
      if (d.length >= 15) reqNums.add(d)
    }
    const apPorNum = new Map<
      string,
      { processo_id: string | null; requerimento_id: string | null }
    >()
    for (const a of apensos.data ?? []) {
      const d = dig(a.numero)
      if (d.length >= 15)
        apPorNum.set(d, {
          processo_id: a.processo_id,
          requerimento_id: a.requerimento_id,
        })
    }
    const descricao = (numero: string): string => {
      const d = dig(numero)
      const cred = credPorNum.get(d)
      if (cred) return cred
      if (reqNums.has(d)) return 'Requerimento administrativo'
      const ap = apPorNum.get(d)
      if (ap) {
        if (ap.processo_id && credPorId.has(ap.processo_id))
          return credPorId.get(ap.processo_id)!
        if (ap.requerimento_id) return 'Requerimento administrativo'
      }
      return ''
    }
    return (opcoes.data?.lawsuits ?? []).map((l) => ({
      id: l.id,
      numero: l.numero,
      descricao: descricao(l.numero),
    }))
  }, [opcoes.data, processos.data, requerimentos.data, apensos.data])

  // Ao fechar, limpa o formulário. Ao abrir a partir de uma publicação,
  // pré-seleciona o processo casando pelo número.
  useEffect(() => {
    if (!open) {
      setForm({ ...FORM_VAZIO })
      setProcessoInicial(null)
      return
    }
    // A DATA ABRE EM HOJE (qualidade de vida): é a resposta de quase toda tarefa
    // criada, e o campo é obrigatório. Continua editável; o prazo não ganha valor
    // padrão — prazo é decisão, não rotina. Não conta como alteração no
    // "Descartar alterações?" (ver `dataInicial` em lib/formularioDaTarefa.ts).
    setForm((f) => (f.start_date ? f : { ...f, start_date: dataInicial }))
    if (!processoNumero) return
    const d = dig(processoNumero)
    const found = lawOptions.find((o) => dig(o.numero) === d)
    if (found) {
      setForm((f) => (f.lawsuit_id ? f : { ...f, lawsuit_id: found.id }))
      setProcessoInicial((atual) => atual ?? found.id)
    }
  }, [open, lawOptions, processoNumero, dataInicial])

  const criar = useMutation({
    mutationFn: (lawsuitId: number) =>
      invokeFunction('advbox-tarefas', {
        action: 'create',
        lawsuits_id: lawsuitId,
        tasks_id: Number(form.tasks_id),
        start_date: form.start_date,
        date_deadline: form.date_deadline || null,
        from: Number(form.from),
        guests: form.guests,
        important: form.important,
        urgent: form.urgent,
        comments: form.comments || null,
      }),
    onSuccess: () => {
      setForm({ ...FORM_VAZIO })
      onCreated()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.lawsuit_id) return toast.error('Selecione um processo da lista.')
    if (!form.tasks_id) return toast.error('Selecione o tipo de tarefa.')
    if (!form.start_date) return toast.error('Informe a data.')
    if (!form.from) return toast.error('Selecione o remetente.')
    if (form.guests.length === 0) return toast.error('Selecione ao menos um responsável.')
    criar.mutate(form.lawsuit_id)
  }

  const users = opcoes.data?.users ?? []
  const tasks = opcoes.data?.tasks ?? []

  // ---------- Remetente ----------
  // Quem cria a tarefa é quem a envia, então o remetente não deveria ser uma
  // escolha. O vínculo com o ADVBOX é feito pelo NOME do perfil, porque não há
  // campo de id do ADVBOX em profiles — comparação sem acento e sem
  // maiúsculas para tolerar divergência de digitação.
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase()
  const meuUsuarioAdvbox = useMemo(() => {
    const nome = profile?.nome?.trim()
    if (!nome) return null
    return users.find((u) => norm(u.name) === norm(nome)) ?? null
  }, [users, profile?.nome])

  // Só o admin escolhe o remetente (cria tarefa em nome de outros). Para os
  // demais o remetente é sempre a própria pessoa, preenchido sozinho e sem
  // campo na tela.
  const escolheRemetente = isAdmin

  // Não-admin sem correspondência no ADVBOX fica impedido de criar: deixá-lo
  // escolher o remetente seria justamente permitir mandar tarefa em nome de
  // outra pessoa, que é o que esta regra existe para impedir.
  const semRemetente = !isAdmin && !meuUsuarioAdvbox

  useEffect(() => {
    if (!open || escolheRemetente || !meuUsuarioAdvbox) return
    setForm((f) => (f.from ? f : { ...f, from: String(meuUsuarioAdvbox.id) }))
  }, [open, escolheRemetente, meuUsuarioAdvbox])

  // "DESCARTAR ALTERAÇÕES?" (item "Novo" da amostra): fechar com algo escolhido
  // ou digitado pergunta antes. O que a tela preencheu sozinha não conta
  // (lib/formularioDaTarefa.ts, com teste).
  const dirty =
    open &&
    !semRemetente &&
    tarefaAlterada(form, { processoInicial, escolheRemetente, dataInicial })

  async function fechar() {
    if (dirty && !(await perguntarDescarte())) return
    onClose()
  }

  const opcoesProcesso = useMemo<OpcaoCombo[]>(
    () =>
      lawOptions.map((l) => ({
        id: l.id,
        titulo: formatCNJ(l.numero),
        subtitulo: l.descricao || null,
      })),
    [lawOptions],
  )
  const opcoesTarefa = useMemo<OpcaoCombo[]>(
    () => tasks.map((t) => ({ id: t.id, titulo: t.name })),
    [tasks],
  )
  const opcoesUsuario = useMemo<OpcaoCombo[]>(
    () => users.map((u) => ({ id: u.id, titulo: u.name })),
    [users],
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova tarefa"
      // FORMULÁRIO: 640px (auditoria visual, C8). Em 960px, os campos de data
      // esticavam até o dobro do que o valor pede.
      size="md"
      dirty={dirty}
      footer={
        <>
          <Button variant="secondary" onClick={fechar}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="form-nova-tarefa"
            loading={criar.isPending}
            disabled={semRemetente}
          >
            Criar tarefa
          </Button>
        </>
      }
    >
      {opcoes.isLoading ? (
        <Loading label="Carregando opções do ADVBOX…" />
      ) : opcoes.isError ? (
        <ErrorState
          message={(opcoes.error as Error)?.message}
          onRetry={() => opcoes.refetch()}
        />
      ) : semRemetente ? (
        <div className="space-y-1">
          <p className="text-corpo font-semibold text-texto">
            Perfil não encontrado no ADVBOX
          </p>
          <p className="text-corpo text-texto-2">
            {profile?.nome
              ? `O nome do seu perfil ("${profile.nome}") não corresponde a nenhum usuário do ADVBOX`
              : 'Seu perfil está sem nome cadastrado'}
            , e a tarefa precisa sair em seu nome. Peça a um administrador para
            acertar o nome em Configurações → Usuários, exatamente como aparece
            no ADVBOX.
          </p>
        </div>
      ) : (
        <form id="form-nova-tarefa" onSubmit={handleSubmit} className="grid gap-s4 sm:grid-cols-2">
          {/* O PROCESSO SÓ DA LISTA DO ADVBOX (crédito, requerimento ou apenso
              cadastrados aqui): texto digitado sem escolher não conta. */}
          <Field label="Processo" required className="sm:col-span-2">
            <Combobox
              opcoes={opcoesProcesso}
              valor={form.lawsuit_id}
              onChange={(id) => setForm((f) => ({ ...f, lawsuit_id: id }))}
              placeholder="Digite o número do processo…"
              vazio="Nenhum processo encontrado."
            />
          </Field>

          <Field label="Tipo de tarefa" required className="sm:col-span-2">
            <Combobox
              opcoes={opcoesTarefa}
              valor={form.tasks_id ? Number(form.tasks_id) : null}
              onChange={(id) => setForm((f) => ({ ...f, tasks_id: id ? String(id) : '' }))}
              placeholder="Digite parte do nome…"
              vazio="Nenhum tipo encontrado."
            />
          </Field>

          <Field label="Data" required>
            <Input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
          </Field>
          <Field label="Prazo">
            <Input
              type="date"
              value={form.date_deadline}
              onChange={(e) => setForm({ ...form, date_deadline: e.target.value })}
            />
          </Field>

          {/* Remetente só aparece para quem pode escolher: o admin, que cria em
              nome de outros, e quem não foi encontrado no ADVBOX pelo nome do
              perfil. Para o resto é sempre a própria pessoa, e um campo com uma
              resposta só é campo a menos para preencher. */}
          {escolheRemetente && (
            <Field label="Remetente" required>
              <Combobox
                opcoes={opcoesUsuario}
                valor={form.from ? Number(form.from) : null}
                onChange={(id) => setForm((f) => ({ ...f, from: id ? String(id) : '' }))}
                placeholder="Digite o nome…"
                vazio="Nenhum usuário encontrado."
              />
            </Field>
          )}

          <Field label="Responsáveis" required className={escolheRemetente ? undefined : 'sm:col-span-2'}>
            <MultiCombobox
              opcoes={opcoesUsuario}
              valores={form.guests}
              onChange={(ids) => setForm((f) => ({ ...f, guests: ids }))}
              placeholder="Digite o nome e escolha…"
              vazio="Nenhum usuário encontrado."
            />
          </Field>

          <div className="flex gap-s5 sm:col-span-2">
            <label className="flex min-h-[24px] cursor-pointer items-center gap-s2 text-corpo text-texto">
              <input
                type="checkbox"
                className="h-[16px] w-[16px] accent-marca"
                checked={form.important}
                onChange={(e) => setForm({ ...form, important: e.target.checked })}
              />
              <Star className="h-[16px] w-[16px] text-texto-2" aria-hidden="true" /> Importante
            </label>
            <label className="flex min-h-[24px] cursor-pointer items-center gap-s2 text-corpo text-texto">
              <input
                type="checkbox"
                className="h-[16px] w-[16px] accent-marca"
                checked={form.urgent}
                onChange={(e) => setForm({ ...form, urgent: e.target.checked })}
              />
              <Flame className="h-[16px] w-[16px] text-aviso" aria-hidden="true" /> Urgente
            </label>
          </div>

          <Field label="Descrição" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={form.comments}
              onChange={(e) => setForm({ ...form, comments: e.target.value })}
            />
          </Field>
        </form>
      )}
    </Modal>
  )
}
