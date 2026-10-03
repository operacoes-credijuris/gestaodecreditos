// O RASCUNHO DA PETIÇÃO DE IA, guardado no navegador por tarefa (revisão de
// qualidade de vida, 03/10/2026).
//
// POR QUE: a peça redigida pela IA custa uma chamada paga e dezenas de segundos,
// e depois ainda é revisada à mão. Recarregar a página, a sessão expirar, sair
// para outra tela ou o navegador fechar levava tudo — o "Descartar alterações?"
// só protege o fechar da janela. Com o rascunho, reabrir a petição DA MESMA
// TAREFA devolve o objeto, a peça e a revisão.
//
// O QUE NÃO MUDA: fechar a janela de propósito continua descartando (a pergunta
// já foi feita), e salvar a peça apaga o rascunho. POR TAREFA, e nunca solto:
// peça de uma tarefa não pode reaparecer na janela de outra (o mesmo cuidado do
// `abertura` em PeticaoModal.tsx). Sem tarefa (aberta pelo assistente), não há
// rascunho.
//
// VENCE EM 7 DIAS: depois disso o processo andou, e a peça velha recuperada
// sozinha seria mais armadilha que ajuda.
//
// TUDO EM try/catch: sem armazenamento (janela anônima, cheio, bloqueado) a
// janela funciona igual, só sem guardar.
import type { Armazenamento } from './preferencias'

const PREFIXO = 'credijuris.peticao.rascunho.'
export const VALIDADE_DO_RASCUNHO_MS = 7 * 24 * 60 * 60 * 1000

/** O que a IA devolveu e a tela usa: o título nomeia o arquivo; os avisos, a caixa. */
export interface RedacaoGuardada {
  titulo: string
  texto: string
  truncada?: boolean
  avisos?: string[]
}

export interface RascunhoDaPeticao {
  instrucao: string
  redacao: RedacaoGuardada | null
  textoIA: string
  /** Quando foi guardado (ms). */
  em: number
}

function armazenamentoPadrao(): Armazenamento | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

const ehTexto = (v: unknown): v is string => typeof v === 'string'

/** A redação guardada tem a forma certa? Senão, é como se não houvesse. */
function redacaoValida(v: unknown): RedacaoGuardada | null | undefined {
  if (v === null) return null
  if (!v || typeof v !== 'object') return undefined
  const r = v as Record<string, unknown>
  if (!ehTexto(r.titulo) || !ehTexto(r.texto)) return undefined
  const avisos = Array.isArray(r.avisos) ? r.avisos.filter(ehTexto) : undefined
  return { titulo: r.titulo, texto: r.texto, truncada: r.truncada === true, avisos }
}

/**
 * O rascunho guardado da tarefa, se houver, tiver a forma certa e não tiver
 * vencido. O vencido é apagado aqui mesmo.
 */
export function lerRascunhoDaPeticao(
  tarefaId: string | null | undefined,
  agora: number = Date.now(),
  armazenamento: Armazenamento | null = armazenamentoPadrao(),
): RascunhoDaPeticao | null {
  if (!tarefaId || !armazenamento) return null
  try {
    const bruto = armazenamento.getItem(PREFIXO + tarefaId)
    if (!bruto) return null
    const v = JSON.parse(bruto) as Record<string, unknown>
    const redacao = redacaoValida(v?.redacao)
    if (
      !v ||
      !ehTexto(v.instrucao) ||
      !ehTexto(v.textoIA) ||
      typeof v.em !== 'number' ||
      redacao === undefined
    )
      return null
    if (agora - v.em > VALIDADE_DO_RASCUNHO_MS) {
      armazenamento.removeItem(PREFIXO + tarefaId)
      return null
    }
    // Rascunho sem nada dentro não é rascunho.
    if (!v.instrucao.trim() && !v.textoIA.trim()) return null
    return { instrucao: v.instrucao, redacao, textoIA: v.textoIA, em: v.em }
  } catch {
    return null
  }
}

/** Guarda o rascunho da tarefa. Falhar é silencioso: só não fica guardado. */
export function gravarRascunhoDaPeticao(
  tarefaId: string | null | undefined,
  rascunho: Omit<RascunhoDaPeticao, 'em'>,
  agora: number = Date.now(),
  armazenamento: Armazenamento | null = armazenamentoPadrao(),
): void {
  if (!tarefaId || !armazenamento) return
  try {
    armazenamento.setItem(PREFIXO + tarefaId, JSON.stringify({ ...rascunho, em: agora }))
  } catch {
    /* cheio ou bloqueado: segue sem guardar */
  }
}

/** Esquece o rascunho da tarefa (a peça foi salva, ou a janela fechada de propósito). */
export function apagarRascunhoDaPeticao(
  tarefaId: string | null | undefined,
  armazenamento: Armazenamento | null = armazenamentoPadrao(),
): void {
  if (!tarefaId || !armazenamento) return
  try {
    armazenamento.removeItem(PREFIXO + tarefaId)
  } catch {
    /* nada a fazer */
  }
}
