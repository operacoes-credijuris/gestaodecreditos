// MOVER PARA ONDE O CARD JÁ ESTÁ NÃO É MOVER (revisão de 03/10/2026).
//
// O DEFEITO. A `kommo-mover` mandava o PATCH sem perguntar onde o card estava.
// Dois cliques, duas abas, ou o botão de uma tela defasada repetiam o movimento:
// a nota "Movido de X para X" entrava no card, e as automações do Digital
// Pipeline podiam rodar outra vez — mensagem ao cedente, tarefa, e-mail. Nada
// disso se desfaz.
//
// O CUSTO DE PERGUNTAR. O Kommo limita a taxa de chamadas da conta, e cada
// movimento já gasta duas (o PATCH e a nota). Ler o card em TODO movimento seria
// a terceira, sempre. Por isso a leitura é só no caso suspeito: o espelho local
// (`kommo_leads.status_id`, que a função já lê para a nota) diz que o card está
// no destino. Aí uma leitura do Kommo confirma antes de responder "já estava" —
// o espelho pode estar defasado, e recusar um movimento que precisava acontecer
// seria pior do que repeti-lo.
//
// LEITURA QUE FALHA NÃO PARA O MOVIMENTO. Se o Kommo não respondeu à leitura, o
// movimento segue como sempre seguiu: é o comportamento de antes, e não pior.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, para o vitest o testar.

export type PassoDoMovimento = 'MOVER' | 'CONFERIR_NO_KOMMO' | 'JA_ESTA'

/** O que a leitura do card no Kommo disse (GET /leads/{id}). */
export interface LeituraDoKommo {
  statusId: number
  pipelineId?: number | null
}

/**
 * O próximo passo do movimento.
 *
 *   kommo === undefined  ainda não se leu o Kommo: decide pelo espelho
 *   kommo === null       a leitura foi tentada e falhou: move, como antes
 *   kommo = { statusId } a leitura respondeu: ela decide
 *
 * PELO status_id SÓ. O PATCH da `kommo-mover` manda só o status_id (o funil fica
 * o do card), então status igual quer dizer que o PATCH não mudaria nada — vale
 * também para as colunas 142/143, que se repetem em todo funil.
 */
export function passoDoMovimento(
  destino: number,
  espelho: number | null | undefined,
  kommo?: LeituraDoKommo | null,
): PassoDoMovimento {
  if (kommo === null) return 'MOVER'
  if (kommo !== undefined) return Number(kommo.statusId) === Number(destino) ? 'JA_ESTA' : 'MOVER'
  return espelho != null && Number(espelho) === Number(destino) ? 'CONFERIR_NO_KOMMO' : 'MOVER'
}

/**
 * A resposta do GET /leads/{id}, lida com cuidado: sem status_id numérico não há
 * leitura (null), e o movimento segue.
 */
export function lerLeituraDoKommo(corpo: unknown): LeituraDoKommo | null {
  const c = (corpo ?? {}) as { status_id?: unknown; pipeline_id?: unknown }
  const statusId = Number(c.status_id)
  if (!Number.isFinite(statusId) || statusId <= 0) return null
  const pipelineId = Number(c.pipeline_id)
  return { statusId, pipelineId: Number.isFinite(pipelineId) && pipelineId > 0 ? pipelineId : null }
}
