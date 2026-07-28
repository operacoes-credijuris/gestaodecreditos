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
const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
const str = (v: unknown): string | null => (v == null ? null : String(v))

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
    const res = await fetch(`${ctx.base}${path}${sep}limit=${limit}&offset=${offset}`, {
      headers: ctx.headers,
    })
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
    const j = await res.json()
    const data = pickArray(j)
    out.push(...data)
    const total = Number((j as { totalCount?: number }).totalCount ?? out.length)
    offset += limit
    if (data.length === 0 || out.length >= total || out.length >= cap) break
  }
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
    if (d.length >= 15) set.add(d)
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

// Executa `fn` sobre `items` com concorrência limitada, ignorando falhas pontuais.
async function pmap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R[]>,
): Promise<R[]> {
  const out: R[] = []
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      try {
        out.push(...(await fn(items[idx])))
      } catch {
        /* ignora falha pontual de um processo */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
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

// Extrai o texto de um andamento (defensivo).
function extrairConteudo(m: Record<string, unknown>): string | null {
  const cands = [m.description, m.text, m.movement, m.content, m.title, m.name, m.description_movement]
  for (const c of cands) {
    if (c != null && String(c).trim()) return String(c).trim()
  }
  return null
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

    // Processos casados: lawsuits_id -> número exibível.
    const casaveis = await processosCasaveis(ctx)
    const lawsuitIds = [...casaveis.keys()]

    // Busca as movimentações de cada processo casado (concorrência limitada).
    const brutos = await pmap(lawsuitIds, 6, async (lid) => {
      const res = await fetch(`${ctx.base}/movements/${lid}`, { headers: ctx.headers })
      if (!res.ok) throw new Error(`/movements/${lid} → HTTP ${res.status}`)
      const arr = pickArray(await res.json())
      return arr.map((m) => ({ lawsuitId: lid, m }))
    })

    // Modo debug: devolve amostra crua para conferência dos nomes de campo.
    if (body.debug) {
      return jsonResponse({
        ok: true,
        processos_casados: casaveis.size,
        amostra: brutos.slice(0, 5).map((x) => x.m),
      })
    }

    const agora = new Date().toISOString()
    const vistos = new Set<string>()
    const rows = brutos
      .map(({ lawsuitId, m }) => {
        const dataIso = extrairData(m)
        const conteudo = extrairConteudo(m)
        const dataDia = dataIso ? dataIso.slice(0, 10) : null
        // id estável: id do ADVBOX quando existir; senão hash determinístico do
        // processo + data + conteúdo (movimentações do ADVBOX não trazem id).
        const id =
          str(m.id) ??
          `${lawsuitId}-${dataDia ?? 'sd'}-${hash(`${dataIso ?? ''}|${conteudo ?? ''}`)}`
        return {
          id,
          advbox_lawsuit_id: lawsuitId,
          numero_processo: casaveis.get(lawsuitId) ?? null,
          data: dataDia,
          data_ts: dataIso,
          conteudo,
          raw: m,
          sincronizado_em: agora,
        }
      })
      // Só andamentos com data dentro da janela e com conteúdo.
      .filter((r) => r.data && r.data >= ini && r.conteudo)
      // Dedup por id (o mesmo andamento pode vir repetido).
      .filter((r) => {
        if (vistos.has(r.id)) return false
        vistos.add(r.id)
        return true
      })

    let gravados = 0
    const chunk = 500
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk)
      const { error } = await svc
        .from('advbox_movimentacoes')
        .upsert(slice, { onConflict: 'id' })
      if (error) throw new Error(error.message)
      gravados += slice.length
    }

    // Remove do cache o que saiu da janela de `dias`.
    await svc.from('advbox_movimentacoes').delete().lt('data', ini)

    return jsonResponse({
      ok: true,
      processos_casados: casaveis.size,
      movimentacoes: rows.length,
      gravados,
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
