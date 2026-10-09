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
import { destinoDepoisDoEntrar } from '@/lib/guardaDaRota'

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

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
    // Com a busca do endereço (`?card=…`): ver destinoDepoisDoEntrar.
    return <Navigate to={destinoDepoisDoEntrar(location.state, INICIO)} replace />
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
    <div className="grid min-h-screen place-content-center gap-s6 bg-papel px-s4 py-s10">
      <FaixaBeta fixa />
      <div className="flex flex-col items-center gap-s2 text-center">
        <h1 className="sr-only">Credijuris</h1>
        {/* NO ESCURO, A LOGOMARCA CLAREIA UM QUARTO: o azul e o cinza de
            "créditos judiciais" ficavam em 4:1 sobre o papel escuro; com o
            filtro passam de 6:1, sem trocar a arte nem pôr placa branca. */}
        <img src={logo} alt="Credijuris — créditos judiciais" className="block h-[40px] w-auto dark:brightness-125" />
        {/* Em sentence case, como no menu ("Gestão de créditos"), revisão UX de 09/10/2026. */}
        <p className="text-corpo text-texto-2">Sistema de gestão de créditos</p>
      </div>

      {/* O RAIO DE JANELA (16px, §0.3): o `rounded-[18px]` de antes era um raio
          fora da escala. No escuro, o anel claro do nível 2 (§0.4). */}
      <div className="w-[min(400px,calc(100vw-32px))] rounded-janela border border-borda bg-superficie p-s8 shadow-nivel-2 dark:ring-1 dark:ring-white/[0.06]">
        <h2 className="mb-s4 font-display text-xl font-extrabold tracking-tight text-texto">
          Acessar o sistema
        </h2>

        {!isSupabaseConfigured && (
          <div className="mb-s4 flex items-start gap-s2 rounded-campo border border-aviso-borda bg-aviso-fundo px-s3 py-s2 text-corpo">
            <AlertTriangle className="mt-s0.5 h-[16px] w-[16px] shrink-0 text-aviso" aria-hidden />
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
        <form onSubmit={handleSubmit} className="space-y-s3">
          <Field label="E-mail" required>
            <Input
              type="email"
              autoComplete="email"
              // O FOCO JÁ NO E-MAIL: a tela só serve para isto, e quem abre a
              // plataforma começa a digitar sem clicar.
              autoFocus
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
              // O CAPS LOCK LIGADO é a causa mais comum de "senha errada" que
              // não é senha errada; o aviso aparece enquanto se digita.
              onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
              onKeyDown={(e) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)}
              onBlur={() => setCapsLock(false)}
              // SÓ COM O AVISO À VISTA: um `undefined` aqui apagaria a descrição
              // que o Field dá ao campo.
              {...(capsLock ? { 'aria-describedby': 'aviso-caps-lock' } : {})}
              required
            />
            {capsLock && (
              <p id="aviso-caps-lock" className="mt-s1 flex items-center gap-s1 text-sm text-aviso">
                <AlertTriangle className="h-[14px] w-[14px] shrink-0" aria-hidden />
                Caps Lock ligado.
              </p>
            )}
          </Field>

          {/* role="alert" (Novo, acessibilidade): o erro que aparece depois do
              Entrar é anunciado, em vez de surgir calado na tela. */}
          {error && (
            <p
              role="alert"
              className="flex items-center gap-s2 rounded-campo border border-perigo-borda bg-perigo-fundo px-s3 py-s2 text-corpo text-perigo"
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

        <p className="mt-s4 text-center text-xs text-texto-3">
          Cadastro de usuários pelo administrador.
        </p>
      </div>
    </div>
  )
}
