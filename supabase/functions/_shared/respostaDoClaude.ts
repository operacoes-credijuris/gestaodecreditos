// Como se PEDE ao Opus 5.5 e como se LÊ o que ele devolve. Puro: sem Deno, sem
// SDK, sem rede — as Edge Functions e os testes (src/lib/__tests__) importam
// daqui.
//
// O QUE MUDOU COM O OPUS 5.5 (05/10/2026), segundo o guia de migração da
// Anthropic, e que este arquivo existe para não deixar voltar:
//
//   1. O RACIOCÍNIO ESTÁ SEMPRE LIGADO. `thinking: {type: 'disabled'}` e
//      `{type: 'enabled', budget_tokens}` dão 400; só vale omitir ou mandar
//      `{type: 'adaptive'}`. Consequência dupla: a resposta pode COMEÇAR por
//      blocos `thinking` (quem lê `content[0].text` lê vazio), e o `max_tokens`
//      cobre raciocínio MAIS resposta (teto apertado corta o JSON no meio).
//   2. FERRAMENTA FORÇADA dá 400: `tool_choice` só aceita 'auto' e 'none'.
//      Para saída estruturada vale `output_config.format`; para manter uma
//      ferramenta, 'auto' + instrução firme + conferir se ela veio.
//   3. `temperature`, `top_p` e `top_k` fora do padrão dão 400.
//   4. O ESFORÇO PADRÃO caiu de 'high' (Opus 5) para 'medium'. Por isso todo
//      pedido daqui declara o seu — e o tipo abaixo obriga.
//   5. O texto que o modelo escreve ENTRE chamadas de ferramenta passa a vir em
//      blocos `thinking` (vazios por padrão), não em `text`.

/** Os níveis de esforço que o Opus 5.5 aceita. */
export type Esforco = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * O esforço das chamadas ao Opus que não escolheram outro: 'high', o padrão do
 * Opus 5 — o pedido do dono foi trocar o modelo, não rebaixar a leitura.
 */
export const ESFORCO_PADRAO_DO_OPUS: Esforco = 'high'

/**
 * O FORMATO DE UM PEDIDO AO OPUS 5.5, conferido pelo compilador.
 *
 * Cada chamada ao Opus escreve `{...} satisfies PedidoAoOpus`: um parâmetro que
 * o modelo recusa (raciocínio desligado ou com orçamento, ferramenta forçada,
 * temperatura) passa a ser erro de `tsc`/`deno check`, e não um 400 descoberto
 * em produção na primeira análise do dia. E `output_config.effort` é
 * OBRIGATÓRIO: esquecer o esforço é rodar em 'medium' sem ninguém ter decidido.
 *
 * O resto dos campos (system, tools, messages…) passa sem conferência aqui —
 * quem os confere é o SDK, ou a própria API nas chamadas por `fetch`.
 */
export interface PedidoAoOpus {
  model: string
  max_tokens: number
  output_config: {
    effort: Esforco
    format?: { type: 'json_schema'; schema: Record<string, unknown> }
  }
  thinking?: { type: 'adaptive'; display?: 'summarized' | 'omitted' }
  tool_choice?: { type: 'auto'; disable_parallel_tool_use?: boolean } | { type: 'none' }
  temperature?: never
  top_p?: never
  top_k?: never
  [outro: string]: unknown
}

/**
 * O mesmo, nas chamadas PELO SDK: `satisfies NoFormatoDoOpus<Anthropic.MessageStreamParams>`.
 *
 * O tipo do SDK entra junto porque é ele que mantém `'text'`, `'user'` e
 * companhia como literais; só com `PedidoAoOpus` (que deixa o resto como
 * `unknown`) o compilador os alarga para `string` e o SDK recusa. Este arquivo
 * não importa o SDK: os testes o carregam no Node, sem o `npm:` do Deno.
 */
export type NoFormatoDoOpus<ParametrosDoSdk> = ParametrosDoSdk & PedidoAoOpus

/** Um bloco de `content`, do jeito que chega — pelo SDK ou por `fetch`. */
export interface BlocoDaResposta {
  type: string
  text?: unknown
  id?: unknown
  name?: unknown
  input?: unknown
}

/** O que importa de uma resposta da Messages API para lê-la. */
export interface RespostaDoClaude {
  stop_reason?: string | null
  content?: readonly BlocoDaResposta[] | null
}

/**
 * O TEXTO da resposta: só os blocos `type: 'text'`, na ordem, juntos.
 *
 * Nunca `content[0]`: com o raciocínio sempre ligado, o primeiro bloco
 * costuma ser `thinking`, e o texto vem depois.
 */
export function textoDaResposta(
  content: readonly BlocoDaResposta[] | null | undefined,
  separador = '',
): string {
  return (content ?? [])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join(separador)
    .trim()
}

/** Tira a cerca de markdown (```json … ```) que o modelo às vezes põe em volta do JSON. */
export function semCercaDeMarkdown(texto: string): string {
  return texto.replace(/```json/gi, '').replace(/```/g, '').trim()
}

/**
 * Os argumentos da ferramenta `nome`, se o modelo a chamou; null se não.
 *
 * Com `tool_choice: 'auto'` a chamada não é garantida — quem lê confere, e
 * decide o que fazer quando ela não vem (ver `pedidoParaChamarAFerramenta`).
 */
export function chamadaDaFerramenta(
  content: readonly BlocoDaResposta[] | null | undefined,
  nome: string,
): Record<string, unknown> | null {
  const uso = (content ?? []).find((b) => b?.type === 'tool_use' && b.name === nome)
  const input = uso?.input
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null
}

/** Uma mensagem para reenviar à API (o formato que a Messages API aceita). */
export interface MensagemDeRetorno {
  role: 'assistant' | 'user'
  content: unknown[]
}

/**
 * A SEGUNDA CHANCE, quando o modelo não chamou a ferramenta que devia.
 *
 * Devolve as duas mensagens a acrescentar à conversa: a resposta dele TAL COMO
 * VEIO (os blocos `thinking` voltam intactos — editados ou tirados, a API
 * recusa) e um turno de usuário que pede a ferramenta pelo nome. Se ele chamou
 * OUTRA ferramenta, cada chamada recebe um `tool_result` de erro — a API exige
 * resposta para todo `tool_use` antes de qualquer outro texto.
 *
 * Continuar a conversa, e não repetir o pedido do zero: o processo já está no
 * cache, e o modelo parte do que já leu e pensou.
 */
export function pedidoParaChamarAFerramenta(
  content: readonly BlocoDaResposta[],
  nome: string,
): MensagemDeRetorno[] {
  const respostas = content
    .filter((b) => b?.type === 'tool_use' && typeof b.id === 'string')
    .map((b) => ({
      type: 'tool_result',
      tool_use_id: b.id as string,
      is_error: true,
      content: `Esta ferramenta não é a desta tarefa. Use ${nome}.`,
    }))
  return [
    { role: 'assistant', content: [...content] },
    {
      role: 'user',
      content: [
        ...respostas,
        {
          type: 'text',
          text:
            `Você não registrou o resultado. Chame agora a ferramenta ${nome}, uma única vez, ` +
            'com o que você já leu. Não escreva o resultado no texto da resposta.',
        },
      ],
    },
  ]
}

/** O resultado de ler uma saída estruturada (`output_config.format`). */
export type LeituraEstruturada<T> =
  | { ok: true; valor: T }
  | { ok: false; motivo: 'recusa' | 'cortada' | 'vazia' | 'invalida'; texto: string }

/**
 * Lê a SAÍDA ESTRUTURADA: o JSON que o esquema garante, no bloco de texto.
 *
 * A garantia do esquema tem duas exceções documentadas, e as duas são
 * conferidas antes do parse: RECUSA (o filtro de segurança fala por cima do
 * formato) e CORTE por `max_tokens` (o JSON fica pela metade).
 */
export function lerSaidaEstruturada<T>(resposta: RespostaDoClaude): LeituraEstruturada<T> {
  const texto = semCercaDeMarkdown(textoDaResposta(resposta.content))
  if (resposta.stop_reason === 'refusal') return { ok: false, motivo: 'recusa', texto }
  if (resposta.stop_reason === 'max_tokens') return { ok: false, motivo: 'cortada', texto }
  if (!texto) return { ok: false, motivo: 'vazia', texto }
  try {
    return { ok: true, valor: JSON.parse(texto) as T }
  } catch {
    return { ok: false, motivo: 'invalida', texto }
  }
}
