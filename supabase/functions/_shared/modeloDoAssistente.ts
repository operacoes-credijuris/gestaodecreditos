// Os modelos que a pessoa escolhe no seletor do assistente — a MESMA lista na
// tela (src/components/Assistente.tsx) e no servidor (assistente/index.ts).
// Puro: a tela, a Edge Function e os testes importam daqui.

/**
 * O OPUS DA PLATAFORMA. É o 5.5 desde 05/10/2026, por pedido do dono: "tudo o
 * que for Opus 5 ou versão anterior, mude para 5.5".
 */
export const OPUS_VIGENTE = 'claude-opus-5-5'

/**
 * O SONNET E O HAIKU VIGENTES (12/11/2026): o seletor ainda oferecia o Sonnet 5
 * e o Haiku 4.5 — este sem raciocínio adaptativo nem nível de esforço, e por
 * isso tratado à parte no servidor. Os dois da geração 5.5 têm os dois, como o
 * Opus, e rodam a execução de código das Skills e da Base do Kommo.
 */
export const SONNET_VIGENTE = 'claude-sonnet-5-5'
export const HAIKU_VIGENTE = 'claude-haiku-5-5'

/** O seletor do assistente, na ordem em que aparece. */
export const MODELOS_DO_ASSISTENTE = [
  { key: HAIKU_VIGENTE, label: 'Haiku' },
  { key: SONNET_VIGENTE, label: 'Sonnet' },
  { key: OPUS_VIGENTE, label: 'Opus' },
] as const

export const MODELO_PADRAO_DO_ASSISTENTE = SONNET_VIGENTE

/**
 * OS MODELOS QUE ACEITAM `thinking: adaptive` E `output_config.effort`
 * (12/11/2026). Era o contrário — "tudo menos o que começa com claude-haiku" —,
 * e isso tirava o raciocínio e o esforço do Haiku 5.5, que tem os dois. Lista
 * de quem ACEITA, e não de quem recusa: um id novo que entre no seletor sem
 * passar por aqui vai sem os dois campos (resposta mais rasa), e não com eles
 * num modelo que os recusa (400 na pergunta inteira).
 */
export const MODELOS_COM_RACIOCINIO_ADAPTATIVO: ReadonlySet<string> = new Set([
  OPUS_VIGENTE,
  SONNET_VIGENTE,
  HAIKU_VIGENTE,
])

/** O modelo aceita raciocínio adaptativo e nível de esforço? */
export function aceitaRaciocinioAdaptativo(id: string): boolean {
  return MODELOS_COM_RACIOCINIO_ADAPTATIVO.has(id)
}

/**
 * O id que vale HOJE para um id guardado antes.
 *
 * Quem escolheu um modelo antes de uma troca tem o id antigo guardado no
 * navegador — ou uma aba aberta da versão anterior, que manda esse id ao
 * servidor. Qualquer Opus, Sonnet ou Haiku que não seja o vigente da família (o
 * Opus 5, o Sonnet 5, o Haiku 4.5…) vira o vigente da MESMA família: a pessoa
 * escolheu "Sonnet", e continua no Sonnet.
 */
export function modeloVigente(id: string): string {
  if (id.startsWith('claude-opus-')) return OPUS_VIGENTE
  if (id.startsWith('claude-sonnet-')) return SONNET_VIGENTE
  if (id.startsWith('claude-haiku-')) return HAIKU_VIGENTE
  return id
}

/**
 * O modelo que o servidor usa de fato. Nunca repassa a escolha do cliente
 * direto para a API: fora da lista, vale o padrão.
 */
export function resolverModeloDoAssistente(pedido: unknown): string {
  const id = typeof pedido === 'string' ? modeloVigente(pedido) : ''
  return MODELOS_DO_ASSISTENTE.some((m) => m.key === id) ? id : MODELO_PADRAO_DO_ASSISTENTE
}
