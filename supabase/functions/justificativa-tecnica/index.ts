// justificativa-tecnica — a justificativa técnica do PREÇO da proposta ao cedente.
//
// Pedido do dono em 05/10/2026 (ver _shared/justificativaTecnica.ts). Na
// Produção de proposta, a janela pede a geração; a IA pesquisa a situação de
// pagamento do ente, o contexto normativo e o deságio de mercado, e redige; a
// pessoa edita, e o Enviar grava o texto como NOTA no card do Kommo.
//
// AS AÇÕES (POST, corpo JSON):
//   gerar     { kommo_lead_id, refazer? }      usuário ativo — abre a geração
//   rascunho  { kommo_lead_id, tentativa, texto } usuário ativo — a edição salva
//   enviar    { kommo_lead_id, tentativa, texto, autor? } usuário ativo — a nota
//   passo     { kommo_lead_id, tentativa, etapa, frente?, anterior? } SÓ INTERNA
// A tela LÊ a tabela direto (RLS de leitura) e acompanha por consulta periódica.
//
// O SEGUNDO PLANO, EM FRENTES PARALELAS E RESUMÍVEIS (05/10/2026). A Edge
// Function tem teto de parede (400 s no plano pago) que `EdgeRuntime.waitUntil`
// NÃO estende. Com o prompt do dono, a pesquisa numa invocação só passava do
// teto e morria. Agora (o desenho inteiro está em _shared/justificativaParalela.ts):
//   gerar        → lê o card (dados, título e notas), monta o prompt, reserva a
//                  linha e dispara o planejamento (responde na hora);
//   planejamento → uma chamada curta ('low', sem ferramenta, saída estruturada)
//                  divide a pesquisa em 3 a 4 frentes e dispara todas;
//   frente       → cada uma na sua invocação ('medium', tetos próprios). Perto
//                  do fim do relógio, salva a conversa e dispara a continuação;
//                  a última a terminar dispara a redação, uma vez só;
//   redação      → ('high') escreve a partir dos dossiês juntos.
//
// CADA INVOCAÇÃO INTERNA RESPONDE NA HORA e trabalha em `waitUntil`: o fetch de
// quem dispara volta em milissegundos, e nenhum worker fica preso esperando a
// próxima etapa terminar (era o custo do encadeamento antigo — ver tetosRpv.ts).
//
// O PULSO: toda invocação viva grava `atualizado_em` a cada PULSO_MS; parada
// (sem pulso) há mais de TRAVA_GERACAO_MIN é morte, e a tela oferece tentar de
// novo. A morte é medida por falta de progresso, não pelo tempo total.
//
// UMA GERAÇÃO POR CARD, com trava atômica no banco: a linha é o lock. Entrar em
// 'gerando' é um UPDATE condicional na `tentativa` lida (ou o insert que não
// pisa em linha existente) — de duas abas, só uma vê a linha mudar. Cada etapa
// só grava se a `tentativa` ainda for a dela, e o pulso que descobre a
// tentativa trocada CORTA a chamada paga em curso.
//
// AS FRENTES DIVIDEM A LINHA pelo jsonb `pesquisa`, com gravação condicional ao
// `pesquisa->>rev` (gravarComVersao): sem migração, e sem perder gravação.
//
// LIMITE DE TAXA: vagas de pesquisa contadas em frentes (VAGAS_DE_PESQUISA); e a
// SDK repete sozinha o 429 da Anthropic (duas vezes, com espera).
//
// ANTES DA MIGRAÇÃO 0076 a tabela não existe: toda ação responde 409 com
// `codigo: 'migracao-pendente'` e a frase de AVISO_MIGRACAO_0076 — nada é
// gerado, nada é cobrado, e nenhuma outra função depende desta.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import { ESFORCO_PADRAO_DO_OPUS, lerSaidaEstruturada, type NoFormatoDoOpus } from '../_shared/respostaDoClaude.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic, contaKommo } from '../_shared/segredos.ts'
import { postarNotas } from '../_shared/anotarNoKommo.ts'
import { consultarTeto } from '../_shared/tetosRpv.ts'
import { municipioDoEnte, resolverUf } from '../_shared/tribunais.ts'
import {
  aceitaRascunho,
  AVISO_MIGRACAO_0076,
  blocoDoCard,
  CHAVE_PROMPT_JUSTIFICATIVA,
  type CardDaJustificativa,
  type ConsumoDaJustificativa,
  CONSUMO_ZERO,
  dividirNota,
  separarNotas,
  ehTabelaAusente,
  esferaDoEnte,
  type FonteDaJustificativa,
  FUNIL_RPV_JUSTIFICATIVA,
  FUNIS_DA_JUSTIFICATIVA,
  type LinhaDaJustificativa,
  listaDeFontes,
  montarPrompt,
  podeEnviar,
  podeGerar,
  promptEmVigor,
  PULSO_MS,
  somarConsumo,
  textoComFontes,
  textoDoTeto,
  TRAVA_ENVIO_MIN,
  TRAVA_GERACAO_MIN,
  valoresDoCard,
} from '../_shared/justificativaTecnica.ts'
import {
  type AndamentoDaGeracao,
  aposInterrupcao,
  aposResposta,
  type BlocoDaConversa,
  cabeMaisUmaGeracao,
  comPlano,
  consumoTotal,
  conversaParaEncerrar,
  decidirFrente,
  dossieDaConversa,
  dossiesDaLinha,
  ehEstadoV2,
  ESQUEMA_DO_PLANO,
  type EstadoDaFrente,
  type EstadoDaPesquisa,
  estadoInicial,
  fecharFrente,
  FOLGA_PARA_NOVA_CHAMADA_MS,
  gravarComVersao,
  MAX_TOKENS_DA_PAGINA,
  type MensagemDaConversa,
  type MudancaDoEstado,
  ORCAMENTO_DA_INVOCACAO_MS,
  pedidoDaFrente,
  pedidoDoPlanejamento,
  planoDaSaida,
  salvarCheckpoint,
  somarConsumos,
  SISTEMA_FRENTE,
  SISTEMA_FRENTE_UNICA,
  SISTEMA_PLANEJAMENTO,
  tomarFrente,
  usoDosBlocos,
  usosRestantes,
} from '../_shared/justificativaParalela.ts'

/**
 * O MESMO MODELO das funções que já pesquisam (analise-precatorio, emolumentos,
 * tetos de RPV). O texto vai ao cedente e sustenta um preço: errar uma norma ou
 * um número sai mais caro que o token.
 */
const MODELO = 'claude-opus-5-5'

/**
 * O ESFORÇO DE CADA ETAPA. Planejar é dividir um pedido em assuntos: 'low'. A
 * frente pesquisa com 'medium' — pela documentação, o Opus 5.5 em 'medium' supera
 * o Opus 5 em 'high' — e são quatro em paralelo. A redação, que sustenta o preço
 * diante do cedente, fica no 'high' de antes.
 */
const ESFORCO_PLANEJAMENTO = 'low' as const
const ESFORCO_FRENTE = 'medium' as const
const ESFORCO_REDACAO = ESFORCO_PADRAO_DO_OPUS

/** Quantas vezes a redação pode recomeçar (cortada pelo relógio ou erro passageiro). */
const MAX_TENTATIVAS_REDACAO = 2

const TABELA = 'justificativa_tecnica'

type Etapa = 'planejamento' | 'frente' | 'redacao'

// ---------------------------------------------------------------------------
// Respostas e banco
// ---------------------------------------------------------------------------

const erro = (mensagem: string, status: number, codigo?: string) =>
  jsonResponse({ error: mensagem, ...(codigo ? { codigo } : {}) }, status)

const semMigracao = () => erro(AVISO_MIGRACAO_0076, 409, 'migracao-pendente')

class TabelaAusente extends Error {}

/** A linha do card, ou null. Tabela ausente vira TabelaAusente. */
async function lerLinha(svc: SupabaseClient, leadId: number): Promise<LinhaDaJustificativa | null> {
  const { data, error } = await svc.from(TABELA).select('*').eq('kommo_lead_id', leadId).maybeSingle()
  if (error) {
    if (ehTabelaAusente(error)) throw new TabelaAusente(error.message)
    throw new Error(error.message)
  }
  return (data as LinhaDaJustificativa | null) ?? null
}

/** A linha no que as etapas leem. */
type LinhaDaEtapa = LinhaDaJustificativa & {
  prompt_usado?: string | null
  variaveis?: Record<string, string> | null
  pesquisa?: unknown
  consumo?: Partial<ConsumoDaJustificativa> | null
}

/**
 * Grava na linha SE a geração ainda for a desta tentativa e estiver gerando.
 * Devolve se gravou: falso quer dizer que outra geração tomou o lugar.
 */
async function gravarDaTentativa(
  svc: SupabaseClient,
  leadId: number,
  tentativa: string,
  campos: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await svc
    .from(TABELA)
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq('kommo_lead_id', leadId)
    .eq('tentativa', tentativa)
    .eq('status', 'gerando')
    .select('kommo_lead_id')
  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

/** O PULSO: só o `atualizado_em`, sem tocar no estado das frentes (não disputa o `rev`). */
async function pulsar(svc: SupabaseClient, leadId: number, tentativa: string): Promise<boolean> {
  try {
    return await gravarDaTentativa(svc, leadId, tentativa, {})
  } catch {
    // Falha de rede no pulso não é perda da geração: o próximo pulso tenta de novo.
    return true
  }
}

/** O estado das frentes desta geração, ou null se a linha não é mais dela. */
async function lerEstado(svc: SupabaseClient, leadId: number, tentativa: string): Promise<EstadoDaPesquisa | null> {
  const { data, error } = await svc
    .from(TABELA).select('status, tentativa, pesquisa').eq('kommo_lead_id', leadId).maybeSingle()
  if (error) throw new Error(error.message)
  const l = data as { status?: string; tentativa?: string; pesquisa?: unknown } | null
  if (!l || l.status !== 'gerando' || l.tentativa !== tentativa || !ehEstadoV2(l.pesquisa)) return null
  return l.pesquisa
}

/**
 * MUDA O ESTADO DAS FRENTES sem perder a gravação de outra frente: a gravação é
 * condicional ao `rev` lido (`pesquisa->>rev`), e quem perde relê e reaplica
 * (gravarComVersao).
 */
function mudarEstado(
  svc: SupabaseClient,
  leadId: number,
  tentativa: string,
  mudar: (e: EstadoDaPesquisa) => MudancaDoEstado,
) {
  return gravarComVersao(
    () => lerEstado(svc, leadId, tentativa),
    async (novo, revLido, colunas) => {
      const { data, error } = await svc
        .from(TABELA)
        .update({ ...colunas, pesquisa: novo, atualizado_em: new Date().toISOString() })
        .eq('kommo_lead_id', leadId)
        .eq('tentativa', tentativa)
        .eq('status', 'gerando')
        .eq('pesquisa->>rev', String(revLido))
        .select('kommo_lead_id')
      if (error) throw new Error(error.message)
      return (data?.length ?? 0) > 0
    },
    mudar,
  )
}

/**
 * O prompt em vigor. A PESQUISA É LIVRE NA INTERNET (decisão do dono,
 * 05/10/2026): sem lista de domínios — nem a que tenha ficado salva em
 * `prompts_operacao`. Quem quiser fontes oficiais pede no prompt; restringir
 * cortava o alcance da pesquisa. Leitura que falha cai no padrão: nunca sem método.
 */
async function lerConfiguracao(svc: SupabaseClient): Promise<{ prompt: string; dominios: string[] }> {
  try {
    const { data } = await svc
      .from('prompts_operacao')
      .select('texto')
      .eq('chave', CHAVE_PROMPT_JUSTIFICATIVA)
      .maybeSingle()
    return { prompt: promptEmVigor((data as { texto?: string | null } | null)?.texto ?? ''), dominios: [] }
  } catch {
    return { prompt: promptEmVigor(''), dominios: [] }
  }
}

function emSegundoPlano(p: Promise<unknown>): void {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * A próxima etapa, numa invocação NOVA — é o que zera o relógio de parede.
 * Leva a service_role no Authorization (passa pelo verify_jwt do gateway e é o
 * que a ação 'passo' aceita). A invocação chamada responde na hora (o trabalho
 * dela corre em waitUntil), então isto volta rápido; falhando o disparo, tenta
 * mais uma vez antes de desistir — sem o disparo, a geração morre por falta de
 * pulso e a tela oferece tentar de novo.
 */
function dispararEtapa(
  leadId: number,
  tentativa: string,
  etapa: Etapa,
  extra: { frente?: string; anterior?: string | null } = {},
): Promise<void> {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/justificativa-tecnica`
  const corpo = JSON.stringify({ acao: 'passo', kommo_lead_id: leadId, tentativa, etapa, ...extra })
  const uma = () =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
        'x-cron-secret': Deno.env.get('CRON_SECRET') ?? '',
      },
      body: corpo,
    }).then(async (r) => {
      await r.body?.cancel().catch(() => {})
      return r.ok
    }).catch(() => false)
  const p = (async () => {
    if (await uma()) return
    await dormir(1_500)
    await uma()
  })()
  emSegundoPlano(p)
  return p
}

/** A mensagem que a pessoa lê quando a IA falha — sem pilha, sem inglês cru. */
function mensagemDaFalha(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) {
    return 'A Anthropic recusou por limite de uso (muitas chamadas ao mesmo tempo). Tente de novo em alguns minutos.'
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return 'A chave da Anthropic foi recusada. Confira em Configurações → Anthropic.'
  }
  if (e instanceof Anthropic.APIUserAbortError || (e as Error)?.name === 'AbortError' || (e as Error)?.name === 'TimeoutError') {
    return 'A etapa passou do tempo que o servidor permite. Tente de novo; se repetir, reduza o pedido do prompt.'
  }
  if (e instanceof Anthropic.APIError) return `A Anthropic respondeu com erro (HTTP ${e.status ?? '?'}): ${e.message}`
  return (e as Error)?.message ?? String(e)
}

/** Erro passageiro da API (vale tentar de novo noutra invocação, em vez de falhar a frente). */
function ehPassageiro(e: unknown): boolean {
  return (
    e instanceof Anthropic.RateLimitError ||
    e instanceof Anthropic.InternalServerError ||
    e instanceof Anthropic.APIConnectionError ||
    (e instanceof Anthropic.APIError && (e.status === 529 || e.status === 503))
  )
}

// ---------------------------------------------------------------------------
// A chamada com relógio
// ---------------------------------------------------------------------------

interface Relogio {
  inicio: number
  /** O pulso descobriu que a geração foi refeita por cima: parar tudo, sem gravar. */
  perdeu: boolean
  /** Corta a chamada em curso (o pulso usa quando perde a geração). */
  cortar: (() => void) | null
}

const restante = (r: Relogio) => ORCAMENTO_DA_INVOCACAO_MS - (Date.now() - r.inicio)

/** Liga o pulso desta invocação; devolve o desligar. */
function ligarPulso(svc: SupabaseClient, leadId: number, tentativa: string, r: Relogio): () => void {
  const id = setInterval(() => {
    void pulsar(svc, leadId, tentativa).then((viva) => {
      if (!viva) {
        r.perdeu = true
        r.cortar?.()
      }
    })
  }, PULSO_MS)
  return () => clearInterval(id)
}

type Chamada =
  | { tipo: 'completa'; resposta: Anthropic.Message }
  | { tipo: 'cortada'; blocos: BlocoDaConversa[]; usage: Anthropic.Usage | null }

/**
 * UMA CHAMADA EM STREAM, cortada no fim do relógio da invocação. Os blocos que
 * chegam INTEIROS (o fim de cada bloco no stream) vão sendo guardados tal como
 * a API os mandou: é deles que sai o checkpoint quando o relógio corta.
 */
async function chamarComRelogio(
  anthropic: Anthropic,
  r: Relogio,
  params: Anthropic.MessageStreamParams,
): Promise<Chamada> {
  const controle = new AbortController()
  const relogio = setTimeout(() => controle.abort(), Math.max(5_000, restante(r)))
  r.cortar = () => controle.abort()
  const completos: BlocoDaConversa[] = []
  const stream = anthropic.messages.stream(params, { signal: controle.signal })
  stream.on('contentBlock', (b) => completos.push(JSON.parse(JSON.stringify(b)) as BlocoDaConversa))
  try {
    return { tipo: 'completa', resposta: await stream.finalMessage() }
  } catch (e) {
    if (controle.signal.aborted) {
      return { tipo: 'cortada', blocos: completos, usage: (stream.currentMessage?.usage as Anthropic.Usage | undefined) ?? null }
    }
    throw e
  } finally {
    clearTimeout(relogio)
    r.cortar = null
  }
}

// ---------------------------------------------------------------------------
// Etapa 1: o planejamento
// ---------------------------------------------------------------------------

async function planejar(svc: SupabaseClient, leadId: number, tentativa: string): Promise<void> {
  const r: Relogio = { inicio: Date.now(), perdeu: false, cortar: null }
  const linha = (await lerLinha(svc, leadId)) as LinhaDaEtapa | null
  if (!linha || linha.status !== 'gerando' || linha.tentativa !== tentativa) return
  // UMA GERAÇÃO DE ANTES DA MUDANÇA (a etapa antiga 'pesquisa'): nasce no formato
  // novo aqui, com o prompt padrão como propósito das frentes.
  if (!ehEstadoV2(linha.pesquisa)) {
    const { prompt } = await lerConfiguracao(svc)
    if (!(await gravarDaTentativa(svc, leadId, tentativa, { pesquisa: estadoInicial(prompt) }))) return
    return planejar(svc, leadId, tentativa)
  }
  const estado = linha.pesquisa
  if (estado.fase !== 'planejando') return // disparo repetido: o plano já foi feito
  const desligar = ligarPulso(svc, leadId, tentativa, r)
  try {
    await pulsar(svc, leadId, tentativa)
    const valores = (linha.variaveis ?? {}) as Record<string, string>
    let frentes: ReturnType<typeof planoDaSaida> = null
    let motivo: string | null = null
    let consumo: ConsumoDaJustificativa = { ...CONSUMO_ZERO, modelo: MODELO }
    try {
      const anthropic = new Anthropic({ apiKey: (await chaveAnthropic()) ?? '' })
      const resposta = await anthropic.messages.create(
        {
          model: MODELO,
          // O raciocínio (sempre ligado no 5.5) conta dentro deste teto; em
          // 'low' ele é curto, e o plano é um JSON de poucas centenas de palavras.
          max_tokens: 8000,
          output_config: {
            effort: ESFORCO_PLANEJAMENTO,
            format: { type: 'json_schema', schema: ESQUEMA_DO_PLANO as unknown as Record<string, unknown> },
          },
          system: SISTEMA_PLANEJAMENTO,
          messages: [{ role: 'user', content: pedidoDoPlanejamento(estado.instrucao, blocoDoCard(valores)) }],
        } satisfies NoFormatoDoOpus<Anthropic.MessageCreateParamsNonStreaming>,
        { signal: AbortSignal.timeout(150_000) },
      )
      consumo = somarConsumo(consumo, resposta.usage)
      const lida = lerSaidaEstruturada(resposta)
      if (lida.ok) {
        frentes = planoDaSaida(lida.valor)
        if (!frentes) motivo = 'o plano veio com menos de duas frentes legíveis'
      } else motivo = `saída do planejamento ${lida.motivo}`
    } catch (e) {
      // O PLANO FALHOU: segue com a frente única (o comportamento de antes, agora
      // resumível) — planejar é ganho, não condição.
      motivo = mensagemDaFalha(e)
    }
    if (r.perdeu) return
    const segundos = Math.round((Date.now() - r.inicio) / 1000)
    const feito = await mudarEstado(svc, leadId, tentativa, (e) =>
      e.fase === 'planejando'
        ? { estado: comPlano(e, frentes, motivo, { ...consumo, segundos }), colunas: { etapa: 'pesquisando' } }
        : null,
    )
    if (!feito.ok) return
    await Promise.all(feito.estado.frentes.map((f) => dispararEtapa(leadId, tentativa, 'frente', { frente: f.id, anterior: null })))
  } finally {
    desligar()
  }
}

// ---------------------------------------------------------------------------
// Etapa 2: uma frente (uma invocação dela)
// ---------------------------------------------------------------------------

async function rodarFrente(
  svc: SupabaseClient,
  leadId: number,
  tentativa: string,
  frenteId: string,
  anterior: string | null,
): Promise<void> {
  const r: Relogio = { inicio: Date.now(), perdeu: false, cortar: null }
  const invocacao = crypto.randomUUID()
  const tomada = await mudarEstado(svc, leadId, tentativa, (e) => {
    const n = tomarFrente(e, frenteId, invocacao, anterior)
    return n ? { estado: n } : null
  })
  if (!tomada.ok) return
  const estado = tomada.estado
  const f0 = estado.frentes.find((x) => x.id === frenteId)!

  const { data: dados } = await svc.from(TABELA).select('prompt_usado, variaveis').eq('kommo_lead_id', leadId).maybeSingle()
  const linha = (dados ?? {}) as { prompt_usado?: string | null; variaveis?: Record<string, string> | null }

  // O ESTADO DE TRABALHO desta invocação, que vai para o checkpoint.
  let conversa: MensagemDaConversa[] = f0.conversa ?? [
    {
      role: 'user',
      content: f0.unica
        ? `TAREFA:\n\n${String(linha.prompt_usado ?? '')}`
        : pedidoDaFrente(f0, linha.variaveis ?? {}, estado.instrucao),
    },
  ]
  let consumo: ConsumoDaJustificativa = { ...CONSUMO_ZERO, ...f0.consumo, modelo: MODELO }
  let retomadas = f0.retomadas
  let semAvanco = f0.interrupcoes_sem_avanco
  let container = f0.container
  /** A frente terminou o turno sem escrever o dossiê: a próxima chamada é o pedido dele. */
  let pedirDossie = false
  const segundos = () => f0.segundos + Math.round((Date.now() - r.inicio) / 1000)

  const anthropic = new Anthropic({ apiKey: (await chaveAnthropic()) ?? '' })
  const desligar = ligarPulso(svc, leadId, tentativa, r)

  /** Fecha a frente (pronta ou falha) e, se era a última, dispara a redação. */
  const fechar = async (fim: Pick<EstadoDaFrente, 'status' | 'dossie' | 'parcial' | 'erro'>) => {
    let dispara = false
    const feito = await mudarEstado(svc, leadId, tentativa, (e) => {
      const m = fecharFrente(e, frenteId, invocacao, { ...fim, consumo, segundos: segundos(), retomadas })
      if (!m) return null
      dispara = m.disparaRedacao
      return { estado: m.estado, colunas: m.disparaRedacao ? { etapa: 'redigindo' } : {} }
    })
    // A TRAVA DA REDAÇÃO: a marca entrou na mesma gravação condicional que
    // fechou a frente. Só quem gravou com ela dispara.
    if (feito.ok && dispara) await dispararEtapa(leadId, tentativa, 'redacao')
  }

  /** Salva a conversa e passa a frente para uma invocação nova (relógio zerado). */
  const ceder = async (esperarMs = 0) => {
    const feito = await mudarEstado(svc, leadId, tentativa, (e) => {
      const n = salvarCheckpoint(e, frenteId, invocacao, {
        conversa, container, retomadas, interrupcoes_sem_avanco: semAvanco, consumo, segundos: segundos(),
      })
      return n ? { estado: n } : null
    })
    if (!feito.ok) return
    if (esperarMs > 0) await dormir(Math.min(esperarMs, Math.max(0, restante(r) - 20_000)))
    await dispararEtapa(leadId, tentativa, 'frente', { frente: frenteId, anterior: invocacao })
  }

  try {
    for (;;) {
      if (r.perdeu) return
      const decisao = decidirFrente(
        { ...f0, consumo, interrupcoes_sem_avanco: semAvanco },
        restante(r),
      )
      if (decisao === 'ceder') return await ceder()
      if (decisao === 'desistir') {
        const dossie = dossieDaConversa(conversa)
        return await fechar({
          status: dossie.texto.trim() ? 'pronta' : 'falha', dossie, parcial: true,
          erro: dossie.texto.trim() ? null : 'a frente passou do teto de invocações sem escrever o dossiê',
        })
      }
      const encerrar = decisao === 'encerrar' || pedirDossie
      const mensagens = encerrar ? conversaParaEncerrar(conversa) : conversa
      const usos = usosRestantes({ consumo, unica: f0.unica })
      const ferramentas = [
        { type: 'web_search_20260209', name: 'web_search', max_uses: usos.buscas },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: usos.paginas, max_content_tokens: MAX_TOKENS_DA_PAGINA },
      ]
      // O CONTÊINER do filtro dinâmico da busca volta junto ao continuar, enquanto vale.
      const conteinerValido =
        container && (!container.expires_at || Date.parse(container.expires_at) > Date.now() + 60_000) ? container.id : undefined
      let chamada: Chamada
      try {
        chamada = await chamarComRelogio(anthropic, r, {
          model: MODELO,
          max_tokens: 32000,
          output_config: { effort: ESFORCO_FRENTE },
          system: f0.unica ? SISTEMA_FRENTE_UNICA : SISTEMA_FRENTE,
          // AS MESMAS FERRAMENTAS SEMPRE: a conversa traz blocos delas, e uma
          // chamada pendente de um pause_turn exige a ferramenta declarada. No
          // encerramento, 'none' — escreve com o que tem.
          tools: ferramentas as unknown as Anthropic.Tool[],
          ...(encerrar ? { tool_choice: { type: 'none' as const } } : {}),
          ...(conteinerValido ? { container: conteinerValido } : {}),
          // O CACHE AUTOMÁTICO: cada continuação reenvia a conversa inteira, com
          // os resultados das buscas e as páginas — o prefixo repetido sai a 5%.
          cache_control: { type: 'ephemeral' },
          messages: mensagens as unknown as Anthropic.MessageParam[],
        } satisfies NoFormatoDoOpus<Anthropic.MessageStreamParams>)
      } catch (e) {
        if (r.perdeu) return
        if (ehPassageiro(e)) {
          // ERRO PASSAGEIRO (limite de taxa, sobrecarga, rede): conta como uma
          // interrupção sem avanço e tenta noutra invocação, depois de esperar.
          semAvanco++
          return await ceder(e instanceof Anthropic.RateLimitError ? 30_000 : 5_000)
        }
        throw e
      }
      if (r.perdeu) return

      if (chamada.tipo === 'cortada') {
        // O RELÓGIO CORTOU: salva até o ponto seguro e continua numa invocação nova.
        const uso = usoDosBlocos(chamada.blocos)
        consumo = somarConsumo(consumo, chamada.usage
          ? { ...chamada.usage, output_tokens: 0, server_tool_use: { web_search_requests: uso.buscas, web_fetch_requests: uso.fetches } }
          : { server_tool_use: { web_search_requests: uso.buscas, web_fetch_requests: uso.fetches } })
        consumo = { ...consumo, interrompidas: (consumo.interrompidas ?? 0) + 1 }
        const depois = aposInterrupcao(mensagens, chamada.blocos)
        conversa = depois.conversa
        retomadas++
        semAvanco = depois.avancou ? 0 : semAvanco + 1
        return await ceder()
      }

      const resp = chamada.resposta
      consumo = somarConsumo(consumo, resp.usage)
      if (resp.container?.id) container = { id: resp.container.id, expires_at: resp.container.expires_at ?? null }
      const depois = aposResposta(mensagens, resp.content as unknown as BlocoDaConversa[], resp.stop_reason)
      if (depois.desfecho === 'recusa') {
        throw new Error('O modelo recusou a pesquisa (filtro de segurança da Anthropic). Revise o prompt em Configurações.')
      }
      conversa = depois.conversa
      semAvanco = 0
      if (depois.desfecho === 'continuar') {
        // pause_turn: o laço de amostragem do servidor tem teto próprio; reenviar
        // a conversa retoma de onde parou.
        retomadas++
        continue
      }
      const dossie = dossieDaConversa(conversa)
      if (dossie.texto.trim() || encerrar) {
        return await fechar({
          status: dossie.texto.trim() ? 'pronta' : 'falha', dossie, parcial: encerrar,
          erro: dossie.texto.trim() ? null : 'a frente terminou sem escrever o dossiê',
        })
      }
      // TERMINOU SEM DOSSIÊ (só buscou): pede o dossiê com o que achou, sem
      // ferramenta. Sem relógio para isso, a conversa já sai fechada com o
      // pedido e a invocação seguinte o atende.
      if (restante(r) < FOLGA_PARA_NOVA_CHAMADA_MS) {
        conversa = conversaParaEncerrar(conversa)
        return await ceder()
      }
      pedirDossie = true
    }
  } catch (e) {
    if (r.perdeu) return
    // A FRENTE FALHOU: fecha como falha, com o que tiver achado — as outras
    // seguem, e a redação diz o que faltou.
    const dossie = dossieDaConversa(conversa)
    await fechar({ status: dossie.texto.trim() ? 'pronta' : 'falha', dossie, parcial: true, erro: mensagemDaFalha(e) })
      .catch(() => {})
  } finally {
    desligar()
  }
}

// ---------------------------------------------------------------------------
// Etapa 3: a redação
// ---------------------------------------------------------------------------

const SISTEMA_REDACAO =
  'Você é analista de crédito da Credijuris e redige a JUSTIFICATIVA TÉCNICA pedida na TAREFA, para o cedente ler. ' +
  'Siga a TAREFA à risca no formato e no tom. Use SÓ os fatos do DOSSIÊ (as frentes da pesquisa) e os dados do crédito da tarefa (dados extraídos, título e notas do card); não acrescente fato, número, data, norma ou decisão que não esteja ali. ' +
  'Quando duas frentes divergirem, prefira a fonte oficial e mais recente. ' +
  'Cite as fontes pelo número entre colchetes da lista FONTES NUMERADAS, por exemplo [2] ou [1, 3], logo depois do fato; nunca cite número que não está na lista. ' +
  'Não escreva a lista de fontes (a plataforma acrescenta, logo depois do texto e antes da linha ###NOTAS###, quando a tarefa pedir essa linha). ' +
  'Se a tarefa pedir a linha ###NOTAS###, escreva-a exatamente assim, sozinha na linha. Responda só com o que a tarefa pede, sem comentário antes ou depois.'

async function redigir(
  anthropic: Anthropic,
  r: Relogio,
  tarefa: string,
  dossie: string,
  fontes: FonteDaJustificativa[],
): Promise<{ texto: string; usage: Anthropic.Usage | null; cortada: boolean }> {
  const pedido =
    `TAREFA (o pedido da casa, com os dados do crédito):\n\n${tarefa}\n\n` +
    `DOSSIÊ DA PESQUISA (por frente; os números entre colchetes indicam as fontes de cada trecho):\n\n${dossie}\n\n` +
    `FONTES NUMERADAS:\n${fontes.length > 0 ? listaDeFontes(fontes) : '(nenhuma fonte foi citada pela pesquisa)'}\n\n` +
    'Redija agora a justificativa técnica.'
  const chamada = await chamarComRelogio(anthropic, r, {
    model: MODELO,
    max_tokens: 32000,
    output_config: { effort: ESFORCO_REDACAO },
    system: SISTEMA_REDACAO,
    messages: [{ role: 'user', content: pedido }],
  } satisfies NoFormatoDoOpus<Anthropic.MessageStreamParams>)
  if (chamada.tipo === 'cortada') return { texto: '', usage: chamada.usage, cortada: true }
  const resposta = chamada.resposta
  if (resposta.stop_reason === 'refusal') {
    throw new Error('O modelo recusou a redação (filtro de segurança da Anthropic). Revise o prompt em Configurações.')
  }
  const texto = resposta.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
    .trim()
  if (!texto) throw new Error('A redação terminou sem texto. Tente de novo.')
  return { texto, usage: resposta.usage, cortada: false }
}

async function redacao(svc: SupabaseClient, leadId: number, tentativa: string): Promise<void> {
  const r: Relogio = { inicio: Date.now(), perdeu: false, cortar: null }
  const linha = (await lerLinha(svc, leadId)) as LinhaDaEtapa | null
  if (!linha || linha.status !== 'gerando' || linha.tentativa !== tentativa) return
  const v2 = ehEstadoV2(linha.pesquisa)

  // A CONTA DAS TENTATIVAS DA REDAÇÃO (cortada pelo relógio, recomeça uma vez).
  if (v2) {
    const conta = await mudarEstado(svc, leadId, tentativa, (e) =>
      e.fase === 'redigindo' && e.redacao.tentativas < MAX_TENTATIVAS_REDACAO
        ? { estado: { ...e, redacao: { ...e.redacao, tentativas: e.redacao.tentativas + 1 } }, colunas: { etapa: 'redigindo' } }
        : null,
    )
    if (!conta.ok) {
      if (conta.motivo === 'nada-a-fazer') {
        await gravarDaTentativa(svc, leadId, tentativa, {
          status: 'falha', etapa: null, erro: 'A redação passou do tempo duas vezes. Tente de novo.',
        }).catch(() => false)
      }
      return
    }
  } else if (!(await gravarDaTentativa(svc, leadId, tentativa, { etapa: 'redigindo' }))) {
    return
  }

  const desligar = ligarPulso(svc, leadId, tentativa, r)
  let consumoRedacao: ConsumoDaJustificativa = { ...CONSUMO_ZERO, modelo: MODELO }
  const consumoFinal = async (): Promise<ConsumoDaJustificativa> => {
    const e = await lerEstado(svc, leadId, tentativa).catch(() => null)
    if (e) {
      const comTempo = { ...e, tempos: { ...e.tempos, redacao_s: Math.round((Date.now() - r.inicio) / 1000) } }
      return consumoTotal(comTempo, consumoRedacao, new Date(), MODELO)
    }
    // A geração de antes da mudança: o consumo que a pesquisa gravou, mais a redação.
    const antes = { ...CONSUMO_ZERO, ...(linha.consumo ?? {}) } as ConsumoDaJustificativa
    return {
      ...antes,
      modelo: MODELO,
      chamadas: antes.chamadas + consumoRedacao.chamadas,
      input_tokens: antes.input_tokens + consumoRedacao.input_tokens,
      output_tokens: antes.output_tokens + consumoRedacao.output_tokens,
      cache_creation_input_tokens: antes.cache_creation_input_tokens + consumoRedacao.cache_creation_input_tokens,
      cache_read_input_tokens: antes.cache_read_input_tokens + consumoRedacao.cache_read_input_tokens,
      segundos: (antes.segundos ?? 0) + Math.round((Date.now() - r.inicio) / 1000),
    }
  }
  try {
    const tarefa = String(linha.prompt_usado ?? '')
    if (!tarefa.trim()) throw new Error('O prompt montado não foi gravado. Gere de novo.')
    const dossie = dossiesDaLinha(linha.pesquisa)
    if (!dossie.texto.trim()) throw new Error('A pesquisa não trouxe resultado em nenhuma frente. Tente de novo.')
    const anthropic = new Anthropic({ apiKey: (await chaveAnthropic()) ?? '' })
    const feito = await redigir(anthropic, r, tarefa, dossie.texto, dossie.fontes)
    if (r.perdeu) return
    if (feito.usage) consumoRedacao = somarConsumo(consumoRedacao, feito.usage)
    if (feito.cortada) {
      // O RELÓGIO CORTOU A REDAÇÃO: recomeça numa invocação nova (a conta acima
      // limita a MAX_TENTATIVAS_REDACAO).
      if (v2) {
        await mudarEstado(svc, leadId, tentativa, (e) => ({
          estado: {
            ...e,
            consumo_redacao: somarConsumos(e.consumo_redacao, { ...consumoRedacao, output_tokens: 0, interrompidas: 1 }),
          },
        }))
        await dispararEtapa(leadId, tentativa, 'redacao')
        return
      }
      throw new Error('A redação passou do tempo que o servidor permite. Tente de novo.')
    }
    const final = textoComFontes(feito.texto, dossie.fontes)
    const consumo = await consumoFinal()
    const campos = {
      status: 'pronta',
      etapa: null,
      texto: final.texto,
      fontes: final.fontes,
      erro: null,
      consumo,
    }
    if (v2) {
      const gravou = await mudarEstado(svc, leadId, tentativa, (e) => ({
        estado: { ...e, fase: 'pronta', tempos: { ...e.tempos, redacao_s: consumo.etapas?.redacao_s ?? null } },
        colunas: campos,
      }))
      if (gravou.ok || gravou.motivo === 'nao-e-mais-desta-geracao') return
    }
    await gravarDaTentativa(svc, leadId, tentativa, campos)
  } catch (e) {
    if (r.perdeu) return
    await gravarDaTentativa(svc, leadId, tentativa, {
      status: 'falha',
      etapa: null,
      erro: mensagemDaFalha(e),
      consumo: await consumoFinal().catch(() => consumoRedacao),
    }).catch(() => false)
  } finally {
    desligar()
  }
}

// ---------------------------------------------------------------------------
// As ações
// ---------------------------------------------------------------------------

/** O teto de RPV do ente, SÓ LENDO o cache (sem disparar pesquisa paga). */
async function tetoDoCard(svc: SupabaseClient, card: CardDaJustificativa, ente: string, tribunal: string): Promise<string> {
  if (Number(card.pipeline_id) !== FUNIL_RPV_JUSTIFICATIVA || !ente) return ''
  try {
    const esfera = esferaDoEnte(ente, tribunal)
    if (!esfera) return ''
    const uf = card.oportunidade?.ficha?.uf || resolverUf({ numero_processo: card.processo_cnj, tribunal }).uf
    const municipio = esfera === 'municipal' ? municipioDoEnte(ente) : null
    const t = await consultarTeto(svc, uf, esfera, new Date().getFullYear(), municipio, false)
    return t.estado === 'pronto' ? textoDoTeto(t) : ''
  } catch {
    return ''
  }
}

async function gerar(req: Request, svc: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const caller = await getCallerAtivo(req, svc)
  if (!caller) return erro(ERRO_ACESSO, 401)
  const leadId = Number(body.kommo_lead_id)
  if (!leadId) return erro('kommo_lead_id é obrigatório.', 400)
  const refazer = body.refazer === true

  const linha = await lerLinha(svc, leadId)
  const pode = podeGerar(linha, refazer)
  // NÃO PAGA DE NOVO: a geração em curso ou a já feita é a que vale.
  if (!pode.ok) return jsonResponse({ ok: true, estado: linha?.status, motivo: pode.motivo })

  const { data: cardLido, error: erroCard } = await svc
    .from('kommo_leads').select('*').eq('kommo_lead_id', leadId).maybeSingle()
  if (erroCard) return erro(`Não consegui ler o card: ${erroCard.message}`, 500)
  const card = cardLido as CardDaJustificativa | null
  if (!card) return erro('O card não está no espelho da plataforma. Sincronize o Kommo e tente de novo.', 404)
  if (!FUNIS_DA_JUSTIFICATIVA[Number(card.pipeline_id)]) {
    return erro('A justificativa técnica é só para cards de RPV e de precatório (interno e externo).', 400)
  }

  const chave = await chaveAnthropic()
  if (!chave) return erro('Chave da Anthropic não configurada. Veja Configurações → Anthropic.', 400)

  // O LIMITE DE TAXA DA CASA, em vagas de pesquisa (frentes). Só o resumo
  // pequeno do andamento é lido — o estado das frentes, com as conversas, não.
  const desde = new Date(Date.now() - TRAVA_GERACAO_MIN * 60_000).toISOString()
  const { data: vivas } = await svc
    .from(TABELA).select('kommo_lead_id, andamento:pesquisa->andamento')
    .eq('status', 'gerando').gt('atualizado_em', desde)
  const andamentos = ((vivas ?? []) as { andamento?: AndamentoDaGeracao | null }[]).map((v) => v.andamento ?? null)
  if (!cabeMaisUmaGeracao(andamentos)) {
    return erro(
      `Já há ${andamentos.length} justificativa(s) pesquisando agora, e a casa limita quantas pesquisas correm ao mesmo tempo. Tente de novo em alguns minutos.`,
      429,
      'fila-cheia',
    )
  }

  // A TRAVA: entrar em 'gerando' é condicional ao que se leu.
  const { prompt, dominios } = await lerConfiguracao(svc)
  const tentativa = crypto.randomUUID()
  const agora = new Date()
  const inicio = {
    kommo_lead_id: leadId,
    pipeline_id: Number(card.pipeline_id),
    status: 'gerando',
    etapa: 'lendo',
    tentativa,
    texto: null,
    texto_editado: null,
    rascunho_em: null,
    fontes: [],
    pesquisa: estadoInicial(prompt, agora),
    erro: null,
    consumo: {},
    criado_por: caller.email ?? null,
    gerado_em: agora.toISOString(),
    atualizado_em: agora.toISOString(),
    enviando_desde: null,
  }
  let ganhou = false
  if (!linha) {
    const { data, error } = await svc.from(TABELA)
      .upsert(inicio, { onConflict: 'kommo_lead_id', ignoreDuplicates: true }).select('kommo_lead_id')
    if (error) throw new Error(error.message)
    ganhou = (data?.length ?? 0) > 0
  } else {
    const { data, error } = await svc.from(TABELA)
      .update(inicio).eq('kommo_lead_id', leadId).eq('tentativa', linha.tentativa ?? '').eq('status', linha.status)
      .select('kommo_lead_id')
    if (error) throw new Error(error.message)
    ganhou = (data?.length ?? 0) > 0
  }
  // Outra aba (ou o clique repetido) chegou antes: a geração dela é a que vale.
  if (!ganhou) return jsonResponse({ ok: true, estado: 'gerando', motivo: 'em-curso' })

  try {
    // LENDO O CRÉDITO: as variáveis (com o título e as notas do card) e o prompt
    // montado, guardados na linha — é o que permite conferir depois com que
    // dados a IA trabalhou, e é o que as etapas leem.
    const previa = valoresDoCard(card)
    const valores = valoresDoCard(card, { tetoRpv: await tetoDoCard(svc, card, previa.ente_devedor, previa.tribunal) })
    const { texto: tarefa, desconhecidas } = montarPrompt(prompt, valores)
    await gravarDaTentativa(svc, leadId, tentativa, {
      prompt_usado: tarefa,
      variaveis: { ...valores, ...(desconhecidas.length ? { _desconhecidas: desconhecidas.join(', ') } : {}) },
      dominios,
    })
    void dispararEtapa(leadId, tentativa, 'planejamento')
    return jsonResponse({ ok: true, estado: 'gerando', tentativa })
  } catch (e) {
    await gravarDaTentativa(svc, leadId, tentativa, { status: 'falha', etapa: null, erro: mensagemDaFalha(e) }).catch(() => false)
    return erro(`Não consegui começar a geração: ${mensagemDaFalha(e)}`, 500)
  }
}

/**
 * UMA ETAPA INTERNA. Quem chama já recebeu a resposta (202): o trabalho corre
 * aqui, em segundo plano, dentro do relógio desta invocação.
 */
async function executarPasso(svc: SupabaseClient, body: Record<string, unknown>): Promise<void> {
  const leadId = Number(body.kommo_lead_id)
  const tentativa = String(body.tentativa ?? '')
  if (!leadId || !tentativa) return
  const etapa = String(body.etapa ?? '')
  try {
    // 'pesquisa' é o nome antigo: uma geração começada antes da mudança cai no
    // planejamento e segue no desenho novo.
    if (etapa === 'planejamento' || etapa === 'pesquisa') return await planejar(svc, leadId, tentativa)
    if (etapa === 'frente') {
      return await rodarFrente(svc, leadId, tentativa, String(body.frente ?? ''), body.anterior ? String(body.anterior) : null)
    }
    if (etapa === 'redacao') return await redacao(svc, leadId, tentativa)
  } catch (e) {
    // O imprevisto (banco fora, por exemplo): a geração vira falha com o motivo,
    // em vez de morrer calada.
    await gravarDaTentativa(svc, leadId, tentativa, { status: 'falha', etapa: null, erro: mensagemDaFalha(e) }).catch(() => false)
  }
}

async function rascunho(req: Request, svc: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const caller = await getCallerAtivo(req, svc)
  if (!caller) return erro(ERRO_ACESSO, 401)
  const leadId = Number(body.kommo_lead_id)
  const tentativa = String(body.tentativa ?? '')
  const texto = String(body.texto ?? '')
  if (!leadId || !tentativa) return erro('kommo_lead_id e tentativa são obrigatórios.', 400)
  const linha = await lerLinha(svc, leadId)
  if (!aceitaRascunho(linha) || linha?.tentativa !== tentativa) {
    return erro('Esta justificativa mudou (foi enviada ou gerada de novo). Reabra a janela.', 409, 'rascunho-recusado')
  }
  const agora = new Date().toISOString()
  // CONDICIONAL À TENTATIVA E AO ESTADO: o rascunho de uma geração antiga não
  // pisa no texto de uma nova, nem num registro já enviado.
  const { data, error } = await svc.from(TABELA)
    .update({ texto_editado: texto, rascunho_em: agora, atualizado_em: agora })
    .eq('kommo_lead_id', leadId).eq('tentativa', tentativa).eq('status', 'pronta')
    .select('kommo_lead_id')
  if (error) throw new Error(error.message)
  if ((data?.length ?? 0) === 0) {
    return erro('Esta justificativa mudou (foi enviada ou gerada de novo). Reabra a janela.', 409, 'rascunho-recusado')
  }
  return jsonResponse({ ok: true, rascunho_em: agora })
}

async function enviar(req: Request, svc: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const caller = await getCallerAtivo(req, svc)
  if (!caller) return erro(ERRO_ACESSO, 401)
  const leadId = Number(body.kommo_lead_id)
  const tentativa = String(body.tentativa ?? '')
  const texto = String(body.texto ?? '').trim()
  const autor = String(body.autor ?? '').trim() || caller.email || null
  if (!leadId || !tentativa) return erro('kommo_lead_id e tentativa são obrigatórios.', 400)

  const linha = await lerLinha(svc, leadId)
  const pode = podeEnviar(linha, texto)
  if (!pode.ok) return erro(pode.erro, 409, 'envio-recusado')
  if (linha?.tentativa !== tentativa) {
    return erro('Esta justificativa foi gerada de novo em outra janela. Reabra antes de enviar.', 409, 'envio-recusado')
  }

  // A TRAVA DO ENVIO, no banco: só passa quem marcar `enviando_desde` numa
  // linha pronta, desta tentativa, sem outro envio vivo. O texto vai junto — é
  // o rascunho final, e não se perde se o Kommo recusar.
  const agora = new Date()
  const vencido = new Date(agora.getTime() - TRAVA_ENVIO_MIN * 60_000).toISOString()
  const { data: travou, error: erroTrava } = await svc.from(TABELA)
    .update({ enviando_desde: agora.toISOString(), texto_editado: texto, rascunho_em: agora.toISOString() })
    .eq('kommo_lead_id', leadId).eq('tentativa', tentativa).eq('status', 'pronta')
    .or(`enviando_desde.is.null,enviando_desde.lt."${vencido}"`)
    .select('kommo_lead_id')
  if (erroTrava) throw new Error(erroTrava.message)
  if ((travou?.length ?? 0) === 0) {
    return erro('Esta justificativa já está sendo enviada (outra aba ou um clique repetido).', 409, 'envio-em-curso')
  }
  const soltar = () =>
    svc.from(TABELA).update({ enviando_desde: null }).eq('kommo_lead_id', leadId).eq('tentativa', tentativa)

  const conta = await contaKommo()
  if (!conta) {
    await soltar()
    return erro('Token ou subdomínio da Kommo não configurado. O texto ficou salvo.', 500)
  }
  // AS NOTAS INTERNAS (###NOTAS###) NÃO VÃO AO KOMMO (decisão do dono,
  // 07/10/2026): ficam só na plataforma, no `texto_enviado` gravado abaixo. A
  // nota do card leva o parágrafo e a lista de fontes.
  const partes = dividirNota(separarNotas(texto).corpo)
  // TODAS AS PARTES NUMA CHAMADA: ou entram todas, ou nenhuma — e tentar de
  // novo não duplica a parte 1 (ver _shared/anotarNoKommo.ts).
  const r = await postarNotas(conta, leadId, partes, { dePessoa: true, autor }).catch((e) => ({
    ok: false as const, status: 0, detalhe: String((e as Error)?.message ?? e),
  }))
  if (!r.ok) {
    await soltar()
    return jsonResponse(
      { error: `O Kommo recusou a nota (HTTP ${r.status}). O texto ficou salvo; tente de novo.`, detalhe: r.detalhe, codigo: 'kommo' },
      502,
    )
  }
  const enviadoEm = new Date().toISOString()
  const marca = {
    status: 'enviada',
    texto_enviado: texto,
    enviado_em: enviadoEm,
    enviado_por: autor,
    nota_kommo_ids: r.ids,
    enviando_desde: null,
    atualizado_em: enviadoEm,
  }
  // A NOTA JÁ ESTÁ NO CARD: marcar como enviada é o que impede o reenvio
  // duplicado. Uma segunda tentativa se a primeira falhar; falhando as duas, a
  // trava de envio fica posta e vence em TRAVA_ENVIO_MIN — e a resposta avisa.
  let { error: erroMarca } = await svc.from(TABELA).update(marca).eq('kommo_lead_id', leadId).eq('tentativa', tentativa)
  if (erroMarca) ({ error: erroMarca } = await svc.from(TABELA).update(marca).eq('kommo_lead_id', leadId).eq('tentativa', tentativa))
  return jsonResponse({
    ok: true,
    partes: partes.length,
    enviado_em: enviadoEm,
    nota_kommo_ids: r.ids,
    aviso: erroMarca
      ? 'A nota subiu ao Kommo, mas não consegui marcar a justificativa como enviada. Não envie de novo: confira o card.'
      : null,
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const svc = serviceClient()
    const acao = String(body.acao ?? '')

    if (acao === 'passo') {
      // SEM USUÁRIO POR TRÁS: só passa quem traz a service_role ou o segredo de
      // cron — nenhum dos dois chega ao navegador.
      const cronSecret = Deno.env.get('CRON_SECRET')
      const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      const interna =
        (!!cronSecret && req.headers.get('x-cron-secret') === cronSecret) ||
        (!!svcKey && req.headers.get('Authorization') === `Bearer ${svcKey}`)
      if (!interna) return erro(ERRO_ACESSO, 401)
      // RESPONDE JÁ, TRABALHA DEPOIS: quem disparou não fica preso esperando.
      const trabalho = executarPasso(svc, body).catch(() => {})
      emSegundoPlano(trabalho)
      return jsonResponse({ ok: true, aceito: true }, 202)
    }
    if (acao === 'gerar') return await gerar(req, svc, body)
    if (acao === 'rascunho') return await rascunho(req, svc, body)
    if (acao === 'enviar') return await enviar(req, svc, body)
    return erro('Ação desconhecida. Use gerar, rascunho ou enviar.', 400)
  } catch (e) {
    if (e instanceof TabelaAusente) return semMigracao()
    return erro('Falha na justificativa técnica: ' + ((e as Error)?.message ?? String(e)), 500)
  }
})
