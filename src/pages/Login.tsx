import { useState, type FormEvent } from 'react'
import { INICIO } from '@/components/layout/navigation'
import { Navigate, useLocation } from 'react-router-dom'
import { AlertTriangle, Loader2, LogIn } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Field, Input } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import logo from '@/assets/logo-credijuris.png'
import { FaixaBeta } from '@/components/layout/FaixaBeta'

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-papel" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-marca-viva" aria-hidden />
        <span className="sr-only">Carregando…</span>
      </div>
    )
  }
  // Volta para a rota que a pessoa pediu antes de cair aqui (o ProtectedRoute
  // guarda em state.from). Link direto de publicação ou de crédito compartilhado
  // por colega chega ao destino em vez de largar no dashboard.
  if (session) {
    const de = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
    return <Navigate to={de && de !== '/login' ? de : INICIO} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await signIn(email.trim(), password)
    setSubmitting(false)
    if (error) setError(error)
  }

  return (
    // O `.login` da amostra: sobre o papel da casa, a logomarca em cor plena
    // (o azul dela não sobrevive legível sobre navy escuro) e, embaixo, o
    // cartão do formulário. O degradê de antes saiu — a amostra não tem.
    <div className="grid min-h-screen place-content-center gap-6 bg-papel px-4 py-11">
      <FaixaBeta fixa />
      <div className="flex flex-col items-center gap-2.5 text-center">
        <h1 className="sr-only">Credijuris</h1>
        <img src={logo} alt="Credijuris — créditos judiciais" className="block h-[40px] w-auto" />
        <p className="text-corpo text-texto-2">Sistema de Gestão de Créditos</p>
      </div>

      <div className="w-[min(400px,calc(100vw-32px))] rounded-[18px] border border-borda bg-superficie p-9 shadow-nivel-2">
        <h2 className="mb-5 font-display text-xl font-extrabold tracking-tight text-texto">
          Acessar o sistema
        </h2>

        {!isSupabaseConfigured && (
          <div className="mb-5 flex items-start gap-2.5 rounded-campo border border-aviso-borda bg-aviso-fundo px-4 py-3 text-corpo">
            <AlertTriangle className="mt-0.5 h-[16px] w-[16px] shrink-0 text-aviso" aria-hidden />
            <p className="text-texto">
              Supabase não configurado. Defina <code className="font-mono text-xs">VITE_SUPABASE_URL</code> e{' '}
              <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> no arquivo{' '}
              <code className="font-mono text-xs">.env</code>.
            </p>
          </div>
        )}

        {/* O FORMULÁRIO DE SEMPRE: e-mail com type=email e autocomplete=email,
            senha com current-password — é o que deixa o gerenciador de senhas
            preencher —, os dois obrigatórios, e só o e-mail aparado. */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="E-mail" required>
            <Input
              type="email"
              autoComplete="email"
              placeholder="seuemail@credijuris.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Senha" required>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          {/* role="alert" (Novo, acessibilidade): o erro que aparece depois do
              Entrar é anunciado, em vez de surgir calado na tela. */}
          {error && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-campo border border-perigo-borda bg-perigo-fundo px-4 py-2 text-corpo text-perigo"
            >
              <AlertTriangle className="h-[16px] w-[16px] shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            loading={submitting}
            icon={<LogIn className="h-[16px] w-[16px]" />}
          >
            Entrar
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-texto-3">
          Cadastro de usuários pelo administrador.
        </p>
      </div>
    </div>
  )
}
