import { Check, RefreshCw } from 'lucide-react'

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
  const ponto = separador ? <span className="text-borda-forte">·</span> : null

  // O `.sync-mini` da amostra: o texto no cinza de metadado e o ÍCONE VERDE nos
  // dois estados — girando enquanto sincroniza, e o ✓ depois. O verde diz "está
  // em dia" de relance; o texto continua discreto.
  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-texto-3">
        {ponto}
        <RefreshCw className="h-[14px] w-[14px] animate-spin text-sucesso-cheio" aria-hidden />{' '}
        {label ?? 'sincronizando…'}
      </span>
    )
  }
  if (!updatedAt) return null
  const d = new Date(updatedAt)
  if (Number.isNaN(d.getTime())) return null
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-texto-3">
      {ponto}
      <Check className="h-[14px] w-[14px] text-sucesso-cheio" aria-hidden />
      <span>
        atualizado às{' '}
        {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </span>
  )
}
