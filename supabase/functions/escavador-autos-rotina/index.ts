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
//   4. ANEXA. Pronto o pedido, os documentos descem do Escavador e sobem ao card
//      JUNTADOS: um PDF por processo, na ordem do processo, dividido em partes
//      só quando o tamanho obriga — "Conhecimento - autos completos - {CNJ}.pdf"
//      ou "Conhecimento - autos (parte 1 de 3) - {CNJ}.pdf". Cada parte fica SÓ
//      na aba Arquivos do card (pedido do dono, 20/10/2026: sem nota de anexo
//      no chat; ver `juntar.ts`). Nada fica guardado na plataforma além do
//      registro do que já subiu.
//
//      ANTES DA MIGRAÇÃO 0077 a rotina faz o que fazia: um arquivo por
//      documento, só na área Arquivos. A coluna `juntada` é o que liga o novo.
//
// UMA NOTA SÓ POR CARD (pedido do dono, 20/10/2026). Criada quando a leitura
// identifica os processos e EDITADA no lugar a cada mudança — nenhuma nota nova
// no fim do histórico. O texto é recalculado do banco a cada volta
// (`atualizarNotas`; ver `_shared/notaUnicaDosAutos.ts`). Sem a migração 0078
// fica só a primeira nota; card lido antes da mudança não ganha nota nenhuma.
//
// O CARD QUE SAI DA COLUNA DE ANÁLISE não pede mais autos (pedido do dono,
// 20/10/2026): o que ainda não foi pedido vira INTERROMPIDO, e volta para a
// fila se o card voltar. O pedido já iniciado termina. Ver
// `_shared/interrupcaoDosAutos.ts`.
//
// A FALHA DO ROBÔ DO ESCAVADOR (INTERNAL_ERROR, LOGIN_ERROR) não encerra mais
// o processo: o pedido se repete de 10 em 10 minutos, até um teto (6 por
// padrão); a nota do card mostra a tentativa. Ver `_shared/falhasDosAutos.ts`.
//
// AÇÕES (só com x-cron-secret; `simular: true` lista sem mudar nada):
//   { acao: 'rejuntar', lead_id?, cnj? }      os processos já CONCLUIDOS com os
//       documentos soltos no card são montados de novo, juntados, a partir do
//       Escavador (baixar não custa). Os soltos NÃO são apagados.
//   { acao: 'repetir_falhas', lead_id?, teto? }  os processos em FALHOU por falha
//       passageira do robô entram numa rodada de repetição (cada uma é um
//       pedido pago, R$ 1,34, dentro da cota diária).
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
import { falhaDaAnthropic } from '../_shared/falhaDaAnthropic.ts'
import { BASE_ESCAVADOR } from '../_shared/escavador.ts'
import { cnjDoCard } from '../_shared/nucleo/cnj.ts'
import { assinarNota } from '../_shared/notaCredijuris.ts'
import { kommoFetch } from '../_shared/kommoFetch.ts'
import { subirAoDriveDoKommo, subirAoDriveDoKommoComVersao } from '../_shared/driveDoKommo.ts'
import { proximaPaginaDeArquivos } from '../_shared/paginasDeArquivos.ts'
import {
  documentosDosAutos,
  emOrdemDosAutos,
  entradasDoOperacional,
  FUNIL_RPV,
  FUNIS_DE_ENTRADA_POR_NOME,
  motivoDoEstado,
  nomeDoAnexo,
} from '../_shared/autosParaOKommo.ts'
import { juntadaInicial, lerJuntada } from '../_shared/autosJuntos.ts'
import { juntarProcessos } from './juntar.ts'
import {
  cobrancaPossivel,
  downloadSumiu,
  inicioDoDiaEmBrasilia,
  reservaCabeNaCota,
  temTempoParaConferir,
  verificacaoDoPedido,
} from './concorrencia.ts'
import { lerTodasAsLinhas } from '../_shared/leituraPaginada.ts'
import {
  ehAnexoDosAutos,
  faltaPapel,
  impressaoDoCard,
  mesclarProcessos,
  normalizarProcessos,
  type ProcessoDoCredito,
  rotuloDoProcesso,
  SISTEMA_PROCESSOS,
} from '../_shared/processosDoCredito.ts'
import {
  DETALHE_INTERROMPIDO,
  DETALHE_RETOMADO,
  ESTADOS_INTERROMPIVEIS,
  INTERROMPIDO,
  podePagarPedido,
  proximoEstadoDaLeitura,
  proximoEstadoDoProcesso,
  situacaoDoCard,
  type SituacaoDoCard,
} from '../_shared/interrupcaoDosAutos.ts'
import {
  type NotaDoCard,
  notaUnicaDosAutos,
  type PortaDaNota,
  processoDaNota,
  sincronizarNotaDoCard,
} from '../_shared/notaUnicaDosAutos.ts'
import {
  codigoDoRoboNoDetalhe,
  consultaRespondeu,
  depoisDaFalhaDoRobo,
  ehPdf,
  erroPassageiro,
  falhaPassageira,
  falhaPassageiraDoRobo,
  horaDeConferir,
  horaDeRepetir,
  INTERVALO_REPETIR_MIN,
  MAX_BYTES_NA_MEMORIA,
  recusaDaConta,
  SEM_RESPOSTA,
  semAcessoAoKommo,
  tetoDoRobo,
  voltouParaAEntrada,
} from '../_shared/falhasDosAutos.ts'

type Servico = ReturnType<typeof serviceClient>

/** Quanto uma volta trabalha antes de passar a vez. */
const ORCAMENTO_MS = 100_000
/** Pedidos novos ao Escavador por dia (R$ 1,34 cada). Protege de uma enxurrada de cards. */
const LIMITE_PEDIDOS_DIA = 40
/**
 * Abaixo disto do orçamento (ORCAMENTO_MS), não se começa outro pedido pago: o
 * que está em voo ainda tem ~60 s até o teto real de ~150 s para terminar e gravar.
 */
const FOLGA_PARA_PEDIR_MS = 10_000
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
  // Da migração 0078 (ausentes antes dela):
  nota_id?: number | null
  nota_texto?: string | null
  nota_em?: string | null
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
  detalhe?: string | null
  // Da migração 0077 (ausentes antes dela):
  juntada?: unknown
  tentativas_do_pedido?: number
  teto_de_tentativas?: number | null
  falha_do_robo?: string | null
  desistiu_em?: string | null
}

/**
 * Quanto a junção trabalha, contado do início da invocação. O teto real do
 * projeto é 150 s de parede (medido em 07/10/2026 na justificativa técnica —
 * não os 400 s do plano pago); 115 s deixa folga para fechar e gravar.
 */
const PRAZO_JUNCAO_MS = 115_000
/** Até quando (contado do início da invocação) a nota do card se edita depois da junção. */
const PRAZO_DAS_NOTAS_MS = 140_000

/**
 * A migração 0077 já rodou? Sem as colunas dela, a rotina faz o que fazia
 * antes (um arquivo por documento; falha do robô encerra o processo) — e não
 * quebra: gravar numa coluna que não existe derrubaria a gravação inteira.
 */
async function temAMigracaoNova(svc: Servico): Promise<boolean> {
  const { error } = await svc
    .from('escavador_autos_processo')
    .select('juntada, tentativas_do_pedido, teto_de_tentativas, falha_do_robo, desistiu_em')
    .limit(1)
  return !error
}

/**
 * A migração 0078 já rodou? Sem as colunas da nota única, a rotina escreve só
 * a PRIMEIRA nota do card (os processos identificados) e nenhuma outra: não há
 * onde guardar o id para editá-la depois, e escrever uma nota a cada passo é o
 * que o dono pediu para acabar.
 */
async function temANotaUnica(svc: Servico): Promise<boolean> {
  const { error } = await svc.from('escavador_autos_card').select('nota_id, nota_texto, nota_em').limit(1)
  return !error
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
  const api = async (caminho: string, init: RequestInit = {}, opcoes: { idempotente?: boolean } = {}) => {
    const espera = 160 - (Date.now() - ultima)
    if (espera > 0) await dormir(espera)
    ultima = Date.now()
    // PELO kommoFetch (auditoria de bugs, 09/10/2026): o 429 (a cota é
    // disputada com o sync e a equipe) é repetido com espera, em vez de virar
    // falha; o 5xx só no GET e no que se declara idempotente (o PATCH do texto
    // da nota) — um POST de nota pode ter gravado.
    return kommoFetch(`${base}${caminho}`, {
      ...init,
      signal: AbortSignal.timeout(TEMPO_API_MS),
      headers: { ...auth, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    }, opcoes)
  }
  const cliente = {
    async urlDoDrive(): Promise<string> {
      if (drive) return drive
      const r = await api('/account?with=drive_url')
      // O STATUS PRIMEIRO (23/10/2026): um 401/429 virava "não consegui descobrir
      // o drive", e a procura ia para o lugar errado.
      if (!r.ok) throw new Error(`o Kommo não informou o drive da conta (HTTP ${r.status}): ${(await r.text().catch(() => '')).slice(0, 160)}`)
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
        const atual: string = caminho
        const r = await api(atual)
        if (r.status === 204) break
        // FALHA NÃO É "SEM ANEXO" (auditoria de bugs, 09/10/2026): um 429/5xx
        // aqui devolvia a lista vazia, a IA lia o card sem os PDFs, o card
        // ficava LIDO e não era relido (a impressão não muda) — o ofício
        // anexado nunca era olhado. O erro sobe e a leitura conta como passageira.
        if (!r.ok) throw new Error(`a aba Arquivos do card não veio do Kommo (HTTP ${r.status})`)
        const j = (await r.json().catch(() => ({}))) as any
        let novos = 0
        for (const f of j?._embedded?.files ?? []) {
          if (f?.file_uuid && !fora.includes(String(f.file_uuid))) {
            fora.push(String(f.file_uuid))
            novos++
          }
        }
        // O `next`, ou o `before_id` quando a página veio cheia (ver
        // _shared/paginasDeArquivos.ts); página sem arquivo novo encerra.
        const prox = novos ? proximaPaginaDeArquivos(atual, j, 50) : null
        caminho = prox ? prox.replace(/^https?:\/\/[^/]+\/api\/v4/, '') : null
      }
      return fora
    },
    /** Nome, tamanho, tipo e endereço de download de um arquivo do drive. */
    async metadados(uuid: string) {
      const d = await cliente.urlDoDrive()
      const r = await kommoFetch(`${d}/v1.0/files/${uuid}`, { headers: auth, signal: AbortSignal.timeout(TEMPO_API_MS) })
      // 404 é arquivo apagado: não há o que ler. O resto é falha, e sobe.
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`os dados de um anexo não vieram do Kommo (HTTP ${r.status})`)
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
      // SÓ O 404 É "SUMIU" (auditoria, 23/10/2026). Antes, qualquer falha (429,
      // 5xx, tempo esgotado) virava null, e o card ficava LIDO sem aquele PDF —
      // a impressão do card não muda, então ele nunca era relido. O resto sobe,
      // e a leitura conta como passageira (refeita na próxima volta).
      if (downloadSumiu(r.status)) {
        await r.body?.cancel().catch(() => {})
        return null
      }
      if (!r.ok) {
        await r.body?.cancel().catch(() => {})
        throw new Error(`um anexo do card não desceu do Kommo (HTTP ${r.status})`)
      }
      return new Uint8Array(await r.arrayBuffer())
    },
    /** Sobe um PDF ao drive do Kommo, em partes — ver `_shared/driveDoKommo.ts`. */
    async subir(nome: string, bytes: Uint8Array): Promise<string> {
      return subirAoDriveDoKommo({ drive: await cliente.urlDoDrive(), auth, nome, bytes, mime: 'application/pdf' })
    },
    /** Sobe um PDF e devolve o uuid e a versão. */
    async subirComVersao(nome: string, bytes: Uint8Array) {
      return subirAoDriveDoKommoComVersao({ drive: await cliente.urlDoDrive(), auth, nome, bytes, mime: 'application/pdf' })
    },
    // SEM NOTA DE ANEXO (o tipo `attachment`) desde 20/10/2026, a pedido
    // do dono: os PDFs dos autos ficam só na aba Arquivos do card (o PUT de
    // `anexar`). O "Executar análise" e o conector dos autos leem a lista
    // `/leads/{id}/files` (pela buscar-kommo), e não as notas.
    async anexar(leadId: number, uuids: string[]) {
      const r = await api(`/leads/${leadId}/files`, {
        method: 'PUT',
        body: JSON.stringify(uuids.map((file_uuid) => ({ file_uuid }))),
      })
      if (!r.ok) throw new Error(`o Kommo recusou o anexo (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}`)
    },
    /**
     * A NOTA ÚNICA dos autos, criada (POST; o texto já vem assinado). Devolve o
     * id que o Kommo deu — 0 se ele aceitou sem devolver id: não há o que
     * editar depois, e criar outra duplicaria a nota.
     */
    async criarNota(leadId: number, texto: string): Promise<{ id: number } | { erro: string }> {
      try {
        const r = await api('/leads/notes', {
          method: 'POST',
          body: JSON.stringify([
            { entity_id: leadId, note_type: 'common', params: { text: texto }, is_need_to_trigger_digital_pipeline: false },
          ]),
        })
        if (!r.ok) return { erro: `o Kommo recusou a nota (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}` }
        const j = (await r.json().catch(() => null)) as { _embedded?: { notes?: { id?: number }[] } } | null
        const id = Number(j?._embedded?.notes?.[0]?.id)
        return { id: Number.isFinite(id) && id > 0 ? id : 0 }
      } catch (e) {
        return { erro: `a nota não respondeu (${(e as Error)?.message ?? e})` }
      }
    },
    /**
     * A NOTA ÚNICA editada no lugar: PATCH /leads/notes/{id}, que mantém a nota
     * na posição dela no histórico. IDEMPOTENTE (o mesmo texto aplicado duas
     * vezes dá o mesmo), então o 5xx se repete. 404 = apagada no Kommo.
     */
    async editarNota(leadId: number, notaId: number, texto: string): Promise<'ok' | 'apagada' | { erro: string }> {
      try {
        const r = await api(`/leads/notes/${notaId}`, {
          method: 'PATCH',
          body: JSON.stringify({ entity_id: leadId, note_type: 'common', params: { text: texto } }),
        }, { idempotente: true })
        if (r.ok) return 'ok'
        if (r.status === 404) return 'apagada'
        return { erro: `o Kommo recusou a edição da nota (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}` }
      } catch (e) {
        return { erro: `a edição da nota não respondeu (${(e as Error)?.message ?? e})` }
      }
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
  // SEM `.catch`: a falha do Kommo sobe e a leitura é refeita na próxima volta
  // (ver `arquivosDoCard`), em vez de o card ser lido sem os anexos.
  for (const u of await kommo.arquivosDoCard(Number(lead.kommo_lead_id))) uuids.add(u)
  const candidatos: { nome: string; bytes: number; download: string }[] = []
  for (const u of [...uuids].slice(0, 30)) {
    const m = await kommo.metadados(u)
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
    // SEM `.catch` (23/10/2026): a falha do download sobe e a leitura é refeita,
    // como a da aba Arquivos. Só o anexo apagado (404) fica de fora.
    const b = await kommo.baixar(c.download)
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
  /** `daConta`: a falha é da conta da Anthropic (sem créditos, chave) — não gasta leitura do card. */
  constructor(mensagem: string, readonly passageira: boolean, readonly daConta = false) {
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
  let daConta = false
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
      // SEM CRÉDITOS NA CONTA (19/10/2026) — e chave recusada, limite, sobrecarga:
      // não é o documento, é a conta. O 400 do saldo zerado era tratado como
      // "documento grande", a leitura encolhia, falhava de novo e o card ficava
      // LIDO só com o número do título, sem nunca ser relido depois da recarga.
      // Agora é passageira: o card volta para a fila e é lido quando a conta voltar.
      if (falhaDaAnthropic(`${j?.error?.type ?? ''} ${j?.error?.message ?? ''}`)) {
        passageira = true
        daConta = true
        break
      }
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
  throw new FalhaDaLeitura(`a leitura pela IA falhou (${ultimoErro})`, passageira, daConta)
}

async function lerCards(
  svc: Servico,
  kommo: Kommo,
  chaveIA: string | null,
  soEste: number | null,
  resta: () => number,
  avisos: string[],
  notaUnica: boolean,
) {
  const leads = await cardsNaEntrada(svc, soEste)
  if (leads.length === 0) return
  const { data: linhas } = await svc
    .from('escavador_autos_card')
    .select(
      'kommo_lead_id, estado, processos, leituras, lido_em, impressao, atualizado_em' +
        (notaUnica ? ', nota_id, nota_texto, nota_em' : ''),
    )
    .in('kommo_lead_id', leads.map((l) => l.kommo_lead_id))
  const porLead = new Map(((linhas ?? []) as unknown as CardLido[]).map((c) => [Number(c.kommo_lead_id), c]))
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
    let leituras = (linha?.leituras ?? 0) + 1
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
      // A FALHA DA CONTA (sem créditos, chave) não gasta leitura: o card volta
      // para a fila com o contador de antes, e é lido quando a conta voltar.
      if (e instanceof FalhaDaLeitura && e.daConta) leituras = linha?.leituras ?? 0
      lerDeNovo = !!chaveIA && passa && (leituras < MAX_LEITURAS || (e instanceof FalhaDaLeitura && e.daConta))
      achados = normalizarProcessos({ processos: [] }, { titulo: String(l.nome ?? ''), anotacoes: '', cnjDoTitulo }).processos
    }

    const antes = (linha?.processos ?? []) as ProcessoDoCredito[]
    const todos = mesclarProcessos(antes, achados)

    // O REGIME DA NOTA ÚNICA começa na PRIMEIRA leitura depois da migração 0078
    // (`nota_em`). Card que já tinha sido lido antes dela fica sem nota nova:
    // ele já tem as notas antigas no histórico.
    const primeiraLeitura = !linha || !((linha.leituras ?? 0) > 0 || linha.lido_em)
    const entraNoRegime = notaUnica && !linha?.nota_em && primeiraLeitura

    await svc.from('escavador_autos_card').update({
      estado: lerDeNovo ? 'NOVO' : todos.length ? 'LIDO' : 'SEM_PROCESSO',
      processos: todos,
      leituras,
      lido_em: agora(),
      impressao,
      fontes: lidos,
      detalhe: todos.length ? null : 'Nenhum número de processo no título, nas anotações nem nos anexos.',
      atualizado_em: agora(),
      ...(entraNoRegime ? { nota_em: agora() } : {}),
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

    // A NOTA DO CARD, UMA VEZ SÓ: criada aqui, quando os processos aparecem pela
    // primeira vez; dali em diante, só editada (`atualizarNotas`).
    //  - Com a 0078: só o card que ENTROU AGORA no regime (a posse LENDO é desta
    //    volta, e o `nota_em` recém-gravado afasta as outras). O que já estava
    //    no regime sem nota (a criação falhou) fica para `atualizarNotas`, que
    //    toma a posse da criação antes de escrever.
    //  - Sem a 0078: a primeira nota e mais nenhuma — não há onde guardar o id.
    if (todos.length && (notaUnica ? entraNoRegime : antes.length === 0)) {
      const texto = await textoDaNota(svc, leadId)
      if (texto) {
        const r = await kommo.criarNota(leadId, texto)
        if ('erro' in r) avisos.push(`card ${leadId}: a nota dos autos não entrou (${r.erro}); tento de novo.`)
        else if (notaUnica) {
          await svc.from('escavador_autos_card')
            .update({ nota_id: r.id, nota_texto: texto })
            .eq('kommo_lead_id', leadId)
            .is('nota_id', null)
        }
      }
    }
  }
}

// ------------------------------------------------------------------ A NOTA DO CARD
/** O texto da nota única do card (já assinado), dos processos dele no banco. Vazio se não há processo. */
async function textoDaNota(svc: Servico, leadId: number): Promise<string> {
  const { data } = await svc.from('escavador_autos_processo').select('*').eq('kommo_lead_id', leadId)
  const linhas = (data ?? []) as Record<string, unknown>[]
  return linhas.length ? assinarNota(notaUnicaDosAutos(linhas.map(processoDaNota))) : ''
}

/** Quanto para trás se procuram cards com mudança: cobre a edição que falhou e é refeita. */
const JANELA_DAS_NOTAS_MS = 48 * 3_600_000
/** Abaixo disto de tempo, não se começa outra edição de nota (cada uma é uma ida ao Kommo). */
const FOLGA_DA_NOTA_MS = 5_000

/**
 * A NOTA ÚNICA DE CADA CARD, levada ao estado do banco. Só os cards no regime
 * (`nota_em`) que mudaram nas últimas 48 horas; o texto é recalculado inteiro e
 * comparado com o último que subiu — igual, nenhuma chamada ao Kommo. Edição
 * que falha fica para a próxima volta (o mesmo texto sai de novo).
 */
async function atualizarNotas(svc: Servico, kommo: Kommo, soEste: number | null, resta: () => number, avisos: string[]) {
  const desde = new Date(Date.now() - JANELA_DAS_NOTAS_MS).toISOString()
  const ids = new Set<number>()
  let qp = svc.from('escavador_autos_processo').select('kommo_lead_id').gte('atualizado_em', desde)
  let qc = svc
    .from('escavador_autos_card')
    .select('kommo_lead_id')
    .not('nota_em', 'is', null)
    .or(`atualizado_em.gte."${desde}",nota_em.gte."${desde}"`)
  if (soEste) {
    qp = qp.eq('kommo_lead_id', soEste)
    qc = qc.eq('kommo_lead_id', soEste)
  }
  const [{ data: dp }, { data: dc }] = await Promise.all([qp, qc])
  for (const l of [...(dp ?? []), ...(dc ?? [])] as { kommo_lead_id: number }[]) ids.add(Number(l.kommo_lead_id))
  if (ids.size === 0) return

  const lista = [...ids]
  const cards: NotaDoCard[] = []
  const processos = new Map<number, Record<string, unknown>[]>()
  for (let i = 0; i < lista.length; i += 150) {
    const fatia = lista.slice(i, i + 150)
    const { data: c, error: ec } = await svc
      .from('escavador_autos_card')
      .select('kommo_lead_id, nota_id, nota_texto, nota_em')
      .in('kommo_lead_id', fatia)
      .not('nota_em', 'is', null)
    if (ec) return
    if (!c?.length) continue
    cards.push(...(c as NotaDoCard[]))
    const { data: p, error: ep } = await svc
      .from('escavador_autos_processo')
      .select('*')
      .in('kommo_lead_id', (c as NotaDoCard[]).map((x) => x.kommo_lead_id))
    // SEM OS PROCESSOS, NENHUMA EDIÇÃO: a nota sairia sem eles.
    if (ep) return
    for (const x of (p ?? []) as Record<string, unknown>[]) {
      const id = Number(x.kommo_lead_id)
      processos.set(id, [...(processos.get(id) ?? []), x])
    }
  }

  const porta: PortaDaNota = {
    criar: (leadId, texto) => kommo.criarNota(leadId, texto),
    editar: (leadId, notaId, texto) => kommo.editarNota(leadId, notaId, texto),
    async tomarCriacao(leadId, lido) {
      let q = svc
        .from('escavador_autos_card')
        .update({ nota_id: null, nota_em: agora() })
        .eq('kommo_lead_id', leadId)
      q = lido.notaId == null ? q.is('nota_id', null) : q.eq('nota_id', lido.notaId)
      q = lido.notaEm == null ? q.is('nota_em', null) : q.eq('nota_em', lido.notaEm)
      const { data } = await q.select('kommo_lead_id')
      return !!data?.length
    },
    async gravarCriada(leadId, notaId, texto) {
      await svc.from('escavador_autos_card').update({ nota_id: notaId, nota_texto: texto }).eq('kommo_lead_id', leadId).is('nota_id', null)
    },
    async gravarTexto(leadId, texto, textoLido) {
      // CONDICIONADO AO TEXTO LIDO: se outra volta editou a nota no meio, o
      // banco fica com o texto dela, e a próxima volta confere de novo.
      const q = svc.from('escavador_autos_card').update({ nota_texto: texto }).eq('kommo_lead_id', leadId)
      await (textoLido == null ? q.is('nota_texto', null) : q.eq('nota_texto', textoLido))
    },
  }

  for (const card of cards) {
    if (resta() < FOLGA_DA_NOTA_MS) break
    const linhas = processos.get(Number(card.kommo_lead_id)) ?? []
    // A nota nasce com os processos: card sem processo (ainda) não tem o que dizer.
    if (linhas.length === 0) continue
    const texto = assinarNota(notaUnicaDosAutos(linhas.map(processoDaNota)))
    const r = await sincronizarNotaDoCard(card, texto, porta, Date.now())
    if (r === 'falhou') avisos.push(`card ${card.kommo_lead_id}: a nota dos autos não foi atualizada; tento de novo na próxima volta.`)
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

/** O `erro` da linha de consumo enquanto o POST pago não volta: linha que fica assim é volta que morreu no meio. */
const RESERVA_EM_ABERTO = 'reserva da cota: o pedido pago ainda não voltou'

/**
 * A RESERVA DA VAGA NA COTA DO DIA (auditoria, 23/10/2026): a linha de consumo
 * é gravada ANTES do POST pago e, em seguida, contam-se as do dia até ela
 * (inclusive). A posição é o que decide — ver `reservaCabeNaCota`. Volta que
 * morre entre a reserva e o POST deixa a linha: a cota conta a mais, nunca a
 * menos.
 */
async function reservarPedidoDoDia(
  svc: Servico,
  leadId: number,
  cnj: string,
  inicioDoDia: string,
): Promise<{ id: string; posicao: number } | { erro: string }> {
  const { data: linha, error } = await svc
    .from('escavador_consumo')
    .insert({
      kommo_lead_id: leadId,
      operacao: 'autos_pedido',
      alvo: cnj,
      centavos: 0,
      requisicoes: 1,
      processos: 1,
      erro: RESERVA_EM_ABERTO,
    })
    .select('id, criado_em')
    .single()
  if (error || !linha?.id) return { erro: error?.message ?? 'a reserva não voltou do banco' }
  const { count, error: erroCota } = await svc
    .from('escavador_consumo')
    .select('id', { count: 'exact', head: true })
    .eq('operacao', 'autos_pedido')
    .gte('criado_em', inicioDoDia)
    .lte('criado_em', String(linha.criado_em))
  if (erroCota || count == null) {
    await desfazerReserva(svc, String(linha.id))
    return { erro: erroCota?.message ?? 'a contagem da cota não voltou' }
  }
  return { id: String(linha.id), posicao: count }
}

async function desfazerReserva(svc: Servico, id: string) {
  await svc.from('escavador_consumo').delete().eq('id', id)
}

/**
 * Depois do POST pago: a reserva vira o consumo (os créditos que o Escavador
 * disse ter usado), fica marcada se a cobrança é possível mas o pedido não
 * confirmou, ou é desfeita se a recusa foi afirmada e nada foi cobrado.
 */
async function fecharReserva(
  svc: Servico,
  id: string,
  r: { status: number; centavos: number },
  pedidoId: number,
) {
  if (r.status >= 200 && r.status < 300 && pedidoId) {
    await svc.from('escavador_consumo').update({ centavos: r.centavos, erro: null }).eq('id', id)
  } else if (cobrancaPossivel(r.status, r.centavos)) {
    await svc
      .from('escavador_consumo')
      .update({ centavos: r.centavos, erro: `o pedido pago não confirmou (HTTP ${r.status}); pode ter sido cobrado` })
      .eq('id', id)
  } else {
    await desfazerReserva(svc, id)
  }
}

async function pedir(
  svc: Servico,
  chave: string,
  situacoes: Map<number, SituacaoDoCard> | null,
  soEste: number | null,
  avisos: string[],
  novas: boolean,
  resta: () => number = () => Infinity,
) {
  // SEM SABER ONDE OS CARDS ESTÃO, NENHUM PEDIDO PAGO (auditoria, 23/10/2026):
  // card fora do mapa conta como "pode pagar", e um mapa incompleto (leitura
  // que falhou ou foi cortada) pagaria pelo card que já saiu da análise. A
  // próxima volta do cron lê de novo.
  if (!situacoes) {
    avisos.push('Não consegui ler onde os cards estão; nenhum pedido pago nesta volta.')
    return
  }
  // REPETIR (0077): o robô falhou de passagem e o pedido se refaz — de 10 em 10
  // minutos, contados do último pedido pago.
  const estados = ['NOVO', 'FILA', 'SEM_SALDO', 'PEDINDO', ...(novas ? ['REPETIR'] : [])]
  let q = svc.from('escavador_autos_processo').select('*').in('estado', estados)
  if (soEste) q = q.eq('kommo_lead_id', soEste)
  const { data } = await q.order('criado_em')
  const processos = (data ?? []) as Processo[]
  if (processos.length === 0) return

  // A COTA DO DIA, no fuso de Brasília. Esta contagem só poupa trabalho (cota
  // cheia, nada a tentar); quem decide o pedido pago é a RESERVA, refeita no
  // banco antes de cada POST (`reservarPedidoDoDia`).
  const inicioDoDia = inicioDoDiaEmBrasilia(new Date())
  const { count, error: erroCota } = await svc
    .from('escavador_consumo')
    .select('id', { count: 'exact', head: true })
    .eq('operacao', 'autos_pedido')
    .gte('criado_em', inicioDoDia)
  // SEM A CONTAGEM, NENHUM PEDIDO PAGO (auditoria de bugs, 09/10/2026): o erro
  // era ignorado e a contagem virava ZERO — com a cota já cheia, uma consulta
  // que falhasse liberava mais 40 pedidos pagos no mesmo dia. A próxima volta
  // (cron de 10 min) tenta de novo.
  if (erroCota || count == null) {
    console.error('[escavador-autos-rotina] cota do dia ilegível; nenhum pedido nesta volta:', erroCota?.message)
    avisos.push(`Não consegui contar os pedidos de hoje (${erroCota?.message ?? 'sem resposta'}); nenhum pedido pago nesta volta.`)
    return
  }
  let pedidosHoje = count
  const comCallback = await temCallback(svc)

  for (const p of processos) {
    // O RELÓGIO ANTES DO PEDIDO PAGO (auditoria de bugs, 09/10/2026): cada volta
    // aqui pode levar ~60 s (a consulta de status e o POST, 30 s de teto cada).
    // Morrer entre o POST pago e a gravação deixava o consumo sem a linha (a cota
    // contava a menos) e a tentativa sem contar. Sem folga, o resto fica para a
    // próxima volta do cron.
    if (resta() < FOLGA_PARA_PEDIR_MS) {
      avisos.push('O tempo da volta acabou antes de todos os pedidos; os demais saem na próxima.')
      break
    }
    const leadId = Number(p.kommo_lead_id)
    const cnj = p.numero_cnj
    // O CARD QUE SAIU DA ANÁLISE não pede nada novo. O que não começou já foi
    // (ou será, na próxima volta) INTERROMPIDO; só a posse PEDINDO parada passa,
    // para a consulta gratuita adotar o pedido que a volta morta possa ter feito.
    const podePagar = podePagarPedido(situacoes.get(leadId))
    if (!podePagar && p.estado !== 'PEDINDO') continue
    // Posse de pedido só se retoma parada; fila da cota cheia nem se consulta.
    if (p.estado === 'PEDINDO' && Date.now() - Date.parse(p.atualizado_em) < POSSE_PARADA_MS) continue
    if (p.estado === 'FILA' && pedidosHoje >= LIMITE_PEDIDOS_DIA) continue
    if (p.estado === 'REPETIR') {
      if (pedidosHoje >= LIMITE_PEDIDOS_DIA) continue
      if (!horaDeRepetir(await quandoFoiPedido(svc, p.pedido_id), Date.now())) continue
    }

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

    // DAQUI EM DIANTE É PEDIDO PAGO: o card que saiu da análise para aqui.
    if (!podePagar) {
      await gravar({ estado: INTERROMPIDO, detalhe: DETALHE_INTERROMPIDO })
      continue
    }

    if (pedidosHoje >= LIMITE_PEDIDOS_DIA) {
      await gravar({ estado: 'FILA', detalhe: `Cota de ${LIMITE_PEDIDOS_DIA} pedidos por dia atingida; pede amanhã.` })
      continue
    }

    // A VAGA NA COTA, NO BANCO, ANTES DO POST PAGO (auditoria, 23/10/2026). A
    // contagem era feita uma vez por volta e somada aqui na memória: duas voltas
    // ao mesmo tempo (o cron, o sync, o aviso) viam as mesmas 38 e pagavam 4 —
    // passando do teto de 40 por dia. Agora cada pedido grava a linha de
    // consumo ANTES e conta as do dia até ela; fora do teto, desfaz e espera.
    const reserva = await reservarPedidoDoDia(svc, leadId, cnj, inicioDoDia)
    if ('erro' in reserva) {
      await gravar({
        estado: 'FILA',
        detalhe: `Não consegui reservar a vaga na cota do dia (${reserva.erro}); tento de novo na próxima volta.`,
      })
      avisos.push(`Não consegui reservar a vaga na cota do dia (${reserva.erro}); nenhum pedido pago a mais nesta volta.`)
      break
    }
    pedidosHoje = Math.max(pedidosHoje, reserva.posicao)
    if (!reservaCabeNaCota(reserva.posicao, LIMITE_PEDIDOS_DIA)) {
      await desfazerReserva(svc, reserva.id)
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
    const pedidoId = Number(r.corpo?.id ?? 0)
    // A RESERVA VIRA O CONSUMO DE VERDADE, ou é desfeita se o pedido com
    // certeza não foi cobrado (ver `cobrancaPossivel`).
    await fecharReserva(svc, reserva.id, r, pedidoId)
    if (r.status === 402) {
      await gravar({ estado: 'SEM_SALDO', detalhe: 'O Escavador recusou o pedido por falta de crédito.' })
      avisos.push('Escavador sem saldo: os pedidos de autos param até a recarga.')
      break
    }
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
        // A nota do card mostra a falha na próxima `atualizarNotas`.
        await gravar({ estado: 'FALHOU', detalhe })
      }
      continue
    }
    await registrarPedido(svc, pedidoId, cnj, leadId, r.corpo)
    // A CONTAGEM DOS PEDIDOS PAGOS deste processo: é ela que o teto de
    // repetições do robô confere.
    await gravar({
      estado: 'AGUARDANDO',
      pedido_id: pedidoId,
      verificado_em: agora(),
      detalhe: p.falha_do_robo ? `Nova tentativa depois da falha do Escavador (${p.falha_do_robo}).` : null,
      ...(novas ? { tentativas_do_pedido: (Number(p.tentativas_do_pedido) || 0) + 1 } : {}),
    })
  }
}

// ------------------------------------------------------------------ 3. ACOMPANHAR
/** Quando o pedido foi feito, pelo registro dele (ms); null se não há como saber. */
async function quandoFoiPedido(svc: Servico, pedidoId: number | null): Promise<number | null> {
  if (!pedidoId) return null
  const { data } = await svc.from('escavador_pedido').select('criado_em').eq('id', pedidoId).maybeSingle()
  return Date.parse(String(data?.criado_em ?? '')) || null
}

async function acompanhar(svc: Servico, chave: string, soEste: number | null, novas: boolean, resta: () => number) {
  // OS MAIS ESQUECIDOS PRIMEIRO (23/10/2026): com o relógio parando o laço no
  // meio, a fila anda pela conferência mais antiga, e não sempre pelos mesmos.
  let q = svc
    .from('escavador_autos_processo')
    .select('*')
    .eq('estado', 'AGUARDANDO')
    .order('verificado_em', { ascending: true, nullsFirst: true })
  if (soEste) q = q.eq('kommo_lead_id', soEste)
  const { data } = await q
  for (const p of (data ?? []) as Processo[]) {
    // O RELÓGIO ANTES DE CADA CONFERÊNCIA (auditoria, 23/10/2026): cada uma leva
    // até 30 s, e com muitos pedidos em AGUARDANDO a invocação morria em ~150 s
    // no meio do laço — sem pedir nem atualizar a nota. O resto fica para a
    // próxima volta. Ver `temTempoParaConferir`.
    if (!temTempoParaConferir(resta())) break
    // NA RODADA DE REPETIÇÃO confere-se de 10 em 10 minutos, e não de 30: senão
    // cada tentativa levaria 40 minutos.
    const verificado = p.verificado_em ? Date.parse(p.verificado_em) : null
    if (!soEste && !horaDeConferir(verificado, Date.now(), !!p.falha_do_robo, REVER_MIN)) continue
    // A GRAVAÇÃO CONDICIONADA AO QUE SE LEU (auditoria, 23/10/2026): entre a
    // leitura e a consulta (até 30 s), outra volta pode ter levado este
    // processo adiante. Gravando só pela chave, a segunda volta zerava a
    // `juntada` de quem já estava juntando, ou trazia um CONCLUIDO de volta a
    // ANEXANDO — e os mesmos PDFs subiam de novo ao card. Só grava quem ainda
    // vê a linha como foi lida; quem perde (nada gravado) deixa o processo com
    // a outra volta.
    const gravar = async (m: Record<string, unknown>): Promise<boolean> => {
      const { data: gravou } = await svc
        .from('escavador_autos_processo')
        .update({ atualizado_em: agora(), ...m })
        .eq('kommo_lead_id', p.kommo_lead_id)
        .eq('numero_cnj', p.numero_cnj)
        .eq('estado', 'AGUARDANDO')
        .eq('atualizado_em', p.atualizado_em)
        .select('kommo_lead_id')
      return !!gravou?.length
    }
    const consulta = await ultimaVerificacao(chave, p.numero_cnj)
    // CONSULTA QUE NÃO RESPONDEU não decide nada: nem sucesso, nem desistência.
    if (!consulta.consultou) {
      await gravar({ verificado_em: agora() })
      continue
    }
    const v = consulta.v
    const status = String(v?.status ?? 'PENDENTE').toUpperCase()
    // A VERIFICAÇÃO TEM DE SER DESTE PEDIDO, pelo id (23/10/2026): ver
    // `verificacaoDoPedido`.
    const doPedido = verificacaoDoPedido(v, p.pedido_id, p.criado_em)
    if (v && doPedido) await registrarPedido(svc, Number(v.id), p.numero_cnj, p.kommo_lead_id, v)
    // AS 72 HORAS CONTAM DO PEDIDO, e não da linha. `criado_em` da linha é a
    // leitura do card: um processo que esperou três dias na FILA (cota, saldo)
    // era pago e, meia hora depois, dado como "tribunal não respondeu" — R$ 1,34
    // perdidos e nada no card.
    const pedidoEm = (doPedido && Date.parse(String(v?.criado_em ?? ''))) || (await quandoFoiPedido(svc, p.pedido_id))

    const codigoDoRobo = novas && doPedido ? falhaPassageiraDoRobo(status, v?.motivo_erro ?? null) : null
    if (doPedido && status === 'SUCESSO') {
      await gravar({
        estado: 'ANEXANDO',
        verificado_em: agora(),
        detalhe: null,
        ...(novas ? { falha_do_robo: null, juntada: juntadaInicial('novo') } : {}),
      })
    } else if (codigoDoRobo) {
      // A FALHA É DO ROBÔ DO ESCAVADOR, e passa: o pedido se repete. A nota
      // única do card mostra a tentativa e, no fim, a desistência.
      const teto = tetoDoRobo(p.teto_de_tentativas)
      const d = depoisDaFalhaDoRobo({ tentativas: Number(p.tentativas_do_pedido) || 0, teto, jaAvisou: !!p.falha_do_robo })
      if (d.estado === 'REPETIR') {
        await gravar({
          estado: 'REPETIR',
          falha_do_robo: codigoDoRobo,
          verificado_em: agora(),
          detalhe: `Falha do Escavador (${codigoDoRobo}) na tentativa ${d.tentativas} de ${teto}; peço de novo em ${INTERVALO_REPETIR_MIN} minutos.`,
        })
      } else {
        await gravar({
          estado: 'FALHOU',
          falha_do_robo: codigoDoRobo,
          desistiu_em: agora(),
          verificado_em: agora(),
          detalhe: `${motivoDoEstado(status, v?.motivo_erro ?? null)} — ${d.tentativas} tentativa(s); parei de tentar.`,
        })
      }
    } else if (doPedido && status !== 'PENDENTE') {
      const motivo = motivoDoEstado(status, v?.motivo_erro ?? null)
      await gravar({ estado: 'FALHOU', detalhe: motivo, verificado_em: agora() })
    } else if (pedidoEm && Date.now() - pedidoEm > DESISTIR_H * 3_600_000) {
      const motivo = `o tribunal não respondeu em ${DESISTIR_H} horas`
      await gravar({ estado: 'FALHOU', detalhe: motivo })
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
        const falhas = todos.filter((d) => !feitas.has(d.chave))
        // A nota única do card mostra a conclusão (`atualizarNotas`).
        await gravar({
          estado: 'CONCLUIDO',
          concluido_em: agora(),
          trabalhando_ate: null,
          detalhe: falhas.length ? `${falhas.length} documento(s) não desceram.` : null,
        })
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

// ------------------------------------------------------------------ O CARD QUE SAIU DA ANÁLISE
/**
 * Onde cada card está, para a regra da interrupção. Card que não está no
 * espelho fica de fora do mapa (= segue como sempre).
 *
 * LEITURA QUE FALHA DEVOLVE null (23/10/2026), e não o mapa vazio: vazio, nada
 * se interrompia — certo — mas todo card ficava "pode pagar", e o `pedir`
 * pagava pelo card que já saiu da análise. Com null, nada se interrompe e
 * nenhum pedido pago sai nesta volta.
 */
async function situacoesDosCards(svc: Servico, ids: number[]): Promise<Map<number, SituacaoDoCard> | null> {
  const fora = new Map<number, SituacaoDoCard>()
  if (!ids.length) return fora
  const { data: etapas, error: erroEtapas } = await svc
    .from('kommo_etapa')
    .select('pipeline_id, status_id, nome')
    .in('pipeline_id', FUNIS_DE_ENTRADA_POR_NOME)
  if (erroEtapas) return null
  const entradas = entradasDoOperacional((etapas ?? []) as any[])
  for (let i = 0; i < ids.length; i += 150) {
    const { data: leads, error } = await svc
      .from('kommo_leads')
      .select('kommo_lead_id, pipeline_id, status_id')
      .in('kommo_lead_id', ids.slice(i, i + 150))
    if (error) return null
    for (const l of (leads ?? []) as any[]) fora.set(Number(l.kommo_lead_id), situacaoDoCard(l, entradas))
  }
  return fora
}

/**
 * A REGRA DA INTERRUPÇÃO, aplicada (pedido do dono, 20/10/2026): o card que
 * saiu da coluna de análise de um funil operacional tem o que ainda não foi
 * pedido (e a leitura pendente) INTERROMPIDO; o card que voltou tem o
 * INTERROMPIDO de volta na fila. Nada aqui chama o Escavador.
 *
 * RODA DEPOIS DE ACOMPANHAR E ANTES DE PEDIR: o processo cujo robô acabou de
 * falhar (REPETIR) num card que já saiu é interrompido antes do pedido pago da
 * mesma volta. Devolve a situação dos cards, que o `pedir` confere de novo.
 */
async function interromperERetomar(svc: Servico, soEste: number | null): Promise<Map<number, SituacaoDoCard> | null> {
  // TODAS AS PÁGINAS, em ordem estável (auditoria, 23/10/2026). O PostgREST
  // corta em 1000 linhas sem avisar: o card além do corte ficava fora do mapa
  // de situações, `podePagarPedido(undefined)` dizia que sim, e o `pedir`
  // pagava pelo card que já tinha saído da coluna de análise. Leitura com erro
  // ou cortada devolve null: nada se interrompe e nada se paga nesta volta.
  type LinhaDoProcesso = { kommo_lead_id: number; numero_cnj: string; estado: string; atualizado_em: string }
  type LinhaDoCard = { kommo_lead_id: number; estado: string; atualizado_em: string }
  const [lp, lc] = await Promise.all([
    lerTodasAsLinhas<LinhaDoProcesso>((de, ate) => {
      let q = svc
        .from('escavador_autos_processo')
        .select('kommo_lead_id, numero_cnj, estado, atualizado_em')
        .in('estado', [...ESTADOS_INTERROMPIVEIS, INTERROMPIDO, 'PEDINDO'])
      if (soEste) q = q.eq('kommo_lead_id', soEste)
      return q.order('kommo_lead_id').order('numero_cnj').range(de, ate)
    }),
    lerTodasAsLinhas<LinhaDoCard>((de, ate) => {
      let q = svc.from('escavador_autos_card').select('kommo_lead_id, estado, atualizado_em').in('estado', ['NOVO', INTERROMPIDO])
      if (soEste) q = q.eq('kommo_lead_id', soEste)
      return q.order('kommo_lead_id').range(de, ate)
    }),
  ])
  if (lp.erro || lp.cortada || lc.erro || lc.cortada) {
    console.error('[escavador-autos-rotina] leitura incompleta para a interrupção:', lp.erro ?? lc.erro ?? 'cortada')
    return null
  }
  const ps = lp.linhas
  const cs = lc.linhas
  const ids = [...new Set([...ps, ...cs].map((x) => Number(x.kommo_lead_id)))]
  const situacoes = await situacoesDosCards(svc, ids)
  if (!situacoes) return null

  for (const p of ps) {
    const s = situacoes.get(Number(p.kommo_lead_id))
    const novo = s ? proximoEstadoDoProcesso(p.estado, s) : null
    if (!novo) continue
    // CONDICIONADO AO QUE SE LEU: a volta que tomou o processo no meio (a posse
    // do pedido) ganha, e nada se sobrescreve.
    await svc
      .from('escavador_autos_processo')
      .update({ estado: novo, detalhe: novo === INTERROMPIDO ? DETALHE_INTERROMPIDO : DETALHE_RETOMADO, atualizado_em: agora() })
      .eq('kommo_lead_id', p.kommo_lead_id)
      .eq('numero_cnj', p.numero_cnj)
      .eq('estado', p.estado)
      .eq('atualizado_em', p.atualizado_em)
  }
  for (const c of cs) {
    const s = situacoes.get(Number(c.kommo_lead_id))
    const novo = s ? proximoEstadoDaLeitura(c.estado, s) : null
    if (!novo) continue
    await svc
      .from('escavador_autos_card')
      .update({ estado: novo, detalhe: novo === INTERROMPIDO ? DETALHE_INTERROMPIDO : DETALHE_RETOMADO, atualizado_em: agora() })
      .eq('kommo_lead_id', c.kommo_lead_id)
      .eq('estado', c.estado)
      .eq('atualizado_em', c.atualizado_em)
  }
  return situacoes
}

// ------------------------------------------------------------------ OUTRA RODADA
/**
 * O CARD DEVOLVIDO À ENTRADA pede outra rodada ao robô. É o "como tentar de
 * novo" que a nota de desistência ensina à equipe: tirar o card da coluna de
 * entrada e devolvê-lo. Só vale para o processo de que a rotina DESISTIU por
 * falha do robô (`desistiu_em`); os FALHOU antigos não voltam sozinhos.
 */
async function rearmarQuemVoltou(svc: Servico, soEste: number | null) {
  let q = svc
    .from('escavador_autos_processo')
    .select('kommo_lead_id, numero_cnj, rotulo, falha_do_robo, desistiu_em, teto_de_tentativas')
    .eq('estado', 'FALHOU')
    .not('desistiu_em', 'is', null)
  if (soEste) q = q.eq('kommo_lead_id', soEste)
  const { data: processos } = await q
  if (!processos?.length) return
  const ids = [...new Set((processos as any[]).map((p) => Number(p.kommo_lead_id)))]
  const { data: leads, error } = await svc
    .from('kommo_leads')
    .select('kommo_lead_id, pipeline_id, status_id, etapa_em')
    .in('kommo_lead_id', ids)
  if (error) return // sem a coluna da etapa (0074), não há como saber quando o card voltou
  const { data: etapas } = await svc
    .from('kommo_etapa')
    .select('pipeline_id, status_id, nome')
    .in('pipeline_id', FUNIS_DE_ENTRADA_POR_NOME)
  const entradas = entradasDoOperacional((etapas ?? []) as any[])
  const porLead = new Map(((leads ?? []) as any[]).map((l) => [Number(l.kommo_lead_id), l]))
  for (const p of processos as any[]) {
    const l = porLead.get(Number(p.kommo_lead_id))
    if (!l) continue
    const naEntrada = entradas.some((e) => e.pipeline_id === Number(l.pipeline_id) && e.status_id === Number(l.status_id))
    if (!voltouParaAEntrada({ naEntrada, etapaEm: l.etapa_em ?? null, desistiuEm: p.desistiu_em })) continue
    // Sem nota própria: a nota única do card passa a mostrar a nova rodada.
    await svc
      .from('escavador_autos_processo')
      .update({
        estado: 'REPETIR',
        tentativas_do_pedido: 0,
        desistiu_em: null,
        verificado_em: null,
        detalhe: 'O card voltou para a entrada: nova rodada de pedidos ao Escavador.',
        atualizado_em: agora(),
      })
      .eq('kommo_lead_id', p.kommo_lead_id)
      .eq('numero_cnj', p.numero_cnj)
      .eq('estado', 'FALHOU')
      .eq('desistiu_em', p.desistiu_em)
  }
}

/** O motivo do erro do robô, pelo registro do pedido; na falta, pelo texto gravado no processo. */
async function codigoDaFalhaAntiga(svc: Servico, p: Processo): Promise<string | null> {
  if (p.pedido_id) {
    const { data } = await svc.from('escavador_pedido').select('status, motivo_erro').eq('id', p.pedido_id).maybeSingle()
    const c = falhaPassageiraDoRobo(data?.status ?? null, data?.motivo_erro ?? null)
    if (c) return c
  }
  return codigoDoRoboNoDetalhe(p.detalhe ?? null)
}

/**
 * AÇÃO `repetir_falhas`: os processos em FALHOU por falha passageira do robô
 * entram numa rodada de repetição. NÃO É AUTOMÁTICO de propósito: são ~13
 * processos antigos, e cada tentativa é um pedido pago — o dono dispara.
 */
async function acaoRepetirFalhas(
  svc: Servico,
  o: { soEste: number | null; teto: number | null; simular: boolean },
) {
  let q = svc.from('escavador_autos_processo').select('*').eq('estado', 'FALHOU')
  if (o.soEste) q = q.eq('kommo_lead_id', o.soEste)
  const { data } = await q
  const fora: { kommo_lead_id: number; numero_cnj: string; rotulo: string; codigo: string }[] = []
  for (const p of (data ?? []) as Processo[]) {
    const codigo = await codigoDaFalhaAntiga(svc, p)
    if (!codigo) continue
    fora.push({ kommo_lead_id: p.kommo_lead_id, numero_cnj: p.numero_cnj, rotulo: p.rotulo, codigo })
    if (o.simular) continue
    const teto = tetoDoRobo(o.teto ?? p.teto_de_tentativas)
    // Sem nota própria: a nota única do card passa a mostrar a nova rodada. O
    // card que já saiu da coluna de análise é INTERROMPIDO na próxima volta,
    // antes de qualquer pedido pago (pedido do dono, 20/10/2026).
    await svc
      .from('escavador_autos_processo')
      .update({
        estado: 'REPETIR',
        tentativas_do_pedido: 0,
        falha_do_robo: codigo,
        desistiu_em: null,
        verificado_em: null,
        ...(o.teto ? { teto_de_tentativas: teto } : {}),
        detalhe: `Nova rodada pedida (falha do Escavador: ${codigo}).`,
        atualizado_em: agora(),
      })
      .eq('kommo_lead_id', p.kommo_lead_id)
      .eq('numero_cnj', p.numero_cnj)
      .eq('estado', 'FALHOU')
  }
  return fora
}

/**
 * AÇÃO `rejuntar`: os processos já CONCLUIDOS no formato antigo (um arquivo
 * por documento) voltam a ANEXANDO com uma junção nova, e a rotina monta as
 * partes baixando de novo do Escavador — o que não custa. Os arquivos soltos
 * que já estão no card NÃO são apagados (decisão do dono, depois).
 */
async function acaoRejuntar(svc: Servico, o: { soEste: number | null; cnj: string | null; simular: boolean }) {
  let q = svc
    .from('escavador_autos_processo')
    .select('kommo_lead_id, numero_cnj, rotulo, total_documentos, anexados, juntada, atualizado_em')
    .eq('estado', 'CONCLUIDO')
  if (o.soEste) q = q.eq('kommo_lead_id', o.soEste)
  if (o.cnj) q = q.eq('numero_cnj', o.cnj)
  const { data } = await q
  const fora: { kommo_lead_id: number; numero_cnj: string; rotulo: string; documentos: number }[] = []
  for (const p of (data ?? []) as any[]) {
    if (lerJuntada(p.juntada)?.concluida) continue // já está juntado
    if (!(Number(p.total_documentos) > 0)) continue
    fora.push({ kommo_lead_id: p.kommo_lead_id, numero_cnj: p.numero_cnj, rotulo: p.rotulo, documentos: p.total_documentos })
    if (o.simular) continue
    await svc
      .from('escavador_autos_processo')
      .update({
        estado: 'ANEXANDO',
        juntada: juntadaInicial('rejuntar'),
        trabalhando_ate: null,
        detalhe: 'Rejuntando os autos em poucos PDFs.',
        atualizado_em: agora(),
      })
      .eq('kommo_lead_id', p.kommo_lead_id)
      .eq('numero_cnj', p.numero_cnj)
      .eq('estado', 'CONCLUIDO')
      .eq('atualizado_em', p.atualizado_em)
  }
  return fora
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
    const body = (await req.json().catch(() => ({}))) as {
      lead_id?: number
      volta?: number
      acao?: string
      cnj?: string
      teto?: number
      simular?: boolean
    }
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
    const novas = await temAMigracaoNova(svc)
    const notaUnica = await temANotaUnica(svc)

    // AS AÇÕES EXPLÍCITAS: só pelo segredo do cron (quem dispara é o dono, pelo
    // SQL Editor) — uma delas gasta dinheiro.
    let acao: Record<string, unknown> | null = null
    if (body.acao) {
      if (!porCron) return jsonResponse({ erro: 'Ação só com o segredo do cron.' }, 403)
      if (!novas) return jsonResponse({ erro: 'A migração 0077 ainda não rodou.' }, 409)
      const simular = body.simular === true
      if (body.acao === 'rejuntar') {
        const lista = await acaoRejuntar(svc, { soEste, cnj: body.cnj ? String(body.cnj) : null, simular })
        acao = { acao: 'rejuntar', simular, processos: lista }
      } else if (body.acao === 'repetir_falhas') {
        const teto = Number(body.teto) > 0 ? Number(body.teto) : null
        const lista = await acaoRepetirFalhas(svc, { soEste, teto, simular })
        acao = { acao: 'repetir_falhas', simular, teto: tetoDoRobo(teto), processos: lista }
      } else {
        return jsonResponse({ erro: `Ação desconhecida: ${body.acao}` }, 400)
      }
      if (simular) return jsonResponse({ ok: true, ...acao })
    }

    // A primeira volta lê, acompanha e pede; as encadeadas só continuam
    // anexando. ACOMPANHAR ANTES DE PEDIR: o processo cujo robô acabou de
    // falhar é pedido de novo na mesma volta — é o que faz a repetição sair de
    // 10 em 10 minutos, e não de 20 em 20. E A INTERRUPÇÃO ENTRE OS DOIS: o
    // card que saiu da análise não chega ao pedido pago.
    if (volta === 0) {
      if (novas) await rearmarQuemVoltou(svc, soEste)
      await lerCards(svc, kommo, chaveIA, soEste, resta, avisos, notaUnica)
      await acompanhar(svc, chave, soEste, novas, resta)
      const situacoes = await interromperERetomar(svc, soEste)
      await pedir(svc, chave, situacoes, soEste, avisos, novas, resta)
      // A nota única de cada card, com o que esta volta mudou.
      if (notaUnica) await atualizarNotas(svc, kommo, soEste, resta, avisos)
    }

    let sobrou = false
    let juntando = false
    if (!novas) {
      sobrou = await anexar(svc, chave, kommo, soEste, resta)
      if (sobrou && volta < MAX_ENCADEADAS) proximaVolta(volta, soEste)
      if (notaUnica) await atualizarNotas(svc, kommo, soEste, resta, avisos)
    } else {
      // A JUNÇÃO RODA DEPOIS DA RESPOSTA, em segundo plano: uma parte de 48 MB
      // (baixar, juntar, subir) passa dos 150 s em que a resposta tem de sair,
      // e o relógio da função — com o segundo plano — morre por volta de 150 s
      // (medido; não os 400 s do plano pago): daí PRAZO_JUNCAO_MS = 115 s. Sem
      // `waitUntil` (rodando local), ela
      // roda aqui mesmo, no orçamento curto.
      const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
      const fundo = typeof rt?.waitUntil === 'function'
      const orcamento = fundo ? PRAZO_JUNCAO_MS : ORCAMENTO_MS
      const trabalho = juntarProcessos({
        svc,
        chave,
        kommo,
        soEste,
        resta: () => orcamento - (Date.now() - inicio),
        orcamento,
        listar: (cnj, pedidoId) => listarAutos(svc, chave, cnj, pedidoId),
      })
        .then(async (s) => {
          if (s && volta < MAX_ENCADEADAS) proximaVolta(volta, soEste)
          // A NOTA DEPOIS DA JUNÇÃO: a parte que subiu, o processo que concluiu.
          // No que sobrar do teto da invocação; o que não couber, a próxima volta faz.
          if (notaUnica) {
            await atualizarNotas(svc, kommo, soEste, () => PRAZO_DAS_NOTAS_MS - (Date.now() - inicio), []).catch(() => {})
          }
          return s
        })
        .catch(() => false)
      if (fundo) {
        rt!.waitUntil!(trabalho)
        juntando = true
      } else sobrou = await trabalho
    }

    let q = svc
      .from('escavador_autos_processo')
      .select('kommo_lead_id, numero_cnj, rotulo, estado, anexados, total_documentos, detalhe')
    if (soEste) q = q.eq('kommo_lead_id', soEste)
    const { data: processos } = await q.order('atualizado_em', { ascending: false }).limit(soEste ? 10 : 20)
    return jsonResponse({
      ok: true,
      volta,
      continua: sobrou,
      juntando,
      formato: novas ? 'juntado' : 'um arquivo por documento',
      ...(acao ? { acao } : {}),
      avisos,
      processos: processos ?? [],
    })
  } catch (e) {
    return jsonResponse({ erro: (e as Error).message }, 500)
  }
})
