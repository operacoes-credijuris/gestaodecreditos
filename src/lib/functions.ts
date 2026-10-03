import { supabase } from './supabase'

/** Erro de Edge Function que veio com um código, além da mensagem. */
export interface ErroDeFuncao extends Error {
  codigo?: string
  /**
   * `gravado: false` no corpo: a função DIZ que não gravou nada. Quem mostra o
   * erro pode então afirmar isso à pessoa sem adivinhar pelo status — a
   * parametros-bcb responde assim quando nenhum índice veio do Banco Central.
   */
  nadaGravado?: boolean
  /** A lista `avisos` do corpo, um item por falha, quando a função a manda. */
  avisos?: string[]
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
 *
 * Exportada só para o teste (src/lib/__tests__/erroDaFuncao.test.ts).
 */
export async function erroDaFuncao(error: { message: string }): Promise<ErroDeFuncao> {
  const ctx = (error as unknown as { context?: Response }).context
  const status = typeof ctx?.status === 'number' ? ` (HTTP ${ctx.status})` : ''
  let detalhe = ''
  let codigo: string | undefined
  let nadaGravado = false
  let avisosDoCorpo: string[] = []
  try {
    const txt = ctx && typeof ctx.text === 'function' ? await ctx.text() : ''
    if (txt) {
      try {
        const j = JSON.parse(txt) as Record<string, unknown>
        // `erro` e `msg` entram porque as funções não falam uma língua só.
        const achado = j.error ?? j.erro ?? j.message ?? j.msg
        // E A LISTA `avisos`, quando é só ela que vem. A parametros-bcb, com o
        // Banco Central fora do ar, responde 502 com o que falhou em `avisos` e
        // nenhum campo de erro — e a tela mostrava o JSON cru, chaves e aspas.
        // Só entra na falta dos campos acima, então quem já manda `error` segue
        // igual.
        const avisos = Array.isArray(j.avisos)
          ? j.avisos.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
          : []
        detalhe = achado
          ? String(achado)
          : avisos.length
            ? avisos.map((a) => a.trim()).join(' · ')
            : txt.slice(0, 300)
        // E O CAMPO `detalhe`, quando a função o manda. A kommo-anotar põe ali a
        // resposta do próprio Kommo, e sem isto a tela mostrava só "Kommo
        // recusou a anotação" com o status — que não distingue token expirado de
        // card apagado de texto recusado.
        if (typeof j.detalhe === 'string' && j.detalhe.trim()) {
          detalhe = `${detalhe} — ${j.detalhe.trim().slice(0, 200)}`
        }
        if (typeof j.codigo === 'string' && j.codigo) codigo = j.codigo
        // SÓ O `false` EXPLÍCITO: corpo sem o campo não diz nada sobre o que gravou.
        if (j.gravado === false) nadaGravado = true
        avisosDoCorpo = avisos.map((a) => a.trim())
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
  if (nadaGravado) falha.nadaGravado = true
  if (avisosDoCorpo.length) falha.avisos = avisosDoCorpo
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
