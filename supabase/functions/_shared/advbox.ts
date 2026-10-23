// Cliente HTTP compartilhado da API do ADVBOX.
//
// POR QUE ESTE MÓDULO EXISTE: a API do ADVBOX fica atrás do Cloudflare e
// responde 429/503/403 (e às vezes um corpo de erro do CF com HTTP 200)
// quando recebe requisições em ritmo alto. Sem retry, qualquer soluço vira
// erro na tela do usuário ("/lawsuits → HTTP 503"). Toda função que fala com
// o ADVBOX deve usar getJson/fetchAll daqui — nunca fetch() direto.
import { serviceClient } from './auth.ts'
import { paginarAdvbox } from './paginacaoAdvbox.ts'

export interface AdvboxCtx {
  base: string
  headers: Record<string, string>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Token + base_url guardados no servidor (nunca no frontend). */
export async function getAdvboxCtx(): Promise<AdvboxCtx> {
  const svc = serviceClient()
  const { data: secret } = await svc
    .from('integracao_advbox_secret')
    .select('token')
    .eq('id', 1)
    .maybeSingle()
  const token = secret?.token
  if (!token) throw new Error('Token do ADVBOX não configurado. Defina em Configurações.')
  const { data: integ } = await svc
    .from('integracoes')
    .select('config')
    .eq('servico', 'advbox')
    .maybeSingle()
  // `?? ` não pega string VAZIA, e vazio é exatamente o que a tela de
  // Configurações gravava ao salvar com o campo de URL em branco: o fallback não
  // entrava, `base` virava '' e toda chamada saía como caminho relativo
  // ("/lawsuits"), derrubando a integração inteira até alguém redigitar a URL.
  // Por isso a checagem é de conteúdo, não de nulidade.
  const configurada = ((integ?.config ?? {}) as { base_url?: string }).base_url
  const base =
    configurada && configurada.trim()
      ? configurada.trim().replace(/\/+$/, '')
      : 'https://app.advbox.com.br/api/v1'
  return {
    base,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }
}

/** Extrai o array de dados de uma resposta do ADVBOX (array direto ou {data}). */
export function pickArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[]
  const obj = (json ?? {}) as Record<string, unknown>
  for (const k of ['data', 'items', 'movements', 'results', 'movimentacoes', 'posts']) {
    if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[]
  }
  return []
}

/**
 * Detecta corpo de erro do Cloudflare — o ADVBOX às vezes devolve isso com
 * HTTP 200, então checar apenas res.ok não basta.
 */
export function isCloudflareError(j: unknown): boolean {
  if (!j || typeof j !== 'object') return false
  const o = j as Record<string, unknown>
  return 'cloudflare_error' in o || ('error_code' in o && 'ray_id' in o)
}

// Espaçamento mínimo entre requisições (por instância da função). Protege o
// caso concorrente; chamadas sequenciais já se espaçam naturalmente.
// Padrão conservador para uso sequencial; quem faz varredura concorrente (ex.:
// advbox-movimentacoes, que busca andamentos de dezenas de processos) deve
// aumentar via configurarThrottle().
let minIntervaloMs = 150
let proximoSlot = 0

/** Ajusta o espaçamento mínimo entre requisições desta instância. */
export function configurarThrottle(ms: number): void {
  minIntervaloMs = Math.max(0, ms)
}

async function throttle(): Promise<void> {
  const agora = Date.now()
  const alvo = Math.max(agora, proximoSlot)
  proximoSlot = alvo + minIntervaloMs
  const espera = alvo - agora
  if (espera > 0) await sleep(espera)
}

/**
 * O status é de falha TEMPORÁRIA — vale tentar de novo?
 *
 * 429 e 5xx, por definição. 408 (o servidor desistiu de esperar o pedido). E 403,
 * que no HTTP seria permanente, mas aqui não é: o Cloudflare na frente do ADVBOX
 * responde 403 quando barra por ritmo (ver o cabeçalho deste módulo), e a mesma
 * chamada passa segundos depois. O resto dos 4xx — 400, 401, 404, 422 — é
 * resposta definitiva: repetir só gasta tempo.
 */
export function falhaTemporaria(status: number): boolean {
  return status === 429 || status === 403 || status === 408 || status >= 500
}

/** Um trecho legível do corpo de erro, para a mensagem dizer o que foi recusado. */
function trechoDoCorpo(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/**
 * GET com throttle + retry/backoff, respeitando Retry-After.
 * Trata 429/403/408/5xx, erro de rede e corpos de erro do Cloudflare como falha
 * temporária.
 *
 * 4xx DEFINITIVO SAI NA HORA (23/10/2026). O `throw` do status não-OK ficava
 * DENTRO do `try`, e o `catch` — feito para erro de rede — o pegava e repetia:
 * um 404 ou um 401 (token trocado) dava 6 tentativas com espera crescente, ~15 s
 * jogados fora por chamada, e numa varredura isso comia o teto de 150 s da Edge
 * Function. Agora só o `fetch` e a leitura do corpo ficam no `try`; o 4xx
 * definitivo é lançado fora dele, com o status e um trecho do corpo.
 */
export async function getJson(
  ctx: AdvboxCtx,
  path: string,
  tries = 6,
): Promise<unknown> {
  let ultimoErro = 'desconhecido'
  const esperar = (a: number) =>
    sleep(500 * 2 ** (a - 1) + Math.floor(Math.random() * 300))
  for (let a = 1; a <= tries; a++) {
    await throttle()
    let res: Response
    let texto: string
    try {
      res = await fetch(`${ctx.base}${path}`, { headers: ctx.headers })
      texto = await res.text()
    } catch (e) {
      // Erro de REDE (conexão caiu, corpo interrompido): merece nova tentativa.
      ultimoErro = (e as Error).message
      if (a < tries) await esperar(a)
      continue
    }
    if (falhaTemporaria(res.status)) {
      ultimoErro = `HTTP ${res.status}`
      if (a < tries) {
        const ra = Number(res.headers.get('retry-after'))
        const espera =
          Number.isFinite(ra) && ra > 0
            ? Math.min(ra * 1000, 15000)
            : 500 * 2 ** (a - 1)
        await sleep(espera + Math.floor(Math.random() * 300))
      }
      continue
    }
    if (!res.ok) {
      // Definitivo: não repete. Fora de qualquer try, de propósito.
      const trecho = trechoDoCorpo(texto)
      throw new Error(`${path} → HTTP ${res.status}${trecho ? ` — ${trecho}` : ''}`)
    }
    let j: unknown
    try {
      j = JSON.parse(texto)
    } catch {
      // 200 com corpo que não é JSON (página de erro do gateway, corpo cortado):
      // é soluço do caminho, não resposta — tenta de novo, como antes.
      ultimoErro = `resposta não é JSON (${trechoDoCorpo(texto).slice(0, 80) || 'vazia'})`
      if (a < tries) await esperar(a)
      continue
    }
    if (isCloudflareError(j)) {
      ultimoErro = 'cloudflare rate limit'
      if (a < tries) await esperar(a)
      continue
    }
    return j
  }
  throw new Error(`${path} → ${ultimoErro} (após ${tries} tentativas)`)
}

/**
 * POST/PUT com throttle e retry SÓ para requisição RECUSADA (429, 403 e corpo de
 * erro do Cloudflare com HTTP 200).
 *
 * 5xx NÃO é repetido aqui, ao contrário do getJson, e a diferença é a única que
 * importa: repetir um GET é inofensivo, mas num POST o servidor pode ter criado o
 * recurso e falhado só ao responder — a segunda tentativa criaria o SEGUNDO
 * processo, no sistema onde o escritório trabalha, e ninguém saberia de onde veio.
 * Recusa é diferente: 429 e 403 significam que a requisição não foi processada, e
 * aí repetir é seguro.
 *
 * O PUT seria idempotente e poderia repetir em 5xx, mas a regra fica uniforme de
 * propósito: dois comportamentos na mesma função é o tipo de detalhe que se esquece
 * na hora de adicionar a terceira chamada.
 *
 * Quem chama trata a falha como "não sei se gravou" — e é por isso que a criação
 * consulta antes de criar: a passagem seguinte encontra o que ficou pela metade.
 */
export async function enviarJson(
  ctx: AdvboxCtx,
  metodo: 'POST' | 'PUT',
  path: string,
  body: unknown,
  tries = 4,
): Promise<unknown> {
  let ultimoErro = 'desconhecido'
  for (let a = 1; a <= tries; a++) {
    await throttle()
    const res = await fetch(`${ctx.base}${path}`, {
      method: metodo,
      headers: { ...ctx.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 429 || res.status === 403) {
      ultimoErro = `HTTP ${res.status}`
      if (a < tries) {
        const ra = Number(res.headers.get('retry-after'))
        const espera =
          Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 15000) : 700 * 2 ** (a - 1)
        await sleep(espera + Math.floor(Math.random() * 300))
      }
      continue
    }
    // Corpo lido como texto primeiro: erro de validação do ADVBOX vem em JSON,
    // mas erro de gateway vem em HTML, e um JSON.parse cru viraria "Unexpected
    // token <" — mensagem que não ajuda ninguém a entender o que foi recusado.
    const texto = await res.text()
    let j: unknown = null
    try {
      j = texto ? JSON.parse(texto) : null
    } catch {
      j = null
    }
    if (isCloudflareError(j)) {
      ultimoErro = 'cloudflare rate limit'
      if (a < tries) await sleep(700 * 2 ** (a - 1) + Math.floor(Math.random() * 300))
      continue
    }
    if (!res.ok) {
      // Os erros por campo (o `errors` do Laravel) vão junto: "The given data
      // was invalid." sozinho não diz o que corrigir.
      const porCampo = (j as { errors?: Record<string, unknown> } | null)?.errors
      const campos = porCampo && typeof porCampo === 'object'
        ? Object.values(porCampo).flat().map(String).join(' ')
        : ''
      const detalhe =
        [
          (j as { message?: string; error?: string } | null)?.message ??
            (j as { error?: string } | null)?.error ??
            (campos ? '' : texto.slice(0, 300)),
          campos,
        ].filter(Boolean).join(' ')
      throw new Error(`HTTP ${res.status}${detalhe ? ` — ${detalhe}` : ''}`)
    }
    return j
  }
  throw new Error(`${path} → ${ultimoErro} (após ${tries} tentativas)`)
}

/** Paginação padrão do ADVBOX: { offset, limit, totalCount, data }. */
export async function fetchAll(
  ctx: AdvboxCtx,
  path: string,
  cap = 8000,
): Promise<Record<string, unknown>[]> {
  // A paginação mora em paginacaoAdvbox.ts (pura, testada) — ver lá os três
  // defeitos do laço antigo (auditoria de bugs, 09/10/2026).
  const sep = path.includes('?') ? '&' : '?'
  return paginarAdvbox(
    (offset, limit) => getJson(ctx, `${path}${sep}limit=${limit}&offset=${offset}`),
    { cap, rotulo: path },
  )
}
