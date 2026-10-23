// Grava/atualiza o token de API do ADVBOX no servidor. Exclusivo do admin.
// O token fica na tabela integracao_advbox_secret (sem acesso via cliente).
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, isAdmin, serviceClient } from '../_shared/auth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCaller(req)
    if (!(await isAdmin(caller, svc))) {
      return jsonResponse({ error: 'Acesso restrito ao administrador.' }, 403)
    }

    const corpo = await req.json().catch(() => ({}))
    // APARADO (Varredura E, 23/10/2026), como os das outras integrações: o token
    // colado com a quebra de linha do fim era gravado assim, e a quebra dentro
    // do header Authorization fazia TODA chamada à ADVBOX falhar com "invalid
    // header value" — longe deste campo, onde se corrige.
    const token = typeof corpo?.token === 'string' ? corpo.token.trim() : ''
    if (!token) {
      return jsonResponse({ error: 'Token inválido.' }, 400)
    }

    const { error: e1 } = await svc.from('integracao_advbox_secret').upsert(
      {
        id: 1,
        token,
        atualizado_em: new Date().toISOString(),
        atualizado_por: caller?.id ?? null,
      },
      { onConflict: 'id' },
    )
    if (e1) return jsonResponse({ error: e1.message }, 400)

    // Marca como configurado na config não secreta (mostrada na UI).
    const { data: integ } = await svc
      .from('integracoes')
      .select('config')
      .eq('servico', 'advbox')
      .maybeSingle()
    const config = { ...(integ?.config ?? {}), configurado: true }
    await svc
      .from('integracoes')
      .upsert({ servico: 'advbox', config, ativo: true }, { onConflict: 'servico' })

    return jsonResponse({ ok: true })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
