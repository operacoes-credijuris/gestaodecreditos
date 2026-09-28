// bullai-catalogo — o que a BullAI sabe buscar, e quantas consultas restam.
//
// AS DUAS PERGUNTAS QUE VÊM ANTES DE QUALQUER PEDIDO: que certidões dá para
// extrair (o catálogo de portais) e quantas ainda cabem no plano. Nenhuma das
// duas gasta consulta.
//
// USO (POST, com sessão logada): { saldo_apenas?: boolean }
//   -> { creditos, portais? }
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveBullai } from '../_shared/segredos.ts'
import { creditosBullai, ErroBullai, portaisBullai } from '../_shared/bullai.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // ATIVO, e não admin: quem precisa do catálogo e do saldo é quem vai pedir
    // certidão, não quem administra a conta. Nada aqui revela a chave.
    const svc = serviceClient()
    const user = await getCallerAtivo(req, svc)
    if (!user) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const chave = await chaveBullai()
    if (!chave) {
      return jsonResponse({ error: 'Chave da BullAI não configurada — grave-a em Configurações.' }, 400)
    }
    const body = await req.json().catch(() => ({}))
    const saldoApenas = Boolean((body as { saldo_apenas?: boolean }).saldo_apenas)

    const [creditos, portais] = await Promise.all([
      creditosBullai(chave),
      saldoApenas ? Promise.resolve(undefined) : portaisBullai(chave),
    ])
    return jsonResponse({ ok: true, creditos, ...(portais ? { portais } : {}) })
  } catch (e) {
    const erro = e as ErroBullai
    return jsonResponse({ error: erro?.message ?? String(e) }, 400)
  }
})
