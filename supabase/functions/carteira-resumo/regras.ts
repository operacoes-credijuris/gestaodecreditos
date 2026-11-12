// As regras puras da carteira-resumo: o modelo aceito e o fim de resposta que
// não pode virar cache. Puro de propósito (sem `npm:`), para a Edge Function e
// os testes do Vitest importarem o mesmo código.
import { OPUS_VIGENTE } from '../_shared/modeloDoAssistente.ts'

// Haiku dá conta desta tarefa: o texto é curto, o formato é fixo e o dossiê
// chega pronto e em ordem cronológica, então sobra pouca decisão para o modelo.
export const MODELO_DA_CARTEIRA = 'claude-haiku-4-5-20251001'

/**
 * OS MODELOS QUE A CARTEIRA ACEITA (23/10/2026): o `modelo` do corpo vinha de
 * qualquer usuário e ia direto para a API — um id qualquer virava 400 em todo
 * o lote, e um modelo caro pago por varredura inteira (a cadeia o repassa).
 * Agora só os modelos que a plataforma já usa: Haiku, Sonnet e o Opus vigente.
 *
 * LISTA PRÓPRIA (12/11/2026): era a do seletor do assistente, que passou para a
 * geração 5.5 no Sonnet e no Haiku. A carteira força a ferramenta e não liga o
 * raciocínio — trocar o modelo dela é decisão à parte, com teste à parte, e
 * não efeito colateral da troca do assistente. Os mesmos ids de antes.
 */
export const MODELOS_DA_CARTEIRA: readonly string[] = [MODELO_DA_CARTEIRA, 'claude-sonnet-5', OPUS_VIGENTE]

/**
 * O modelo que a carteira usa de fato. O pedido fora da lista, ou vazio, vale o
 * padrão; um Opus antigo vira o vigente, como no assistente.
 */
export function resolverModeloDaCarteira(pedido: unknown): string {
  const bruto = typeof pedido === 'string' ? pedido.trim() : ''
  const id = bruto.startsWith('claude-opus-') ? OPUS_VIGENTE : bruto
  return MODELOS_DA_CARTEIRA.includes(id) ? id : MODELO_DA_CARTEIRA
}

/**
 * A RESPOSTA CORTADA NO TETO DE TOKENS NÃO É RESUMO (23/10/2026). Com a
 * ferramenta forçada, o `max_tokens` corta o `input` dela no meio: um campo pela
 * metade, ou vazio. Isso ia para a carteira do investidor com o `fonte_hash`,
 * e o crédito era pulado nas varreduras seguintes. Devolve a mensagem da falha,
 * ou null quando a resposta pode ser lida.
 */
export function falhaDaResposta(stopReason: string | null | undefined): string | null {
  if (stopReason === 'max_tokens') {
    return 'A resposta do modelo passou do tamanho máximo e saiu cortada; o resumo não foi gravado.'
  }
  if (stopReason === 'refusal') return 'O modelo recusou escrever o resumo (filtro de segurança da Anthropic).'
  return null
}
