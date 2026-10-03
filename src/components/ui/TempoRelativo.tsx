import { useEffect, useState } from 'react'
import { formatarRelativo, formatDateTime } from '@/lib/format'

/** De quanto em quanto tempo o texto se refaz (ms): "há 1 min" vira "há 2 min". */
const INTERVALO_MS = 30_000

/**
 * A data relativa ("há 5 min", "ontem") que SE ATUALIZA sozinha, com a data e a
 * hora exatas na dica (e no `dateTime`, para o leitor de tela).
 *
 * A regra do texto é `formatarRelativo` (lib/format.ts). Sem data válida, não
 * desenha nada.
 */
export function TempoRelativo({
  valor,
  prefixo,
  className,
}: {
  valor: string | number | Date | null | undefined
  /** Antes do texto, na mesma frase: "atualizado" → "atualizado há 3 min". */
  prefixo?: string
  className?: string
}) {
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setAgora(new Date()), INTERVALO_MS)
    return () => window.clearInterval(t)
  }, [])
  const texto = formatarRelativo(valor, agora)
  if (!texto || valor === null || valor === undefined) return null
  const d =
    valor instanceof Date
      ? valor
      : new Date(typeof valor === 'string' && valor.length <= 10 ? `${valor}T00:00:00` : valor)
  const iso = Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  return (
    <time dateTime={iso} title={iso ? formatDateTime(iso) : undefined} className={className}>
      {prefixo ? `${prefixo} ${texto}` : texto}
    </time>
  )
}
