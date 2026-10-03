// O SERVIÇO DA NOTA DE AUDITORIA que a `kommo-mover` grava no card ao movê-lo —
// o selo que o Kommo mostra em cima do texto ("Operacional", "Comercial").
//
// É O SERVIDOR QUE DECIDE, PELO DESTINO, e não a tela. O desfecho da Negociação
// (Fechados, Não fechado(s), Sem resposta) é ato do COMERCIAL: quem fala com o
// cedente é ele, e a nota que diz "Movido de Negociação para Fechados" com o selo
// "Operacional" atribuiria ao operacional uma decisão que não foi dele. Se a tela
// mandasse o serviço no corpo da requisição, qualquer chamada poderia carimbar
// "Comercial" em qualquer movimento.
//
// SAIU DA `kommo-mover` PARA SER TESTADA: o `index.ts` dela chama `Deno.serve`
// ao ser importado, e o vitest não o carrega. MÓDULO PURO — sem `npm:` e sem
// `Deno.` —, como `trilhasDoPrecatorio.ts` e `colunasRpv.ts`.

import { negociacaoDoDestino } from './desfechoDaNegociacao.ts'

export type ServicoDaNota = 'Operacional' | 'Comercial'

/**
 * O serviço da nota de um movimento para esta coluna.
 *
 * "Comercial" para os três destinos do desfecho da Negociação, nos três funis;
 * "Operacional" em todo o resto, como sempre foi.
 *
 * A MESMA PERGUNTA DA CONFERÊNCIA DE ORIGEM (`negociacaoDoDestino`): no RPV pelo
 * id só (o status_id é único na conta); no Precatório pelo id e pelo nome de
 * reserva, a regra que autorizou o movimento (`destinoPermitido`).
 */
export function servicoDaNota(
  pipelineId: number | null | undefined,
  statusId: number,
  nome: string | null | undefined,
): ServicoDaNota {
  return negociacaoDoDestino(pipelineId, statusId, nome) ? 'Comercial' : 'Operacional'
}
