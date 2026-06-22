import { supabase } from './supabase'

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
  if (error) {
    // A mensagem detalhada costuma vir no corpo da resposta.
    let detalhe = error.message
    try {
      const ctx = (error as unknown as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json()
        if (j?.error) detalhe = j.error
      }
    } catch {
      /* ignora */
    }
    throw new Error(detalhe)
  }
  return data as T
}
