// "Descartar alterações?" numa janela da própria plataforma (item "Novo" da
// amostra), no lugar do `window.confirm` do navegador.
//
// POR QUE TROCAR. O diálogo do navegador não segue o visual, não tem o texto que
// explica o que se perde e fica fora da pilha de diálogos (lib/dialogo.ts): o
// Escape dele e o da janela de baixo eram dois mundos. Aqui a pergunta é uma
// janela como as outras, POR CIMA da que ia fechar, e a de baixo não responde ao
// teclado enquanto ela estiver aberta.
//
// QUANDO A PERGUNTA APARECE NÃO MUDOU: quem perguntava com `window.confirm`
// continua perguntando no mesmo ponto, só que esperando a resposta (`await`).
// A diferença é só o desenho.
//
// COMO FUNCIONA. Este módulo não desenha nada: guarda o pedido e avisa quem
// desenha (`JanelaDeDescarte`, montada uma vez na raiz do app). Separado assim, a
// regra — um pedido por vez, a resposta volta para quem perguntou — é testável
// sem React.

/** O texto da pergunta, o mesmo do diálogo do navegador que ela substitui. */
export const PERGUNTA_DO_DESCARTE = 'Descartar alterações não salvas?'

/**
 * ONDE está o que se perde: numa janela (o padrão) ou numa ficha lateral (o
 * Drawer). Muda só uma palavra do texto, como na amostra — a regra é a mesma.
 */
export type LugarDoDescarte = 'janela' | 'ficha'

/** O texto do corpo da pergunta, para cada lugar (os da amostra, base.js). */
export function textoDoDescarte(lugar: LugarDoDescarte = 'janela'): string {
  return `O que foi digitado ${lugar === 'ficha' ? 'nesta ficha' : 'nesta janela'} ainda não foi salvo. Fechando agora, se perde.`
}

type Ouvinte = (aberto: boolean, lugar: LugarDoDescarte) => void

let ouvinte: Ouvinte | null = null
let pendente: {
  promessa: Promise<boolean>
  resolver: (sim: boolean) => void
  lugar: LugarDoDescarte
} | null = null

/**
 * Há uma pergunta "Descartar alterações?" na tela agora? Serve ao Ctrl+K: com
 * ela aberta, há algo digitado embaixo, e a busca avisa em vez de fechar.
 */
export function perguntaDeDescarteAberta(): boolean {
  return pendente !== null
}

/**
 * Pergunta se a pessoa quer descartar o que digitou. Devolve `true` para
 * descartar e `false` para continuar editando.
 *
 * UM PEDIDO POR VEZ: dois cliques seguidos no X (ou o X e o Escape no mesmo
 * instante) recebem a MESMA pergunta, e não duas janelas empilhadas — a segunda
 * resposta seria dada a uma pergunta que a pessoa já não vê.
 *
 * `lugar` só muda o texto ("nesta janela" ou "nesta ficha"); sem ele, é o de
 * sempre.
 */
export function perguntarDescarte(lugar: LugarDoDescarte = 'janela'): Promise<boolean> {
  if (pendente) return pendente.promessa
  if (!ouvinte) {
    // SEM A JANELA MONTADA (não acontece no app: ela fica na raiz, em main.tsx),
    // a pergunta ainda é feita, pelo navegador. Responder "sim" sozinho
    // descartaria o que a pessoa digitou sem perguntar nada.
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(PERGUNTA_DO_DESCARTE))
  }
  let resolver: (sim: boolean) => void = () => {}
  const promessa = new Promise<boolean>((r) => {
    resolver = r
  })
  pendente = { promessa, resolver, lugar }
  ouvinte(true, lugar)
  return promessa
}

/** A resposta da janela: `true` descarta, `false` continua editando. */
export function responderDescarte(sim: boolean): void {
  const p = pendente
  pendente = null
  ouvinte?.(false, p?.lugar ?? 'janela')
  p?.resolver(sim)
}

/**
 * A janela que desenha a pergunta se registra aqui. Devolve a função que
 * desfaz o registro. Uma pergunta em aberto quando a janela sai (o app
 * desmontou) é respondida com "continuar editando": na dúvida, nada se perde.
 */
export function registrarJanelaDeDescarte(fn: Ouvinte): () => void {
  ouvinte = fn
  if (pendente) fn(true, pendente.lugar)
  return () => {
    if (ouvinte !== fn) return
    ouvinte = null
    if (pendente) responderDescarte(false)
  }
}
