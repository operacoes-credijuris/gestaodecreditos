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
    const { error: perfilErr } = await svc.from('profiles').upsert(
      {
        id: userId,
        email,
        nome: nome ?? '',
        role: role === 'admin' ? 'admin' : 'usuario',
        ativo: true,
      },
      { onConflict: 'id' },
    )
    // Ignorar este erro era pior do que parece: a conta JÁ existe no Auth, e o
    // trigger cria o profile como 'usuario'. Então "criar administrador" podia
    // devolver ok:true e produzir um usuário comum, sem ninguém notar até a
    // pessoa reclamar que não vê Configurações. O usuário criado não é revertido
    // de propósito — apagar conta recém-criada por falha de espelho arrisca
    // perder a senha já definida; melhor dizer o que ficou pendente.
    if (perfilErr) {
      return jsonResponse(
        {
          error:
            `Usuário criado, mas o cadastro (nome e perfil) não foi gravado: ${perfilErr.message}. ` +
            'Edite o usuário para completar.',
          user_id: userId,
        },
        500,
      )
    }

    return jsonResponse({ ok: true, user_id: userId })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
