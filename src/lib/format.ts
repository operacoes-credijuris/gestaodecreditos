// Helpers de formatação e normalização de strings (pt-BR).

/** Converte string vazia/só espaços em null (mantém o banco sem ""). */
export const vazioNull = (s?: string | null): string | null =>
  s?.trim() ? s.trim() : null

/** Reduz um número de processo/telefone à forma só-dígitos. */
export function onlyDigits(v?: string | null): string {
  return (v ?? '').replace(/\D/g, '')
}

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

/**
 * Campo de dinheiro: os dígitos entram pela direita como centavos, então
 * digitar "1234" vira 12,34 e não há como montar um valor inválido. Devolve
 * null quando não sobrou dígito nenhum (campo em branco = não informado).
 */
export function parseBRLInput(v: string): number | null {
  const d = onlyDigits(v)
  return d ? Number(d) / 100 : null
}

/** Valor para dentro do campo de dinheiro: 1234.5 -> "1.234,50" (sem "R$"). */
export function formatBRLInput(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return ''
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
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

/**
 * Hoje em ISO local (YYYY-MM-DD). O locale sv-SE já entrega nesse formato, e
 * usar a data LOCAL (não UTC) importa: perto da meia-noite o toISOString()
 * viraria o dia antes da hora e acenderia semáforo errado.
 */
export function hojeISO(): string {
  return new Date().toLocaleDateString('sv-SE')
}

/**
 * Data de "daqui a N meses" a partir de um ISO local (YYYY-MM-DD). Meses de
 * CALENDÁRIO, com o dia preso ao último do mês quando ele não existe
 * (31/01 -> 28/02) — somar 30 dias por mês erraria em boa parte do ano.
 */
export function mesesDepois(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const seq = m + meses
  const ano = y + Math.floor((seq - 1) / 12)
  const mes = ((seq - 1) % 12) + 1
  // Dia 0 do mês seguinte = último dia deste mês.
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const dia = Math.min(d, ultimoDia)
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Formata número de processo no padrão CNJ NNNNNNN-DD.AAAA.J.TR.OOOO. */
export function formatCNJ(value: string | null | undefined): string {
  if (!value) return '—'
  const digits = onlyDigits(value)
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
