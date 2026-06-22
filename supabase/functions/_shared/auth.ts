// Helpers de autenticação/serviço compartilhados pelas Edge Functions.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const ADMIN_EMAIL = 'operacoes@credijuris.com'

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

/** Verifica se o usuário é administrador. */
export async function isAdmin(
  user: { id: string; email?: string } | null,
  svc: SupabaseClient,
): Promise<boolean> {
  if (!user) return false
  if (user.email === ADMIN_EMAIL) return true
  const { data } = await svc
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  return data?.role === 'admin'
}
