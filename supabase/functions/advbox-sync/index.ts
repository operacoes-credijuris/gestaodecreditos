// Sincroniza dados do ADVBOX (processos, tarefas e movimentações) usando o
// token guardado no servidor. O mapeamento de campos é defensivo: tenta nomes
// comuns e ignora o que não reconhecer. Ajuste conforme a resposta real da sua
// conta ADVBOX (veja https://api.softwareadvbox.com.br/docs).
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, serviceClient } from '../_shared/auth.ts'

function pickArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[]
  const obj = (json ?? {}) as Record<string, unknown>
  for (const k of ['data', 'items', 'lawsuits', 'posts', 'movements', 'results']) {
    if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[]
  }
  return []
}

const str = (v: unknown): string | null =>
  v == null ? null : String(v)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCaller(req)
    if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

    // Token (secreto) + base_url (config).
    const { data: secret } = await svc
      .from('integracao_advbox_secret')
      .select('token')
      .eq('id', 1)
      .maybeSingle()
    const token = secret?.token
    if (!token) {
      return jsonResponse(
        { error: 'Token do ADVBOX não configurado. Defina em Configurações.' },
        400,
      )
    }
    const { data: integ } = await svc
      .from('integracoes')
      .select('config')
      .eq('servico', 'advbox')
      .maybeSingle()
    const baseUrl =
      ((integ?.config ?? {}) as { base_url?: string }).base_url ??
      'https://app.advbox.com.br/api/v1'

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    }
    const get = async (path: string) => {
      const res = await fetch(`${baseUrl}${path}`, { headers })
      if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
      return pickArray(await res.json())
    }

    const resumo = { processos: 0, tarefas: 0, movimentacoes: 0 }
    const erros: string[] = []
    const agora = new Date().toISOString()

    // ---------- Processos (lawsuits) ----------
    try {
      const lawsuits = await get('/lawsuits')
      if (lawsuits.length) {
        const { data: existentes } = await svc
          .from('processos')
          .select('advbox_lawsuit_id')
          .not('advbox_lawsuit_id', 'is', null)
        const has = new Set(
          (existentes ?? []).map((e: { advbox_lawsuit_id: string }) => e.advbox_lawsuit_id),
        )
        const novos = lawsuits
          .filter((l) => !has.has(String(l.id ?? l.lawsuit_id)))
          .map((l) => ({
            advbox_lawsuit_id: str(l.id ?? l.lawsuit_id),
            numero_cnj: str(l.protocol_number ?? l.number ?? l.numero ?? l.cnj ?? '') ?? '',
            tribunal: str(l.court_name ?? l.tribunal),
            comarca: str(l.county ?? l.comarca),
            vara: str(l.court ?? l.vara),
          }))
          .filter((p) => p.numero_cnj)
        if (novos.length) {
          const { error } = await svc.from('processos').insert(novos)
          if (error) throw new Error(error.message)
          resumo.processos = novos.length
        }
      }
    } catch (e) {
      erros.push(`Processos: ${(e as Error).message}`)
    }

    // ---------- Tarefas (posts) ----------
    try {
      const posts = await get('/posts')
      const tarefas = posts
        .map((p) => ({
          advbox_id: str(p.id),
          titulo: str(p.title ?? p.task ?? p.name ?? 'Tarefa ADVBOX') ?? 'Tarefa ADVBOX',
          descricao: str(p.description ?? p.text ?? p.comment),
          responsavel: str(p.user ?? p.responsible ?? p.lawyer),
          prazo: str(p.date ?? p.deadline ?? p.due_date),
          status: 'pendente',
          prioridade: 'media',
          sincronizado_em: agora,
        }))
        .filter((t) => t.advbox_id)
      if (tarefas.length) {
        const { error } = await svc
          .from('tarefas')
          .upsert(tarefas, { onConflict: 'advbox_id' })
        if (error) throw new Error(error.message)
        resumo.tarefas = tarefas.length
      }
    } catch (e) {
      erros.push(`Tarefas: ${(e as Error).message}`)
    }

    // ---------- Movimentações (last_movements) ----------
    try {
      const movs = await get('/last_movements')
      const registros = movs
        .map((m) => ({
          fonte: 'advbox',
          tipo: 'movimentacao',
          external_id: str(m.id ?? `${m.lawsuit_id ?? ''}-${m.date ?? ''}`),
          numero_processo: str(m.protocol_number ?? m.number ?? m.lawsuit_number),
          conteudo: str(m.description ?? m.text ?? m.movement),
          data_publicacao: str(m.date ?? m.created_at),
          lida: false,
          tratada: false,
        }))
        .filter((r) => r.external_id && r.conteudo)
      if (registros.length) {
        const { error } = await svc
          .from('publicacoes')
          .upsert(registros, { onConflict: 'fonte,external_id', ignoreDuplicates: true })
        if (error) throw new Error(error.message)
        resumo.movimentacoes = registros.length
      }
    } catch (e) {
      erros.push(`Movimentações: ${(e as Error).message}`)
    }

    const mensagem =
      `ADVBOX sincronizado — ${resumo.processos} processo(s), ` +
      `${resumo.tarefas} tarefa(s), ${resumo.movimentacoes} movimentação(ões).` +
      (erros.length ? ` Avisos: ${erros.join('; ')}` : '')

    return jsonResponse({ ok: true, resumo, erros, mensagem })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
