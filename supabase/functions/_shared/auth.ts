// Helpers de autenticação/serviço compartilhados pelas Edge Functions.
//
// Especificador `npm:` em vez de https://esm.sh, e versão fixa. Motivo: este é
// o único import externo das funções, então ele era um ponto único de falha
// em dois sentidos.
//   1. Disponibilidade: em 30/07/2026 o esm.sh devolveu 522 durante o deploy e
//      derrubou a implantação inteira, inclusive de funções não alteradas.
//   2. Versão: `@2` significa "qualquer 2.x" — resolvia para o que estivesse
//      publicado no dia, então uma mudança de comportamento chegaria em
//      produção sem ninguém ter mexido no código.
// Para atualizar, troque a versão aqui de propósito e rode `npm run check:functions`.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

// ⚠️ AS FUNCTIONS LEEM COM service_role — RLS NÃO VALE AQUI. E desativar alguém
// em Configurações não mexe no Supabase Auth, então o desligado continua obtendo
// JWT válido. Logo o portão de acesso é de CÓDIGO (getCallerAtivo/isAdmin
// abaixo), não do banco. É o fato mais importante deste módulo.
export const ADMIN_EMAIL = 'contato@credijuris.com'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** Client com a service_role — ignora RLS. Uso restrito ao servidor. */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Retorna o usuário autenticado a partir do header Authorization. */
export async function getCaller(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? ''
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const {
    data: { user },
  } = await client.auth.getUser()
  return user
}

/**
 * Client que carrega o JWT de quem chamou — logo, as RLS valem normalmente.
 * Use quando a função só precisa LER o que o próprio usuário já poderia ver;
 * é o oposto do serviceClient(), que ignora RLS.
 */
export function callerClient(req: Request): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Administrador E ativo. Sem o `ativo`, um admin desligado ainda chamava
 * admin-create-user e abria conta nova para voltar por ela.
 *
 * ADMIN_EMAIL é escape deliberado: a conta-mestra não pode se autotrancar, senão
 * ninguém reativa ninguém.
 */
export async function isAdmin(
  user: { id: string; email?: string } | null,
  svc: SupabaseClient,
): Promise<boolean> {
  if (!user) return false
  if (user.email === ADMIN_EMAIL) return true
  const { data } = await svc
    .from('profiles')
    .select('role, ativo')
    .eq('id', user.id)
    .maybeSingle()
  return data?.role === 'admin' && data?.ativo !== false
}

/** Mensagem única do 401. Estava copiada em 10 functions, em duas redações. */
export const ERRO_ACESSO =
  'Acesso não autorizado. Faça login novamente; se o problema persistir, o acesso pode ter sido desativado.'

/**
 * Usuário autenticado E ativo, ou null. Portão de TODA function que serve dado
 * ao app — getCaller() sozinho só responde "o JWT é válido?".
 *
 * Só nega com `ativo = false` EXPLÍCITO: falta de linha em profiles é defeito de
 * cadastro, não desligamento, e trancar por causa disso é pior que o risco que
 * evita. (Não troque por `!== true`.)
 */
export async function getCallerAtivo(req: Request, svc: SupabaseClient) {
  const user = await getCaller(req)
  if (!user) return null
  if (user.email === ADMIN_EMAIL) return user
  const { data } = await svc
    .from('profiles')
    .select('ativo')
    .eq('id', user.id)
    .maybeSingle()
  return data?.ativo === false ? null : user
}
