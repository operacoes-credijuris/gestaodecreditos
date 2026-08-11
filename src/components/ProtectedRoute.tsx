import { useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2, ShieldOff } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-100">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
    </div>
  )
}

/**
 * Acesso desligado pelo administrador. As policies do banco já barram a leitura
 * (migração 0025), então sem esta tela o usuário veria a plataforma inteira
 * vazia e acharia que quebrou. Dizer o motivo é o que evita o chamado.
 */
function AcessoDesativado() {
  const { user, signOut } = useAuth()
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-50">
          <ShieldOff className="h-5 w-5 text-red-600" />
        </div>
        <h1 className="mt-3 text-lg font-semibold text-slate-800">
          Acesso desativado
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          A conta {user?.email} está desativada. Procure o administrador da
          plataforma para reativá-la.
        </p>
        <button
          onClick={async () => {
            const { error } = await signOut()
            setAviso(error)
          }}
          className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Sair
        </button>
        {aviso && <p className="mt-3 text-xs text-amber-700">{aviso}</p>}
      </div>
    </div>
  )
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, acessoDesativado } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  // `state` guarda a rota pedida: sem isto, quem abre um link direto de
  // publicação sem sessão autenticava e caía no dashboard, com o link já
  // substituído no histórico e sem Voltar que o traga.
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  if (acessoDesativado) return <AcessoDesativado />
  return <>{children}</>
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const { session, loading, isAdmin, acessoDesativado } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  // Desativado antes de admin: quem foi desligado não deve ver Configurações
  // nem ser mandado ao dashboard sem explicação.
  if (acessoDesativado) return <AcessoDesativado />
  if (!isAdmin) return <Navigate to="/estrategica" replace />
  return <>{children}</>
}
