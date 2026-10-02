// O DESFECHO DA NEGOCIAÇÃO — Fechados, Não fechado(s), Sem resposta — SÓ SAI DA
// NEGOCIAÇÃO DO MESMO FUNIL (etapa 10a do redesenho, 02/10/2026).
//
// POR QUE O SERVIDOR CONFERE A ORIGEM. A permissão da `kommo-mover` sempre foi só
// pelo destino. Para os destinos do operacional isso basta, mas estes três são o
// fim da conversa do comercial com o cedente: mover para "Fechados" um card que
// ainda está na Análise dispararia as automações de negócio fechado no Kommo, e
// isso não se desfaz. A pergunta "o card está na Negociação?" responde pelo
// espelho (`kommo_leads.status_id`); sem o card no espelho, não há como saber, e
// a resposta é recusar.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, para o vitest o testar: o `index.ts`
// da `kommo-mover` chama `Deno.serve` ao ser importado.

import { DESTINOS_DA_NEGOCIACAO_RPV, NEGOCIACAO_RPV } from './colunasRpv.ts'
import { destinosDaNegociacao, trilhaDoPipeline, type RefColuna } from './trilhasDoPrecatorio.ts'

const normalizarNome = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

/** A Negociação de onde um destino tem de partir, com o funil dela. */
export interface NegociacaoExigida {
  /** O funil da Negociação — null no RPV, que se liga só pelo id. */
  pipelineId: number | null
  coluna: RefColuna
}

/**
 * O destino é um dos três desfechos da Negociação? Se for, devolve a Negociação
 * de onde ele tem de partir; se não, null — e o movimento segue a regra de
 * sempre, sem conferência de origem.
 *
 * NO RPV PELO ID SÓ (o status_id é único na conta). NO PRECATÓRIO pelo id e pelo
 * nome de reserva do destino, a mesma regra de `destinoPermitido`: a coluna
 * recriada com outro id, e aceita pelo nome, continua exigindo a Negociação.
 */
export function negociacaoDoDestino(
  pipelineId: number | null | undefined,
  statusId: number,
  nome: string | null | undefined,
): NegociacaoExigida | null {
  if (DESTINOS_DA_NEGOCIACAO_RPV.has(statusId)) {
    return { pipelineId: null, coluna: { colunaKommo: 'Negociação', statusId: NEGOCIACAO_RPV.coluna } }
  }
  if (!pipelineId) return null
  const trilha = trilhaDoPipeline(pipelineId)
  if (!trilha?.negociacao) return null
  const destinos = destinosDaNegociacao(trilha)
  const alvo = normalizarNome(nome)
  const eh =
    destinos.some((d) => d.statusId === statusId) ||
    (!!alvo && destinos.some((d) => normalizarNome(d.colunaKommo) === alvo))
  return eh ? { pipelineId: trilha.pipelineId, coluna: trilha.negociacao.coluna } : null
}

/** Onde o card está, segundo o espelho local. */
export interface OrigemDoCard {
  statusId: number
  pipelineId?: number | null
  /** O nome da coluna de origem no `kommo_etapa`, quando se tem. */
  nome?: string | null
}

/**
 * A RECUSA DA ORIGEM: null se o movimento pode seguir, ou a mensagem de erro.
 *
 * Só olha os três destinos da Negociação; qualquer outro destino devolve null.
 * Para eles, o card tem de estar na Negociação do mesmo funil:
 *   - pelo id da coluna (único na conta, então o funil vem junto);
 *   - ou, no Precatório, pelo NOME de reserva da Negociação, desde que no mesmo
 *     funil — a Negociação apagada e recriada no Kommo ganha id novo.
 * Card que o espelho não tem: recusa, com o caminho para resolver.
 */
export function recusaDaOrigem(
  destino: { pipelineId: number | null | undefined; statusId: number; nome: string | null | undefined },
  origem: OrigemDoCard | null,
): string | null {
  const exigida = negociacaoDoDestino(destino.pipelineId, destino.statusId, destino.nome)
  if (!exigida) return null
  const para = String(destino.nome ?? '').trim() || 'esta coluna'
  if (!origem || !origem.statusId) {
    return (
      `Só se move para "${para}" a partir da Negociação, e o card não está no espelho local ` +
      'para conferir em que coluna ele está. Sincronize o Kommo e tente de novo.'
    )
  }
  if (exigida.coluna.statusId && Number(origem.statusId) === exigida.coluna.statusId) return null
  const mesmoFunil = exigida.pipelineId !== null && Number(origem.pipelineId) === exigida.pipelineId
  if (mesmoFunil && normalizarNome(origem.nome) && normalizarNome(origem.nome) === normalizarNome(exigida.coluna.colunaKommo)) {
    return null
  }
  const deOnde = String(origem.nome ?? '').trim()
  return (
    `Só se move para "${para}" a partir da Negociação` +
    (deOnde ? `, e o card está em "${deOnde}".` : ', e o card está em outra coluna.')
  )
}
