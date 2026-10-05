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
//   passo     { kommo_lead_id, tentativa, etapa } SÓ INTERNA — uma etapa
// A tela LÊ a tabela direto (RLS de leitura) e acompanha por consulta periódica.
//
// O SEGUNDO PLANO, e por que em duas etapas. A Edge Function tem teto de tempo
// de parede (400 s no plano pago) que `EdgeRuntime.waitUntil` NÃO estende — é a
// lição dos emolumentos (ver _shared/emolumentos.ts). Pesquisa com oito buscas,
// três páginas abertas e retomadas, mais a redação, passaria do teto numa
// invocação só. Então:
//   gerar    → lê o card, monta o prompt, reserva a linha e dispara a pesquisa
//              (responde na hora);
//   pesquisa → uma invocação NOVA (relógio zerado): só busca e lê, e grava o
//              dossiê com as fontes; dispara a redação;
//   redação  → outra invocação nova: escreve a partir do dossiê, sem ferramenta.
// Cada etapa grava `atualizado_em` ao começar; parada há mais de
// TRAVA_GERACAO_MIN é morte, e a tela oferece tentar de novo.
//
// UMA GERAÇÃO POR CARD, com trava atômica no banco: a linha é o lock. Entrar em
// 'gerando' é um UPDATE condicional na `tentativa` lida (ou o insert que não
// pisa em linha existente) — de duas abas, só uma vê a linha mudar. Cada etapa
// só grava se a `tentativa` ainda for a dela: uma geração refeita por cima de
// uma que morreu não é atropelada pela morta que acorda tarde.
//
// LIMITE DE TAXA: no máximo MAX_GERACOES_SIMULTANEAS na casa toda; e a SDK
// repete sozinha o 429 da Anthropic (duas vezes, com espera).
//
// ANTES DA MIGRAÇÃO 0076 a tabela não existe: toda ação responde 409 com
// `codigo: 'migracao-pendente'` e a frase de AVISO_MIGRACAO_0076 — nada é
// gerado, nada é cobrado, e nenhuma outra função depende desta.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import { ESFORCO_PADRAO_DO_OPUS, type NoFormatoDoOpus } from '../_shared/respostaDoClaude.ts'
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
  CHAVE_DOMINIOS_JUSTIFICATIVA,
  CHAVE_PROMPT_JUSTIFICATIVA,
  type CardDaJustificativa,
  type ConsumoDaJustificativa,
  CONSUMO_ZERO,
  dividirNota,
  dossieDaResposta,
  ehTabelaAusente,
  esferaDoEnte,
  type FonteDaJustificativa,
  FUNIL_RPV_JUSTIFICATIVA,
  FUNIS_DA_JUSTIFICATIVA,
  type LinhaDaJustificativa,
  lerDominios,
  listaDeFontes,
  MAX_GERACOES_SIMULTANEAS,
  montarPrompt,
  podeEnviar,
  podeGerar,
  promptEmVigor,
  somarConsumo,
  textoComFontes,
  textoDoTeto,
  TRAVA_ENVIO_MIN,
  TRAVA_GERACAO_MIN,
  valoresDoCard,
} from '../_shared/justificativaTecnica.ts'

/**
 * O MESMO MODELO das funções que já pesquisam (analise-precatorio, emolumentos,
 * tetos de RPV). O texto vai ao cedente e sustenta um preço: errar uma norma ou
 * um número sai mais caro que o token.
 */
const MODELO = 'claude-opus-5-5'

/**
 * Os tetos da pesquisa. São o principal controle de tempo e de custo: o modelo
 * tende a gastar o orçamento que recebe. Oito buscas cobrem regime e fila,
 * LOA, normas recentes e deságio; três páginas abertas, o documento oficial que
 * a busca só resumiu. Duas retomadas cobrem o laço de amostragem do servidor.
 */
const MAX_BUSCAS = 8
const MAX_FETCHES = 3
const MAX_RETOMADAS = 2
/** Teto do texto de cada página aberta: decreto e LOA têm centenas de páginas. */
const MAX_TOKENS_DA_PAGINA = 20_000

/** O orçamento de relógio de UMA invocação, abaixo dos 400 s da plataforma. */
const ORCAMENTO_MS = 340_000
/** Abaixo disto, não vale começar mais uma retomada. */
const FOLGA_MINIMA_MS = 70_000

const TABELA = 'justificativa_tecnica'

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

/** O prompt e os domínios em vigor. Leitura que falha cai no padrão: nunca sem método. */
async function lerConfiguracao(svc: SupabaseClient): Promise<{ prompt: string; dominios: string[] }> {
  try {
    const { data } = await svc
      .from('prompts_operacao')
      .select('chave, texto')
      .in('chave', [CHAVE_PROMPT_JUSTIFICATIVA, CHAVE_DOMINIOS_JUSTIFICATIVA])
    const linhas = (data ?? []) as { chave: string; texto: string | null }[]
    const de = (k: string) => linhas.find((l) => l.chave === k)?.texto ?? ''
    return {
      prompt: promptEmVigor(de(CHAVE_PROMPT_JUSTIFICATIVA)),
      dominios: lerDominios(de(CHAVE_DOMINIOS_JUSTIFICATIVA)).dominios,
    }
  } catch {
    return { prompt: promptEmVigor(''), dominios: [] }
  }
}

function emSegundoPlano(p: Promise<unknown>): void {
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

/**
 * A próxima etapa, numa invocação NOVA — é o que zera o relógio de parede.
 * Leva a service_role no Authorization (passa pelo verify_jwt do gateway e é o
 * que a ação 'passo' aceita). Fire-and-forget, segurado pelo waitUntil.
 */
function dispararEtapa(leadId: number, tentativa: string, etapa: 'pesquisa' | 'redacao'): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/justificativa-tecnica`
  const p = fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
      'x-cron-secret': Deno.env.get('CRON_SECRET') ?? '',
    },
    body: JSON.stringify({ acao: 'passo', kommo_lead_id: leadId, tentativa, etapa }),
  }).catch(() => {})
  emSegundoPlano(p)
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

// ---------------------------------------------------------------------------
// As duas etapas da IA
// ---------------------------------------------------------------------------

const SISTEMA_PESQUISA =
  'Você é pesquisador da Credijuris, empresa que compra precatórios e RPVs. Abaixo vem a TAREFA: o pedido de uma justificativa técnica do preço de uma proposta, com os dados do crédito. ' +
  'NESTA ETAPA VOCÊ SÓ PESQUISA — outra etapa redige. Use a busca na web (e, quando a busca só resumir um documento oficial que importa, abra-o) para levantar o que a tarefa pede pesquisar. ' +
  'Prefira fontes oficiais e recentes; diga a data de cada informação. Não invente nada: o que não achar, diga que não achou. ' +
  'Responda com um DOSSIÊ em tópicos curtos, em português, organizado nos assuntos da tarefa (situação de pagamento do ente; contexto jurídico e normativo; referências de deságio de mercado), e termine com "NÃO ENCONTRADO:" listando o que procurou e não achou. ' +
  'Cada fato precisa vir da busca, para a citação acompanhá-lo. ' +
  // NO OPUS 5.5 o texto escrito ENTRE uma busca e outra vem em bloco de
  // raciocínio (vazio por padrão), e o dossiê (`dossieDaResposta`) só lê os
  // blocos de texto. No Opus 5 essas notas chegavam como texto e entravam no
  // dossiê; agora o que importa tem de estar na resposta final.
  'Escreva o dossiê INTEIRO na resposta final, depois de terminar as buscas: o que você anotar entre uma busca e outra não chega a quem redige.'

const SISTEMA_REDACAO =
  'Você é analista de crédito da Credijuris e redige a JUSTIFICATIVA TÉCNICA pedida na TAREFA, para o cedente ler. ' +
  'Siga a TAREFA à risca no formato e no tom. Use SÓ os fatos do DOSSIÊ e os dados do crédito da tarefa; não acrescente fato, número, data, norma ou decisão que não esteja ali. ' +
  'Cite as fontes pelo número entre colchetes da lista FONTES NUMERADAS, por exemplo [2] ou [1, 3], logo depois do fato; nunca cite número que não está na lista. ' +
  'Não escreva a lista de fontes no fim (a plataforma acrescenta). Responda só com o texto da justificativa, sem comentário antes ou depois.'

interface Contexto {
  anthropic: Anthropic
  inicio: number
  consumo: ConsumoDaJustificativa
}

const restante = (c: Contexto) => ORCAMENTO_MS - (Date.now() - c.inicio)

async function pesquisar(
  c: Contexto,
  tarefa: string,
  dominios: string[],
): Promise<{ texto: string; fontes: FonteDaJustificativa[] }> {
  const restricao = dominios.length > 0 ? { allowed_domains: dominios } : {}
  const ferramentas = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS, ...restricao },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: MAX_FETCHES, max_content_tokens: MAX_TOKENS_DA_PAGINA, ...restricao },
  ]
  const mensagens: Anthropic.MessageParam[] = [{ role: 'user', content: `TAREFA:\n\n${tarefa}` }]
  const blocos: Anthropic.ContentBlock[] = []
  for (let volta = 0; volta <= MAX_RETOMADAS; volta++) {
    const resposta = await c.anthropic.messages
      .stream(
        {
          model: MODELO,
          max_tokens: 16000,
          // O padrão do Opus 5 (o do 5.5 é 'medium'). O raciocínio, sempre
          // ligado no 5.5, divide os 16000 com o dossiê.
          output_config: { effort: ESFORCO_PADRAO_DO_OPUS },
          system: SISTEMA_PESQUISA,
          tools: ferramentas as unknown as Anthropic.Tool[],
          messages: mensagens,
        } satisfies NoFormatoDoOpus<Anthropic.MessageStreamParams>,
        { signal: AbortSignal.timeout(Math.max(10_000, restante(c) - 15_000)) },
      )
      .finalMessage()
    c.consumo = somarConsumo(c.consumo, resposta.usage)
    if (resposta.stop_reason === 'refusal') {
      throw new Error('O modelo recusou a pesquisa (filtro de segurança da Anthropic). Revise o prompt em Configurações.')
    }
    blocos.push(...resposta.content)
    // O laço de amostragem do servidor tem teto próprio e devolve 'pause_turn';
    // reenviar o turno pausado retoma de onde parou, sem mensagem nova. Sem
    // tempo para outra volta, segue com o que já foi achado — um dossiê parcial
    // é melhor que nenhum, e a redação diz o que faltou.
    if (resposta.stop_reason !== 'pause_turn' || restante(c) < FOLGA_MINIMA_MS) break
    mensagens.push({ role: 'assistant', content: resposta.content })
  }
  const dossie = dossieDaResposta(blocos as unknown as Parameters<typeof dossieDaResposta>[0])
  if (!dossie.texto.trim()) throw new Error('A pesquisa terminou sem devolver texto. Tente de novo.')
  return dossie
}

async function redigir(c: Contexto, tarefa: string, dossie: string, fontes: FonteDaJustificativa[]): Promise<string> {
  const pedido =
    `TAREFA (o pedido da casa, com os dados do crédito):\n\n${tarefa}\n\n` +
    `DOSSIÊ DA PESQUISA (os números entre colchetes indicam as fontes de cada trecho):\n\n${dossie}\n\n` +
    `FONTES NUMERADAS:\n${fontes.length > 0 ? listaDeFontes(fontes) : '(nenhuma fonte foi citada pela pesquisa)'}\n\n` +
    'Redija agora a justificativa técnica.'
  const resposta = await c.anthropic.messages
    .stream(
      {
        model: MODELO,
        max_tokens: 12000,
        output_config: { effort: ESFORCO_PADRAO_DO_OPUS },
        system: SISTEMA_REDACAO,
        messages: [{ role: 'user', content: pedido }],
      } satisfies NoFormatoDoOpus<Anthropic.MessageStreamParams>,
      { signal: AbortSignal.timeout(Math.max(10_000, restante(c) - 10_000)) },
    )
    .finalMessage()
  c.consumo = somarConsumo(c.consumo, resposta.usage)
  if (resposta.stop_reason === 'refusal') {
    throw new Error('O modelo recusou a redação (filtro de segurança da Anthropic). Revise o prompt em Configurações.')
  }
  const texto = resposta.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('')
    .trim()
  if (!texto) throw new Error('A redação terminou sem texto. Tente de novo.')
  return texto
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

  // O LIMITE DE TAXA DA CASA: gerações vivas ao mesmo tempo.
  const desde = new Date(Date.now() - TRAVA_GERACAO_MIN * 60_000).toISOString()
  const { count } = await svc
    .from(TABELA).select('kommo_lead_id', { count: 'exact', head: true })
    .eq('status', 'gerando').gt('atualizado_em', desde)
  if ((count ?? 0) >= MAX_GERACOES_SIMULTANEAS) {
    return erro(
      `Já há ${count} justificativas sendo geradas agora, e a casa limita a ${MAX_GERACOES_SIMULTANEAS} ao mesmo tempo. Tente de novo em alguns minutos.`,
      429,
      'fila-cheia',
    )
  }

  // A TRAVA: entrar em 'gerando' é condicional ao que se leu.
  const tentativa = crypto.randomUUID()
  const agora = new Date().toISOString()
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
    pesquisa: null,
    erro: null,
    consumo: {},
    criado_por: caller.email ?? null,
    gerado_em: agora,
    atualizado_em: agora,
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
    // LENDO O CRÉDITO: as variáveis e o prompt montado, guardados na linha —
    // é o que permite conferir depois com que dados a IA trabalhou.
    const { prompt, dominios } = await lerConfiguracao(svc)
    const previa = valoresDoCard(card)
    const valores = valoresDoCard(card, { tetoRpv: await tetoDoCard(svc, card, previa.ente_devedor, previa.tribunal) })
    const { texto: tarefa, desconhecidas } = montarPrompt(prompt, valores)
    await gravarDaTentativa(svc, leadId, tentativa, {
      etapa: 'pesquisando',
      prompt_usado: tarefa,
      variaveis: { ...valores, ...(desconhecidas.length ? { _desconhecidas: desconhecidas.join(', ') } : {}) },
      dominios,
    })
    dispararEtapa(leadId, tentativa, 'pesquisa')
    return jsonResponse({ ok: true, estado: 'gerando', tentativa })
  } catch (e) {
    await gravarDaTentativa(svc, leadId, tentativa, { status: 'falha', etapa: null, erro: mensagemDaFalha(e) }).catch(() => false)
    return erro(`Não consegui começar a geração: ${mensagemDaFalha(e)}`, 500)
  }
}

async function passo(svc: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const leadId = Number(body.kommo_lead_id)
  const tentativa = String(body.tentativa ?? '')
  const etapa = body.etapa === 'redacao' ? 'redacao' : 'pesquisa'
  const linha = await lerLinha(svc, leadId)
  if (!linha || linha.status !== 'gerando' || linha.tentativa !== tentativa) {
    return jsonResponse({ ok: true, ignorado: true })
  }
  const l = linha as LinhaDaJustificativa & {
    prompt_usado?: string | null
    dominios?: string[] | null
    pesquisa?: { texto?: string; fontes?: FonteDaJustificativa[] } | null
    consumo?: Partial<ConsumoDaJustificativa> | null
  }
  const c: Contexto = {
    anthropic: new Anthropic({ apiKey: (await chaveAnthropic()) ?? '' }),
    inicio: Date.now(),
    consumo: { ...CONSUMO_ZERO, ...(l.consumo ?? {}), modelo: MODELO },
  }
  const segundos = () => (c.consumo.segundos ?? 0) + Math.round((Date.now() - c.inicio) / 1000)

  // O PULSO: a etapa começou agora. Parada além da trava, a tela sabe que morreu.
  if (!(await gravarDaTentativa(svc, leadId, tentativa, { etapa: etapa === 'pesquisa' ? 'pesquisando' : 'redigindo' }))) {
    return jsonResponse({ ok: true, ignorado: true })
  }
  try {
    const tarefa = String(l.prompt_usado ?? '')
    if (!tarefa.trim()) throw new Error('O prompt montado não foi gravado. Gere de novo.')
    if (etapa === 'pesquisa') {
      const dossie = await pesquisar(c, tarefa, l.dominios ?? [])
      const seguiu = await gravarDaTentativa(svc, leadId, tentativa, {
        etapa: 'redigindo',
        pesquisa: dossie,
        consumo: { ...c.consumo, segundos: segundos() },
      })
      if (seguiu) dispararEtapa(leadId, tentativa, 'redacao')
      return jsonResponse({ ok: true, etapa, fontes: dossie.fontes.length })
    }
    const dossie = l.pesquisa ?? {}
    const fontesDaPesquisa = dossie.fontes ?? []
    const redacao = await redigir(c, tarefa, String(dossie.texto ?? ''), fontesDaPesquisa)
    const final = textoComFontes(redacao, fontesDaPesquisa)
    await gravarDaTentativa(svc, leadId, tentativa, {
      status: 'pronta',
      etapa: null,
      texto: final.texto,
      fontes: final.fontes,
      erro: null,
      consumo: { ...c.consumo, segundos: segundos() },
    })
    return jsonResponse({ ok: true, etapa })
  } catch (e) {
    await gravarDaTentativa(svc, leadId, tentativa, {
      status: 'falha',
      etapa: null,
      erro: mensagemDaFalha(e),
      consumo: { ...c.consumo, segundos: segundos() },
    }).catch(() => false)
    return jsonResponse({ ok: false, error: mensagemDaFalha(e) })
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
  const partes = dividirNota(texto)
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
      return await passo(svc, body)
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
