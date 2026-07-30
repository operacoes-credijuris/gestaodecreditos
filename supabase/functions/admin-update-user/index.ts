// Altera nome, e-mail e senha de um usuário. Exclusivo do administrador.
//
// Precisa existir do lado servidor porque e-mail e senha vivem no Supabase Auth
// (auth.users), e alterá-los exige a Admin API, que só a service_role pode
// chamar. O nome fica em public.profiles e o cliente até conseguiria escrever
// direto, mas vem por aqui junto para os três campos serem uma operação só —
// senão um erro no meio deixaria o e-mail trocado no Auth e o antigo no profile.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, isAdmin, serviceClient } from '../_shared/auth.ts'

/** Mesmo mínimo que o Supabase Auth exige, validado aqui para o erro ser claro. */
const SENHA_MINIMA = 6

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCaller(req)
    if (!(await isAdmin(caller, svc))) {
      return jsonResponse({ error: 'Acesso restrito ao administrador.' }, 403)
    }

    const body = (await req.json().catch(() => ({}))) as {
      userId?: string
      nome?: string
      email?: string
      password?: string
    }
    const userId = (body.userId ?? '').trim()
    if (!userId) return jsonResponse({ error: 'Informe o usuário.' }, 400)

    const nome = body.nome?.trim()
    const email = body.email?.trim()
    const password = body.password ?? ''

    if (email !== undefined && email === '') {
      return jsonResponse({ error: 'O e-mail não pode ficar vazio.' }, 400)
    }
    // Senha em branco significa "não alterar" — o formulário deixa o campo vazio
    // quando não se quer trocar. Preenchida, tem de ser válida.
    if (password && password.length < SENHA_MINIMA) {
      return jsonResponse(
        { error: `A senha precisa ter ao menos ${SENHA_MINIMA} caracteres.` },
        400,
      )
    }

    // ---------- Auth (e-mail e senha) ----------
    const mudancasAuth: Record<string, unknown> = {}
    if (email) {
      mudancasAuth.email = email
      // Sem isto o Supabase manda e-mail de confirmação e o login antigo continua
      // valendo até o usuário clicar no link — troca feita pelo admin não deve
      // depender de o usuário confirmar.
      mudancasAuth.email_confirm = true
    }
    if (password) mudancasAuth.password = password
    if (nome !== undefined) mudancasAuth.user_metadata = { nome }

    if (Object.keys(mudancasAuth).length > 0) {
      const { error } = await svc.auth.admin.updateUserById(userId, mudancasAuth)
      // Erro mais comum aqui: e-mail já usado por outro usuário.
      if (error) return jsonResponse({ error: error.message }, 400)
    }

    // ---------- Profile (espelho legível pelo app) ----------
    const mudancasPerfil: Record<string, unknown> = {}
    if (nome !== undefined) mudancasPerfil.nome = nome
    if (email) mudancasPerfil.email = email

    if (Object.keys(mudancasPerfil).length > 0) {
      const { error } = await svc
        .from('profiles')
        .update(mudancasPerfil)
        .eq('id', userId)
      if (error) {
        // O Auth já foi alterado. Reportar em vez de tentar reverter: uma
        // reversão que também falhasse deixaria estado pior e mais difícil de
        // diagnosticar do que a divergência em si.
        return jsonResponse(
          {
            error:
              `Credenciais alteradas, mas o cadastro não atualizou: ${error.message}`,
          },
          500,
        )
      }
    }

    return jsonResponse({ ok: true })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
