// Histórico de UM processo dentro da ficha lateral, em duas abas:
// "Movimentações" (andamentos do tribunal) e "Tarefas" (o que a equipe fez ou
// tem para fazer naquele processo, do ADVBOX).
//
// Separação total por autos: a ficha do principal mostra SÓ o que é do
// principal, e a ficha de cada apenso só o dela (o apenso é um processo por
// direito próprio — decisão de produto, 2026-07). Vale para os dois: cada
// registro é carimbado com o número do processo A QUE ELE PERTENCE.
//
// Ambas as abas leem de cache local (public.advbox_movimentacoes e
// public.advbox_tarefas), então a ficha abre instantânea. Quem mantém o cache:
//  - Movimentações: cron + a sincronização da aba Movimentações. A ficha só lê.
//  - Tarefas: cron + esta ficha, ao abrir a aba (o /posts do ADVBOX não filtra
//    por processo, então a varredura é global e vale para todas as fichas — por
//    isso o intervalo mínimo entre disparos).
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { invokeFunction } from '@/lib/functions'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatDate, formatNome, onlyDigits, sentenceCase } from '@/lib/format'

interface MovLinha {
  id: string
  data: string | null
  conteudo: string | null
}

interface TarefaLinha {
  id: string
  tipo: string | null
  data: string | null
  date_deadline: string | null
  notes: string | null
  responsaveis: string[] | null
  important: boolean
  urgent: boolean
  concluida: boolean
}

// Teto da consulta. PostgREST corta em 1000 de qualquer forma; explícito aqui
// para o aviso de truncamento não depender de configuração do servidor.
const LIMITE = 1000

// Renderização progressiva: histórico integral pode ter centenas de itens, e
// montar tudo de uma vez trava a abertura da ficha.
const PAGINA = 50

// Acima disso o texto abre recolhido (andamento de diário costuma ser longo).
const CLAMP_CHARS = 280

// Intervalo mínimo entre sincronizações do MESMO processo. O sync é dirigido
// ao processo aberto (o /history do ADVBOX é por lawsuit), então é barato e o
// intervalo pode ser curto. Mapa de módulo para valer entre aberturas de ficha.
const INTERVALO_SYNC_MS = 60 * 1000
const ultimoSyncPorProcesso = new Map<string, number>()

/** Trilho da linha do tempo: bolinha ancorada à esquerda do item. */
function Bolinha({ tone }: { tone: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute -left-[21.5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white',
        tone,
      )}
    />
  )
}

/** Texto longo com "ler mais" próprio — estado por item, não global. */
function TextoLongo({ texto }: { texto: string }) {
  const [expandido, setExpandido] = useState(false)
  const longo = texto.length > CLAMP_CHARS
  return (
    <>
      <p
        className={cn(
          'mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700',
          longo && !expandido && 'line-clamp-4',
        )}
      >
        {texto}
      </p>
      {longo && (
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          className="mt-0.5 text-xs font-medium text-brand-600 hover:underline"
        >
          {expandido ? 'ler menos' : 'ler mais'}
        </button>
      )}
    </>
  )
}

// Um andamento na linha do tempo. A primeira (mais recente) é destacada para
// ancorar o olhar.
function MovItem({ mov, primeiro }: { mov: MovLinha; primeiro: boolean }) {
  return (
    <li className="relative">
      <Bolinha tone={primeiro ? 'bg-brand-500' : 'bg-slate-300'} />
      <div className="text-xs font-semibold tabular-nums text-slate-600">
        {mov.data ? formatDate(mov.data) : 'sem data'}
      </div>
      <TextoLongo texto={mov.conteudo ?? ''} />
    </li>
  )
}

// Uma tarefa na linha do tempo. A cor da bolinha e o selo dizem o estado —
// verde para feita, âmbar para pendente.
function TarefaItem({ t }: { t: TarefaLinha }) {
  const resp = (t.responsaveis ?? []).filter(Boolean)
  return (
    <li className="relative">
      <Bolinha tone={t.concluida ? 'bg-emerald-500' : 'bg-amber-400'} />
      {/* Data e tarefa na mesma linha. A situação NÃO vira selo: a cor da
          bolinha à esquerda já diz se está concluída ou em aberto, e repetir
          isso num selo só pesava. CAIXA ALTA do ADVBOX pesa na leitura, então
          o tipo vai em sentence case (mesma regra da página de Tarefas). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm text-slate-800">
          {/* A cor da bolinha é a única pista visual da situação; para quem usa
              leitor de tela, o estado vai aqui. */}
          <span className="sr-only">
            {t.concluida ? 'Concluída. ' : 'Em aberto. '}
          </span>
          <span className="text-xs font-semibold tabular-nums text-slate-600">
            {t.data ? formatDate(t.data) : 'sem data'}
          </span>
          <span aria-hidden="true" className="mx-1.5 text-slate-300">
            ·
          </span>
          <span className="font-medium">
            {t.tipo ? sentenceCase(t.tipo) : 'Tarefa'}
          </span>
        </span>
        {/* Só aparecem se a origem informar (o /history não traz). */}
        {t.urgent && (
          <Badge size="sm" tone="red">
            Urgente
          </Badge>
        )}
        {t.important && (
          <Badge size="sm" tone="orange">
            Importante
          </Badge>
        )}
      </div>
      {(t.date_deadline || resp.length > 0) && (
        <p className="mt-0.5 text-xs text-slate-500">
          {t.date_deadline && <>Prazo: {formatDate(t.date_deadline)}</>}
          {t.date_deadline && resp.length > 0 && ' · '}
          {resp.length > 0 && resp.map((n) => formatNome(n)).join(', ')}
        </p>
      )}
      {t.notes && <TextoLongo texto={t.notes} />}
    </li>
  )
}

/**
 * Filtro de situação, à direita das abas: bolinha + rótulo minúsculo, sem
 * caixa. Ligado = cor cheia; desligado = apagado. Deliberadamente discreto —
 * é um refinamento da lista, não o assunto da seção. Os dois começam ligados,
 * então nada fica escondido sem o usuário mandar.
 */
function ChipSituacao({
  ativo,
  cor,
  rotulo,
  qtd,
  onClick,
}: {
  ativo: boolean
  cor: string
  rotulo: string
  qtd: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      title={ativo ? `Ocultar ${rotulo}` : `Mostrar ${rotulo}`}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] transition-colors',
        ativo
          ? 'text-slate-500 hover:text-slate-700'
          : 'text-slate-300 hover:text-slate-400',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 rounded-full', ativo ? cor : 'bg-slate-300')}
      />
      {rotulo}
      <span className="tabular-nums">{qtd}</span>
    </button>
  )
}

/** Botão "Mostrar mais" da renderização progressiva. */
function MostrarMais({ restantes, onClick }: { restantes: number; onClick: () => void }) {
  if (restantes <= 0) return null
  return (
    <div className="mt-3">
      <Button size="sm" variant="outline" onClick={onClick}>
        Mostrar mais ({restantes} restantes)
      </Button>
    </div>
  )
}

/**
 * Seção final da ficha: movimentações e tarefas do processo, em abas.
 * `numero` é o número do próprio processo (crédito, requerimento ou apenso).
 */
export function DrawerHistorico({ numero }: { numero?: string | null }) {
  const digits = onlyDigits(numero)
  // Mesma regra da Edge Function (>= 6 dígitos) — menos que isso é lixo.
  const habilitado = digits.length >= 6
  const [aba, setAba] = useState<'movimentacoes' | 'tarefas'>('movimentacoes')
  // Situações visíveis. Ambas ligadas por padrão: o filtro serve para tirar
  // ruído quando o usuário quiser, não para esconder tarefas por conta própria.
  const [mostrar, setMostrar] = useState({ concluidas: true, abertas: true })
  const [visiveisMov, setVisiveisMov] = useState(PAGINA)
  const [visiveisTar, setVisiveisTar] = useState(PAGINA)
  const qc = useQueryClient()

  const movs = useQuery({
    queryKey: ['advbox_movimentacoes', 'ficha', digits],
    enabled: habilitado,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advbox_movimentacoes')
        .select('id, data, conteudo')
        .eq('numero_digits', digits)
        .order('data', { ascending: false })
        .order('data_ts', { ascending: false })
        .limit(LIMITE)
      if (error) throw new Error(error.message)
      return (data ?? []) as MovLinha[]
    },
  })

  const tarefas = useQuery({
    queryKey: ['advbox_tarefas', 'ficha', digits],
    enabled: habilitado,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advbox_tarefas')
        .select(
          'id, tipo, data, date_deadline, notes, responsaveis, important, urgent, concluida',
        )
        .eq('numero_digits', digits)
        // nullsFirst: false — tarefa sem data vai para o fim, não para o topo.
        .order('data', { ascending: false, nullsFirst: false })
        .limit(LIMITE)
      if (error) throw new Error(error.message)
      return (data ?? []) as TarefaLinha[]
    },
  })

  // Atualização em 2º plano ao entrar na aba: a lista já aparece com o cache e
  // se completa quando a varredura termina.
  const sync = useMutation({
    mutationFn: () =>
      // `numero` restringe a varredura a este processo.
      invokeFunction('advbox-tarefas', { action: 'sync', numero: digits }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['advbox_tarefas'] }),
    // Libera nova tentativa na próxima abertura em vez de esperar o intervalo.
    onError: () => {
      ultimoSyncPorProcesso.delete(digits)
    },
  })

  useEffect(() => {
    if (aba !== 'tarefas' || !habilitado) return
    if (Date.now() - (ultimoSyncPorProcesso.get(digits) ?? 0) < INTERVALO_SYNC_MS) return
    // Marca antes de disparar: evita disparo duplo no StrictMode.
    ultimoSyncPorProcesso.set(digits, Date.now())
    sync.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, habilitado, digits])

  const listaMov = movs.data ?? []
  const listaTar = tarefas.data ?? []

  const tarFiltradas = useMemo(
    () =>
      listaTar.filter((t) => (t.concluida ? mostrar.concluidas : mostrar.abertas)),
    [listaTar, mostrar],
  )

  const contagens = useMemo(
    () => ({
      concluidas: listaTar.filter((t) => t.concluida).length,
      abertas: listaTar.filter((t) => !t.concluida).length,
    }),
    [listaTar],
  )

  const movMostradas = listaMov.slice(0, visiveisMov)
  const tarMostradas = tarFiltradas.slice(0, visiveisTar)

  return (
    <section className="border-b border-slate-100 py-4 first:pt-0 last:border-b-0">
      {/* As duas visões são títulos de seção, não um controle à parte: usam a
          mesma tipografia de "Partes"/"Processo" (DrawerSection) e ficam
          separadas por uma barra. A ativa fica na cor do título; a outra
          recua. Contagem entre parênteses, como em "Apensos (3)". */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3
          role="group"
          aria-label="Alternar entre movimentações e tarefas do processo"
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"
        >
          <button
            type="button"
            onClick={() => setAba('movimentacoes')}
            aria-pressed={aba === 'movimentacoes'}
            // `uppercase` repetido no botão: o reset de formulário do preflight
            // impede a herança do <h3>, e sem isto o título sai em caixa mista.
            className={cn(
              'uppercase transition-colors',
              aba === 'movimentacoes'
                ? 'text-brand-600'
                : 'text-slate-400 hover:text-slate-600',
            )}
          >
            Movimentações{movs.data ? ` (${listaMov.length})` : ''}
          </button>
          <span aria-hidden="true" className="font-normal text-slate-300">
            |
          </span>
          <button
            type="button"
            onClick={() => setAba('tarefas')}
            aria-pressed={aba === 'tarefas'}
            className={cn(
              'uppercase transition-colors',
              aba === 'tarefas' ? 'text-brand-600' : 'text-slate-400 hover:text-slate-600',
            )}
          >
            Tarefas{tarefas.data ? ` (${listaTar.length})` : ''}
          </button>
        </h3>
        {aba === 'tarefas' && (
          <div
            role="group"
            aria-label="Filtrar tarefas por situação"
            className="flex shrink-0 items-center gap-3"
          >
            <ChipSituacao
              ativo={mostrar.concluidas}
              cor="bg-emerald-500"
              rotulo="concluídas"
              qtd={contagens.concluidas}
              onClick={() => {
                setMostrar((m) => ({ ...m, concluidas: !m.concluidas }))
                setVisiveisTar(PAGINA)
              }}
            />
            <ChipSituacao
              ativo={mostrar.abertas}
              cor="bg-amber-400"
              rotulo="em aberto"
              qtd={contagens.abertas}
              onClick={() => {
                setMostrar((m) => ({ ...m, abertas: !m.abertas }))
                setVisiveisTar(PAGINA)
              }}
            />
          </div>
        )}
      </div>

      {aba === 'movimentacoes' ? (
        movs.isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-12 w-full rounded-lg" />
            <div className="skeleton h-12 w-11/12 rounded-lg" />
          </div>
        ) : movs.isError ? (
          <p className="text-sm text-red-600">{(movs.error as Error).message}</p>
        ) : listaMov.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhuma movimentação sincronizada para este processo. O histórico é
            atualizado pelo cron e ao abrir a aba Movimentações.
          </p>
        ) : (
          <>
            {listaMov.length === LIMITE && (
              <p className="mb-3 text-xs text-slate-500">
                Mostrando as {LIMITE} mais recentes.
              </p>
            )}
            {/* Linha do tempo: trilho à esquerda, mais recente no topo. */}
            <ol className="ml-1.5 space-y-4 border-l border-slate-200 pl-4">
              {movMostradas.map((m, i) => (
                <MovItem key={m.id} mov={m} primeiro={i === 0} />
              ))}
            </ol>
            <MostrarMais
              restantes={listaMov.length - movMostradas.length}
              onClick={() => setVisiveisMov((v) => v + PAGINA * 2)}
            />
          </>
        )
      ) : (
        <>
          {sync.isPending && listaTar.length > 0 && (
            <p className="mb-2 text-[11px] text-slate-400">atualizando do ADVBOX…</p>
          )}

          {tarefas.isLoading ? (
            <div className="space-y-2">
              <div className="skeleton h-12 w-full rounded-lg" />
              <div className="skeleton h-12 w-11/12 rounded-lg" />
            </div>
          ) : tarefas.isError ? (
            <p className="text-sm text-red-600">{(tarefas.error as Error).message}</p>
          ) : tarFiltradas.length === 0 ? (
            <p className="text-sm text-slate-500">
              {listaTar.length === 0
                ? sync.isPending
                  ? 'Buscando as tarefas deste processo no ADVBOX…'
                  : sync.isError
                    ? // Afirmar "nenhuma tarefa registrada no ADVBOX" é afirmar
                      // algo sobre o ADVBOX, e a consulta que provaria isso
                      // falhou. Dito assim, o advogado concluía que o processo
                      // não tem prazo agendado — falso negativo sobre prazo, o
                      // pior tipo de erro nesta tela.
                      'Não foi possível consultar o ADVBOX agora, e não há tarefa em cache para este processo.'
                    : 'Nenhuma tarefa registrada no ADVBOX para este processo.'
                : !mostrar.concluidas && !mostrar.abertas
                  ? 'Nenhuma situação selecionada — clique em "concluídas" ou "em aberto".'
                  : mostrar.concluidas
                    ? 'Nenhuma tarefa concluída neste processo.'
                    : 'Nenhuma tarefa em aberto neste processo.'}
            </p>
          ) : (
            <>
              <ol className="ml-1.5 space-y-4 border-l border-slate-200 pl-4">
                {tarMostradas.map((t) => (
                  <TarefaItem key={t.id} t={t} />
                ))}
              </ol>
              <MostrarMais
                restantes={tarFiltradas.length - tarMostradas.length}
                onClick={() => setVisiveisTar((v) => v + PAGINA * 2)}
              />
            </>
          )}
          {/* Falha de sincronização não esconde o cache: avisa e segue. O aviso
              vale também com cache vazio — era justamente aí que ele mais
              importava, e a guarda de listaTar.length o calava. */}
          {sync.isError && (
            <p className="mt-3 text-xs text-amber-700">
              Não foi possível atualizar do ADVBOX agora: {(sync.error as Error).message}
            </p>
          )}
        </>
      )}
    </section>
  )
}
