// _shared/dataDoAdvbox.ts
// A DATA DE UM CAMPO DO ADVBOX, em AAAA-MM-DD (coluna `date` do Postgres).
//
// Defensivo: o campo chega ora ISO, ora só a data, ora em dd/mm/aaaa, ora no
// "2026-02-15 10:00:00" do /history (sem fuso — hora de parede, tratada como
// está). O DEFEITO (auditoria de bugs, 09/10/2026): o "Z" era acrescentado a
// TODA string com mais de 10 caracteres, e a que já trazia fuso — o
// "2026-02-15T10:00:00.000000Z" do Laravel, o "…-03:00" — virava "…ZZ" ou
// "…-03:00Z": data inválida, e a tarefa ficava sem data e sem prazo.
//
// Sem `npm:` e sem `Deno.`, para o vitest.

const COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i

export function dataDoAdvbox(v: unknown): string | null {
  if (v == null || v === '') return null
  const s = String(v).trim()
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  if (s.length <= 10) {
    const d = new Date(`${s}T00:00:00Z`)
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const iso = s.replace(' ', 'T')
  if (COM_FUSO.test(iso)) {
    // Instante com fuso: o dia é o de Brasília, que é o da agenda do escritório.
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  }
  // Sem fuso: hora de parede; o dia é o que está escrito.
  const d = new Date(`${iso}Z`)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
