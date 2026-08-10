import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'

export const ADMIN_EMAIL = 'contato@credijuris.com'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
  /**
   * Administrador desligou este usuário em Configurações. O banco já barra o
   * acesso (policies exigem is_ativo(), migração 0025); isto existe para a tela
   * dizer o motivo em vez de mostrar tudo vazio.
   */
  acessoDesativado: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    setProfile((data as Profile) ?? null)
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => {
          if (mounted) setLoading(false)
        })
      } else {
        setLoading(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession?.user) {
        loadProfile(newSession.user.id)
      } else {
        setProfile(null)
        // Sessão encerrada (logout, token revogado, senha trocada pelo admin):
        // o cache do React Query guarda o que o usuário anterior carregou —
        // carteira, dados de investidor, valores de crédito. Sem limpar, quem
        // entrasse depois no mesmo navegador veria esses dados na primeira
        // renderização, antes de qualquer refetch.
        qc.clear()
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [qc])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      return { error: traduzErroAuth(error.message) }
    }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
    qc.clear()
  }

  const user = session?.user ?? null
  const isAdmin = useMemo(
    () => user?.email === ADMIN_EMAIL || profile?.role === 'admin',
    [user?.email, profile?.role],
  )
  // `=== false` e não `!profile?.ativo`: enquanto o perfil não carregou, profile
  // é null e não se sabe nada — só bloqueia com o desligamento confirmado.
  const acessoDesativado = profile?.ativo === false

  const value: AuthContextValue = {
    session,
    user,
    profile,
    loading,
    isAdmin,
    acessoDesativado,
    signIn,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}

function traduzErroAuth(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha inválidos.'
  if (/email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.'
  if (/rate limit/i.test(msg)) return 'Muitas tentativas. Aguarde e tente novamente.'
  return msg
}
