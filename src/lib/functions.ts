import { supabase } from './supabase'
import { falhaDaAnthropic } from '../../supabase/functions/_shared/falhaDaAnthropic.ts'

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
  // A FALHA DA ANTHROPIC EM PORTUGUÊS (19/10/2026): sem créditos, chave recusada,
  // limite ou sobrecarga viram o que fazer — e não o JSON cru em inglês, que foi
  // o que a análise de RPV mostrou quando o saldo da conta acabou.
  const daAnthropic = falhaDaAnthropic(detalhe || error.message)
  if (daAnthropic) {
    const f: ErroDeFuncao = new Error(daAnthropic.mensagem)
    f.codigo = `anthropic-${daAnthropic.tipo}`
    return f
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
  const { data, error } = await invocarComSessaoRenovada<T>(name, body ?? {})
  if (error) throw await erroDaFuncao(error)
  return data as T
}

/**
 * A RECUSA DA SESSÃO, e só ela: o 401 do portão das funções (ERRO_ACESSO, a
 * "Sessão inválida." da advbox-tarefas) ou do gateway (JWT vencido/inválido).
 * Um 401 que a função repassa de outro serviço (Escavador, Kommo) não entra:
 * renovar a sessão não muda a resposta dele.
 */
const SESSAO_RECUSADA = /acesso não autorizado|sessão inválida|invalid jwt|jwt expired|missing authorization/i

/** Exportada só para o teste. */
export async function sessaoRecusada(error: unknown): Promise<boolean> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx?.status !== 401 || typeof ctx.clone !== 'function') return false
  const txt = await ctx.clone().text().catch(() => '')
  return SESSAO_RECUSADA.test(txt)
}

/**
 * RENOVA A SESSÃO E TENTA DE NOVO, uma vez, quando a função recusa o acesso
 * (22/10/2026): com a aba aberta por horas, o token podia sair vencido, e a
 * pessoa logada lia "Acesso não autorizado. Faça login novamente" — foi o que a
 * justificativa técnica mostrou, e o vigia dela, que falhava calado, deixou a
 * geração parar no meio. O 401 do portão vem antes de qualquer trabalho da
 * função, então repetir não faz nada duas vezes.
 */
async function invocarComSessaoRenovada<T>(name: string, body: Record<string, unknown> | FormData) {
  const r = await supabase.functions.invoke<T>(name, { body })
  if (!r.error || !(await sessaoRecusada(r.error))) return r
  const { data } = await supabase.auth.refreshSession().catch(() => ({ data: { session: null } }))
  if (!data.session) return r
  return supabase.functions.invoke<T>(name, { body })
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
  const { data, error } = await invocarComSessaoRenovada<T>(name, form)
  if (error) throw await erroDaFuncao(error)
  return data as T
}
