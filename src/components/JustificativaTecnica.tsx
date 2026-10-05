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
  RefreshCw,
  Send,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { supabase } from '@/lib/supabase'
import { codigoDoErro, invokeFunction } from '@/lib/functions'
import { comecarNoCard, terminarNoCard, type PorCard } from '@/lib/emCursoPorCard'
import type { KommoLead } from '@/lib/types'
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
  geracaoParada,
  type LinhaDaJustificativa,
  ROTULO_DA_ETAPA,
  textoEmVigor,
} from '../../supabase/functions/_shared/justificativaTecnica.ts'

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
      {gerando ? 'Gerando justificativa…' : pronta ? 'Revisar justificativa' : 'Justificativa técnica'}
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
}

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

  const consulta = useQuery({
    queryKey: [TABELA, leadId],
    enabled: aberta,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from(TABELA).select('*').eq('kommo_lead_id', leadId).maybeSingle()
      if (error) throw error
      return (data ?? null) as Linha | null
    },
    refetchInterval: (q) => {
      const l = q.state.data as Linha | null | undefined
      return l?.status === 'gerando' && !geracaoParada(l) ? CONSULTA_MS : false
    },
  })
  const linha = consulta.data ?? null
  const semMigracao = !!consulta.error && ehTabelaAusente(consulta.error)

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
        if (codigoDoErro(e) === 'migracao-pendente') setMigracaoPelaFuncao(true)
        else setErroDoPedido((e as Error).message)
      } finally {
        setPedindo(false)
      }
    },
    [leadId, atualizar],
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
  const [texto, setTexto] = useState('')
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
    setTexto(t)
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
      setRascunho('salvando')
      try {
        const r = await invokeFunction<{ rascunho_em: string }>(FUNCAO, {
          acao: 'rascunho', kommo_lead_id: linha.kommo_lead_id, tentativa: linha.tentativa, texto: valor,
        })
        ultimoEnviado.current = valor
        setSalvoEm(r?.rascunho_em ?? new Date().toISOString())
        setRascunho('salvo')
      } catch (e) {
        setRascunho('erro')
        toast.error(`O rascunho não foi salvo: ${(e as Error).message}`)
      }
    },
    [linha, toast],
  )

  const cancelarRelogio = () => {
    if (relogio.current !== null) window.clearTimeout(relogio.current)
    relogio.current = null
  }
  useEffect(() => cancelarRelogio, [])

  function aoDigitar(valor: string) {
    setTexto(valor)
    setRascunho('pendente')
    cancelarRelogio()
    relogio.current = window.setTimeout(() => void salvarRascunho(valor), ESPERA_RASCUNHO_MS)
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
      onFechar()
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
        description={descricao}
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
          <>
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
          </>
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
          <Andamento etapa={linha?.etapa ?? 'lendo'} desde={linha?.gerado_em ?? null} />
        ) : falhou ? (
          <div className="space-y-s4">
            <Aviso tom="perigo">
              {parada
                ? `A geração parou no meio (${ROTULO_DA_ETAPA[linha?.etapa ?? 'lendo'].toLowerCase()}): o servidor interrompeu a etapa. Tente de novo.`
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
            <pre
              tabIndex={0}
              aria-label="Texto enviado (só leitura)"
              className="max-h-[52vh] overflow-y-auto whitespace-pre-wrap break-words rounded-campo border border-borda bg-superficie-2 p-s4 font-sans text-corpo leading-relaxed text-texto scrollbar-thin"
            >
              {textoEmVigor(linha)}
            </pre>
          </div>
        ) : pronta && linha ? (
          <div className="space-y-s2">
            <p className="flex items-start gap-s2 text-xs text-texto-3">
              <AlertTriangle className="mt-[1px] h-[14px] w-[14px] shrink-0 text-aviso" aria-hidden />
              Rascunho para revisão humana: confira os fatos, os números e as fontes antes de enviar.
            </p>
            {erroDoPedido && <Aviso tom="perigo">{erroDoPedido}</Aviso>}
            <textarea
              value={texto}
              onChange={(e) => aoDigitar(e.target.value)}
              aria-label="Texto da justificativa técnica"
              spellCheck
              className="block min-h-[46vh] w-full resize-y rounded-campo border border-borda-forte bg-superficie px-s4 py-s3 font-sans text-corpo leading-relaxed text-texto shadow-nivel-1 outline-none transition-colors scrollbar-thin placeholder:text-texto-3 focus:border-marca-viva focus:ring-[3px] focus:ring-marca-viva/20"
            />
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
                <span>
                  {consumo.buscas ?? 0} busca(s), {consumo.fetches ?? 0} página(s) aberta(s)
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <Andamento etapa="lendo" desde={null} />
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

/** As três etapas da geração, com a atual em destaque e a dica de que dá para fechar. */
function Andamento({ etapa, desde }: { etapa: EtapaDaJustificativa; desde: string | null }) {
  const ordem: EtapaDaJustificativa[] = ['lendo', 'pesquisando', 'redigindo']
  const atual = ordem.indexOf(etapa)
  return (
    <div className="space-y-s5 py-s2">
      <ol className="m-0 list-none space-y-s3 p-0" aria-label="Andamento da geração">
        {ordem.map((e, i) => {
          const feita = i < atual
          const agora = i === atual
          return (
            <li key={e} className="flex items-center gap-s3" aria-current={agora ? 'step' : undefined}>
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
                {ROTULO_DA_ETAPA[e]}
                {agora ? '…' : ''}
              </span>
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

function Aviso({ tom, children }: { tom: 'aviso' | 'perigo'; children: ReactNode }) {
  return (
    <p
      role={tom === 'perigo' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-s2 rounded-campo border px-s4 py-s3 text-corpo text-texto',
        tom === 'perigo' ? 'border-perigo-borda bg-perigo-fundo' : 'border-aviso-borda bg-aviso-fundo',
      )}
    >
      <AlertTriangle
        className={cn('mt-[3px] h-[16px] w-[16px] shrink-0', tom === 'perigo' ? 'text-perigo' : 'text-aviso')}
        aria-hidden
      />
      <span>{children}</span>
    </p>
  )
}
