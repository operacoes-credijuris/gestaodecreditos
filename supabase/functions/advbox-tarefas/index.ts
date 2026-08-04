// Integração de Tarefas com o ADVBOX (fonte única das tarefas).
// Ações:
//  - 'list'    : tarefas do ADVBOX ligadas aos processos cadastrados em
//                Créditos (numero_cnj), Requerimentos (numero_protocolo) e
//                Apensos (numero), casados por process_number/protocol_number.
//  - 'options' : catálogos para o formulário (usuários, tipos de tarefa) e os
//                processos casáveis (para o campo lawsuits_id).
//  - 'create'  : cria a tarefa no ADVBOX (POST /posts).
//  - 'sync'    : grava as tarefas no cache public.advbox_tarefas, que alimenta
//                a aba "Tarefas" da ficha de cada processo. Roda por cron e ao
//                abrir a aba. Aceita JWT do usuário OU x-cron-secret.
//
// Por que o sync é global (e não por processo): /posts não filtra por processo,
// então descobrir as tarefas de UM processo exige baixar todas e casar por
// lawsuits_id. Uma passada alimenta a ficha de todos os processos de uma vez.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, serviceClient } from '../_shared/auth.ts'
// Cliente compartilhado com throttle + retry/backoff: a API do ADVBOX responde
// 429/503 sob carga e sem retry isso vira erro na tela do usuário.
import {
  fetchAll,
  getAdvboxCtx,
  getJson,
  type AdvboxCtx,
} from '../_shared/advbox.ts'

const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

/**
 * Normaliza uma data do ADVBOX para YYYY-MM-DD (coluna `date` do Postgres).
 * Defensivo: o campo chega ora ISO, ora só a data, ora em dd/mm/aaaa.
 */
function dataDia(v: unknown): string | null {
  if (v == null || v === '') return null
  const s = String(v).trim()
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  const d = new Date(s.length <= 10 ? `${s}T00:00:00Z` : s)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** Campos derivados de um post do ADVBOX, comuns a 'list' e 'sync'. */
function extrairTarefa(p: Record<string, unknown>, numero: string) {
  const users = (p.users ?? []) as Array<Record<string, unknown>>
  return {
    tipo: (p.task ?? null) as string | null,
    processo: numero,
    start_date: (p.date ?? null) as string | null,
    date_deadline: (p.date_deadline ?? null) as string | null,
    notes: (p.notes ?? null) as string | null,
    responsaveis: users.map((u) => u.name).filter(Boolean) as string[],
    important: users.some((u) => Number(u.important) === 1),
    urgent: users.some((u) => Number(u.urgent) === 1),
    // Sem responsável não há como afirmar conclusão — `every` em lista vazia
    // seria true e marcaria a tarefa como feita sem ninguém tê-la feito.
    concluida: users.length > 0 && users.every((u) => u.completed),
  }
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
    const body = await req.json().catch(() => ({}))
    const action = body.action ?? 'list'

    // Autorização: JWT do usuário (chamada do app) OU segredo de cron — o
    // agendamento do 'sync' não tem usuário para autenticar.
    const cronSecret = Deno.env.get('CRON_SECRET')
    const headerSecret = req.headers.get('x-cron-secret')
    const autorizadoPorCron = !!cronSecret && headerSecret === cronSecret
    if (!autorizadoPorCron) {
      const caller = await getCaller(req)
      if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)
    }

    const ctx = await getAdvboxCtx()

    if (action === 'options') {
      const settings = (await getJson(ctx, '/settings')) as {
        users?: { id?: unknown; name?: unknown }[]
        tasks?: { id?: unknown; task?: unknown }[]
      }
      const users = (settings.users ?? []).map((u) => ({
        id: u.id,
        name: String(u.name ?? ''),
      }))
      const tasks = (settings.tasks ?? [])
        .map((t) => ({ id: t.id, name: String(t.task ?? '') }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
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

    if (action === 'sync') {
      const map = await processosCasaveis(ctx)
      const posts = await fetchAll(ctx, '/posts')
      const agora = new Date().toISOString()
      const rows = posts
        .filter((p) => p.lawsuits_id != null && map.has(Number(p.lawsuits_id)))
        .map((p) => {
          const law = map.get(Number(p.lawsuits_id))
          const numero = String(law?.process_number || law?.protocol_number || '')
          const t = extrairTarefa(p, numero)
          return {
            id: String(p.id),
            advbox_lawsuit_id: String(p.lawsuits_id),
            numero_processo: numero,
            numero_digits: onlyDigits(numero),
            tipo: t.tipo,
            data: dataDia(t.start_date),
            date_deadline: dataDia(t.date_deadline),
            notes: t.notes,
            responsaveis: t.responsaveis,
            important: t.important,
            urgent: t.urgent,
            concluida: t.concluida,
            raw: p,
            sincronizado_em: agora,
          }
        })

      const svc = serviceClient()
      // Upsert em blocos: um payload único com centenas de tarefas estoura o
      // limite de corpo da requisição.
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await svc
          .from('advbox_tarefas')
          .upsert(rows.slice(i, i + 500), { onConflict: 'id' })
        if (error) throw new Error(error.message)
      }
      // Poda o que não veio nesta passada (tarefa apagada no ADVBOX ou processo
      // que saiu do cadastro): toda linha atual levou `agora` no carimbo. Só
      // poda se houve resultado — uma resposta vazia por soluço da API não pode
      // limpar o cache inteiro.
      let podadas = 0
      if (rows.length) {
        const { count } = await svc
          .from('advbox_tarefas')
          .delete({ count: 'exact' })
          .lt('sincronizado_em', agora)
        podadas = count ?? 0
      }
      return jsonResponse({ ok: true, gravadas: rows.length, podadas })
    }

    // action === 'list'
    const map = await processosCasaveis(ctx)
    const posts = await fetchAll(ctx, '/posts')
    const tarefas = posts
      .filter((p) => p.lawsuits_id != null && map.has(Number(p.lawsuits_id)))
      .map((p) => {
        const law = map.get(Number(p.lawsuits_id))
        const numero = String(law?.process_number || law?.protocol_number || '')
        return {
          id: p.id,
          ...extrairTarefa(p, numero),
          created_at: p.created_at ?? null,
        }
      })
    return jsonResponse({ tarefas, total: tarefas.length })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
