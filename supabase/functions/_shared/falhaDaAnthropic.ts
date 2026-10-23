// _shared/falhaDaAnthropic.ts
// A FALHA DA ANTHROPIC EM PORTUGUÊS, e com o que fazer (19/10/2026).
//
// O CASO QUE A TROUXE: a conta da API ficou sem créditos, e a análise de RPV
// mostrou "Claude API (qualificação) 400: {"type":"error","error":{"type":
// "invalid_request_error","message":"Your credit balance is too low to access
// the Anthropic API..."}}" — em inglês, com o JSON cru, sem dizer que o problema
// era de saldo nem onde recarregar. E isso vale para TODO recurso de IA da
// plataforma, não só a análise.
//
// UM TRADUTOR SÓ, nas pontas: o navegador (`erroDaFuncao`, por onde passa o erro
// de qualquer função) e as funções que gravam o erro no banco para a tela ler
// depois. Sem `npm:` e sem `Deno.`: roda nos dois lados e no vitest.

export type TipoDaFalhaDaAnthropic = 'sem-credito' | 'chave' | 'limite' | 'sobrecarga'

// SÓ AS MARCAS DA ANTHROPIC (23/10/2026): as regras casavam "rate limit",
// "overloaded" e "invalid api key" soltos, e o erro do ADVBOX ("cloudflare rate
// limit") aparecia como "A Anthropic limitou as chamadas", com o código e o
// "nada gravado" da função jogados fora. Agora só o tipo de erro que a API da
// Anthropic devolve e a frase do saldo dela.
const REGRAS: { tipo: TipoDaFalhaDaAnthropic; casa: RegExp; mensagem: string }[] = [
  {
    tipo: 'sem-credito',
    casa: /credit balance is too low|purchase credits/i,
    mensagem:
      'A conta da Anthropic (a IA da plataforma) está sem créditos. Recarregue em console.anthropic.com → ' +
      'Settings → Billing e tente de novo. Nada foi gravado.',
  },
  {
    tipo: 'chave',
    casa: /authentication_error|invalid x-api-key/i,
    mensagem: 'A chave da Anthropic foi recusada. Confira em Configurações → Anthropic.',
  },
  {
    tipo: 'limite',
    casa: /rate_limit_error/i,
    mensagem: 'A Anthropic limitou as chamadas (muitas ao mesmo tempo). Tente de novo em alguns minutos.',
  },
  {
    tipo: 'sobrecarga',
    casa: /overloaded_error/i,
    mensagem: 'A Anthropic está sobrecarregada no momento. Tente de novo em alguns minutos.',
  },
]

/**
 * A falha reconhecida — o tipo e a mensagem em português — ou null quando o
 * texto não é uma das falhas conhecidas da Anthropic (aí fica como veio).
 */
export function falhaDaAnthropic(texto: unknown): { tipo: TipoDaFalhaDaAnthropic; mensagem: string } | null {
  const t = String(texto ?? '')
  if (!t) return null
  const r = REGRAS.find((x) => x.casa.test(t))
  return r ? { tipo: r.tipo, mensagem: r.mensagem } : null
}

/** O texto traduzido, se for falha conhecida da Anthropic; senão, o próprio texto. */
export function traduzirFalhaDaAnthropic(texto: string): string {
  return falhaDaAnthropic(texto)?.mensagem ?? texto
}
