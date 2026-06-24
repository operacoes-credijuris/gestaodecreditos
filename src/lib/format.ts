// Helpers de formatação (pt-BR).

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('pt-BR')
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR')
}

/** Formata número de processo no padrão CNJ NNNNNNN-DD.AAAA.J.TR.OOOO. */
export function formatCNJ(value: string | null | undefined): string {
  if (!value) return '—'
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 20) return value
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(
    9,
    13,
  )}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16, 20)}`
}

// Partículas que permanecem em minúsculo no meio do nome.
const PARTICULAS_NOME = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la', 'van', 'von',
])

/**
 * Converte um nome em CAIXA ALTA (vindo do ADVBOX) para "Primeira Letra
 * Maiúscula", mantendo partículas em minúsculo (ex.: "ERCÍLIO DA COSTA" ->
 * "Ercílio da Costa").
 */
export function formatNome(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) =>
      i > 0 && PARTICULAS_NOME.has(w)
        ? w
        : w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1),
    )
    .join(' ')
}

/**
 * "Sentence case": tudo minúsculo, só a primeira letra maiúscula
 * (ex.: "ENTRAR EM CONTATO" -> "Entrar em contato").
 */
export function sentenceCase(value: string | null | undefined): string {
  if (!value) return ''
  const s = value.toLocaleLowerCase('pt-BR')
  return s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1)
}
