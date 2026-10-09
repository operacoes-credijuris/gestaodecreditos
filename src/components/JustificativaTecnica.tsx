// A JUSTIFICATIVA TÉCNICA DA PROPOSTA na tela: o botão (ou o cheque) no card e
// a janela em que a IA gera, a pessoa edita e o Enviar grava a nota no Kommo.
//
// As regras moram em `supabase/functions/_shared/justificativaTecnica.ts`, que
// a Edge Function `justificativa-tecnica` também usa: o que é "parada", o que
// pode enviar, o texto em vigor. Aqui fica só o desenho e o fluxo da janela.
//
// O QUE A JANELA GARANTE:
//   - abrir pela primeira vez É o pedido de geração; reabrir não paga de novo;
//   - "Gerar de novo" pergunta antes, porque é pago;
//   - a geração roda no servidor: a janela pode fechar, e o resultado fica salvo;
//   - a edição vira rascunho com espera de digitação, e fechar não perde nada;
//   - o Enviar trava por card (lib/emCursoPorCard.ts) contra o clique duplo, e o
//     servidor trava de novo contra a segunda aba;
//   - sem a migração 0076, a janela diz isso e não chama nada pago.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  Send,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { supabase } from '@/lib/supabase'
import { codigoDoErro, invokeFunction } from '@/lib/functions'
import { comecarNoCard, terminarNoCard, type PorCard } from '@/lib/emCursoPorCard'
import { comRascunhoSalvo } from '@/lib/rascunhoDaJustificativa'
import type { KommoLead } from '@/lib/types'
import { CaixaDeAviso, IdentificacaoDoCard } from '@/components/analise/Pecas'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { TempoRelativo } from '@/components/ui/TempoRelativo'
import { useToast } from '@/components/ui/Toast'
import {
  AVISO_MIGRACAO_0076,
  ehTabelaAusente,
  type EstadoDaJustificativa,
  type EtapaDaJustificativa,
  type FaseDaGeracao,
  geracaoParada,
  juntarNotas,
  type LinhaDaJustificativa,
  ROTULO_DA_FASE,
  separarNotas,
  textoEmVigor,
} from '../../supabase/functions/_shared/justificativaTecnica.ts'
import type { AndamentoDaGeracao } from '../../supabase/functions/_shared/justificativaParalela.ts'

const FUNCAO = 'justificativa-tecnica'
const TABELA = 'justificativa_tecnica'
/** De quanto em quanto a janela confere o andamento da geração. */
const CONSULTA_MS = 3_000
/** A espera de digitação antes de salvar o rascunho. */
const ESPERA_RASCUNHO_MS = 1_200

/** O resumo de cada card que a fila mostra: o estado e a data do envio. */
export interface ResumoDaJustificativa {
  kommo_lead_id: number
  status: EstadoDaJustificativa
  etapa: EtapaDaJustificativa | null
  atualizado_em: string | null
  enviado_em: string | null
}

/**
 * OS ESTADOS DOS CARDS DA ABA, numa consulta só. Confere de novo, sozinha,
 * enquanto algum card estiver gerando — é o que vira o botão em cheque sem
 * recarregar a página.
 *
 * SEM A TABELA (antes da migração 0076) a consulta falha e a fila mostra só o
 * botão: o aviso é dado na janela, onde a pessoa vai procurá-lo.
 */
export function useJustificativasDaAba(ids: readonly number[], ligado: boolean) {
  const chave = [...ids].sort((a, b) => a - b)
  return useQuery({
    queryKey: [TABELA, 'aba', chave],
    enabled: ligado && chave.length > 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABELA)
        .select('kommo_lead_id, status, etapa, atualizado_em, enviado_em')
        .in('kommo_lead_id', chave)
      if (error) throw error
      const m: Record<number, ResumoDaJustificativa> = {}
      for (const l of (data ?? []) as ResumoDaJustificativa[]) m[Number(l.kommo_lead_id)] = l
      return m
    },
    refetchInterval: (q) =>
      Object.values((q.state.data ?? {}) as Record<number, ResumoDaJustificativa>).some(
        (l) => l.status === 'gerando' && !geracaoParada(l),
      )
        ? 5_000
        : false,
  })
}

const BTN = 'h-[32px] px-4'
const IC = 'h-[16px] w-[16px] flex-none'

/**
 * O LUGAR DO BOTÃO NO CARD. Enviada, vira o cheque — "✓ Justificativa técnica
 * enviada", com a data —, que reabre a janela só de leitura. Antes disso é o
 * botão, com o estado na palavra: gerando, pronta para revisar, falhou.
 */
export function BotaoJustificativa({
  resumo,
  ocupado,
  onAbrir,
}: {
  resumo?: ResumoDaJustificativa
  ocupado: boolean
  onAbrir: () => void
}) {
  if (resumo?.status === 'enviada') {
    return (
      <button
        type="button"
        onClick={onAbrir}
        title="Justificativa técnica enviada ao Kommo — abrir o texto enviado"
        className="inline-flex h-[32px] max-w-full items-center gap-s1.5 whitespace-nowrap rounded-full border border-sucesso-borda bg-sucesso-fundo px-s3 text-sm font-semibold text-sucesso transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-anel"
      >
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-sucesso-cheio text-white">
          <Check className="h-[12px] w-[12px]" strokeWidth={3} aria-hidden />
        </span>
        <span className="min-w-0 truncate">Justificativa técnica enviada</span>
        {resumo.enviado_em && (
          <TempoRelativo valor={resumo.enviado_em} className="shrink-0 text-xs font-medium text-texto-2" />
        )}
      </button>
    )
  }
  const gerando = resumo?.status === 'gerando' && !geracaoParada(resumo)
  const falhou = resumo?.status === 'falha' || (resumo?.status === 'gerando' && geracaoParada(resumo))
  const pronta = resumo?.status === 'pronta'
  return (
    <Button
      size="sm"
      variant="secondary"
      className={cn(BTN, pronta && 'text-marca-texto hover:bg-marca-leve hover:text-marca-texto')}
      icon={
        gerando ? (
          <RefreshCw className={cn(IC, 'animate-spin')} aria-hidden />
        ) : falhou ? (
          <AlertTriangle className={cn(IC, 'text-aviso')} aria-hidden />
        ) : (
          <FileText className={IC} aria-hidden />
        )
      }
      onClick={onAbrir}
      disabled={ocupado}
      title={
        gerando
          ? 'A justificativa está sendo gerada — abrir para acompanhar'
          : falhou
            ? 'A última geração falhou — abrir para ver o motivo e tentar de novo'
            : pronta
              ? 'A justificativa está pronta para revisar e enviar'
              : 'Gerar a justificativa técnica do preço da proposta (a IA pesquisa e redige)'
      }
    >
      {/* O ESTADO NA PALAVRA, também na falha (revisão visual 2): antes ela só
          trocava o ícone, e "falhou" ficava no passar do mouse. */}
      {gerando
        ? 'Gerando justificativa…'
        : pronta
          ? 'Revisar justificativa'
          : falhou
            ? 'Justificativa falhou'
            : 'Justificativa técnica'}
    </Button>
  )
}

/** A linha inteira, como a janela a lê. */
type Linha = LinhaDaJustificativa & {
  fontes?: { url: string; titulo: string }[] | null
  consumo?: { buscas?: number; fetches?: number; input_tokens?: number; output_tokens?: number } | null
  gerado_em?: string | null
  rascunho_em?: string | null
  enviado_por?: string | null
  nota_kommo_ids?: number[] | null
  /** O resumo do andamento (fase e frentes), lido de dentro do jsonb `pesquisa`. */
  andamento?: AndamentoDaGeracao | null
}

/**
 * AS COLUNAS QUE A JANELA LÊ — e não `*`. O jsonb `pesquisa` guarda o estado das
 * frentes, com as conversas salvas para continuar (centenas de KB); a consulta
 * a cada três segundos lê só o resumo dele, `andamento`.
 */
const COLUNAS_DA_JANELA =
  'kommo_lead_id, pipeline_id, status, etapa, tentativa, texto, texto_editado, texto_enviado, rascunho_em, ' +
  'fontes, erro, consumo, gerado_em, atualizado_em, enviando_desde, enviado_em, enviado_por, nota_kommo_ids, ' +
  'andamento:pesquisa->andamento'

type EstadoDoRascunho = 'salvo' | 'pendente' | 'salvando' | 'erro'

/**
 * A JANELA. Fica montada na página (uma só), e a `lead` diz de que card: assim
 * a trava do Enviar, por card, sobrevive a fechar e reabrir.
 */
export function JanelaJustificativa({
  lead,
  autor,
  onFechar,
  onEnviada,
}: {
  lead: KommoLead | null
  /** Quem assina o rodapé da nota ("registrado por …"). */
  autor: string
  onFechar: () => void
  /** A nota subiu: a página põe o texto no histórico do card sem esperar o sync. */
  onEnviada?: (lead: KommoLead, texto: string) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const leadId = lead?.kommo_lead_id ?? 0
  const aberta = lead !== null
  // O CARD ABERTO AGORA (09/10/2026): a janela é uma só, e a resposta de um
  // pedido do card A pode voltar com a do B aberta. O que é do A (o cache, o
  // aviso de falha) segue valendo; o que é da janela (o estado do rascunho, o
  // erro, o fechar) só vale se ela ainda for do A.
  const cardAberto = useRef(leadId)
  cardAberto.current = leadId

  const consulta = useQuery({
    queryKey: [TABELA, leadId],
    enabled: aberta,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from(TABELA).select(COLUNAS_DA_JANELA).eq('kommo_lead_id', leadId).maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as Linha | null
    },
    refetchInterval: (q) => {
      const l = q.state.data as Linha | null | undefined
      return l?.status === 'gerando' && !geracaoParada(l) ? CONSULTA_MS : false
    },
  })
  const linha = consulta.data ?? null
  const semMigracao = !!consulta.error && ehTabelaAusente(consulta.error)

  // O VIGIA DAS FRENTES (08/10/2026): com a janela aberta numa geração em curso
  // — inclusive a que parece parada —, a cada minuto pede ao servidor que
  // relance a frente cuja invocação morreu sem sinal (ver `frentesOrfas`). Foi o
  // que deixou a geração do Renan de Santana esperando para sempre pela frente
  // da EC 136.
  const emCurso = linha?.status === 'gerando'
  useEffect(() => {
    if (!aberta || !emCurso || !leadId) return
    let vivo = true
    const vigiar = () =>
      void invokeFunction<{ relancadas?: number }>(FUNCAO, { acao: 'vigiar', kommo_lead_id: leadId })
        // RELÊ SEMPRE (uma vez por minuto): a geração que parecia parada deixa de
        // ser consultada a cada 3 s, e é esta releitura que a vê voltar a andar.
        .then(() => {
          if (vivo) void qc.invalidateQueries({ queryKey: [TABELA] })
        })
        .catch(() => {})
    vigiar()
    const id = setInterval(vigiar, 60_000)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [aberta, emCurso, leadId, qc])

  // ---------------- gerar ----------------
  const [pedindo, setPedindo] = useState(false)
  const [erroDoPedido, setErroDoPedido] = useState<string | null>(null)
  const [migracaoPelaFuncao, setMigracaoPelaFuncao] = useState(false)
  const [confirmarRefazer, setConfirmarRefazer] = useState(false)
  const pedidoFeito = useRef<number | null>(null)

  const atualizar = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: [TABELA] })
  }, [qc])

  const gerar = useCallback(
    async (refazer: boolean) => {
      setPedindo(true)
      setErroDoPedido(null)
      try {
        await invokeFunction(FUNCAO, { acao: 'gerar', kommo_lead_id: leadId, refazer })
        await atualizar()
      } catch (e) {
        // A RESPOSTA É DESTE CARD (09/10/2026): voltando com a janela já noutro,
        // o erro não pode aparecer como se fosse do outro — vai para o aviso.
        if (cardAberto.current !== leadId) toast.error(`A justificativa de outro card não foi gerada: ${(e as Error).message}`)
        else if (codigoDoErro(e) === 'migracao-pendente') setMigracaoPelaFuncao(true)
        else setErroDoPedido((e as Error).message)
      } finally {
        setPedindo(false)
      }
    },
    [leadId, atualizar, toast],
  )

  // ABRIR PELA PRIMEIRA VEZ É O PEDIDO: sem linha (e com a leitura certa — nunca
  // por erro de leitura), a janela pede a geração uma vez por abertura.
  useEffect(() => {
    if (!aberta) {
      pedidoFeito.current = null
      return
    }
    if (consulta.isLoading || consulta.error || linha || pedidoFeito.current === leadId) return
    pedidoFeito.current = leadId
    void gerar(false)
  }, [aberta, consulta.isLoading, consulta.error, linha, leadId, gerar])

  // ---------------- o texto e o rascunho ----------------
  // O TEXTO É UM SÓ (o que se salva e o que vai ao Kommo); na janela ele aparece
  // em duas partes quando traz a linha ###NOTAS###: o corpo (com as fontes) e,
  // numa caixa à parte, as notas internas. `notas` null = o texto não tem a linha,
  // e tudo fica como sempre foi.
  const [corpo, setCorpo] = useState('')
  const [notas, setNotas] = useState<string | null>(null)
  const texto = useMemo(() => (notas === null ? corpo : juntarNotas(corpo, notas)), [corpo, notas])
  const [rascunho, setRascunho] = useState<EstadoDoRascunho>('salvo')
  const [salvoEm, setSalvoEm] = useState<string | null>(null)
  const carregado = useRef<string | null>(null)
  const relogio = useRef<number | null>(null)
  const ultimoEnviado = useRef<string>('')

  // O CAMPO NASCE COM O TEXTO EM VIGOR, uma vez por geração: a consulta que volta
  // a cada abertura não pode apagar a edição em curso.
  useEffect(() => {
    if (!linha || linha.status === 'gerando') return
    const chave = `${linha.kommo_lead_id}:${linha.tentativa}:${linha.status}`
    if (carregado.current === chave) return
    carregado.current = chave
    const t = textoEmVigor(linha)
    const partes = separarNotas(t)
    setCorpo(partes.corpo)
    setNotas(partes.notas)
    ultimoEnviado.current = t
    setRascunho('salvo')
    setSalvoEm(linha.rascunho_em ?? null)
  }, [linha])

  const salvarRascunho = useCallback(
    async (valor: string) => {
      if (!linha || linha.status !== 'pronta' || valor === ultimoEnviado.current) {
        setRascunho('salvo')
        return
      }
      const doCard = linha.kommo_lead_id
      // FECHADA (0) AINDA É DELE: o Fechar salva a edição pendente, e o estado
      // tem de voltar a "salvo" — reaberta, a janela do mesmo card não recarrega
      // o campo, e um "salvando" preso desligaria o Enviar.
      const daJanela = () => cardAberto.current === doCard || cardAberto.current === 0
      setRascunho('salvando')
      try {
        const r = await invokeFunction<{ rascunho_em: string }>(FUNCAO, {
          acao: 'rascunho', kommo_lead_id: doCard, tentativa: linha.tentativa, texto: valor,
        })
        const em = r?.rascunho_em ?? new Date().toISOString()
        // A EDIÇÃO SALVA ENTRA NO CACHE (ver lib/rascunhoDaJustificativa.ts):
        // sem isto, reabrir este card depois de outro trazia o texto sem ela.
        qc.setQueryData<Linha | null>([TABELA, doCard], (antes) =>
          comRascunhoSalvo(antes, { kommo_lead_id: doCard, tentativa: linha.tentativa, texto: valor, rascunho_em: em }),
        )
        if (!daJanela()) return
        ultimoEnviado.current = valor
        setSalvoEm(em)
        setRascunho('salvo')
      } catch (e) {
        toast.error(`O rascunho não foi salvo: ${(e as Error).message}`)
        if (daJanela()) setRascunho('erro')
      }
    },
    [linha, toast, qc],
  )

  const cancelarRelogio = () => {
    if (relogio.current !== null) window.clearTimeout(relogio.current)
    relogio.current = null
    pendente.current = null
  }
  // SAIR DA TELA NÃO PERDE A ÚLTIMA EDIÇÃO (09/10/2026): o relógio da pausa era
  // cancelado na desmontagem, e o que se digitou no último segundo antes de
  // trocar de página não era salvo. Agora ele sai na hora, como no Fechar.
  const pendente = useRef<string | null>(null)
  const salvarAgora = useRef(salvarRascunho)
  salvarAgora.current = salvarRascunho
  useEffect(
    () => () => {
      const valor = pendente.current
      cancelarRelogio()
      if (valor !== null) void salvarAgora.current(valor)
    },
    [],
  )

  function agendarRascunho(valor: string) {
    setRascunho('pendente')
    cancelarRelogio()
    pendente.current = valor
    relogio.current = window.setTimeout(() => {
      relogio.current = null
      pendente.current = null
      void salvarRascunho(valor)
    }, ESPERA_RASCUNHO_MS)
  }
  function aoDigitarCorpo(valor: string) {
    setCorpo(valor)
    agendarRascunho(notas === null ? valor : juntarNotas(valor, notas))
  }
  function aoDigitarNotas(valor: string) {
    setNotas(valor)
    agendarRascunho(juntarNotas(corpo, valor))
  }

  // FECHAR NÃO PERDE NADA: a edição que ainda esperava a pausa sai agora.
  function fechar() {
    if (relogio.current !== null) {
      cancelarRelogio()
      void salvarRascunho(texto)
    }
    setErroDoPedido(null)
    setMigracaoPelaFuncao(false)
    onFechar()
  }

  // ---------------- enviar ----------------
  const travas = useRef<PorCard<true>>({})
  const [enviandoPorCard, setEnviandoPorCard] = useState<PorCard<true>>({})
  const enviando = leadId ? enviandoPorCard[leadId] !== undefined : false

  async function enviar() {
    if (!lead || !linha || travas.current[leadId] !== undefined) return
    // A TRAVA É SÍNCRONA (o ref): dois cliques no mesmo quadro passam antes de o
    // estado do React mudar, e o segundo subiria a nota duas vezes.
    travas.current = comecarNoCard(travas.current, leadId, true)
    setEnviandoPorCard(travas.current)
    cancelarRelogio()
    try {
      const r = await invokeFunction<{ partes: number; aviso: string | null }>(FUNCAO, {
        acao: 'enviar', kommo_lead_id: leadId, tentativa: linha.tentativa, texto, autor,
      })
      ultimoEnviado.current = texto
      onEnviada?.(lead, texto)
      if (r?.aviso) toast.error(r.aviso)
      else toast.success(
        r?.partes && r.partes > 1
          ? `Justificativa enviada ao card no Kommo, em ${r.partes} notas.`
          : 'Justificativa enviada ao card no Kommo.',
      )
      await atualizar()
      // SÓ FECHA A JANELA DESTE CARD (09/10/2026): fechada durante o envio e
      // aberta noutro card, ela fechava sozinha quando o envio do primeiro voltava.
      if (cardAberto.current === leadId) onFechar()
    } catch (e) {
      toast.error(`${(e as Error).message}`)
      await atualizar()
    } finally {
      travas.current = terminarNoCard(travas.current, leadId)
      setEnviandoPorCard(travas.current)
    }
  }

  // ---------------- o que mostrar ----------------
  const parada = linha ? geracaoParada(linha) : false
  const gerando = (linha?.status === 'gerando' && !parada) || (pedindo && !linha)
  const pronta = linha?.status === 'pronta'
  const enviada = linha?.status === 'enviada'
  const falhou = linha?.status === 'falha' || parada
  const podeRefazer = !!linha && !gerando && !pedindo && !enviando
  const consumo = linha?.consumo ?? null

  const descricao = useMemo(() => {
    if (!lead) return undefined
    // O TÍTULO DO CARD, como o Kommo o mostra: cedente, processo, parcela.
    return lead.nome?.trim() || lead.processo_cnj || undefined
  }, [lead])

  return (
    <>
      <Modal
        open={aberta}
        onClose={fechar}
        size="lg"
        title="Justificativa técnica"
        description={descricao ? <IdentificacaoDoCard titulo={descricao} /> : undefined}
        dirty={rascunho === 'erro'}
        rodapeInicio={
          podeRefazer && !semMigracao && !migracaoPelaFuncao ? (
            <Button
              variant="secondary"
              icon={<RefreshCw className={IC} aria-hidden />}
              onClick={() => setConfirmarRefazer(true)}
            >
              {falhou ? 'Tentar de novo' : 'Gerar de novo'}
            </Button>
          ) : undefined
        }
        footer={
          // [Fechar][Enviar] JUNTOS: no celular, o par quebra inteiro.
          <div className="flex gap-s2">
            <Button variant="ghost" onClick={fechar}>
              Fechar
            </Button>
            {pronta && (
              <Button
                icon={<Send className={IC} aria-hidden />}
                onClick={() => void enviar()}
                loading={enviando}
                disabled={enviando || !texto.trim() || rascunho === 'salvando'}
                title="Grava o texto como nota no card do Kommo"
              >
                Enviar
              </Button>
            )}
          </div>
        }
      >
        {semMigracao || migracaoPelaFuncao ? (
          <Aviso tom="aviso">{AVISO_MIGRACAO_0076}</Aviso>
        ) : consulta.isLoading ? (
          <div className="flex items-center gap-s2 py-s8 text-corpo text-texto-2">
            <Loader2 className="h-[16px] w-[16px] animate-spin" aria-hidden /> Abrindo…
          </div>
        ) : consulta.error ? (
          <Aviso tom="perigo">
            Não consegui ler a justificativa deste card: {(consulta.error as Error).message}
          </Aviso>
        ) : gerando ? (
          <Andamento
            fase={faseDaLinha(linha)}
            andamento={linha?.andamento ?? null}
            desde={linha?.gerado_em ?? null}
          />
        ) : falhou ? (
          <div className="space-y-s4">
            <Aviso tom="perigo">
              {parada
                ? `A geração parou no meio (${ROTULO_DA_FASE[faseDaLinha(linha)].toLowerCase()}): o servidor parou de dar sinal de progresso. Tente de novo.`
                : `A geração falhou: ${linha?.erro ?? 'motivo não informado.'}`}
            </Aviso>
            {erroDoPedido && <Aviso tom="perigo">{erroDoPedido}</Aviso>}
          </div>
        ) : erroDoPedido && !linha ? (
          <div className="space-y-s4">
            <Aviso tom="perigo">Não consegui pedir a geração: {erroDoPedido}</Aviso>
            <Button variant="secondary" icon={<RefreshCw className={IC} aria-hidden />} onClick={() => void gerar(false)}>
              Tentar de novo
            </Button>
          </div>
        ) : enviada && linha ? (
          <div className="space-y-s3">
            <p className="flex flex-wrap items-center gap-s2 text-corpo text-texto-2">
              <CheckCircle2 className="h-[16px] w-[16px] text-sucesso" aria-hidden />
              <span>
                Enviada ao Kommo{linha.enviado_por ? ` por ${linha.enviado_por}` : ''}{' '}
                <TempoRelativo valor={linha.enviado_em} />
                {(linha.nota_kommo_ids?.length ?? 0) > 1 ? `, em ${linha.nota_kommo_ids!.length} notas` : ''}.
              </span>
            </p>
            <TextoEnviado texto={textoEmVigor(linha)} />
          </div>
        ) : pronta && linha ? (
          <div className="space-y-s2">
            <p className="flex items-start gap-s2 text-xs text-texto-3">
              <AlertTriangle className="mt-[1px] h-[14px] w-[14px] shrink-0 text-aviso" aria-hidden />
              Rascunho para revisão humana: confira os fatos, os números e as fontes antes de enviar.
            </p>
            {erroDoPedido && <Aviso tom="perigo">{erroDoPedido}</Aviso>}
            <textarea
              value={corpo}
              onChange={(e) => aoDigitarCorpo(e.target.value)}
              aria-label="Texto da justificativa técnica"
              spellCheck
              // O CONTORNO E O FOCO DO CAMPO DA CASA (ui/Field): era a borda
              // forte com sombra de cartão (§0.4: só o cartão leva sombra) e o
              // anel de outro azul.
              className={cn(
                'block w-full resize-y rounded-campo border border-borda-controle bg-superficie px-s4 py-s3 font-sans text-corpo leading-relaxed text-texto outline-none transition-colors scrollbar-thin placeholder:text-texto-3 focus:border-anel focus:ring-[3px] focus:ring-anel/20',
                notas === null ? 'min-h-[46vh]' : 'min-h-[36vh]',
              )}
            />
            {notas !== null && <NotasInternas valor={notas} onChange={aoDigitarNotas} />}
            <div className="flex flex-wrap items-center gap-x-s3 gap-y-s1 text-xs text-texto-3">
              <span aria-live="polite">
                {rascunho === 'salvando'
                  ? 'Salvando rascunho…'
                  : rascunho === 'pendente'
                    ? 'Alterações por salvar…'
                    : rascunho === 'erro'
                      ? 'Rascunho não salvo — continue editando para tentar de novo'
                      : salvoEm
                        ? <>Rascunho salvo <TempoRelativo valor={salvoEm} /></>
                        : 'Texto gerado, sem edições'}
              </span>
              <span>{texto.length.toLocaleString('pt-BR')} caracteres</span>
              {linha.gerado_em && <span>Gerada <TempoRelativo valor={linha.gerado_em} /></span>}
              {consumo && (consumo.buscas || consumo.fetches) ? (
                <span className="tabular-nums">
                  {noNumero(consumo.buscas ?? 0, 'busca', 'buscas')},{' '}
                  {noNumero(consumo.fetches ?? 0, 'página aberta', 'páginas abertas')}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <Andamento fase="lendo" andamento={null} desde={null} />
        )}
      </Modal>

      <ConfirmDialog
        open={confirmarRefazer}
        title={falhou ? 'Tentar gerar de novo?' : 'Gerar a justificativa de novo?'}
        message={
          enviada
            ? 'A geração é paga (pesquisa na internet e redação pela IA). O texto enviado continua no Kommo; o novo texto ficará pronto para revisar e enviar.'
            : 'A geração é paga (pesquisa na internet e redação pela IA), e o texto atual, com as suas edições, será substituído pelo novo.'
        }
        confirmLabel="Gerar de novo"
        onClose={() => setConfirmarRefazer(false)}
        onConfirm={() => {
          setConfirmarRefazer(false)
          carregado.current = null
          cancelarRelogio()
          void gerar(true)
        }}
      />
    </>
  )
}

/**
 * A FASE DA GERAÇÃO, para a janela. A fina (planejando) vem do resumo do
 * andamento; a coluna `etapa` é a reserva das gerações de antes da mudança.
 */
function faseDaLinha(linha: Linha | null): FaseDaGeracao {
  const a = linha?.andamento
  if (a?.fase && a.fase !== 'pronta') return a.fase
  if (a?.fase === 'pronta') return 'redigindo'
  const etapa: EtapaDaJustificativa = linha?.etapa ?? 'lendo'
  return etapa
}

/**
 * As etapas da geração — lendo, planejando, pesquisando (com as frentes, "2 de
 * 4", e um ✓ em cada uma que termina) e redigindo —, a atual em destaque, e a
 * dica de que dá para fechar.
 */
function Andamento({
  fase,
  andamento,
  desde,
}: {
  fase: FaseDaGeracao
  andamento: AndamentoDaGeracao | null
  desde: string | null
}) {
  // A geração de antes da mudança não tem planejamento: três etapas, como era.
  const ordem: FaseDaGeracao[] = andamento
    ? ['lendo', 'planejando', 'pesquisando', 'redigindo']
    : ['lendo', 'pesquisando', 'redigindo']
  const atual = ordem.indexOf(fase)
  const frentes = andamento?.frentes ?? []
  const prontas = frentes.filter((f) => f.status !== 'pesquisando').length
  return (
    <div className="space-y-s5 py-s2">
      <ol className="m-0 list-none space-y-s3 p-0" aria-label="Andamento da geração">
        {ordem.map((e, i) => {
          const feita = i < atual
          const agora = i === atual
          const comFrentes = e === 'pesquisando' && frentes.length > 0 && (agora || feita)
          return (
            <li key={e} aria-current={agora ? 'step' : undefined}>
              <div className="flex items-center gap-s3">
                <span
                  className={cn(
                    'grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full border-[1.5px]',
                    feita
                      ? 'border-sucesso-cheio bg-sucesso-cheio text-white'
                      : agora
                        ? 'border-marca-viva text-marca-texto'
                        : 'border-borda-forte text-texto-3',
                  )}
                >
                  {feita ? (
                    <Check className="h-[13px] w-[13px]" strokeWidth={3} aria-hidden />
                  ) : agora ? (
                    <Loader2 className="h-[14px] w-[14px] animate-spin" aria-hidden />
                  ) : (
                    <span className="text-xs font-bold">{i + 1}</span>
                  )}
                </span>
                <span className={cn('text-corpo', agora ? 'font-semibold text-texto' : feita ? 'text-texto-2' : 'text-texto-3')}>
                  {ROTULO_DA_FASE[e]}
                  {agora ? '…' : ''}
                </span>
                {comFrentes && (
                  <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-texto-3">
                    {prontas} de {frentes.length} {frentes.length === 1 ? 'frente' : 'frentes'}
                  </span>
                )}
              </div>
              {comFrentes && (
                <ul
                  className="m-0 mt-s2 list-none space-y-s1.5 rounded-campo bg-superficie-2 py-s2 pl-s3 pr-s3 sm:ml-[36px]"
                  aria-label="Frentes da pesquisa"
                >
                  {frentes.map((f) => (
                    <li key={f.id} className="flex items-start gap-s2 text-sm">
                      <span className="mt-[2px] grid h-[16px] w-[16px] shrink-0 place-items-center">
                        {f.status === 'pronta' ? (
                          <Check className="h-[16px] w-[16px] text-sucesso" strokeWidth={3} aria-label="terminada" />
                        ) : f.status === 'falha' ? (
                          <AlertTriangle className="h-[14px] w-[14px] text-aviso" aria-label="sem resultado" />
                        ) : (
                          <Loader2 className="h-[14px] w-[14px] animate-spin text-marca-texto" aria-label="pesquisando" />
                        )}
                      </span>
                      <span className={cn('min-w-0', f.status === 'pesquisando' ? 'text-texto' : 'text-texto-2')}>
                        {f.titulo}
                        {f.parcial && f.status !== 'pesquisando' && (
                          <span className="ml-s1.5 text-xs text-texto-3">(parcial: no limite de tempo)</span>
                        )}
                        {f.status === 'falha' && <span className="ml-s1.5 text-xs text-texto-3">(sem resultado)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
      <p className="rounded-campo bg-superficie-2 px-s4 py-s3 text-corpo text-texto-2">
        A pesquisa leva alguns minutos. Pode fechar a janela: a geração continua no servidor, e o texto fica salvo
        para revisar quando você voltar.
        {desde && (
          <>
            {' '}Pedida <TempoRelativo valor={desde} />.
          </>
        )}
      </p>
    </div>
  )
}

/**
 * AS NOTAS INTERNAS (a parte depois de ###NOTAS###), numa caixa à parte: o que
 * não foi confirmado e as divergências entre fontes. Ficam SÓ na plataforma
 * (decisão do dono, 07/10/2026): o envio ao Kommo leva o parágrafo e as fontes.
 */
function NotasInternas({
  valor,
  onChange,
  enviada = false,
}: {
  valor: string
  onChange?: (v: string) => void
  enviada?: boolean
}) {
  return (
    // NO ESCURO, O ÂMBAR SÓ NO CONTORNO E NO CADEADO (auditoria visual, E7): o
    // fundo `aviso-fundo` de lá é um marrom que, na largura da janela, pesava.
    <section
      aria-label="Notas internas"
      className="rounded-campo border border-aviso-borda bg-aviso-fundo px-s4 py-s3 dark:bg-superficie-2"
    >
      <h3 className="m-0 flex items-center gap-s1.5 font-display text-xs font-bold uppercase tracking-[0.06em] text-texto-2">
        <Lock className="h-[14px] w-[14px] shrink-0 text-aviso" aria-hidden />
        Notas internas (não vão para o cedente)
      </h3>
      {enviada || !onChange ? (
        <p className="m-0 mt-s2 whitespace-pre-wrap break-words text-sm text-texto">{valor || '—'}</p>
      ) : (
        <textarea
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Notas internas (não vão para o cedente)"
          rows={4}
          spellCheck
          className="mt-s2 block w-full resize-y rounded-campo border border-borda-controle bg-superficie px-s3 py-s2 font-sans text-sm leading-relaxed text-texto outline-none transition-colors scrollbar-thin focus:border-anel focus:ring-[3px] focus:ring-anel/20"
        />
      )}
      <p className="m-0 mt-s2 text-xs text-texto-3">
        {enviada
          ? 'Ficaram salvas só aqui, na plataforma; não foram para o Kommo.'
          : 'Ficam só aqui, na plataforma: não vão para o Kommo nem para o cedente.'}
      </p>
    </section>
  )
}

/** O texto enviado, só leitura — com as notas internas na caixa delas, se houver. */
function TextoEnviado({ texto }: { texto: string }) {
  const partes = separarNotas(texto)
  return (
    <>
      <pre
        tabIndex={0}
        aria-label="Texto enviado (só leitura)"
        className="max-h-[52vh] overflow-y-auto whitespace-pre-wrap break-words rounded-campo border border-borda bg-superficie-2 p-s4 font-sans text-corpo leading-relaxed text-texto scrollbar-thin"
      >
        {partes.corpo}
      </pre>
      {partes.notas !== null && <NotasInternas valor={partes.notas} enviada />}
    </>
  )
}

/**
 * O aviso da janela: a CAIXA DA ANÁLISE (`CaixaDeAviso`), a mesma das janelas
 * da cotação e do envio ao fundo — esta tinha uma cópia própria, com outro
 * recuo e outro ícone de erro.
 */
function Aviso({ tom, children }: { tom: 'aviso' | 'perigo'; children: ReactNode }) {
  return (
    <CaixaDeAviso tom={tom} role={tom === 'perigo' ? 'alert' : 'status'}>
      {children}
    </CaixaDeAviso>
  )
}

/** "1 busca", "21 buscas". */
const noNumero = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`
