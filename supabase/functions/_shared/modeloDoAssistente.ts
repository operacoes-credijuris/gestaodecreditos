// Os modelos que a pessoa escolhe no seletor do assistente — a MESMA lista na
// tela (src/components/Assistente.tsx) e no servidor (assistente/index.ts).
// Puro: a tela, a Edge Function e os testes importam daqui.

/**
 * O OPUS DA PLATAFORMA. É o 5.5 desde 05/10/2026, por pedido do dono: "tudo o
 * que for Opus 5 ou versão anterior, mude para 5.5".
 */
export const OPUS_VIGENTE = 'claude-opus-5-5'

/** O seletor do assistente, na ordem em que aparece. */
export const MODELOS_DO_ASSISTENTE = [
  { key: 'claude-haiku-4-5-20251001', label: 'Haiku' },
  { key: 'claude-sonnet-5', label: 'Sonnet' },
  { key: OPUS_VIGENTE, label: 'Opus' },
] as const

export const MODELO_PADRAO_DO_ASSISTENTE = 'claude-sonnet-5'

/**
 * O id que vale HOJE para um id guardado antes.
 *
 * Quem escolheu "Opus" antes da troca tem `claude-opus-5` guardado no
 * navegador — ou uma aba aberta da versão anterior, que manda esse id ao
 * servidor. Qualquer Opus que não seja o vigente (o 5, ou um 4.x mais antigo)
 * vira o vigente. Sonnet e Haiku passam como estão: a troca foi só do Opus.
 */
export function modeloVigente(id: string): string {
  return id.startsWith('claude-opus-') && id !== OPUS_VIGENTE ? OPUS_VIGENTE : id
}

/**
 * O modelo que o servidor usa de fato. Nunca repassa a escolha do cliente
 * direto para a API: fora da lista, vale o padrão.
 */
export function resolverModeloDoAssistente(pedido: unknown): string {
  const id = typeof pedido === 'string' ? modeloVigente(pedido) : ''
  return MODELOS_DO_ASSISTENTE.some((m) => m.key === id) ? id : MODELO_PADRAO_DO_ASSISTENTE
}
