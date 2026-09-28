// A FORMATAÇÃO DE DINHEIRO E DE PERCENTUAL, em pt-BR.
//
// MORA AQUI, e não em src/lib/format.ts, desde 28/09/2026: a nota do Kommo que
// a análise escreve passou a ser montada também no SERVIDOR (quando o Claude
// entrega a planilha pelo conector), e o que o comercial lê no card tem de ser
// escrito igual pelos dois lados. src/lib/format.ts reexporta estas duas.
//
// MÓDULO PURO — sem `Deno.` e sem `npm:`.

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

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
