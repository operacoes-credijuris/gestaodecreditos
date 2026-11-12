import { useState, type FormEvent } from 'react'
import { INICIO } from '@/components/layout/navigation'
import { Navigate, useLocation } from 'react-router-dom'
import { AlertTriangle, Loader2, LogIn } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Field, Input } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import marca from '@/assets/marca-credijuris.png'
import { FaixaBeta } from '@/components/layout/FaixaBeta'
import { destinoDepoisDoEntrar } from '@/lib/guardaDaRota'
import { cn } from '@/lib/cn'

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
    // A ENTRADA DA V3 (repaginação, 12/11/2026): duas metades. À esquerda, o
    // painel da marca no marinho do menu, com o halo champanhe e o nome na
    // serifa — a mesma assinatura do menu lateral, para quem entra já reconhecer
    // a casa. À direita, sobre o papel, o cartão do formulário. No celular, o
    // painel vira uma faixa curta em cima.
    //
    // A LOGOMARCA VAI NA PLACA BRANCA, como no menu: o azul dela não sobrevive
    // legível sobre o marinho, e a placa é a forma fiel de mostrá-la ali.
    <div className="grid min-h-screen grid-rows-[auto_1fr] bg-papel lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-1">
      <FaixaBeta fixa />
      <aside
        className={cn(
          'relative isolate flex flex-col overflow-hidden bg-nav px-s5 py-s6 lg:justify-center lg:px-s16 lg:py-s16',
          // O marinho com o degradê vertical do menu e o halo champanhe no
          // canto de cima — e um segundo, mais fraco, embaixo, onde a linha
          // desenhada termina.
          'bg-[radial-gradient(110%_60%_at_0%_0%,rgb(var(--ouro)/0.1),transparent_60%),radial-gradient(70%_50%_at_100%_100%,rgb(var(--ouro)/0.07),transparent_70%),linear-gradient(180deg,rgb(var(--nav-fundo-2)),rgb(var(--nav-fundo))_55%)]',
          // O FIO CHAMPANHE que separa o painel do papel (embaixo, no celular).
          'after:absolute after:bg-[linear-gradient(180deg,transparent,rgb(var(--ouro)/0.45),transparent)] max-lg:after:inset-x-0 max-lg:after:bottom-0 max-lg:after:h-px max-lg:after:bg-[linear-gradient(90deg,transparent,rgb(var(--ouro)/0.45),transparent)] lg:after:inset-y-0 lg:after:right-0 lg:after:w-px',
        )}
      >
        {/* No computador: a placa no alto, o nome no meio do painel e a legenda
            embaixo. No celular: a placa e o nome numa linha só. */}
        <div className="flex items-center gap-s3 lg:flex-col lg:items-start lg:gap-s10">
          {/* BRANCO FIXO, como no menu: a placa continua branca no escuro. */}
          <div className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-campo bg-white p-[6px] ring-1 ring-black/10">
            <img src={marca} alt="" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <h1 className="font-titulo text-2xl font-semibold leading-[26px] tracking-[-0.005em] text-white lg:text-4xl lg:leading-[36px]">
              Credijuris
            </h1>
            {/* O FIO CHAMPANHE sob o nome, como sob a marca no menu. */}
            <span aria-hidden className="mt-s4 hidden h-px w-s12 bg-ouro/70 lg:block" />
            {/* Em sentence case, como no menu ("Gestão de créditos"), revisão UX de 09/10/2026. */}
            <p className="mt-[2px] text-sm text-nav-texto lg:mt-s4 lg:text-lg">Sistema de gestão de créditos</p>
          </div>
        </div>

        {/* A LINHA QUE SOBE: um traço fino, champanhe, como a curva de um
            gráfico de carteira ao fundo do painel. Só enfeite, e só no
            computador — no celular a faixa é curta demais para ela. */}
        <svg
          aria-hidden
          viewBox="0 0 480 220"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 hidden h-[44%] w-full text-ouro lg:block"
        >
          <path
            d="M0 196 C 48 190, 72 176, 112 178 S 176 150, 214 146 S 268 120, 300 112 S 360 70, 398 64 S 452 30, 480 22"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.38"
            strokeWidth="1.25"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M0 210 C 60 206, 96 198, 140 196 S 210 182, 250 176 S 320 156, 360 146 S 430 122, 480 112"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.16"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <p className="absolute bottom-s12 left-s16 hidden text-xs font-medium uppercase tracking-[0.1em] text-nav-apagado lg:block">
          Créditos judiciais
        </p>
      </aside>

      <main className="flex items-center justify-center px-s4 py-s10 lg:py-s12">
        {/* O RAIO DE JANELA (§0.3). v3: a sombra do nível 2 já traz o fio de luz
            no escuro — sem o anel claro feito à mão. Chega subindo 4px. */}
        <div className="animate-page w-[min(400px,calc(100vw-32px))] rounded-janela border border-borda bg-superficie p-s8 shadow-nivel-2 max-sm:p-s6">
          <h2 className="mb-s5 font-display text-2xl font-semibold tracking-[-0.01em] text-texto">
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

          <p className="mt-s5 border-t border-borda pt-s4 text-center text-xs text-texto-3">
            Cadastro de usuários pelo administrador.
          </p>
        </div>
      </main>
    </div>
  )
}
