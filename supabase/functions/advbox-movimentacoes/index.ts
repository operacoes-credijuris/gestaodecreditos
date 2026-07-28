// Sincroniza as MOVIMENTAÇÕES (andamentos) do ADVBOX para o cache
// public.advbox_movimentacoes. Passos:
//  1. Compila os números dos processos cadastrados em Créditos (numero_cnj),
//     Requerimentos (numero_protocolo) e Apensos (numero).
//  2. Casa esses números com os processos do ADVBOX (/lawsuits) por
//     process_number/protocol_number → obtém os lawsuits_id.
//  3. Para cada processo casado, busca GET /movements/{lawsuit_id} e mantém só
//     os andamentos dos últimos `dias` (default 20).
//  4. Faz upsert no cache e remove o que saiu da janela.
// A página lê do banco; esta função roda em 2º plano (ao abrir a aba) e também
// por cron (pg_cron), autenticada por JWT do usuário OU por x-cron-secret.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, serviceClient } from '../_shared/auth.ts'

const DIAS_JANELA = 20
const MIN_DIGITS = 6 // casa números com >= 6 dígitos (igual à aba de Tarefas)
const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
const str = (v: unknown): string | null => (v == null ? null : String(v))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Detecta corpo de erro do Cloudflare (o ADVBOX às vezes devolve isso, inclusive
// com HTTP 200, quando há rate limit). Nesses casos devemos tentar de novo.
function isCloudflareError(j: unknown): boolean {
  if (!j || typeof j !== 'object') return false
  const o = j as Record<string, unknown>
  return 'cloudflare_error' in o || ('error_code' in o && 'ray_id' in o)
}

// Hash estável (djb2) em base36 — usado para gerar um id determinístico quando
// a movimentação do ADVBOX não traz um id próprio.
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

interface AdvboxCtx {
  base: string
  headers: Record<string, string>
}

async function getCtx(): Promise<AdvboxCtx> {
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

// Extrai o array de dados de uma resposta do ADVBOX (array direto ou {data}).
function pickArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[]
  const obj = (json ?? {}) as Record<string, unknown>
  for (const k of ['data', 'items', 'movements', 'results', 'movimentacoes']) {
    if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[]
  }
  return []
}

// Throttle GLOBAL: serializa o início de todas as requisições ao ADVBOX com um
// espaçamento mínimo, para não estourar o rate limit do Cloudflare (o problema
// não é uma requisição isolada, e sim o ritmo agregado de todas juntas).
const MIN_INTERVALO_MS = 350
let proximoSlot = 0
async function throttle(): Promise<void> {
  const agora = Date.now()
  const alvo = Math.max(agora, proximoSlot)
  proximoSlot = alvo + MIN_INTERVALO_MS
  const espera = alvo - agora
  if (espera > 0) await sleep(espera)
}

// GET com throttle + retry/backoff, respeitando Retry-After. Resistente a rate
// limit do Cloudflare (429/403/5xx e corpos de erro do CF, às vezes com 200).
async function getJson(
  ctx: AdvboxCtx,
  path: string,
  tries = 7,
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
              : 600 * 2 ** (a - 1)
          await sleep(espera + Math.floor(Math.random() * 400))
        }
        continue
      }
      const j = await res.json()
      if (isCloudflareError(j)) {
        ultimoErro = 'cloudflare rate limit'
        if (a < tries) await sleep(600 * 2 ** (a - 1) + Math.floor(Math.random() * 400))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return j
    } catch (e) {
      // Erro de rede/parse: backoff e tenta de novo.
      ultimoErro = (e as Error).message
      if (a < tries) await sleep(600 * 2 ** (a - 1) + Math.floor(Math.random() * 300))
    }
  }
  throw new Error(`${path} → ${ultimoErro}`)
}

// Paginação padrão do ADVBOX: { offset, limit, totalCount, data }.
async function fetchAll(
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

// Busca robusta das movimentações de um processo (com retry/backoff).
async function fetchMovements(
  ctx: AdvboxCtx,
  lawsuitId: string,
): Promise<Record<string, unknown>[]> {
  return pickArray(await getJson(ctx, `/movements/${lawsuitId}`))
}

// Map com concorrência limitada que devolve UM resultado por item (1:1),
// preservando a ordem. Falhas viram o valor de `onError(item, erro)`.
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// Conjunto de números de processo cadastrados (Créditos, Requerimentos, Apensos).
async function numerosCadastrados(): Promise<Set<string>> {
  const svc = serviceClient()
  const [proc, ap, req] = await Promise.all([
    svc.from('processos').select('numero_cnj'),
    svc.from('apensos').select('numero'),
    svc.from('requerimentos').select('numero_protocolo'),
  ])
  const set = new Set<string>()
  const add = (v: unknown) => {
    const d = onlyDigits(v)
    if (d.length >= MIN_DIGITS) set.add(d)
  }
  for (const r of proc.data ?? []) add((r as { numero_cnj?: string }).numero_cnj)
  for (const r of ap.data ?? []) add((r as { numero?: string }).numero)
  for (const r of req.data ?? [])
    add((r as { numero_protocolo?: string }).numero_protocolo)
  return set
}

// Processos do ADVBOX que casam com os nossos números.
// Retorna mapa lawsuits_id -> número de processo exibível.
async function processosCasaveis(ctx: AdvboxCtx): Promise<Map<string, string>> {
  const nums = await numerosCadastrados()
  const lawsuits = await fetchAll(ctx, '/lawsuits')
  const map = new Map<string, string>()
  for (const l of lawsuits) {
    const pn = onlyDigits(l.process_number)
    const prot = onlyDigits(l.protocol_number)
    if ((pn && nums.has(pn)) || (prot && nums.has(prot))) {
      map.set(String(l.id), String(l.process_number || l.protocol_number || l.id))
    }
  }
  return map
}

// Extrai a data de um andamento (defensivo: vários nomes possíveis).
function extrairData(m: Record<string, unknown>): string | null {
  const cands = [m.date, m.created_at, m.data, m.movement_date, m.datetime, m.updated_at]
  for (const c of cands) {
    if (c == null || c === '') continue
    const d = new Date(String(c))
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

// Data (YYYY-MM-DD) da última movimentação entre todos os andamentos de um
// processo (independente da janela). null = nenhum andamento com data válida.
function ultimaData(movs: Record<string, unknown>[]): string | null {
  let max: string | null = null
  for (const m of movs) {
    const iso = extrairData(m)
    if (!iso) continue
    const dia = iso.slice(0, 10)
    if (!max || dia > max) max = dia
  }
  return max
}

// Extrai o texto de um andamento (defensivo).
function extrairConteudo(m: Record<string, unknown>): string | null {
  const cands = [m.description, m.text, m.movement, m.content, m.title, m.name, m.description_movement]
  for (const c of cands) {
    if (c != null && String(c).trim()) return String(c).trim()
  }
  return null
}

// Processos por invocação. Pequeno o bastante para caber no limite de recursos
// do edge function mesmo com o rate limit do ADVBOX; o restante é encadeado.
const BATCH = 12

// Dispara a próxima fatia numa invocação SEPARADA (fire-and-forget), autenticada
// pelo segredo de cron. Assim nenhuma execução isolada passa do limite.
function dispararProximo(fila: { lid: string; numero: string }[], dias: number): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/advbox-movimentacoes`
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const p = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ fila, dias }),
  }).catch(() => {})
  const rt = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
  }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Autorização: JWT de usuário (chamada do app) OU segredo de cron.
    const cronSecret = Deno.env.get('CRON_SECRET')
    const headerSecret = req.headers.get('x-cron-secret')
    const autorizadoPorCron = !!cronSecret && headerSecret === cronSecret
    if (!autorizadoPorCron) {
      const caller = await getCaller(req)
      if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const dias = Number(body.dias ?? DIAS_JANELA)
    const ctx = await getCtx()
    const svc = serviceClient()

    // Data-limite (só a parte da data) para a janela.
    const ini = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)

    // Lista de trabalho: vem no corpo (fatia encadeada) ou é computada na 1ª
    // chamada da cadeia. O processamento é feito em lotes pequenos que se
    // auto-encadeiam, para não estourar o limite de recursos do edge function.
    const primeira = !Array.isArray((body as { fila?: unknown }).fila)
    let fila: { lid: string; numero: string }[]
    if (primeira) {
      const casaveis = await processosCasaveis(ctx)
      fila = [...casaveis.entries()].map(([lid, numero]) => ({ lid, numero }))
      // Poda o que saiu da janela — só na primeira chamada da cadeia.
      await svc.from('advbox_movimentacoes').delete().lt('data', ini)
      // Poda o status de processos que não estão mais cadastrados/casados.
      const numeros = [...casaveis.values()]
      const lst = numeros.length ? numeros : ['__none__']
      const inStr = '(' + lst.map((n) => `"${String(n).replace(/["\\]/g, '')}"`).join(',') + ')'
      await svc.from('advbox_processo_status').delete().not('numero_processo', 'in', inStr)
    } else {
      fila = (body as { fila: { lid: string; numero: string }[] }).fila
    }
    const lote = fila.slice(0, BATCH)
    const resto = fila.slice(BATCH)

    // Modo debug: só reporta o tamanho da fila (sem buscar movimentações).
    if ((body as { debug?: boolean }).debug) {
      return jsonResponse({ ok: true, primeira, fila: fila.length })
    }

    // Busca as movimentações do lote (concorrência baixa + throttle + retry).
    const resultados = await mapPool(lote, 3, async ({ lid, numero }) => {
      try {
        return {
          lid,
          numero,
          movs: await fetchMovements(ctx, lid),
          erro: null as string | null,
        }
      } catch (e) {
        return {
          lid,
          numero,
          movs: [] as Record<string, unknown>[],
          erro: (e as Error).message,
        }
      }
    })

    // Monta as linhas do lote (só andamentos com data na janela e com conteúdo).
    const agora = new Date().toISOString()
    const vistos = new Set<string>()
    const rows = resultados
      .flatMap((r) =>
        r.movs.map((m) => {
          const dataIso = extrairData(m)
          const conteudo = extrairConteudo(m)
          const dataDia = dataIso ? dataIso.slice(0, 10) : null
          // id estável: id do ADVBOX quando existir; senão hash determinístico
          // (as movimentações do ADVBOX não trazem id próprio).
          const id =
            str(m.id) ??
            `${r.lid}-${dataDia ?? 'sd'}-${hash(`${dataIso ?? ''}|${conteudo ?? ''}`)}`
          return {
            id,
            advbox_lawsuit_id: r.lid,
            numero_processo: r.numero,
            data: dataDia,
            data_ts: dataIso,
            conteudo,
            raw: m,
            sincronizado_em: agora,
          }
        }),
      )
      .filter((r) => r.data && r.data >= ini && r.conteudo)
      .filter((r) => {
        if (vistos.has(r.id)) return false
        vistos.add(r.id)
        return true
      })

    let gravados = 0
    if (rows.length) {
      const { error } = await svc
        .from('advbox_movimentacoes')
        .upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(error.message)
      gravados = rows.length
    }

    // Status por processo (última movimentação de todo o histórico). Só grava
    // para processos buscados com sucesso, para não sobrescrever com null.
    const statusRows = resultados
      .filter((r) => r.erro == null)
      .map((r) => ({
        numero_processo: r.numero,
        advbox_lawsuit_id: r.lid,
        ultima_movimentacao: ultimaData(r.movs),
        sincronizado_em: agora,
      }))
    if (statusRows.length) {
      const { error } = await svc
        .from('advbox_processo_status')
        .upsert(statusRows, { onConflict: 'numero_processo' })
      if (error) throw new Error(error.message)
    }

    const errosNoLote = resultados.filter((r) => r.erro).length

    // Encadeia a próxima fatia, se houver.
    if (resto.length) dispararProximo(resto, dias)

    return jsonResponse({
      ok: true,
      primeira,
      lote: lote.length,
      restante: resto.length,
      gravados,
      erros_no_lote: errosNoLote,
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
