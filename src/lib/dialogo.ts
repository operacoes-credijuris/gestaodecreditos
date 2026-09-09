// Regras de diálogo compartilhadas: prender o foco e travar o scroll do fundo.
//
// POR QUE ESTE MÓDULO EXISTE: a plataforma tem TRÊS coisas que se declaram
// `aria-modal` — Modal, Drawer e o menu lateral no celular — e só o Modal
// cumpria a promessa. Nos outros dois o foco ficava no fundo: o primeiro Tab
// saía para a página atrás do overlay, invisível sob o desfoque, e Enter ali
// acionava um item da navegação, trocando de rota e destruindo a ficha que
// estava sendo lida. Três implementações da mesma regra viravam três
// comportamentos; agora é uma.
import { useCallback, useEffect, useRef } from 'react'

/** Elementos que recebem foco por Tab dentro de um painel. */
export const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Contador de diálogos abertos. Sem ele, fechar UM diálogo destravaria o scroll
// enquanto outro ainda está aberto (confirmação em cima de formulário é o caso
// comum aqui), e o fundo voltaria a rolar sob o diálogo de cima.
let abertos = 0
let overflowOriginal = ''

/**
 * A PILHA DOS DIÁLOGOS ABERTOS, do mais antigo para o de cima.
 *
 * POR QUE ELA EXISTE. Cada diálogo registra o seu próprio listener de Escape no
 * `document`, e o Escape chega a TODOS ao mesmo tempo. Com uma janela aberta
 * dentro de outra — a de reprovar/diligenciar dentro da análise de RPV, que é o
 * caso comum aqui — um Escape fechava as duas: a de dentro pedia confirmação e
 * a de fora, se não estivesse "dirty", fechava calada, levando embora o texto
 * que a pessoa acabou de digitar. Estando dirty, vinham DOIS `window.confirm`
 * com a mesma frase, e quem clicava OK no primeiro pensando ser o da janela
 * pequena descartava a análise inteira.
 *
 * Parar a propagação no painel não resolveria: os listeners estão no
 * `document`, não na árvore de cada janela.
 *
 * SÍMBOLO, e não um número: a identidade não pode colidir nem sobreviver a um
 * remonte. Sai da pilha de onde estiver — o desmonte não é garantidamente na
 * ordem inversa quando duas janelas fecham no mesmo ciclo.
 */
const pilha: symbol[] = []

/**
 * Trava o scroll do body enquanto o diálogo estiver aberto.
 *
 * O overlay do Modal rola sozinho, então a roda do mouse sobre ele parecia
 * funcionar — mas na listagem de Créditos rolada até a linha 150, girar a roda
 * rolava a LISTAGEM atrás. Ao fechar, a tabela estava em outra posição e a linha
 * em que se trabalhava havia se perdido.
 */
export function useTravaScroll(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return
    if (abertos === 0) {
      overflowOriginal = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    abertos += 1
    return () => {
      abertos -= 1
      if (abertos === 0) document.body.style.overflow = overflowOriginal
    }
  }, [ativo])
}

/**
 * Prende o foco dentro do painel enquanto `ativo`, e devolve ao elemento
 * anterior ao sair.
 *
 * `preferirCampo` faz o foco inicial cair no primeiro CAMPO do corpo, e não no
 * primeiro focável — que é o X do cabeçalho. Com o foco no X, abrir "Novo
 * crédito" e começar a digitar não escrevia nada, e a primeira barra de espaço
 * acionava o botão: o formulário fechava sem confirmação (dirty ainda era false)
 * e ninguém entendia por quê.
 */
export function useFocoPreso(
  ativo: boolean,
  painelRef: React.RefObject<HTMLElement | null>,
  preferirCampo = false,
): () => boolean {
  const focoAnterior = useRef<HTMLElement | null>(null)
  // O REGISTRO NA PILHA MORA AQUI porque todo diálogo da plataforma já passa
  // por este hook — Modal, Drawer e o menu do celular. Registrar em cada um
  // deles daria três lugares para esquecer, que é como os três já divergiram
  // uma vez.
  const marca = useRef<symbol | null>(null)
  if (marca.current === null) marca.current = Symbol('dialogo')

  useEffect(() => {
    if (!ativo) return
    const m = marca.current as symbol
    pilha.push(m)
    return () => {
      const i = pilha.lastIndexOf(m)
      if (i >= 0) pilha.splice(i, 1)
    }
  }, [ativo])

  /**
   * Este diálogo é o de cima? É o que decide quem responde ao Escape.
   *
   * Pilha vazia devolve true de propósito: um diálogo que por qualquer motivo
   * não se registrou continua fechando com Escape. Um teclado que não fecha
   * janela é pior que uma janela que fecha na vez de outra.
   */
  const ehTopo = useCallback(
    () => pilha.length === 0 || pilha[pilha.length - 1] === marca.current,
    [],
  )

  useEffect(() => {
    if (!ativo) return
    focoAnterior.current = document.activeElement as HTMLElement | null
    const painel = painelRef.current
    if (painel) {
      const corpo = preferirCampo
        ? painel.querySelector<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
          )
        : null
      const primeiro = corpo ?? painel.querySelector<HTMLElement>(FOCAVEIS)
      ;(primeiro ?? painel).focus()
    }
    // Devolve o foco quando `ativo` fica false — e não no desmonte: o Drawer
    // mantém o nó montado por 200ms pela animação de saída, e restaurar depois
    // disso devolveria o foco tarde, com a página já mudada.
    return () => {
      focoAnterior.current?.focus()
    }
  }, [ativo, painelRef, preferirCampo])

  useEffect(() => {
    if (!ativo) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      // O MESMO MOTIVO DO ESCAPE: com duas janelas abertas, os dois laços de Tab
      // disparam e o de fora rouba o foco de volta para o painel dele — o Tab
      // dentro da janela pequena pulava para o fundo.
      if (!ehTopo()) return
      const painel = painelRef.current
      if (!painel) return
      const focaveis = Array.from(painel.querySelectorAll<HTMLElement>(FOCAVEIS))
      if (focaveis.length === 0) return
      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      const atual = document.activeElement
      if (e.shiftKey) {
        if (atual === primeiro || !painel.contains(atual)) {
          e.preventDefault()
          ultimo.focus()
        }
      } else if (atual === ultimo || !painel.contains(atual)) {
        e.preventDefault()
        primeiro.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [ativo, painelRef, ehTopo])

  return ehTopo
}
