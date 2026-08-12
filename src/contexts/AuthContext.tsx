import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { esquecerTokenDrive } from '@/lib/drive'
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
  /** Devolve mensagem quando o servidor não confirmou a saída (ver signOut). */
  signOut: () => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()
  /** Dono da sessão agora. Serve para descartar leitura de perfil em voo que
   *  chegue depois de trocar (ou encerrar) o usuário. */
  const usuarioCorrente = useRef<string | null>(null)

  /**
   * Carrega o perfil. Duas guardas, e as duas nasceram de defeito real:
   *
   * 1. FALHA DE LEITURA NÃO É "USUÁRIO SEM PERFIL". Antes, o `{ error }` era
   *    descartado e o perfil ia a null. Como isto roda a cada SIGNED_IN — o que
   *    inclui a volta para a aba depois do notebook acordar —, um 502 momentâneo
   *    REBAIXAVA o administrador (isAdmin passa a false, Configurações
   *    desaparece) e travava a criação de tarefa, que depende do nome do perfil.
   *    Falhando, preserva o que já estava.
   *
   * 2. RESPOSTA DE OUTRO USUÁRIO NÃO PODE VENCER. A leitura é assíncrona: a de A
   *    pode chegar depois do logout ou depois do login de B e repovoar o perfil
   *    com quem já saiu. Só aplica se ainda for o usuário da sessão corrente.
   */
  async function loadProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      console.error('Falha ao ler o perfil; mantendo o anterior.', error)
      return
    }
    if (usuarioCorrente.current !== userId) return
    setProfile((data as Profile) ?? null)
  }

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session?.user) {
        usuarioCorrente.current = data.session.user.id
        loadProfile(data.session.user.id).finally(() => {
          if (mounted) setLoading(false)
        })
      } else {
        setLoading(false)
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      usuarioCorrente.current = newSession?.user?.id ?? null
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

  /**
   * Sai da conta. Devolve mensagem quando o servidor não confirmou a saída.
   *
   * O `{ error }` era descartado, e o caso é grave em terminal compartilhado: se
   * o /logout falha (rede, 429, 5xx), o auth-js NÃO remove a sessão, mas a tela
   * limpava o cache e recarregava — parecia que "só piscou". O operador fechava
   * o notebook achando que havia saído, e a sessão dele continuava válida para o
   * próximo que abrisse. Pior ainda depois da tela de acesso desativado: o
   * botão Sair dela não saía, e ela se desfazia sozinha no refetch seguinte.
   *
   * Falhando, derruba a sessão LOCALMENTE de todo jeito — quem clicou em Sair
   * tem de ficar fora deste dispositivo — e avisa que a revogação no servidor não
   * foi confirmada, porque só um novo login com conexão a completa.
   */
  async function signOut(): Promise<{ error: string | null }> {
    const { error } = await supabase.auth.signOut()
    setProfile(null)
    usuarioCorrente.current = null
    qc.clear()
    // O token do Drive vive no sessionStorage da aba (ver lib/drive.ts). Sem isto,
    // quem clicasse em Sair deixaria a credencial de acesso ao Drive da empresa
    // disponível para o próximo que usasse a mesma aba.
    esquecerTokenDrive()
    if (error) {
      console.error('Falha ao encerrar a sessão no servidor.', error)
      // scope: 'local' remove o token deste navegador sem depender da rede.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      setSession(null)
      return {
        error:
          'Não foi possível confirmar a saída no servidor. A sessão foi encerrada neste dispositivo; entre novamente com conexão para revogar o acesso por completo.',
      }
    }
    return { error: null }
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
  // Falha de rede vazava crua e em inglês ("Failed to fetch") num produto todo
  // em pt-BR, e quem lia concluía que a senha estava errada.
  if (/failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(msg))
    return 'Sem conexão com o servidor. Verifique a internet e tente novamente.'
  // Resto: mensagem em português na tela, técnica só no console.
  console.error('Erro de autenticação:', msg)
  return 'Não foi possível entrar agora. Tente novamente em instantes.'
}
