// fase-processual/regras.ts
// As regras puras da fase processual (12/11/2026): o modelo aceito e o
// roteamento ATV-02/ATV-03 pelo prazo. Sem `Deno.` e sem `npm:`, para a Edge
// Function e os testes do Vitest importarem o mesmo código.

/**
 * OS MODELOS QUE A FASE PROCESSUAL ACEITA (12/11/2026). O `modelo` do corpo vinha
 * de qualquer usuário ativo e ia direto para a API: um id errado virava 400 em
 * todos os créditos da carteira, e o Opus 5.5 recusa a ferramenta forçada que a
 * classificação usa. Fica o padrão (Haiku) e o Sonnet 5, que já aceitavam.
 */
export const MODELOS_DA_FASE: readonly string[] = ['claude-haiku-4-5-20251001', 'claude-sonnet-5']

/** O modelo que a classificação usa de fato: fora da lista, ou vazio, vale o padrão. */
export function modeloDaFase(pedido: unknown, padrao: string): string {
  const id = typeof pedido === 'string' ? pedido.trim() : ''
  return MODELOS_DA_FASE.includes(id) ? id : padrao
}

/**
 * O PRAZO DE PAGAMENTO JÁ VENCEU? (12/11/2026) Datas em AAAA-MM-DD.
 *
 * ATV-03 (sequestro) cabe em dois casos: o prazo venceu ANTES da homologação da
 * cessão, ou venceu DEPOIS dela e já passou hoje — o mesmo critério da transição
 * por calendário (`data_limite_pagamento < hoje`). Só o primeiro era olhado, e o
 * crédito que o calendário tinha posto em ATV-03 voltava a ATV-02 a cada
 * andamento novo.
 */
export function venceuOPrazo(dataLimite: string, dataHomologacao: string, hoje: string): boolean {
  return dataLimite < dataHomologacao || dataLimite < hoje
}
