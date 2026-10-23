// escavador-autos-rotina/concorrencia.ts — as regras que guardam a rotina dela
// mesma (auditoria de 23/10/2026).
//
// O CRON, O SYNC E O AVISO DO ESCAVADOR acordam a rotina, às vezes no mesmo
// minuto: duas voltas leem as mesmas linhas, e quem decide é quem grava
// primeiro. Aqui ficam as decisões puras que o `index.ts` usa nesses pontos —
// a verificação que é deste pedido, a vaga na cota paga do dia, o relógio da
// conferência e o download do Kommo que sumiu de verdade.
//
// SEM `Deno.` E SEM `npm:`: o vitest alcança este módulo direto.

import { SEM_RESPOSTA } from '../_shared/falhasDosAutos.ts'

/**
 * Abaixo disto do orçamento da volta, não se começa outra conferência de
 * pedido. Cada uma leva até 30 s (a consulta de status) mais o banco; com
 * 15 s de folga sobre os 100 s do orçamento, a última termina bem antes do
 * teto real de ~150 s da invocação.
 */
export const FOLGA_PARA_CONFERIR_MS = 15_000

/**
 * HÁ TEMPO PARA OUTRA CONFERÊNCIA? Sem esta pergunta, uma fila de pedidos em
 * AGUARDANDO (cada consulta até 30 s) passava do teto da invocação, a função
 * morria no meio e o resto da volta — pedir, a nota do card — não rodava. O
 * que não couber fica para a próxima volta do cron.
 */
export function temTempoParaConferir(restaMs: number, folgaMs = FOLGA_PARA_CONFERIR_MS): boolean {
  return restaMs >= folgaMs
}

/** O pedaço da última verificação do Escavador que a rotina confere. */
export interface VerificacaoDoEscavador {
  id?: unknown
  criado_em?: unknown
  opcoes?: { autos?: unknown } | null
}

/**
 * A ÚLTIMA VERIFICAÇÃO DO PROCESSO É A DESTE PEDIDO?
 *
 * PELO ID, QUANDO HÁ ID (23/10/2026). Antes, qualquer verificação mais nova que
 * a linha passava como "do pedido": uma consulta de documentos públicos feita
 * à mão, ou o pedido de outro cliente da conta, concluía o processo como se
 * fossem os autos dele — ANEXANDO com a lista errada, ou FALHOU pelo erro de
 * outro. O status-atualizacao devolve o mesmo `id` que o solicitar-atualizacao
 * deu ao pedido (`pedido_id`), e é por ele que se casa.
 *
 * A linha antiga sem `pedido_id` ainda casa pela data, mas só com um pedido de
 * AUTOS: sem isso ela nunca sairia de AGUARDANDO (as 72 horas contam do pedido,
 * e sem pedido não há de onde contar).
 */
export function verificacaoDoPedido(
  v: VerificacaoDoEscavador | null | undefined,
  pedidoId: number | string | null | undefined,
  criadoEmDaLinha: string,
): boolean {
  if (!v) return false
  const id = Number(v.id)
  const meu = Number(pedidoId)
  if (Number.isFinite(meu) && meu > 0) return Number.isFinite(id) && id === meu
  const quando = Date.parse(String(v.criado_em ?? ''))
  const linha = Date.parse(criadoEmDaLinha)
  return v.opcoes?.autos === true && Number.isFinite(quando) && Number.isFinite(linha) && quando >= linha
}

/** O começo do dia de hoje no fuso de Brasília (UTC-3, sem horário de verão desde 2019), em ISO. */
export function inicioDoDiaEmBrasilia(agora: Date): string {
  const hoje = agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  return `${hoje}T03:00:00Z`
}

/**
 * A RESERVA ESTÁ DENTRO DA COTA? `posicao` é quantas reservas do dia existem até
 * a minha, inclusive (as de `criado_em` menor ou igual ao dela). A primeira
 * reserva é a posição 1; a 40ª ainda paga, a 41ª não.
 *
 * Duas voltas que reservam juntas nunca passam as duas do teto: a mais nova
 * conta a mais velha, e a mais velha não conta a mais nova. No empate exato
 * de horário as duas se contam — e as duas recuam, o que só adia um pedido.
 */
export function reservaCabeNaCota(posicao: number, limite: number): boolean {
  return Number.isFinite(posicao) && posicao >= 1 && posicao <= limite
}

/**
 * O POST PAGO PODE TER SIDO COBRADO? Então a reserva fica (o dinheiro pode ter
 * saído e a cota tem de contar). Sem resposta (status 0), com o cabeçalho de
 * crédito usado, ou aceito: pode. Recusa afirmada (402, 4xx) sem crédito usado:
 * não, e a vaga volta para a cota.
 */
export function cobrancaPossivel(status: number, centavos: number): boolean {
  return status === SEM_RESPOSTA || centavos > 0 || (status >= 200 && status < 300)
}

/**
 * O ANEXO DO CARD SUMIU DE VERDADE? Só o 404 diz isso. Qualquer outra falha
 * (401, 429, 5xx, tempo esgotado) é do caminho, e a leitura do card tem de ser
 * refeita — senão o card fica LIDO sem aquele PDF e nunca mais é relido.
 */
export function downloadSumiu(status: number): boolean {
  return status === 404
}
