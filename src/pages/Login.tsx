import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2, LogIn } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Field, Input } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import logo from '@/assets/logo-credijuris.png'

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-papel">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    )
  }
  // Volta para a rota que a pessoa pediu antes de cair aqui (o ProtectedRoute
  // guarda em state.from). Link direto de publicação ou de crédito compartilhado
  // por colega chega ao destino em vez de largar no dashboard.
  if (session) {
    const de = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
    return <Navigate to={de && de !== '/login' ? de : '/estrategica'} replace />
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
    // Fundo claro, como os materiais comerciais da marca: a logomarca aparece
    // em cor plena (o azul dela não sobrevive legível sobre navy escuro).
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-papel via-white to-brand-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="sr-only">Credijuris</h1>
          <img
            src={logo}
            alt="Credijuris — créditos judiciais"
            className="mx-auto mb-3 h-12 w-auto"
          />
          <p className="text-sm text-slate-600">Sistema de Gestão de Créditos</p>
        </div>

        <div className="rounded-2xl border border-brand-100 bg-white p-6 shadow-xl shadow-brand-950/[0.07] sm:p-8">
          <h2 className="font-display mb-6 text-lg font-bold tracking-tight text-slate-900">
            Acessar o sistema
          </h2>

          {!isSupabaseConfigured && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Supabase não configurado. Defina <code>VITE_SUPABASE_URL</code> e{' '}
              <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>.env</code>.
            </div>
          )}

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

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={submitting}
              icon={<LogIn className="h-4 w-4" />}
            >
              Entrar
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-600">
            Cadastro de usuários pelo administrador.
          </p>
        </div>
      </div>
    </div>
  )
}
