// As janelas abertas e se alguma tem algo digitado — o que o Ctrl+K precisa
// saber para decidir entre AVISAR e TOMAR O LUGAR da janela (base.js da amostra).
//
// POR QUE NÃO BASTA A PILHA DE lib/dialogo.ts. A pilha diz que há janela aberta,
// mas não se ela está ALTERADA, nem como fechá-la. Antes, com qualquer janela
// aberta o Ctrl+K só avisava — até com o glossário, que não tem nada a perder.
// Na amostra, sem alteração a busca toma o lugar da janela; com alteração, avisa,
// porque o que foi digitado não se perde por um atalho.
//
// QUEM SE REGISTRA: o Modal e o Drawer (que já sabem o `dirty`), o menu do
// celular e as novidades. O "alterada" é o MESMO `dirty` que faz a janela
// perguntar "Descartar alterações?" ao fechar — uma regra só para as duas coisas.
import { useEffect, useRef } from 'react'

/** O que o registro guarda de cada janela aberta. */
export interface JanelaAberta {
  /** Tem algo digitado que ainda não foi salvo (o `dirty` da janela)? */
  alterada: boolean
  /** Fecha a janela como o X faria (sem perguntar: só é chamado sem alteração). */
  fechar: () => void
}

/** Como estão as janelas, para o Ctrl+K. */
export type EstadoDasJanelas = 'nenhuma' | 'livre' | 'alterada'

/**
 * O estado das janelas, a partir do registro.
 *
 * - Uma pergunta "Descartar alterações?" na tela é alteração: há algo digitado
 *   embaixo dela.
 * - JANELA NA PILHA QUE NÃO SE REGISTROU (um diálogo novo que esqueceu de usar
 *   o registro) conta como alterada: sem saber fechá-la, nem se tem algo
 *   digitado, o seguro é avisar — como a plataforma fazia antes.
 */
export function estadoDasJanelas(
  janelas: readonly Pick<JanelaAberta, 'alterada'>[],
  haDialogoNaPilha: boolean,
  perguntaDeDescarteAberta = false,
): EstadoDasJanelas {
  if (perguntaDeDescarteAberta) return 'alterada'
  if (janelas.some((j) => j.alterada)) return 'alterada'
  if (janelas.length > 0) return 'livre'
  return haDialogoNaPilha ? 'alterada' : 'nenhuma'
}

// O registro: uma leitura por janela, para pegar SEMPRE o `dirty` e o `fechar`
// de agora (eles mudam a cada tecla, e o registro não pode ficar para trás).
const registro = new Map<symbol, () => JanelaAberta>()

/** Registra uma janela aberta. Devolve a função que a tira do registro. */
export function registrarJanelaAberta(ler: () => JanelaAberta): () => void {
  const marca = Symbol('janela')
  registro.set(marca, ler)
  return () => {
    registro.delete(marca)
  }
}

/** As janelas abertas agora, da mais antiga para a de cima. */
export function janelasAbertas(): JanelaAberta[] {
  return Array.from(registro.values(), (ler) => ler())
}

/**
 * Fecha todas as janelas abertas, da de cima para a mais antiga (a ordem em que
 * a pessoa as fecharia no X). Só para quando NENHUMA está alterada — quem chama
 * confere antes com `estadoDasJanelas`.
 */
export function fecharJanelasAbertas(): void {
  for (const j of janelasAbertas().reverse()) j.fechar()
}

/**
 * Registra a janela enquanto `aberta`. `alterada` e `fechar` podem mudar a cada
 * render: o registro lê sempre os de agora.
 */
export function useJanelaAberta(aberta: boolean, alterada: boolean, fechar: () => void): void {
  const atual = useRef<JanelaAberta>({ alterada, fechar })
  atual.current = { alterada, fechar }
  useEffect(() => {
    if (!aberta) return
    return registrarJanelaAberta(() => atual.current)
  }, [aberta])
}
