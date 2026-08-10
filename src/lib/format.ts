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

/**
 * Campo de percentual com DUAS CASAS OBRIGATÓRIAS. Mesma mecânica do campo de
 * dinheiro, e de propósito a mesma implementação: os dígitos entram pela
 * direita, então digitar "1550" vira 15,50 e não existe momento em que o campo
 * fique sem as duas casas nem como montar um valor inválido. Duas cópias da
 * mesma regra divergiriam com o tempo.
 */
export const parsePercentInput = parseBRLInput
export const formatPercentInput = formatBRLInput

/**
 * Percentual com DUAS casas sempre: "10,00%" e não "10%". Casas fixas alinham a
 * coluna e evitam que 81,4 e 81,40 pareçam números de precisão diferente.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

/** Data e hora local: "10/08/2026 às 16:21". Para carimbo de geração. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
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
 * Dias corridos de `inicio` até `fim`, ambos ISO (YYYY-MM-DD). null quando a
 * data inicial não existe ou está malformada.
 *
 * A conta é feita em UTC de propósito: subtrair Dates locais erra em um dia
 * sempre que houver mudança de fuso no intervalo, e a diferença apareceria como
 * "364 dias" num crédito comprado há exatamente um ano.
 */
export function diasEntre(
  inicio: string | null | undefined,
  fim: string,
): number | null {
  const a = (inicio ?? '').slice(0, 10)
  const b = (fim ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

/**
 * Meses de `inicio` até `fim`, ambos ISO (YYYY-MM-DD), com fração no mês
 * incompleto. null quando alguma data falta ou está malformada.
 *
 * Meses de CALENDÁRIO, não dias/30: de 01/01 a 01/07 tem de dar exatamente 6, e
 * é assim que alguém confere a conta na mão. A sobra de dias entra como fração
 * do mês corrente (01/01 a 15/07 -> 6 + 14/31).
 *
 * Pode devolver negativo quando `fim` é anterior a `inicio`; quem usa decide o
 * que fazer com isso.
 */
export function mesesEntre(
  inicio: string | null | undefined,
  fim: string | null | undefined,
): number | null {
  const a = (inicio ?? '').slice(0, 10)
  const b = (fim ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  const inteiros = (y2 - y1) * 12 + (m2 - m1)
  if (d2 === d1) return inteiros
  // Fração do mês em curso, medida no mês onde a sobra cai.
  const anterior = d2 < d1 ? inteiros - 1 : inteiros
  const refMes = m2 - 1 + (d2 < d1 ? -1 : 0)
  const diasNoMes = new Date(y2, refMes + 1, 0).getDate()
  const sobra = d2 < d1 ? diasNoMes - d1 + d2 : d2 - d1
  return anterior + sobra / diasNoMes
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
