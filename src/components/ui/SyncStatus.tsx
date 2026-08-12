import { RefreshCw } from 'lucide-react'

// Indicador uniforme de sincronização em segundo plano: enquanto sincroniza,
// mostra spinner + rótulo; depois, o horário da última atualização (HH:MM).
// Sem sincronização em curso e sem updatedAt, não renderiza nada.
//
// TUDO EM MINÚSCULA, nos dois estados. O indicador nunca começa frase: ele vem
// logo depois de uma contagem ("27 publicações · atualizado às 14:27"), e os
// rótulos de "sincronizando" já eram minúsculos. Com "Atualizado" maiúsculo, a
// mesma linha trocava de caixa sozinha ao terminar de carregar.
export function SyncStatus({
  syncing,
  updatedAt,
  label,
  separador = false,
}: {
  syncing: boolean
  updatedAt?: number | string | null
  label?: string
  /**
   * Põe um "·" antes do texto, separando-o da contagem que vem à esquerda.
   *
   * Fica AQUI, e não na tela, porque o indicador pode não renderizar nada (sem
   * sincronização em curso e sem updatedAt): um ponto escrito na tela ficaria
   * pendurado sozinho depois da contagem. Quem sabe se há texto é o componente.
   */
  separador?: boolean
}) {
  const ponto = separador ? <span className="text-slate-300">·</span> : null

  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-brand-600">
        {ponto}
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> {label ?? 'sincronizando…'}
      </span>
    )
  }
  if (!updatedAt) return null
  const d = new Date(updatedAt)
  if (Number.isNaN(d.getTime())) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      {ponto}
      <span>
        atualizado às{' '}
        {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </span>
  )
}
