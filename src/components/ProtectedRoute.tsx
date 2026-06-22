import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-100">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
    </div>
  )
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const { session, loading, isAdmin } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/estrategica" replace />
  return <>{children}</>
}
