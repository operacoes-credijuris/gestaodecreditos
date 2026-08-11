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
 * Verifica se o usuário é administrador E está com acesso liberado.
 *
 * O `ativo` entra aqui porque sem ele a desativação era furada num ponto que
 * anula o resto: um administrador desligado continuava passando por esta função
 * e podia chamar admin-create-user para abrir uma conta NOVA, ativa, e voltar
 * por ela. Bloquear as tabelas no banco (migração 0025) não fecha isso, porque
 * as Edge Functions usam service_role e não passam por RLS.
 *
 * ADMIN_EMAIL é escape deliberado: é a conta-mestra da casa, e se ela pudesse se
 * autotrancar ninguém teria como reativar ninguém.
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

/**
 * Usuário autenticado E com acesso liberado, ou null. É o portão de TODA function
 * que serve dado ao app.
 *
 * POR QUE EXISTE: getCaller() só responde "o JWT é válido?". Desativar alguém em
 * Configurações não mexe no Supabase Auth, então o desligado continua conseguindo
 * fazer login e obter JWT novo. As policies com is_ativo() barram o acesso direto
 * às tabelas, mas as functions leem com service_role, que ignora RLS — logo, sem
 * esta checagem, o desligado seguia obtendo tarefa, movimentacao, publicacao e
 * ainda podia disparar varredura de IA na conta da casa.
 *
 * Só nega com ativo = false EXPLÍCITO, pelo mesmo motivo do coalesce de
 * is_ativo() no banco: falta de linha em profiles é defeito de cadastro, não
 * desligamento, e trancar por causa disso é pior que o risco que evita.
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
