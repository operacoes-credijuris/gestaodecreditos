// _shared/dataDeBrasilia.ts
// O "HOJE" DE NEGÓCIO, NO FUSO DE BRASÍLIA (auditoria de bugs, 09/10/2026).
//
// `new Date().toISOString().slice(0, 10)` é o dia em UTC. Das 21h às 24h de
// Brasília o UTC já virou o dia, e o "hoje" das funções saía AMANHÃ: a fase
// reclassificada às 22h entrava com a data do dia seguinte; a certidão obtida
// à noite nascia emitida amanhã e vencia um dia depois do certo; a regra de
// certidão que começa a valer amanhã já valia hoje à noite. A data que a pessoa
// lê e contra a qual um prazo vence é a de Brasília — é a que se usa aqui.
//
// Sem `Deno.` e sem `npm:`, para o vitest.

const FUSO = 'America/Sao_Paulo'

/** O dia (AAAA-MM-DD) de um instante, no fuso de Brasília. */
export function diaEmBrasilia(instante: Date | number): string {
  const d = typeof instante === 'number' ? new Date(instante) : instante
  // 'sv-SE' formata como AAAA-MM-DD.
  return d.toLocaleDateString('sv-SE', { timeZone: FUSO })
}

/** Hoje, AAAA-MM-DD, em Brasília. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return diaEmBrasilia(agora)
}

/** Uma data AAAA-MM-DD somada de `dias` corridos (aritmética de calendário, sem fuso). */
export function somarDiasAoDia(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "09 de outubro de 2026", de uma data AAAA-MM-DD. */
export function dataPorExtenso(dia: string): string {
  const [a, m, d] = dia.split('-')
  return `${d} de ${MESES[Number(m) - 1]} de ${a}`
}

/** "09/10/2026", de uma data AAAA-MM-DD. */
export function diaMesAno(dia: string): string {
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a}`
}
