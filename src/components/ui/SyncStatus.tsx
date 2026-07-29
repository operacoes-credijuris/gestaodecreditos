import { RefreshCw } from 'lucide-react'

// Indicador uniforme de sincronização em segundo plano: enquanto sincroniza,
// mostra spinner + rótulo; depois, o horário da última atualização (HH:MM).
// Sem sincronização em curso e sem updatedAt, não renderiza nada.
export function SyncStatus({
  syncing,
  updatedAt,
  label,
}: {
  syncing: boolean
  updatedAt?: number | string | null
  label?: string
}) {
  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-brand-600">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> {label ?? 'sincronizando…'}
      </span>
    )
  }
  if (!updatedAt) return null
  const d = new Date(updatedAt)
  if (Number.isNaN(d.getTime())) return null
  return (
    <span className="text-xs text-slate-500">
      Atualizado às{' '}
      {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}
