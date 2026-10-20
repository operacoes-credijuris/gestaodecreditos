// O CARD QUE SAIU DA ANÁLISE NÃO PEDE MAIS AUTOS — a regra pura.
//
// O PEDIDO DO DONO (20/10/2026). Muitas vezes a equipe baixa a íntegra à mão e
// move o card adiante antes de o Escavador ser chamado; a rotina seguia pedindo
// (R$ 1,34 por processo, dentro da cota diária) autos que ninguém ia ler.
//
// A REGRA:
//   - Card num funil OPERACIONAL (RPV, Precatório Interno ou Externo) que NÃO
//     está mais na coluna de entrada daquele funil: nenhum pedido NOVO. O que
//     ainda não foi pedido (NOVO, FILA, SEM_SALDO, REPETIR) — e a leitura
//     pendente do card (NOVO) — passa a INTERROMPIDO, sem chamar o Escavador.
//   - O que JÁ COMEÇOU termina: PEDINDO com posse viva, AGUARDANDO, ANEXANDO.
//     (A posse PEDINDO parada é retomada pela rotina; ela consulta o Escavador
//     de graça e adota o pedido que a volta morta chegou a fazer, mas não paga
//     outro: ver `podePagarPedido`.)
//   - Card que VOLTA à coluna de entrada: o INTERROMPIDO volta para a fila
//     (NOVO). A regra dos 30 dias continua valendo — o pedido consulta o
//     Escavador antes e reaproveita os autos trazidos há pouco.
//   - Card no funil comercial (fora dos operacionais), ou que a plataforma não
//     sabe onde está (fora do espelho, coluna de entrada não resolvida): segue
//     como sempre. Na dúvida, não se interrompe nada.
//
// SEM `Deno.` E SEM `npm:`: o vitest alcança este módulo direto.

import { FUNIL_RPV } from './autosParaOKommo.ts'
import { TRILHAS_PRECATORIO } from './trilhasDoPrecatorio.ts'

/** Os funis do Operacional: RPV, Precatório Interno e Externo. */
export const FUNIS_OPERACIONAIS: number[] = [FUNIL_RPV, ...TRILHAS_PRECATORIO.map((t) => t.pipelineId)]

/** Os estados de processo que ainda não chamaram o Escavador — e que a saída do card interrompe. */
export const ESTADOS_INTERROMPIVEIS = ['NOVO', 'FILA', 'SEM_SALDO', 'REPETIR'] as const

/** O estado novo: o card saiu da coluna de análise antes do pedido. */
export const INTERROMPIDO = 'INTERROMPIDO'

/** O rótulo do estado para quem lê (nota do card, tela). */
export const ROTULO_INTERROMPIDO = 'Interrompido — o card saiu da análise'

/** O `detalhe` gravado no processo (e na leitura do card) quando a saída interrompe. */
export const DETALHE_INTERROMPIDO =
  'O card saiu da coluna de análise antes do pedido ao Escavador; nenhum pedido novo enquanto ele estiver fora.'

/** O `detalhe` gravado quando o card volta e o processo volta para a fila. */
export const DETALHE_RETOMADO = 'O card voltou para a coluna de análise: o pedido voltou para a fila.'

/**
 *   na_entrada           o card está na coluna de entrada do funil operacional dele
 *   saiu_da_analise      está num funil operacional, mas fora da coluna de entrada
 *   fora_do_operacional  funil comercial, card fora do espelho, ou entrada não
 *                        resolvida — a rotina segue como sempre
 */
export type SituacaoDoCard = 'na_entrada' | 'saiu_da_analise' | 'fora_do_operacional'

/**
 * Onde o card está, para a regra da interrupção.
 *
 * A ENTRADA DO FUNIL TEM DE ESTAR RESOLVIDA: se o espelho das colunas
 * (`kommo_etapa`) não trouxe a entrada do Interno, por exemplo, TODO card do
 * Interno pareceria "fora da entrada" — e a rotina interromperia o funil
 * inteiro por uma leitura que falhou. Sem a entrada, não se sabe: segue como sempre.
 */
export function situacaoDoCard(
  lead: { pipeline_id: number | string | null; status_id: number | string | null } | null | undefined,
  entradas: { pipeline_id: number; status_id: number }[],
): SituacaoDoCard {
  if (!lead) return 'fora_do_operacional'
  const funil = Number(lead.pipeline_id)
  if (!FUNIS_OPERACIONAIS.includes(funil)) return 'fora_do_operacional'
  const doFunil = entradas.filter((e) => Number(e.pipeline_id) === funil)
  if (doFunil.length === 0) return 'fora_do_operacional'
  return doFunil.some((e) => Number(e.status_id) === Number(lead.status_id)) ? 'na_entrada' : 'saiu_da_analise'
}

/**
 * O próximo estado de um processo do card, pela situação do card; null = fica.
 *
 * PEDINDO, AGUARDANDO, ANEXANDO, CONCLUIDO e FALHOU nunca mudam aqui: o pedido
 * iniciado termina, e o que terminou fica.
 */
export function proximoEstadoDoProcesso(estado: string, situacao: SituacaoDoCard): string | null {
  if (situacao === 'saiu_da_analise' && (ESTADOS_INTERROMPIVEIS as readonly string[]).includes(estado)) return INTERROMPIDO
  if (situacao === 'na_entrada' && estado === INTERROMPIDO) return 'NOVO'
  return null
}

/** O próximo estado da LEITURA do card (`escavador_autos_card`); null = fica. Só a leitura pendente se interrompe. */
export function proximoEstadoDaLeitura(estado: string, situacao: SituacaoDoCard): string | null {
  if (situacao === 'saiu_da_analise' && estado === 'NOVO') return INTERROMPIDO
  if (situacao === 'na_entrada' && estado === INTERROMPIDO) return 'NOVO'
  return null
}

/**
 * Pode sair um pedido PAGO ao Escavador para este card? Não, se ele saiu da
 * análise. A consulta de status (de graça) e a adoção de um pedido já feito
 * continuam valendo — elas não gastam nada e não deixam pedido pago órfão.
 */
export function podePagarPedido(situacao: SituacaoDoCard | undefined): boolean {
  return situacao !== 'saiu_da_analise'
}
