// escavador-autos-rotina — os autos do crédito, do tribunal para o card do Kommo.
//
// O QUE ELA FAZ, a cada volta (cron de 10 minutos; o kommo-sync e o aviso do
// Escavador também a acordam; e ela se encadeia enquanto houver PDF descendo):
//
//   1. LÊ O CARD. Card que chegou numa coluna de entrada (a primeira do
//      Operacional em RPV, precatório interno e externo; e a NOVOS do funil
//      geral) é lido por um agente de IA — título, anotações do comercial e os
//      PDFs anexados — que diz quais são os PROCESSOS DESTE CRÉDITO: o
//      conhecimento, o cumprimento (ou execução) e o requisitório (precatório ou
//      RPV). O código confere cada número (dígito verificador, e estar onde a IA
//      disse) antes de ele virar pedido. Ver `_shared/processosDoCredito.ts`.
//   2. PEDE, UMA VEZ POR PROCESSO. Cada processo do card é pedido ao Escavador
//      uma vez só (R$ 1,34 cada, cota diária), com o certificado digital. Autos
//      trazidos nos últimos 30 dias — por este card ou por outro — não se pedem
//      de novo.
//   3. ACOMPANHA. O robô leva horas no tribunal (2h15 no teste de 22/09). O
//      aviso deles acorda a rotina; de meia em meia hora, sem custo, ela confere.
//   4. ANEXA. Pronto o pedido, cada PDF desce do Escavador e sobe DIRETO como
//      anexo do card, na ordem do processo e com o papel na frente:
//      "Conhecimento 001 - 09-06-2020 - Petição Inicial.pdf". Nada fica guardado
//      na plataforma além do registro do que já subiu.
//
// UM PEDIDO POR PROCESSO DO CARD, e isso é garantido por POSSE NO BANCO, não por
// cuidado: o cron, o sync e o aviso podem acordar a rotina ao mesmo tempo, e quem
// paga um pedido é só quem conseguiu gravar PEDINDO naquele processo.
//
// AUTORIZAÇÃO: x-cron-secret (o cron, o sync, o aviso, ela mesma) ou JWT de
// usuário ativo. Aceita `{ lead_id }` para trabalhar só aquele card, agora.
import { encodeBase64 } from 'jsr:@std/encoding@1.0.11/base64'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic, chaveEscavador, contaKommo } from '../_shared/segredos.ts'
import { BASE_ESCAVADOR } from '../_shared/escavador.ts'
import { cnjDoCard, digitosDoCnj } from '../_shared/nucleo/cnj.ts'
import { assinarNota } from '../_shared/notaCredijuris.ts'
import { subirAoDriveDoKommo } from '../_shared/driveDoKommo.ts'
import {
  documentosDosAutos,
  emOrdemDosAutos,
  entradasDoOperacional,
  FUNIL_RPV,
  FUNIS_DE_ENTRADA_POR_NOME,
  motivoDoEstado,
  nomeDoAnexo,
  notaDeFalha,
  notaDosAutos,
} from '../_shared/autosParaOKommo.ts'
import {
  ehAnexoDosAutos,
  faltaPapel,
  impressaoDoCard,
  mesclarProcessos,
  normalizarProcessos,
  notaDosProcessos,
  type ProcessoDoCredito,
  rotuloDoProcesso,
  SISTEMA_PROCESSOS,
} from '../_shared/processosDoCredito.ts'
import {
  consultaRespondeu,
  ehPdf,
  erroPassageiro,
  falhaPassageira,
  MAX_BYTES_NA_MEMORIA,
  recusaDaConta,
  SEM_RESPOSTA,
  semAcessoAoKommo,
} from '../_shared/falhasDosAutos.ts'

type Servico = ReturnType<typeof serviceClient>

/** Quanto uma volta trabalha antes de passar a vez. */
const ORCAMENTO_MS = 100_000
/** Pedidos novos ao Escavador por dia (R$ 1,34 cada). Protege de uma enxurrada de cards. */
const LIMITE_PEDIDOS_DIA = 40
/** De quanto em quanto se confere um pedido em aberto (a consulta não custa). */
const REVER_MIN = 30
/** Pedido parado há mais que isto é dado como perdido. */
const DESISTIR_H = 72
/** Autos trazidos há menos que isto servem sem pedir de novo. */
const REUSO_DIAS = 30
/** Posse parada há mais que isto: a volta que a tomou morreu no meio. */
const POSSE_PARADA_MS = 5 * 60_000
/** Leituras de um card pela IA, no máximo: a primeira e as que o card mudado pedir. */
const MAX_LEITURAS = 4
/** Entre uma leitura e a seguinte do mesmo card. */
const RELER_APOS_MS = 60 * 60_000
/** Leituras por volta: cada uma leva de 10 a 50 segundos. */
const LEITURAS_POR_VOLTA = 2
/** Quanto a IA tem para responder antes de a leitura ficar para a próxima volta. */
const ESPERA_DA_IA_MS = 55_000
/**
 * O que a IA recebe de anexo: até 6 PDFs, 16 MB no total, 12 MB cada. Os 16 MB
 * viram ~21 MB em base64, dentro dos 32 MB que a API do Claude aceita por pedido.
 */
const MAX_PDFS = 6
const MAX_BYTES_LEITURA = 16 * 1024 * 1024
const MAX_BYTES_PDF_LEITURA = 12 * 1024 * 1024
/** O modelo da leitura: achar números num processo não pede o maior. */
const MODELO_LEITURA = 'claude-sonnet-5'
/** Tentativas por documento antes de desistir dele. */
const MAX_TENTATIVAS = 3
/** Voltas encadeadas no máximo, por disparo. */
const MAX_ENCADEADAS = 12
/**
 * Quanto se espera cada chamada ao Escavador e ao Kommo. SEM TETO, uma conexão
 * parada segurava a volta além da trava de 3 minutos, e outra volta entrava no
 * mesmo processo e subia o mesmo PDF de novo: anexo em dobro no card.
 */
const TEMPO_API_MS = 30_000
const TEMPO_DOWNLOAD_MS = 90_000
/** Depois de cinco falhas seguidas que passam (rede, cota, 5xx), o processo descansa isto. */
const PAUSA_APOS_FALHAS_MS = 30 * 60_000

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
const agora = () => new Date().toISOString()

interface CardLido {
  kommo_lead_id: number
  estado: string
  processos: ProcessoDoCredito[]
  leituras: number
  lido_em: string | null
  impressao: string | null
  atualizado_em: string
}

interface Processo {
  kommo_lead_id: number
  numero_cnj: string
  papeis: string[]
  rotulo: string
  estado: string
  pedido_id: number | null
  total_documentos: number
  anexados: number
  paginas: number
  chaves_anexadas: string[]
  verificado_em: string | null
  criado_em: string
  atualizado_em: string
}

// ------------------------------------------------------------------ Escavador
async function escavador(chave: string, caminho: string, init: RequestInit = {}) {
  let res: Response
  try {
    res = await fetch(caminho.startsWith('http') ? caminho : `${BASE_ESCAVADOR}${caminho}`, {
      ...init,
      signal: AbortSignal.timeout(TEMPO_API_MS),
      headers: {
        Authorization: `Bearer ${chave}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch (e) {
    // SEM RESPOSTA (rede, tempo esgotado) vira status 0, e não exceção: quem
    // chamou decide, e no pedido pago isso importa — o Escavador pode ter
    // recebido e cobrado sem a resposta voltar, e a próxima volta adota o pedido
    // pela consulta de status em vez de pagar outro.
    return { status: SEM_RESPOSTA, corpo: String((e as Error)?.message ?? e), centavos: 0 }
  }
  const centavos = Number(res.headers.get('Creditos-Utilizados') ?? 0) || 0
  const txt = await res.text()
  let corpo: any = txt
  try {
    corpo = JSON.parse(txt)
  } catch { /* o status conta a história */ }
  return { status: res.status, corpo, centavos }
}

/**
 * A última atualização do processo no Escavador (consulta gratuita).
 *
 * `consultou` FALSO É "NÃO SEI", e não "não há pedido": antes, qualquer
 * resposta diferente de 200 virava null, e o pedido pago seguia — passando por
 * cima do reaproveitamento dos 30 dias e da adoção do pedido de uma volta que
 * morreu. Ver `consultaRespondeu`.
 */
async function ultimaVerificacao(
  chave: string,
  cnj: string,
): Promise<{ consultou: boolean; status: number; v: Record<string, any> | null }> {
  const r = await escavador(chave, `/processos/numero_cnj/${cnj}/status-atualizacao`)
  return {
    consultou: consultaRespondeu(r.status),
    status: r.status,
    v: r.status === 200 ? (r.corpo?.ultima_verificacao ?? null) : null,
  }
}

/** Há token de callback cadastrado? Sem ele, o pedido não pode pedir aviso. */
async function temCallback(svc: Servico): Promise<boolean> {
  const { data } = await svc.from('integracao_escavador_secret').select('callback_token').eq('id', 1).maybeSingle()
  return !!String(data?.callback_token ?? '').trim()
}

// ------------------------------------------------------------------ Kommo
function clienteKommo(token: string, subdominio: string) {
  const auth = { Authorization: `Bearer ${token}` }
  const base = `https://${subdominio}.kommo.com/api/v4`
  let ultima = 0
  let drive: string | null = null
  // O TETO DO KOMMO É 7 REQUISIÇÕES POR SEGUNDO, e violá-lo bloqueia o IP.
  const api = async (caminho: string, init: RequestInit = {}) => {
    const espera = 160 - (Date.now() - ultima)
    if (espera > 0) await dormir(espera)
    ultima = Date.now()
    return fetch(`${base}${caminho}`, {
      ...init,
      signal: AbortSignal.timeout(TEMPO_API_MS),
      headers: { ...auth, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    })
  }
  const cliente = {
    async urlDoDrive(): Promise<string> {
      if (drive) return drive
      const r = await api('/account?with=drive_url')
      const u = ((await r.json().catch(() => ({}))) as any)?.drive_url
      if (!u) throw new Error('não consegui descobrir o drive da conta Kommo')
      drive = String(u)
      return drive
    },
    /** Os uuids dos arquivos anexados ao card (a aba Arquivos). */
    async arquivosDoCard(leadId: number): Promise<string[]> {
      const fora: string[] = []
      let caminho: string | null = `/leads/${leadId}/files?limit=50`
      for (let i = 0; caminho && i < 5; i++) {
        const r = await api(caminho)
        if (r.status === 204 || !r.ok) break
        const j = (await r.json().catch(() => ({}))) as any
        for (const f of j?._embedded?.files ?? []) if (f?.file_uuid) fora.push(String(f.file_uuid))
        const prox = j?._links?.next?.href as string | undefined
        caminho = prox ? prox.replace(/^https?:\/\/[^/]+\/api\/v4/, '') : null
      }
      return fora
    },
    /** Nome, tamanho, tipo e endereço de download de um arquivo do drive. */
    async metadados(uuid: string) {
      const d = await cliente.urlDoDrive()
      const r = await fetch(`${d}/v1.0/files/${uuid}`, { headers: auth, signal: AbortSignal.timeout(TEMPO_API_MS) })
      if (!r.ok) return null
      const m = (await r.json().catch(() => null)) as any
      return {
        nome: String(m?.name ?? ''),
        bytes: Number(m?.size ?? 0) || 0,
        mime: String(m?.metadata?.mime_type ?? ''),
        download: m?._links?.download?.href as string | undefined,
      }
    },
    async baixar(url: string): Promise<Uint8Array | null> {
      let r = await fetch(url, { signal: AbortSignal.timeout(TEMPO_DOWNLOAD_MS) })
      if (r.status === 401 || r.status === 403) {
        r = await fetch(url, { headers: auth, signal: AbortSignal.timeout(TEMPO_DOWNLOAD_MS) })
      }
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null
    },
    /** Sobe um PDF ao drive do Kommo, em partes — ver `_shared/driveDoKommo.ts`. */
    async subir(nome: string, bytes: Uint8Array): Promise<string> {
      return subirAoDriveDoKommo({ drive: await cliente.urlDoDrive(), auth, nome, bytes, mime: 'application/pdf' })
    },
    async anexar(leadId: number, uuids: string[]) {
      const r = await api(`/leads/${leadId}/files`, {
        method: 'PUT',
        body: JSON.stringify(uuids.map((file_uuid) => ({ file_uuid }))),
      })
      if (!r.ok) throw new Error(`o Kommo recusou o anexo (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}`)
    },
    async anotar(leadId: number, texto: string) {
      await api('/leads/notes', {
        method: 'POST',
        body: JSON.stringify([
          {
            entity_id: leadId,
            note_type: 'common',
            params: { text: assinarNota(texto) },
            is_need_to_trigger_digital_pipeline: false,
          },
        ]),
      }).catch(() => null)
    },
  }
  return cliente
}
type Kommo = ReturnType<typeof clienteKommo>

// ------------------------------------------------------------------ 1. LER O CARD
/** Os cards nas colunas de entrada (ou só o pedido), com o que a leitura precisa. */
async function cardsNaEntrada(svc: Servico, soEste: number | null) {
  const { data: etapas } = await svc
    .from('kommo_etapa')
    .select('pipeline_id, status_id, nome')
    .in('pipeline_id', FUNIS_DE_ENTRADA_POR_NOME)
  const entradas = entradasDoOperacional((etapas ?? []) as any[])
  let q = svc.from('kommo_leads').select('kommo_lead_id, pipeline_id, status_id, nome, processo_cnj, notas')
  q = soEste ? q.eq('kommo_lead_id', soEste) : q.in('status_id', entradas.map((e) => e.status_id))
  const { data } = await q
  return ((data ?? []) as any[]).filter(
    (l) => soEste || entradas.some((e) => e.pipeline_id === Number(l.pipeline_id) && e.status_id === Number(l.status_id)),
  )
}

/** O que a IA lê: título, anotações do comercial e os PDFs anexados. */
async function fontesDoCard(kommo: Kommo, lead: any) {
  const notas = (Array.isArray(lead.notas) ? lead.notas : []) as any[]
  const deGente = notas.filter((n) => !n.automatica)
  const anotacoes = deGente
    .map((n) => String(n.texto ?? '').trim())
    .filter(Boolean)
    .join('\n---\n')
    .slice(0, 40_000)

  // OS ANEXOS: os da aba Arquivos e os das anotações (que nem sempre aparecem
  // lá). De TODAS as notas com arquivo: o espelho marca a nota de anexo como
  // automática, e é nela que o PDF do comercial costuma chegar.
  const uuids = new Set<string>(notas.map((n) => n.arquivo_uuid).filter(Boolean).map(String))
  for (const u of await kommo.arquivosDoCard(Number(lead.kommo_lead_id)).catch(() => [])) uuids.add(u)
  const candidatos: { nome: string; bytes: number; download: string }[] = []
  for (const u of [...uuids].slice(0, 30)) {
    const m = await kommo.metadados(u).catch(() => null)
    if (!m?.download) continue
    const pdf = /pdf/i.test(m.mime) || /\.pdf$/i.test(m.nome)
    if (!pdf || ehAnexoDosAutos(m.nome) || m.bytes > MAX_BYTES_PDF_LEITURA) continue
    candidatos.push({ nome: m.nome, bytes: m.bytes, download: m.download })
  }
  // OS MENORES PRIMEIRO: o ofício e o extrato do tribunal, que é onde os números
  // estão, são peças curtas; o PDF de 300 páginas fica para quando couber.
  candidatos.sort((a, b) => a.bytes - b.bytes)
  const pdfs: { nome: string; bytes: Uint8Array }[] = []
  let total = 0
  for (const c of candidatos) {
    if (pdfs.length >= MAX_PDFS || total + c.bytes > MAX_BYTES_LEITURA) break
    const b = await kommo.baixar(c.download).catch(() => null)
    if (!b) continue
    pdfs.push({ nome: c.nome, bytes: b })
    total += b.byteLength
  }
  return { titulo: String(lead.nome ?? ''), anotacoes, pdfs, notas }
}

/**
 * A leitura que falhou, e se vale tentar de novo.
 *
 * RELER SÓ O QUE PASSA. Cada leitura reenvia os PDFs (dezenas de centavos de
 * dólar), e repetir quatro vezes uma resposta cortada ou um JSON inválido era
 * pagar quatro vezes pelo mesmo erro.
 */
class FalhaDaLeitura extends Error {
  constructor(mensagem: string, readonly passageira: boolean) {
    super(mensagem)
  }
}

/** Documento que não tem como descer (grande demais, não é PDF): tentar de novo não muda nada. */
class DocumentoImpossivel extends Error {}

/** A leitura pela IA. Documento recusado (grande demais, páginas demais) cai para uma leitura menor. */
async function perguntarAIA(
  chave: string,
  fontes: { titulo: string; anotacoes: string; pdfs: { nome: string; bytes: Uint8Array }[] },
  rpv: boolean,
): Promise<{ bruto: unknown; lidos: string[] }> {
  const tentativas = [
    fontes.pdfs,
    fontes.pdfs.filter((p) => p.bytes.byteLength <= 3 * 1024 * 1024).slice(0, 3),
    [],
  ]
  let ultimoErro = ''
  let passageira = false
  for (const pdfs of tentativas) {
    const conteudo: unknown[] = [
      {
        type: 'text',
        text:
          `TÍTULO DO CARD: ${fontes.titulo || '(sem título)'}\n` +
          `FUNIL: ${rpv ? 'RPV' : 'Precatório'}\n\n` +
          `ANOTAÇÕES DO COMERCIAL:\n${fontes.anotacoes || '(nenhuma)'}\n\n` +
          `ANEXOS EM PDF: ${pdfs.length ? pdfs.map((p) => p.nome).join('; ') : '(nenhum)'}`,
      },
      ...pdfs.map((p) => ({
        type: 'document',
        title: p.nome.slice(0, 200),
        source: { type: 'base64', media_type: 'application/pdf', data: encodeBase64(p.bytes) },
      })),
      { type: 'text', text: 'Identifique os processos deste crédito.' },
    ]
    let res: Response
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: AbortSignal.timeout(ESPERA_DA_IA_MS),
        headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODELO_LEITURA,
          // SEM PENSAMENTO, e com folga na resposta. No Sonnet 5 o pensamento vem
          // LIGADO quando o campo é omitido, e conta DENTRO do max_tokens (docs da
          // Anthropic, "Thinking"): com 1.500 o JSON saía cortado justamente no
          // card com mais PDF. Achar números de processo não pede raciocínio
          // longo, e a espera aqui é de 55 segundos.
          max_tokens: 4000,
          thinking: { type: 'disabled' },
          system: SISTEMA_PROCESSOS,
          messages: [{ role: 'user', content: conteudo }],
        }),
      })
    } catch (e) {
      throw new FalhaDaLeitura(`a leitura pela IA não respondeu a tempo (${(e as Error)?.message ?? e})`, true)
    }
    const j = (await res.json().catch(() => null)) as any
    if (!res.ok) {
      ultimoErro = `HTTP ${res.status}: ${String(j?.error?.message ?? '').slice(0, 200)}`
      passageira = falhaPassageira(res.status)
      // SÓ O 400 SE RESOLVE ENCOLHENDO. Chave errada, limite de uso, fora do ar:
      // tentar de novo com menos documentos não muda nada.
      if (res.status === 400 && pdfs.length > 0) continue
      break
    }
    if (j?.stop_reason === 'max_tokens') {
      ultimoErro = 'a resposta da IA saiu cortada'
      passageira = false
      break
    }
    const txt = ((j?.content ?? []) as any[])
      .map((c) => (c?.type === 'text' ? String(c.text ?? '') : ''))
      .join('')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()
    try {
      return { bruto: JSON.parse(txt), lidos: pdfs.map((p) => p.nome) }
    } catch {
      ultimoErro = 'a IA não devolveu JSON válido'
      passageira = false
      break
    }
  }
  throw new FalhaDaLeitura(`a leitura pela IA falhou (${ultimoErro})`, passageira)
}

async function lerCards(
  svc: Servico,
  kommo: Kommo,
  chaveIA: string | null,
  soEste: number | null,
  resta: () => number,
  avisos: string[],
) {
  const leads = await cardsNaEntrada(svc, soEste)
  if (leads.length === 0) return
  const { data: linhas } = await svc
    .from('escavador_autos_card')
    .select('kommo_lead_id, estado, processos, leituras, lido_em, impressao, atualizado_em')
    .in('kommo_lead_id', leads.map((l) => l.kommo_lead_id))
  const porLead = new Map(((linhas ?? []) as CardLido[]).map((c) => [Number(c.kommo_lead_id), c]))
  let feitas = 0

  for (const l of leads) {
    if (feitas >= LEITURAS_POR_VOLTA || resta() < ESPERA_DA_IA_MS + 10_000) break
    const leadId = Number(l.kommo_lead_id)
    const linha = porLead.get(leadId)
    const notas = (Array.isArray(l.notas) ? l.notas : []) as any[]
    const impressao = impressaoDoCard(String(l.nome ?? ''), notas)

    // QUEM SE LÊ: card novo; card que ficou NOVO; posse de leitura parada; e o
    // card já lido que MUDOU (anotação ou anexo novo de gente) e ainda não tem os
    // três processos — com teto de leituras e uma hora entre elas.
    const parado = linha?.estado === 'LENDO' && Date.now() - Date.parse(linha.atualizado_em) > POSSE_PARADA_MS
    const mudou =
      (linha?.estado === 'LIDO' || linha?.estado === 'SEM_PROCESSO') &&
      linha.impressao !== impressao &&
      (linha.estado === 'SEM_PROCESSO' || faltaPapel(linha.processos ?? [])) &&
      (linha.leituras ?? 0) < MAX_LEITURAS &&
      (!linha.lido_em || Date.now() - Date.parse(linha.lido_em) > RELER_APOS_MS)
    if (linha && linha.estado !== 'NOVO' && !parado && !mudou) continue

    // A POSSE DA LEITURA: pela chave primária no card novo, por update
    // condicionado ao que se leu no card que já existe.
    if (!linha) {
      const { error } = await svc
        .from('escavador_autos_card')
        .insert({ kommo_lead_id: leadId, estado: 'LENDO', atualizado_em: agora() })
      if (error) continue
    } else {
      const { data: tomei } = await svc
        .from('escavador_autos_card')
        .update({ estado: 'LENDO', atualizado_em: agora() })
        .eq('kommo_lead_id', leadId)
        .eq('estado', linha.estado)
        .eq('atualizado_em', linha.atualizado_em)
        .select('kommo_lead_id')
      if (!tomei?.length) continue
    }
    feitas++

    const rpv = Number(l.pipeline_id) === FUNIL_RPV
    const leituras = (linha?.leituras ?? 0) + 1
    // SÓ O TÍTULO. O `processo_cnj` do espelho, quando o título não tem número, é
    // o primeiro CNJ das ANOTAÇÕES — e entrava à força como "do título", mesmo
    // que a IA o tivesse descartado (processo só citado, dívida do titular): um
    // pedido de R$ 1,34 pelo processo errado. O título segue o formato
    // "originador - cedente - nº do processo - parcelas - % de honorários".
    const cnjDoTitulo = cnjDoCard(l.nome)
    let achados: ProcessoDoCredito[] = []
    let lidos: string[] = []
    // A leitura que não deu certo por um motivo passageiro (demora, limite de uso,
    // instabilidade) é refeita na próxima volta; o processo do título não espera.
    let lerDeNovo = false
    try {
      const fontes = await fontesDoCard(kommo, l)
      if (!chaveIA) throw new Error('chave da Anthropic não configurada')
      const r = await perguntarAIA(chaveIA, fontes, rpv)
      lidos = r.lidos
      const n = normalizarProcessos(r.bruto, { titulo: fontes.titulo, anotacoes: fontes.anotacoes, cnjDoTitulo })
      achados = n.processos
      avisos.push(...n.avisos.map((a) => `card ${leadId}: ${a}`))
    } catch (e) {
      // SEM A IA, O CARD NÃO FICA PARADO: segue com o número do título, que é o
      // que a rotina fazia antes da leitura existir — e, havendo chave e
      // leituras sobrando, a IA tenta de novo na próxima volta.
      avisos.push(`card ${leadId}: ${(e as Error).message}`)
      // Falha do Kommo ao juntar as fontes conta como passageira; a da IA diz
      // se é (ver FalhaDaLeitura).
      const passa = e instanceof FalhaDaLeitura ? e.passageira : true
      lerDeNovo = !!chaveIA && leituras < MAX_LEITURAS && passa
      achados = normalizarProcessos({ processos: [] }, { titulo: String(l.nome ?? ''), anotacoes: '', cnjDoTitulo }).processos
    }

    const antes = (linha?.processos ?? []) as ProcessoDoCredito[]
    const todos = mesclarProcessos(antes, achados)
    const conhecidos = new Set(antes.map((p) => digitosDoCnj(p.cnj)))
    const novos = todos.filter((p) => !conhecidos.has(digitosDoCnj(p.cnj)))

    await svc.from('escavador_autos_card').update({
      estado: lerDeNovo ? 'NOVO' : todos.length ? 'LIDO' : 'SEM_PROCESSO',
      processos: todos,
      leituras,
      lido_em: agora(),
      impressao,
      fontes: lidos,
      detalhe: todos.length ? null : 'Nenhum número de processo no título, nas anotações nem nos anexos.',
      atualizado_em: agora(),
    }).eq('kommo_lead_id', leadId)

    // CADA PROCESSO VIRA UMA LINHA DE PEDIDO — a chave (card, CNJ) é o que
    // impede o segundo pedido do mesmo processo. Papel novo de um processo já
    // conhecido só atualiza o rótulo enquanto nenhum PDF dele subiu.
    for (const p of todos) {
      const rotulo = rotuloDoProcesso(p.papeis, rpv)
      await svc.from('escavador_autos_processo').upsert(
        { kommo_lead_id: leadId, numero_cnj: p.cnj, papeis: p.papeis, rotulo, estado: 'NOVO' },
        { onConflict: 'kommo_lead_id,numero_cnj', ignoreDuplicates: true },
      )
      await svc.from('escavador_autos_processo')
        .update({ papeis: p.papeis, rotulo })
        .eq('kommo_lead_id', leadId)
        .eq('numero_cnj', p.cnj)
        .eq('anexados', 0)
    }
    if (novos.length) await kommo.anotar(leadId, notaDosProcessos(todos, rpv, novos.length))
  }
}

// ------------------------------------------------------------------ 2. PEDIR
async function registrarPedido(svc: Servico, id: number, cnj: string, leadId: number, v: Record<string, any>) {
  await svc.from('escavador_pedido').upsert(
    {
      id,
      numero_cnj: cnj,
      kommo_lead_id: leadId,
      tipo: 'autos',
      status: String(v?.status ?? 'PENDENTE'),
      motivo_erro: v?.motivo_erro ?? null,
      concluido_em: v?.concluido_em ?? null,
      atualizado_em: agora(),
    },
    { onConflict: 'id' },
  )
}

async function pedir(svc: Servico, chave: string, kommo: Kommo, soEste: number | null, avisos: string[]) {
  let q = svc.from('escavador_autos_processo').select('*').in('estado', ['NOVO', 'FILA', 'SEM_SALDO', 'PEDINDO'])
  if (soEste) q = q.eq('kommo_lead_id', soEste)
  const { data } = await q.order('criado_em')
  const processos = (data ?? []) as Processo[]
  if (processos.length === 0) return

  // A COTA DO DIA, no fuso de Brasília.
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const { count } = await svc
    .from('escavador_consumo')
    .select('id', { count: 'exact', head: true })
    .eq('operacao', 'autos_pedido')
    .gte('criado_em', `${hoje}T03:00:00Z`)
  let pedidosHoje = count ?? 0
  const comCallback = await temCallback(svc)

  for (const p of processos) {
    const leadId = Number(p.kommo_lead_id)
    const cnj = p.numero_cnj
    // Posse de pedido só se retoma parada; fila da cota cheia nem se consulta.
    if (p.estado === 'PEDINDO' && Date.now() - Date.parse(p.atualizado_em) < POSSE_PARADA_MS) continue
    if (p.estado === 'FILA' && pedidosHoje >= LIMITE_PEDIDOS_DIA) continue

    // A POSSE DO PEDIDO, antes de qualquer chamada paga.
    const { data: tomei } = await svc
      .from('escavador_autos_processo')
      .update({ estado: 'PEDINDO', atualizado_em: agora() })
      .eq('kommo_lead_id', leadId)
      .eq('numero_cnj', cnj)
      .eq('estado', p.estado)
      .eq('atualizado_em', p.atualizado_em)
      .select('kommo_lead_id')
    if (!tomei?.length) continue
    const gravar = (m: Record<string, unknown>) =>
      svc.from('escavador_autos_processo')
        .update({ atualizado_em: agora(), ...m })
        .eq('kommo_lead_id', leadId)
        .eq('numero_cnj', cnj)

    // O MESMO PROCESSO EM OUTRO CARD: segue o pedido dele (ou espera, se o outro
    // está no meio do pedido).
    const { data: irmao } = await svc
      .from('escavador_autos_processo')
      .select('estado, pedido_id')
      .eq('numero_cnj', cnj)
      .in('estado', ['PEDINDO', 'AGUARDANDO', 'ANEXANDO', 'CONCLUIDO'])
      .neq('kommo_lead_id', leadId)
      .limit(1)
      .maybeSingle()
    if (irmao?.estado === 'PEDINDO') {
      await gravar({ estado: 'FILA', detalhe: 'Outro card deste processo está fazendo o pedido.' })
      continue
    }
    if (irmao?.pedido_id) {
      await gravar({
        estado: irmao.estado === 'AGUARDANDO' ? 'AGUARDANDO' : 'ANEXANDO',
        pedido_id: irmao.pedido_id,
        detalhe: 'O mesmo processo já foi pedido por outro card.',
      })
      continue
    }

    // AUTOS RECENTES NO ESCAVADOR não se pedem de novo — a consulta é de graça e
    // o pedido não. Socorre também a posse parada: se a volta que morreu chegou a
    // pedir, o pedido aparece aqui como PENDENTE e é adotado.
    const consulta = await ultimaVerificacao(chave, cnj)
    if (!consulta.consultou) {
      await gravar({
        estado: 'FILA',
        detalhe: `Não consegui consultar o Escavador antes de pedir (HTTP ${consulta.status}); tento de novo na próxima volta.`,
      })
      continue
    }
    const v = consulta.v
    const comAutos = v?.opcoes?.autos === true
    const recente = v?.concluido_em && Date.now() - Date.parse(String(v.concluido_em)) < REUSO_DIAS * 86_400_000
    if (comAutos && v?.status === 'SUCESSO' && recente) {
      await registrarPedido(svc, Number(v.id), cnj, leadId, v)
      await gravar({ estado: 'ANEXANDO', pedido_id: Number(v.id), detalhe: 'Autos já trazidos recentemente.' })
      continue
    }
    if (comAutos && v?.status === 'PENDENTE') {
      await registrarPedido(svc, Number(v.id), cnj, leadId, v)
      await gravar({ estado: 'AGUARDANDO', pedido_id: Number(v.id), verificado_em: agora() })
      continue
    }

    if (pedidosHoje >= LIMITE_PEDIDOS_DIA) {
      await gravar({ estado: 'FILA', detalhe: `Cota de ${LIMITE_PEDIDOS_DIA} pedidos por dia atingida; pede amanhã.` })
      continue
    }

    const r = await escavador(chave, `/processos/numero_cnj/${cnj}/solicitar-atualizacao`, {
      method: 'POST',
      // O AVISO SÓ COM CALLBACK CADASTRADO. O SDK oficial do Escavador diz que
      // `enviar_callback` exige uma URL de callback na conta, e o único pedido
      // real (22/09, id 58021125) foi feito sem ele. Sem token de callback aqui,
      // o aviso seria recusado mesmo que chegasse; a conferência de meia em
      // meia hora cobre o acompanhamento.
      body: JSON.stringify({ autos: 1, utilizar_certificado: 1, ...(comCallback ? { enviar_callback: 1 } : {}) }),
    })
    if (r.status === 402) {
      await gravar({ estado: 'SEM_SALDO', detalhe: 'O Escavador recusou o pedido por falta de crédito.' })
      avisos.push('Escavador sem saldo: os pedidos de autos param até a recarga.')
      break
    }
    const pedidoId = Number(r.corpo?.id ?? 0)
    if (r.status >= 300 || !pedidoId) {
      const detalhe = `O Escavador recusou o pedido (HTTP ${r.status}): ${String(r.corpo?.message ?? '').slice(0, 200)}`
      // PROBLEMA DA CONTA PARA A VOLTA, e não encerra o processo: token recusado
      // ou limite de chamadas valem para todos, e FALHOU deixaria cada processo
      // sem pedido para sempre, mesmo depois de o token ser trocado.
      if (recusaDaConta(r.status)) {
        await gravar({ estado: 'FILA', detalhe })
        avisos.push(`Escavador recusou o pedido pela conta (HTTP ${r.status}): os pedidos param nesta volta.`)
        break
      }
      // SEM RESPOSTA OU ERRO DO LADO DELES volta para a fila. Se o pedido chegou
      // a ser feito e cobrado, a consulta da próxima volta o encontra PENDENTE e
      // o adota, em vez de pagar outro.
      if (falhaPassageira(r.status)) {
        await gravar({ estado: 'FILA', detalhe: `${detalhe} — tento de novo na próxima volta.` })
        continue
      }
      // A RECUSA PODE SER "JÁ HÁ PEDIDO EM ANDAMENTO": adota-se aquele pedido.
      // Recusa definitiva não se repete a cada volta (o log da conta).
      const depois = (await ultimaVerificacao(chave, cnj)).v
      if (depois?.opcoes?.autos === true && depois?.status === 'PENDENTE') {
        await registrarPedido(svc, Number(depois.id), cnj, leadId, depois)
        await gravar({ estado: 'AGUARDANDO', pedido_id: Number(depois.id), verificado_em: agora(), detalhe: null })
      } else {
        await gravar({ estado: 'FALHOU', detalhe })
        await kommo.anotar(leadId, notaDeFalha(cnj, detalhe.replace(/^O Escavador/, 'o Escavador')))
      }
      continue
    }
    pedidosHoje++
    await registrarPedido(svc, pedidoId, cnj, leadId, r.corpo)
    await svc.from('escavador_consumo').insert({
      kommo_lead_id: leadId,
      operacao: 'autos_pedido',
      alvo: cnj,
      centavos: r.centavos,
      requisicoes: 1,
      processos: 1,
    })
    await gravar({ estado: 'AGUARDANDO', pedido_id: pedidoId, verificado_em: agora(), detalhe: null })
  }
}

// ------------------------------------------------------------------ 3. ACOMPANHAR
/** Quando o pedido foi feito, pelo registro dele (ms); null se não há como saber. */
async function quandoFoiPedido(svc: Servico, pedidoId: number | null): Promise<number | null> {
  if (!pedidoId) return null
  const { data } = await svc.from('escavador_pedido').select('criado_em').eq('id', pedidoId).maybeSingle()
  return Date.parse(String(data?.criado_em ?? '')) || null
}

async function acompanhar(svc: Servico, chave: string, kommo: Kommo, soEste: number | null) {
  let q = svc.from('escavador_autos_processo').select('*').eq('estado', 'AGUARDANDO')
  if (soEste) q = q.eq('kommo_lead_id', soEste)
  const { data } = await q
  const limite = Date.now() - REVER_MIN * 60_000
  for (const p of (data ?? []) as Processo[]) {
    if (!soEste && p.verificado_em && Date.parse(p.verificado_em) > limite) continue
    const gravar = (m: Record<string, unknown>) =>
      svc.from('escavador_autos_processo')
        .update({ atualizado_em: agora(), ...m })
        .eq('kommo_lead_id', p.kommo_lead_id)
        .eq('numero_cnj', p.numero_cnj)
    const consulta = await ultimaVerificacao(chave, p.numero_cnj)
    // CONSULTA QUE NÃO RESPONDEU não decide nada: nem sucesso, nem desistência.
    if (!consulta.consultou) {
      await gravar({ verificado_em: agora() })
      continue
    }
    const v = consulta.v
    const status = String(v?.status ?? 'PENDENTE').toUpperCase()
    const doPedido =
      v && (Number(v.id) === Number(p.pedido_id) || Date.parse(String(v.criado_em)) >= Date.parse(p.criado_em))
    if (v && doPedido) await registrarPedido(svc, Number(v.id), p.numero_cnj, p.kommo_lead_id, v)
    // AS 72 HORAS CONTAM DO PEDIDO, e não da linha. `criado_em` da linha é a
    // leitura do card: um processo que esperou três dias na FILA (cota, saldo)
    // era pago e, meia hora depois, dado como "tribunal não respondeu" — R$ 1,34
    // perdidos e nada no card.
    const pedidoEm = (doPedido && Date.parse(String(v?.criado_em ?? ''))) || (await quandoFoiPedido(svc, p.pedido_id))

    if (doPedido && status === 'SUCESSO') {
      await gravar({ estado: 'ANEXANDO', verificado_em: agora(), detalhe: null })
    } else if (doPedido && status !== 'PENDENTE') {
      const motivo = motivoDoEstado(status, v?.motivo_erro ?? null)
      await gravar({ estado: 'FALHOU', detalhe: motivo, verificado_em: agora() })
      await kommo.anotar(p.kommo_lead_id, notaDeFalha(`${p.numero_cnj} (${p.rotulo.toLowerCase()})`, motivo))
    } else if (pedidoEm && Date.now() - pedidoEm > DESISTIR_H * 3_600_000) {
      const motivo = `o tribunal não respondeu em ${DESISTIR_H} horas`
      await gravar({ estado: 'FALHOU', detalhe: motivo })
      await kommo.anotar(p.kommo_lead_id, notaDeFalha(`${p.numero_cnj} (${p.rotulo.toLowerCase()})`, motivo))
    } else {
      await gravar({ verificado_em: agora() })
    }
  }
}

// ------------------------------------------------------------------ 4. ANEXAR
/** A lista inteira dos autos, seguindo as páginas; com a dos públicos na falta de permissão. */
async function listarAutos(svc: Servico, chave: string, cnj: string, pedidoId: number | null) {
  const docs: ReturnType<typeof documentosDosAutos> = []
  for (const rota of ['autos', 'documentos-publicos']) {
    let url: string | null = `/processos/numero_cnj/${cnj}/${rota}?limit=100`
    let paginas = 0
    const desta: typeof docs = []
    for (let i = 0; url && i < 60; i++) {
      const r = await escavador(chave, url)
      if (r.status !== 200) {
        // LISTA PELA METADE NÃO É LISTA. Uma página do meio que falhava encerrava
        // a leitura com o que já tinha, e o processo terminava "60 de 60" com 206
        // documentos nos autos. O erro sobe, e a próxima volta lista de novo.
        if (paginas > 0) {
          throw new Error(`a lista dos autos parou na página ${paginas + 1} (HTTP ${r.status}); continua na próxima volta`)
        }
        // Na primeira página, só a recusa AFIRMADA passa para a outra rota (sem
        // permissão para os autos → os documentos públicos); o resto é passageiro.
        if (falhaPassageira(r.status) || r.status === 401) {
          throw new Error(`o Escavador não entregou a lista dos autos (HTTP ${r.status}); continua na próxima volta`)
        }
        break
      }
      paginas++
      desta.push(...documentosDosAutos(r.corpo))
      url = r.corpo?.links?.next ?? null
    }
    if (desta.length) {
      docs.push(...desta)
      break
    }
  }
  const vistos = new Set<string>()
  const unicos = emOrdemDosAutos(docs.filter((d) => !vistos.has(d.chave) && vistos.add(d.chave)))
  for (let i = 0; i < unicos.length; i += 100) {
    // GRAVAÇÃO QUE FALHA NÃO PODE PASSAR EM SILÊNCIO: com a lista fora do banco,
    // o processo terminava CONCLUIDO com "0 de 0" e nenhum aviso.
    const { error } = await svc.from('escavador_documento').upsert(
      unicos.slice(i, i + 100).map((d, j) => ({
        numero_cnj: cnj,
        pedido_id: pedidoId,
        chave: d.chave,
        nome: d.titulo,
        tipo: d.tipo,
        data_documento: d.data ? `${d.data}Z` : null,
        paginas: d.paginas,
        ordem: i + j + 1,
      })),
      { onConflict: 'numero_cnj,chave' },
    )
    if (error) throw new Error(`não consegui gravar a lista dos autos: ${String(error.message).slice(0, 160)}`)
  }
  return unicos
}

async function anexar(svc: Servico, chave: string, kommo: Kommo, soEste: number | null, resta: () => number) {
  let q = svc.from('escavador_autos_processo').select('*').eq('estado', 'ANEXANDO').order('atualizado_em')
  if (soEste) q = q.eq('kommo_lead_id', soEste)
  const { data } = await q
  let sobrou = false

  for (const p of (data ?? []) as Processo[]) {
    if (resta() < 20_000) {
      sobrou = true
      break
    }
    const gravar = (m: Record<string, unknown>) =>
      svc.from('escavador_autos_processo')
        .update({ atualizado_em: agora(), ...m })
        .eq('kommo_lead_id', p.kommo_lead_id)
        .eq('numero_cnj', p.numero_cnj)

    // A TRAVA: só uma volta trabalha neste processo do card por vez. A linha
    // volta inteira e substitui a lida antes: entre as duas, outra volta pode
    // ter anexado documentos, e `chaves_anexadas` velho subiria o mesmo PDF.
    const { data: peguei } = await svc
      .from('escavador_autos_processo')
      .update({ trabalhando_ate: new Date(Date.now() + 3 * 60_000).toISOString() })
      .eq('kommo_lead_id', p.kommo_lead_id)
      .eq('numero_cnj', p.numero_cnj)
      .eq('estado', 'ANEXANDO')
      .or(`trabalhando_ate.is.null,trabalhando_ate.lt."${agora()}"`)
      .select('*')
    if (!peguei?.length) continue
    Object.assign(p, peguei[0])

    const cnj = p.numero_cnj
    const leadId = p.kommo_lead_id
    try {
      const lerDocs = () =>
        svc.from('escavador_documento').select('*').eq('numero_cnj', cnj).order('ordem', { ascending: true })
      let { data: docs } = await lerDocs()
      if (!docs?.length || p.total_documentos === 0) {
        const lista = await listarAutos(svc, chave, cnj, p.pedido_id)
        if (lista.length === 0) {
          const motivo = 'o Escavador concluiu, mas não entregou documento nenhum'
          await gravar({ estado: 'FALHOU', detalhe: motivo, trabalhando_ate: null })
          await kommo.anotar(leadId, notaDeFalha(`${cnj} (${p.rotulo.toLowerCase()})`, motivo))
          continue
        }
        const paginas = lista.reduce((t, d) => t + d.paginas, 0)
        await gravar({ total_documentos: lista.length, paginas })
        p.total_documentos = lista.length
        p.paginas = paginas
        ;({ data: docs } = await lerDocs())
        if (!docs?.length) throw new Error('a lista dos autos não ficou gravada; continua na próxima volta')
      }

      const feitas = new Set(p.chaves_anexadas ?? [])
      const todos = (docs ?? []) as any[]
      // O DISJUNTOR: cinco falhas seguidas sem acerto é defeito do caminho (token
      // sem acesso ao drive, cota do Kommo cheia), e não do documento.
      let seguidas = 0
      let acertos = 0
      let ultimoErro = ''
      /** Os documentos da sequência de falhas: se o disjuntor abrir, a culpa não foi deles. */
      let daSequencia: any[] = []
      for (const d of todos) {
        if (seguidas >= 5 && acertos === 0) break
        if (feitas.has(d.chave) || Number(d.tentativas) >= MAX_TENTATIVAS) continue
        if (resta() < 20_000) {
          sobrou = true
          break
        }
        // A TENTATIVA CONTA ANTES DE BAIXAR. Contada só no erro, um documento que
        // derrubava a volta (memória, tempo) nunca era contado: voltava a ser o
        // primeiro da fila em toda volta, e os seguintes nunca subiam.
        let contada = false
        try {
          let uuid: string | null = d.kommo_file_uuid ?? null
          if (!uuid) {
            // Outro card do mesmo processo pode ter subido este PDF agora há pouco.
            const { data: fresco } = await svc
              .from('escavador_documento')
              .select('kommo_file_uuid')
              .eq('id', d.id)
              .maybeSingle()
            uuid = fresco?.kommo_file_uuid ?? null
          }
          if (!uuid) {
            d.tentativas = Number(d.tentativas) + 1
            contada = true
            await svc.from('escavador_documento').update({ tentativas: d.tentativas }).eq('id', d.id)
            const res = await fetch(`${BASE_ESCAVADOR}/processos/numero_cnj/${cnj}/documentos/${d.chave}`, {
              headers: { Authorization: `Bearer ${chave}` },
              signal: AbortSignal.timeout(TEMPO_DOWNLOAD_MS),
            })
            if (!res.ok) throw new Error(`o Escavador recusou o download (HTTP ${res.status})`)
            // GRANDE DEMAIS NÃO SE LÊ: o tamanho vem no cabeçalho, antes do corpo, e
            // ler o corpo de um arquivo maior que a memória derruba a função.
            const tamanho = Number(res.headers.get('content-length') ?? 0) || 0
            if (tamanho > MAX_BYTES_NA_MEMORIA) {
              await res.body?.cancel()
              throw new DocumentoImpossivel(`arquivo grande demais para descer por aqui (${Math.round(tamanho / 1_048_576)} MB)`)
            }
            const bytes = new Uint8Array(await res.arrayBuffer())
            if (bytes.byteLength > MAX_BYTES_NA_MEMORIA) {
              throw new DocumentoImpossivel(`arquivo grande demais para descer por aqui (${Math.round(bytes.byteLength / 1_048_576)} MB)`)
            }
            // O ANEXO SOBE COMO PDF: corpo que não é PDF (página de erro, HTML)
            // viraria um arquivo quebrado no card.
            if (!ehPdf(bytes)) throw new DocumentoImpossivel('o Escavador não devolveu um PDF')
            const nome = nomeDoAnexo(
              Number(d.ordem) || 1,
              p.total_documentos,
              { titulo: String(d.nome ?? ''), data: d.data_documento ? String(d.data_documento).slice(0, 19) : null },
              p.rotulo,
            )
            uuid = await kommo.subir(nome, bytes)
            // SUBIU: as tentativas voltam a zero. Elas valem para o documento em
            // todos os cards do processo, e um acerto contado como tentativa
            // tiraria o PDF do terceiro card que o anexasse.
            await svc.from('escavador_documento')
              .update({ kommo_file_uuid: uuid, bytes: bytes.byteLength, baixado_em: agora(), erro: null, tentativas: 0 })
              .eq('id', d.id)
            d.tentativas = 0
          }
          await kommo.anexar(leadId, [uuid])
          feitas.add(d.chave)
          await svc.from('escavador_documento').update({ anexado_em: agora() }).eq('id', d.id)
          acertos++
          seguidas = 0
          daSequencia = []
          await gravar({
            chaves_anexadas: [...feitas],
            anexados: feitas.size,
            trabalhando_ate: new Date(Date.now() + 3 * 60_000).toISOString(),
          })
        } catch (e) {
          const erro = String((e as Error).message).slice(0, 300)
          // O documento que não tem como descer esgota as tentativas de uma vez, e
          // não conta no disjuntor: o defeito é dele, não do caminho.
          const impossivel = e instanceof DocumentoImpossivel
          const tentativas = impossivel ? MAX_TENTATIVAS : Number(d.tentativas) + (contada ? 0 : 1)
          await svc.from('escavador_documento').update({ tentativas, erro }).eq('id', d.id)
          d.tentativas = tentativas
          d.erro = erro
          if (!impossivel) {
            seguidas++
            ultimoErro = erro
            daSequencia.push(d)
          }
        }
      }

      if (seguidas >= 5 && acertos === 0) {
        const motivo = `os PDFs não sobem para o Kommo: ${ultimoErro.slice(0, 200)}`
        // SÓ A FALTA DE ACESSO ENCERRA. Antes, cinco falhas seguidas numa volta
        // davam FALHOU para sempre — mesmo com 150 de 206 documentos já no card,
        // e mesmo quando a causa era um 5xx ou um limite que passa em minutos. O
        // processo descansa meia hora e continua; cada documento tem as suas três
        // tentativas, então a espera não vira laço.
        if (semAcessoAoKommo(ultimoErro)) {
          await gravar({ estado: 'FALHOU', detalhe: motivo, trabalhando_ate: null })
          await kommo.anotar(leadId, notaDeFalha(`${cnj} (${p.rotulo.toLowerCase()})`, motivo))
        } else {
          // A TENTATIVA DEVOLVIDA quando a queda foi passageira: uma
          // indisponibilidade longa esgotaria os documentos da frente um a um,
          // sem culpa deles. Recusa que não passa sozinha segue contando.
          for (const d of erroPassageiro(ultimoErro) ? daSequencia : []) {
            const t = Math.max(0, Number(d.tentativas) - 1)
            await svc.from('escavador_documento').update({ tentativas: t }).eq('id', d.id)
          }
          await gravar({
            detalhe: `${motivo} — tento de novo em meia hora.`,
            trabalhando_ate: new Date(Date.now() + PAUSA_APOS_FALHAS_MS).toISOString(),
          })
        }
        continue
      }

      const faltam = todos.filter((d) => !feitas.has(d.chave) && Number(d.tentativas) < MAX_TENTATIVAS)
      if (faltam.length === 0) {
        const falhas = todos.filter((d) => !feitas.has(d.chave)).map((d) => `${d.nome} (${d.erro ?? 'erro'})`)
        const datas = todos.map((d) => d.data_documento).filter(Boolean).sort()
        await gravar({
          estado: 'CONCLUIDO',
          concluido_em: agora(),
          trabalhando_ate: null,
          detalhe: falhas.length ? `${falhas.length} documento(s) não desceram.` : null,
        })
        await kommo.anotar(
          leadId,
          notaDosAutos({
            cnj,
            rotulo: p.rotulo,
            anexados: feitas.size,
            total: todos.length,
            paginas: p.paginas,
            primeiro: datas[0] ?? null,
            ultimo: datas.at(-1) ?? null,
            falhas,
          }),
        )
      } else {
        sobrou = true
        await gravar({ trabalhando_ate: null })
      }
    } catch (e) {
      sobrou = true
      await gravar({ trabalhando_ate: null, detalhe: String((e as Error).message).slice(0, 300) })
    }
  }
  return sobrou
}

/** A próxima volta, numa invocação separada — nenhuma passa do teto de tempo. */
function proximaVolta(volta: number, soEste: number | null) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/escavador-autos-rotina`
  const p = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': Deno.env.get('CRON_SECRET') ?? '' },
    body: JSON.stringify({ volta: volta + 1, lead_id: soEste }),
  }).catch(() => {})
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const inicio = Date.now()
  const resta = () => ORCAMENTO_MS - (Date.now() - inicio)
  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    const porCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    if (!porCron) {
      const caller = await getCallerAtivo(req, serviceClient())
      if (!caller) return jsonResponse({ erro: ERRO_ACESSO }, 401)
    }
    const body = (await req.json().catch(() => ({}))) as { lead_id?: number; volta?: number }
    const soEste = Number(body.lead_id) || null
    const volta = Number(body.volta) || 0

    const svc = serviceClient()
    const chave = await chaveEscavador()
    const conta = await contaKommo()
    if (!chave) return jsonResponse({ erro: 'Token do Escavador não configurado.' }, 400)
    if (!conta) return jsonResponse({ erro: 'Kommo não configurado.' }, 400)
    const kommo = clienteKommo(conta.token, conta.subdominio)
    const chaveIA = await chaveAnthropic()
    const avisos: string[] = []

    // A primeira volta lê, pede e acompanha; as encadeadas só continuam anexando.
    if (volta === 0) {
      await lerCards(svc, kommo, chaveIA, soEste, resta, avisos)
      await pedir(svc, chave, kommo, soEste, avisos)
      await acompanhar(svc, chave, kommo, soEste)
    }
    const sobrou = await anexar(svc, chave, kommo, soEste, resta)
    if (sobrou && volta < MAX_ENCADEADAS) proximaVolta(volta, soEste)

    let q = svc
      .from('escavador_autos_processo')
      .select('kommo_lead_id, numero_cnj, rotulo, estado, anexados, total_documentos, detalhe')
    if (soEste) q = q.eq('kommo_lead_id', soEste)
    const { data: processos } = await q.order('atualizado_em', { ascending: false }).limit(soEste ? 10 : 20)
    return jsonResponse({ ok: true, volta, continua: sobrou, avisos, processos: processos ?? [] })
  } catch (e) {
    return jsonResponse({ erro: (e as Error).message }, 500)
  }
})
