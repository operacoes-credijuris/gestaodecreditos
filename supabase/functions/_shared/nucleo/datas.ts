// NÚCLEO COMPARTILHADO — cálculo de datas.
//
// Este arquivo é a fonte única para as duas metades do sistema: o frontend
// (Vite) importa via src/lib/format.ts, que reexporta daqui, e as Edge
// Functions (Deno) importam direto. Antes desta separação cada lado tinha a
// sua cópia, e elas divergiam.
//
// Não importe nada de src/ aqui: o Deno não enxerga aquele lado.

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
