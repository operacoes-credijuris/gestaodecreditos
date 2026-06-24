// Integração de Tarefas com o ADVBOX (fonte única das tarefas).
// Ações:
//  - 'list'    : tarefas do ADVBOX ligadas aos processos cadastrados em
//                Créditos (numero_cnj), Requerimentos (numero_protocolo) e
//                Apensos (numero), casados por process_number/protocol_number.
//  - 'options' : catálogos para o formulário (usuários, tipos de tarefa) e os
//                processos casáveis (para o campo lawsuits_id).
//  - 'create'  : cria a tarefa no ADVBOX (POST /posts).
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, serviceClient } from '../_shared/auth.ts'

const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

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
  if (!token) throw new Error('Token do ADVBOX não configurado.')
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
    const data: Record<string, unknown>[] = Array.isArray(j) ? j : (j.data ?? [])
    out.push(...data)
    const total = Number((j as { totalCount?: number }).totalCount ?? out.length)
    offset += limit
    if (data.length === 0 || out.length >= total || out.length >= cap) break
  }
  return out
}

// Conjunto de números de processo cadastrados no nosso sistema (só dígitos).
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
    if (d.length >= 6) set.add(d)
  }
  for (const r of proc.data ?? []) add((r as { numero_cnj?: string }).numero_cnj)
  for (const r of ap.data ?? []) add((r as { numero?: string }).numero)
  for (const r of req.data ?? [])
    add((r as { numero_protocolo?: string }).numero_protocolo)
  return set
}

// Processos do ADVBOX que casam com os nossos números (por process_number ou
// protocol_number). Retorna mapa lawsuits_id -> info do processo.
async function processosCasaveis(ctx: AdvboxCtx) {
  const nums = await numerosCadastrados()
  const lawsuits = await fetchAll(ctx, '/lawsuits')
  const map = new Map<number, Record<string, unknown>>()
  for (const l of lawsuits) {
    const pn = onlyDigits(l.process_number)
    const prot = onlyDigits(l.protocol_number)
    if ((pn && nums.has(pn)) || (prot && nums.has(prot))) {
      map.set(Number(l.id), l)
    }
  }
  return map
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const caller = await getCaller(req)
    if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = body.action ?? 'list'
    const ctx = await getCtx()

    if (action === 'options') {
      const settings = await fetch(`${ctx.base}/settings`, { headers: ctx.headers }).then(
        (r) => r.json(),
      )
      const users = (settings.users ?? []).map((u: Record<string, unknown>) => ({
        id: u.id,
        name: u.name,
      }))
      const tasks = (settings.tasks ?? [])
        .map((t: Record<string, unknown>) => ({ id: t.id, name: t.task }))
        .sort((a: { name: string }, b: { name: string }) =>
          String(a.name).localeCompare(String(b.name), 'pt-BR'),
        )
      const map = await processosCasaveis(ctx)
      const lawsuits = [...map.values()]
        .map((l) => ({
          id: l.id,
          numero: l.process_number || l.protocol_number || '(sem número)',
          folder: l.folder ?? null,
          cliente:
            Array.isArray(l.customers) && l.customers.length
              ? (l.customers[0] as { name?: string }).name ?? null
              : null,
        }))
        .sort((a, b) => String(a.numero).localeCompare(String(b.numero)))
      return jsonResponse({ users, tasks, lawsuits })
    }

    if (action === 'create') {
      const payload = {
        lawsuits_id: body.lawsuits_id,
        tasks_id: body.tasks_id,
        start_date: body.start_date,
        from: body.from,
        guests: body.guests,
        date_deadline: body.date_deadline || undefined,
        comments: body.comments || undefined,
        important: body.important ? 1 : 0,
        urgent: body.urgent ? 1 : 0,
      }
      const res = await fetch(`${ctx.base}/posts`, {
        method: 'POST',
        headers: { ...ctx.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          data?.message ||
          (data?.errors ? Object.values(data.errors).flat().join(' ') : '') ||
          `HTTP ${res.status}`
        return jsonResponse({ error: `ADVBOX: ${msg}` }, 400)
      }
      return jsonResponse({ ok: true, data })
    }

    // action === 'list'
    const map = await processosCasaveis(ctx)
    const posts = await fetchAll(ctx, '/posts')
    const tarefas = posts
      .filter((p) => p.lawsuits_id != null && map.has(Number(p.lawsuits_id)))
      .map((p) => {
        const law = map.get(Number(p.lawsuits_id))
        const users = (p.users ?? []) as Array<Record<string, unknown>>
        const concluida = users.length > 0 && users.every((u) => u.completed)
        return {
          id: p.id,
          tipo: p.task ?? null,
          processo: (law?.process_number || law?.protocol_number || '') as string,
          start_date: p.date ?? null,
          date_deadline: p.date_deadline ?? null,
          notes: p.notes ?? null,
          responsaveis: users.map((u) => u.name).filter(Boolean),
          important: users.some((u) => Number(u.important) === 1),
          urgent: users.some((u) => Number(u.urgent) === 1),
          concluida,
          created_at: p.created_at ?? null,
        }
      })
    return jsonResponse({ tarefas, total: tarefas.length })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
