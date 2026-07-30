// Grava/atualiza o token de longa duração do Kommo no servidor. Exclusivo do
// admin. O token fica em integracao_kommo_secret, tabela sem policy nenhuma —
// inacessível pelo cliente, só a service_role lê.
//
// O subdomínio vai junto porque a API do Kommo resolve a conta pelo HOST
// (https://<subdominio>.kommo.com). O token sozinho não a identifica: bater no
// gateway genérico devolve 401 "Account not found" mesmo com token válido.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, isAdmin, serviceClient } from '../_shared/auth.ts'

// Aceita o subdomínio em qualquer das formas que a pessoa tem à mão — o que ela
// vê na barra de endereço é a URL inteira, não o pedaço isolado:
//   contatocredijuriscom
//   contatocredijuriscom.kommo.com
//   https://contatocredijuriscom.kommo.com/
function normalizarSubdominio(v: string): string {
  return v
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.kommo\.com$/i, '')
    .toLowerCase()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCaller(req)
    if (!(await isAdmin(caller, svc))) {
      return jsonResponse({ error: 'Acesso restrito ao administrador.' }, 403)
    }

    const body = await req.json()
    const token: unknown = body?.token
    const subdominioBruto: unknown = body?.subdominio

    if (typeof subdominioBruto !== 'string' || !normalizarSubdominio(subdominioBruto)) {
      return jsonResponse({ error: 'Informe o subdomínio da conta Kommo.' }, 400)
    }
    const subdominio = normalizarSubdominio(subdominioBruto)

    // O token é opcional na atualização: permite corrigir só o subdomínio sem
    // precisar redigitar um JWT de mil caracteres.
    const trocaToken = typeof token === 'string' && token.trim().length > 0
    if (token !== undefined && token !== null && !trocaToken) {
      return jsonResponse({ error: 'Token inválido.' }, 400)
    }

    const { data: atual } = await svc
      .from('integracao_kommo_secret')
      .select('token')
      .eq('id', 1)
      .maybeSingle()

    if (!trocaToken && !atual?.token) {
      return jsonResponse({ error: 'Nenhum token salvo ainda — informe o token.' }, 400)
    }

    const { error: e1 } = await svc.from('integracao_kommo_secret').upsert(
      {
        id: 1,
        token: trocaToken ? (token as string).trim() : atual!.token,
        subdominio,
        atualizado_em: new Date().toISOString(),
        atualizado_por: caller?.id ?? null,
      },
      { onConflict: 'id' },
    )
    if (e1) return jsonResponse({ error: e1.message }, 400)

    // Valida contra a API antes de dizer que deu certo: token e subdomínio só
    // funcionam juntos, e um erro aqui é muito mais fácil de entender agora do
    // que quando o sync falhar depois. O subdomínio guardado é útil mesmo se a
    // validação falhar, então a gravação acima não é revertida.
    let validado = false
    let aviso: string | null = null
    try {
      const res = await fetch(`https://${subdominio}.kommo.com/api/v4/account`, {
        headers: {
          Authorization: `Bearer ${trocaToken ? (token as string).trim() : atual!.token}`,
          Accept: 'application/json',
        },
      })
      if (res.ok) {
        validado = true
      } else if (res.status === 401) {
        aviso =
          'O Kommo recusou a autenticação (401). Confira o subdomínio — a conta é ' +
          'resolvida pelo endereço, então subdomínio errado dá 401 mesmo com token válido.'
      } else {
        aviso = `O Kommo respondeu HTTP ${res.status} na validação.`
      }
    } catch (e) {
      aviso = `Não foi possível validar agora: ${(e as Error).message}`
    }

    // config não secreta, mostrada na UI
    const { data: integ } = await svc
      .from('integracoes')
      .select('config')
      .eq('servico', 'kommo')
      .maybeSingle()
    const config = {
      ...(integ?.config ?? {}),
      configurado: true,
      subdominio,
      validado,
    }
    await svc
      .from('integracoes')
      .upsert({ servico: 'kommo', config, ativo: true }, { onConflict: 'servico' })

    return jsonResponse({ ok: true, validado, aviso })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
