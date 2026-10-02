import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // Mensagem clara em dev caso o .env não esteja configurado.
  console.error(
    'Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY ausentes. ' +
      'Copie .env.example para .env e preencha com os dados do seu projeto Supabase.',
  )
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

// `||`, e não `??`: variável DEFINIDA E VAZIA também cai no provisório. Com `??`
// o texto vazio passava adiante, e o createClient derrubava o módulo ("supabaseUrl
// is required") — junto com todo teste que importa algo que importa este arquivo.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
)
