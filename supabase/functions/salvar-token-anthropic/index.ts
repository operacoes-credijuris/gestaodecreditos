// Grava/atualiza a chave de API da Anthropic no servidor. Exclusivo do admin.
// A chave fica na tabela integracao_anthropic_secret (sem acesso via cliente).
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

    const { token } = await req.json()
    if (!token || typeof token !== 'string') {
      return jsonResponse({ error: 'Chave inválida.' }, 400)
    }

    // Confere o formato antes de gravar. Sem isto, uma chave colada pela
    // metade — o caso comum, já que a Anthropic só a exibe uma vez — é aceita
    // aqui e só falha depois, na primeira pergunta, como "invalid x-api-key":
    // longe do campo que a pessoa precisa corrigir.
    const chave = token.trim()
    if (!chave.startsWith('sk-ant-')) {
      return jsonResponse(
        {
          error:
            'Isto não parece uma chave de API da Anthropic — ela começa com ' +
            '"sk-ant-". Confira em console.anthropic.com → API Keys.',
        },
        400,
      )
    }
    if (chave.length < 40) {
      return jsonResponse(
        {
          error:
            'A chave parece incompleta. Ela é exibida uma única vez, na ' +
            'criação — se tiver dúvida, gere uma nova e copie inteira.',
        },
        400,
      )
    }

    const { error: e1 } = await svc.from('integracao_anthropic_secret').upsert(
      {
        id: 1,
        token: chave,
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
      .eq('servico', 'anthropic')
      .maybeSingle()
    const config = { ...(integ?.config ?? {}), configurado: true }
    await svc
      .from('integracoes')
      .upsert({ servico: 'anthropic', config, ativo: true }, { onConflict: 'servico' })

    return jsonResponse({ ok: true })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
