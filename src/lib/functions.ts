import { supabase } from './supabase'

/** Erro de Edge Function que veio com um código, além da mensagem. */
export interface ErroDeFuncao extends Error {
  codigo?: string
}

/**
 * O código do erro, quando a função mandou um.
 *
 * SERVE A QUEM PRECISA DISTINGUIR UM ERRO DOS OUTROS para oferecer uma saída —
 * e não à mensagem, que é para ler. Casar por texto funcionaria hoje e
 * quebraria na primeira vírgula trocada na frase.
 */
export function codigoDoErro(e: unknown): string | undefined {
  const c = (e as ErroDeFuncao | null)?.codigo
  return typeof c === 'string' && c ? c : undefined
}

/**
 * Traduz o erro do supabase-js no que a função de fato respondeu.
 *
 * O MOTIVO REAL VEM NO CORPO, e a mensagem do supabase-js é sempre a mesma
 * ("Edge Function returned a non-2xx status code"). Sem cavar o corpo, todo
 * erro de função chega à tela indistinguível de qualquer outro.
 *
 * Lê como TEXTO e só então tenta interpretar. A versão anterior chamava .json()
 * direto e aceitava apenas a chave `error`: quando a função morre no nível da
 * plataforma — estouro de tempo, de memória, erro de boot — o corpo não é esse
 * JSON, o .json() lançava, o catch engolia e sobrava a mensagem genérica. Era o
 * caso do botão Analisar.
 *
 * UMA SÓ PARA AS DUAS INVOCAÇÕES. Esta decodificação vivia copiada nas duas, e
 * a cópia é o tipo de coisa que envelhece torto: o código do erro entrou aqui e
 * teria entrado numa delas só.
 */
async function erroDaFuncao(error: { message: string }): Promise<ErroDeFuncao> {
  const ctx = (error as unknown as { context?: Response }).context
  const status = typeof ctx?.status === 'number' ? ` (HTTP ${ctx.status})` : ''
  let detalhe = ''
  let codigo: string | undefined
  try {
    const txt = ctx && typeof ctx.text === 'function' ? await ctx.text() : ''
    if (txt) {
      try {
        const j = JSON.parse(txt) as Record<string, unknown>
        // `erro` e `msg` entram porque as funções não falam uma língua só.
        const achado = j.error ?? j.erro ?? j.message ?? j.msg
        detalhe = achado ? String(achado) : txt.slice(0, 300)
        if (typeof j.codigo === 'string' && j.codigo) codigo = j.codigo
      } catch {
        // Corpo que não é JSON ainda diz muito: HTML de gateway, rastro de pilha.
        detalhe = txt.slice(0, 300)
      }
    }
  } catch {
    /* corpo ilegível: sobra o status, que já separa 401 de 500 */
  }
  const falha: ErroDeFuncao = new Error(`${detalhe || error.message}${status}`)
  if (codigo) falha.codigo = codigo
  return falha
}

/**
 * Invoca uma Edge Function do Supabase enviando o JWT do usuário logado.
 * Retorna o JSON da função ou lança erro com mensagem amigável.
 */
export async function invokeFunction<T = unknown>(
  name: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: body ?? {},
  })
  if (error) throw await erroDaFuncao(error)
  return data as T
}

/**
 * Mesma invocação de invokeFunction, mas com corpo `FormData` — para upload de
 * arquivo (ex: subir uma Skill). Função separada porque invokeFunction sempre
 * serializa o corpo como JSON; passar FormData por ali sairia com Content-Type
 * errado.
 */
export async function invokeFunctionForm<T = unknown>(
  name: string,
  form: FormData,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: form })
  if (error) throw await erroDaFuncao(error)
  return data as T
}
