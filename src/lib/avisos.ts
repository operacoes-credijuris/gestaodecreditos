// As regras dos avisos flutuantes (components/ui/Toast.tsx), como funções puras
// — revisão de qualidade de vida, 03/10/2026.
//
// O ERRO FICA ATÉ SER FECHADO. Antes, todo aviso sumia em 4,5 s; o de erro,
// quase sempre o mais longo ("Não foi possível gravar… tente de novo; se
// continuar, avise o administrador"), sumia antes de ser lido — justamente o que
// a pessoa precisava ler, e às vezes copiar para quem vai consertar. O de
// sucesso continua sumindo: confirma e sai da frente.
//
// O MESMO AVISO NÃO SE EMPILHA: uma falha que se repete (o mesmo botão clicado
// três vezes, uma consulta que volta a falhar) mostrava três caixas iguais.

import { formatDataHoraSegundos } from './format'

export type TipoDoAviso = 'success' | 'error' | 'info'

/** Quanto tempo cada aviso fica (ms); `null`: até ser fechado. */
export function duracaoDoAviso(tipo: TipoDoAviso, temAcao: boolean): number | null {
  if (tipo === 'error') return null
  // Com ação ("Desfazer"), a pessoa precisa de tempo para clicar.
  return temAcao ? 7000 : 4500
}

/** Ao tirar o mouse de cima, quanto falta para sumir (ms); o erro, de novo, fica. */
export function duracaoDepoisDoMouse(tipo: TipoDoAviso): number | null {
  return tipo === 'error' ? null : 2000
}

/** Quantos avisos cabem na pilha; passando disso, sai o mais antigo. */
export const MAX_AVISOS = 4

interface AvisoNaPilha {
  type: TipoDoAviso
  message: string
}

/**
 * Põe o aviso novo na pilha.
 *
 * - IGUAL A UM QUE JÁ ESTÁ NA TELA (mesmo tipo, mesmo texto): a pilha não muda e
 *   volta o que já estava (`repetido`), para quem chama renovar o tempo dele.
 * - Senão, entra no fim; passando de `MAX_AVISOS`, saem os mais antigos — os de
 *   erro por último, porque são os que ninguém fechou ainda de propósito.
 */
export function juntarAviso<T extends AvisoNaPilha>(
  pilha: readonly T[],
  novo: T,
  max: number = MAX_AVISOS,
): { pilha: T[]; repetido: T | null } {
  const repetido = pilha.find((a) => a.type === novo.type && a.message === novo.message) ?? null
  if (repetido) return { pilha: [...pilha], repetido }
  const junta = [...pilha, novo]
  while (junta.length > max) {
    const i = junta.findIndex((a) => a.type !== 'error')
    // Só erros na pilha: sai o mais antigo deles (nunca o que acabou de chegar).
    junta.splice(i >= 0 && i < junta.length - 1 ? i : 0, 1)
  }
  return { pilha: junta, repetido: null }
}

/** O que o "Copiar detalhes" do aviso de erro leva para quem vai consertar. */
export interface DetalhesDoErro {
  mensagem: string
  quando: Date
  /** O endereço da tela (o `#/…` do HashRouter). */
  tela: string
  /** O arquivo de entrada carregado (lib/versaoNova.ts), que identifica a versão. */
  versao: string | null
  navegador: string
}

/**
 * O texto copiado: a mensagem e, embaixo, onde, quando e em que versão. É o que
 * o administrador pergunta de volta toda vez ("em que tela? que horas?").
 * NADA DE DADO DA SESSÃO (e-mail, token): o texto vai parar em conversa de
 * WhatsApp.
 */
export function detalhesDoErro(d: DetalhesDoErro): string {
  return [
    d.mensagem.trim(),
    '',
    `Tela: ${d.tela || '/'}`,
    `Quando: ${formatDataHoraSegundos(d.quando.toISOString())}`,
    `Versão: ${d.versao ?? 'não identificada'}`,
    `Navegador: ${d.navegador || 'não identificado'}`,
  ].join('\n')
}
