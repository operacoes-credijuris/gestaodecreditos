// Grava/atualiza o token de acesso do Escavador. Exclusivo do admin.
// A chave fica em integracao_escavador_secret (RLS ligada, nenhuma policy — só
// a service_role das Edge Functions lê). Ver a migração 0061.
//
// A CHAVE É TESTADA ANTES DE SER GRAVADA, e não conferida por formato.
//
// O token do Escavador é um personal access token opaco: não há prefixo que se
// possa exigir como o "sk-ant-" da Anthropic, e um palpite de formato só criaria
// falso negativo. Em vez disso, esta função gasta uma chamada em
// /quantidade-creditos — que não consome crédito — e só grava se a API
// responder. Assim o erro aparece no campo que a pessoa acabou de preencher, e
// não duas telas adiante, na primeira diligência, como "Escavador respondeu
// 401".
//
// De quebra, a resposta traz o SALDO. Em período de teste é o número que
// interessa antes de sair rodando apuração.

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, isAdmin, serviceClient } from '../_shared/auth.ts'
import { ErroEscavador, saldoEscavador } from '../_shared/escavador.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCaller(req)
    if (!(await isAdmin(caller, svc))) {
      return jsonResponse({ error: 'Acesso restrito ao administrador.' }, 403)
    }

    const { token } = await req.json()
    const chave = String(token ?? '').trim()
    if (!chave) return jsonResponse({ error: 'Informe o token do Escavador.' }, 400)

    let saldo: { creditos: number; saldo: number; descricao: string }
    try {
      saldo = await saldoEscavador(chave)
    } catch (e) {
      const erro = e as ErroEscavador
      // 401 já vem traduzido por _shared/escavador.ts. Qualquer outra falha
      // (rede, 5xx do Escavador) NÃO é motivo para recusar a chave em silêncio:
      // dizemos o que houve e pedimos para tentar de novo, em vez de acusar um
      // token que pode estar correto.
      return jsonResponse(
        {
          error:
            erro?.status === 401
              ? 'O Escavador recusou este token. Confira em api.escavador.com/tokens — ' +
                'ele é exibido uma única vez, na criação.'
              : `Não foi possível confirmar o token agora (${erro?.message ?? erro}). ` +
                'A chave NÃO foi gravada; tente de novo em instantes.',
        },
        400,
      )
    }

    const { error: e1 } = await svc.from('integracao_escavador_secret').upsert(
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
      .eq('servico', 'escavador')
      .maybeSingle()
    const config = { ...(integ?.config ?? {}), configurado: true }
    await svc
      .from('integracoes')
      .upsert({ servico: 'escavador', config, ativo: true }, { onConflict: 'servico' })

    return jsonResponse({ ok: true, saldo })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
