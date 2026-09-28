// Grava/atualiza a chave da BullAI. Exclusivo do admin.
// A chave fica em integracao_bullai_secret (RLS ligada, nenhuma policy — só a
// service_role das Edge Functions lê). Ver a migração 0070.
//
// A CHAVE É TESTADA ANTES DE SER GRAVADA, como a do Escavador: esta função gasta
// uma chamada em /credits — que não consome consulta — e só grava se a BullAI
// responder. Assim o erro aparece no campo que a pessoa acabou de preencher, e
// não duas telas adiante, no primeiro pedido de certidão. E a resposta já traz o
// saldo de consultas, que é o número que interessa antes de sair pedindo.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, isAdmin, serviceClient } from '../_shared/auth.ts'
import { creditosBullai, ErroBullai } from '../_shared/bullai.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCaller(req)
    if (!(await isAdmin(caller, svc))) {
      return jsonResponse({ error: 'Acesso restrito ao administrador.' }, 403)
    }

    const { token } = await req.json().catch(() => ({}))
    const chave = String(token ?? '').trim()
    if (!chave) return jsonResponse({ error: 'Informe a chave da BullAI.' }, 400)

    let creditos
    try {
      creditos = await creditosBullai(chave)
    } catch (e) {
      const erro = e as ErroBullai
      return jsonResponse(
        {
          error:
            erro?.status === 401
              ? erro.message
              : `Não foi possível confirmar a chave agora (${erro?.message ?? erro}). A chave NÃO foi gravada; tente de novo em instantes.`,
        },
        400,
      )
    }

    const { error } = await svc.from('integracao_bullai_secret').upsert(
      { id: 1, token: chave, atualizado_em: new Date().toISOString(), atualizado_por: caller?.id ?? null },
      { onConflict: 'id' },
    )
    if (error) return jsonResponse({ error: error.message }, 400)

    // Marca como configurado na config não secreta (mostrada na UI).
    const { data: integ } = await svc.from('integracoes').select('config').eq('servico', 'bullai').maybeSingle()
    await svc
      .from('integracoes')
      .upsert(
        { servico: 'bullai', config: { ...(integ?.config ?? {}), configurado: true }, ativo: true },
        { onConflict: 'servico' },
      )

    return jsonResponse({ ok: true, creditos })
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500)
  }
})
