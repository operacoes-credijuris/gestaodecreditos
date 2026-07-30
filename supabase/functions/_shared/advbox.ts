// Cliente HTTP compartilhado da API do ADVBOX.
//
// POR QUE ESTE MÓDULO EXISTE: a API do ADVBOX fica atrás do Cloudflare e
// responde 429/503/403 (e às vezes um corpo de erro do CF com HTTP 200)
// quando recebe requisições em ritmo alto. Sem retry, qualquer soluço vira
// erro na tela do usuário ("/lawsuits → HTTP 503"). Toda função que fala com
// o ADVBOX deve usar getJson/fetchAll daqui — nunca fetch() direto.
import { serviceClient } from './auth.ts'

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
  const base =
    ((integ?.config ?? {}) as { base_url?: string }).base_url ??
    'https://app.advbox.com.br/api/v1'
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
 * GET com throttle + retry/backoff, respeitando Retry-After.
 * Trata 429/403/5xx e corpos de erro do Cloudflare como falha temporária.
 */
export async function getJson(
  ctx: AdvboxCtx,
  path: string,
  tries = 6,
): Promise<unknown> {
  let ultimoErro = 'desconhecido'
  for (let a = 1; a <= tries; a++) {
    await throttle()
    try {
      const res = await fetch(`${ctx.base}${path}`, { headers: ctx.headers })
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
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
      const j = await res.json()
      if (isCloudflareError(j)) {
        ultimoErro = 'cloudflare rate limit'
        if (a < tries) await sleep(500 * 2 ** (a - 1) + Math.floor(Math.random() * 300))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return j
    } catch (e) {
      // Erro de rede/parse: também merece nova tentativa.
      ultimoErro = (e as Error).message
      if (a < tries) await sleep(500 * 2 ** (a - 1) + Math.floor(Math.random() * 300))
    }
  }
  throw new Error(`${path} → ${ultimoErro} (após ${tries} tentativas)`)
}

/** Paginação padrão do ADVBOX: { offset, limit, totalCount, data }. */
export async function fetchAll(
  ctx: AdvboxCtx,
  path: string,
  cap = 8000,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  const limit = 200
  let offset = 0
  for (let i = 0; i < 60; i++) {
    const sep = path.includes('?') ? '&' : '?'
    const j = await getJson(ctx, `${path}${sep}limit=${limit}&offset=${offset}`)
    const data = pickArray(j)
    out.push(...data)
    const total = Number((j as { totalCount?: number }).totalCount ?? out.length)
    offset += limit
    if (data.length === 0 || out.length >= total || out.length >= cap) break
  }
  return out
}
