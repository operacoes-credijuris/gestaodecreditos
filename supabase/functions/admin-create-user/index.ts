// Cria um novo usuário (e-mail + senha). Exclusivo do administrador.
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

    const { email, password, nome, role } = await req.json()
    if (!email || !password) {
      return jsonResponse({ error: 'Informe e-mail e senha.' }, 400)
    }

    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome: nome ?? '' },
    })
    if (createErr) return jsonResponse({ error: createErr.message }, 400)

    const userId = created.user?.id
    // Garante o profile com nome/role corretos (o trigger cria como 'usuario').
    await svc.from('profiles').upsert(
      {
        id: userId,
        email,
        nome: nome ?? '',
        role: role === 'admin' ? 'admin' : 'usuario',
        ativo: true,
      },
      { onConflict: 'id' },
    )

    return jsonResponse({ ok: true, user_id: userId })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
