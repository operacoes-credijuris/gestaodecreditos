// Os atalhos de teclado da plataforma (itens "Novo" da amostra): Ctrl+K abre a
// busca geral, "/" vai ao filtro da tela e "?" mostra a lista de atalhos.
//
// A REGRA QUE MAIS IMPORTA É QUANDO NÃO DISPARAR. Quem está digitando — num
// campo, numa caixa de texto (a do Assistente inclusive) ou num editável — não
// pode ter a barra ou a interrogação roubadas do texto. O Ctrl+K é a exceção
// (como na amostra): ele não escreve nada, e no campo o navegador o usaria para
// levar o foco à barra de endereço. E com uma janela aberta, a busca e o filtro
// não agem por baixo dela: a janela pode ter algo digitado que ainda não foi
// salvo.

export type Atalho = 'busca' | 'filtro' | 'atalhos'

/** O que do evento de teclado importa aqui (o teste monta um objeto simples). */
export interface TeclaPressionada {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** Qual atalho a tecla pede, ou null. */
export function qualAtalho(e: TeclaPressionada): Atalho | null {
  // Ctrl+K, e Cmd+K no Mac. Com Alt é outra combinação (o AltGr do teclado
  // brasileiro chega como Ctrl+Alt), e não pode abrir a busca.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') return 'busca'
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.key === '/') return 'filtro'
  if (e.key === '?') return 'atalhos'
  return null
}

/** O que do alvo do evento importa aqui. */
export interface AlvoDaTecla {
  tagName?: string
  isContentEditable?: boolean
  closest?: (seletor: string) => unknown
}

/** O foco está num lugar onde se digita? Então nenhum atalho de letra vale. */
export function estaDigitando(alvo: AlvoDaTecla | null | undefined): boolean {
  if (!alvo) return false
  if (alvo.isContentEditable) return true
  if (/^(INPUT|TEXTAREA|SELECT)$/i.test(alvo.tagName ?? '')) return true
  // DENTRO de um editável (o foco num filho de um contenteditable).
  return !!alvo.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

/**
 * O atalho deve agir agora?
 *
 * - Digitando: o "/" e o "?" não (são letras do texto). O Ctrl+K, sim: não é
 *   letra, e quem o aperta num campo quer buscar — antes, era o navegador que o
 *   pegava e levava o foco à barra de endereço.
 * - Com janela aberta, a busca:
 *   - ALTERADA (algo digitado e não salvo): AVISA, e a janela fica (quem chama
 *     mostra o aviso). O que foi digitado não se perde por um atalho.
 *   - Sem alteração: SUBSTITUI — a janela fecha e a busca abre no lugar dela,
 *     como na amostra. Não há nada a perder.
 * - Com janela aberta, o filtro não faz nada (agiria por baixo dela), e os
 *   atalhos ("?") abrem POR CIMA: é consulta, e consultar não custa o que foi
 *   digitado embaixo.
 *
 * `janelaAlterada` vale `true` quando não se sabe: o seguro é avisar.
 */
export function decidirAtalho(
  atalho: Atalho,
  alvo: AlvoDaTecla | null | undefined,
  janelaAberta: boolean,
  janelaAlterada = true,
): 'agir' | 'avisar' | 'substituir' | 'ignorar' {
  if (atalho === 'busca') {
    if (!janelaAberta) return 'agir'
    return janelaAlterada ? 'avisar' : 'substituir'
  }
  if (estaDigitando(alvo)) return 'ignorar'
  if (!janelaAberta || atalho === 'atalhos') return 'agir'
  return 'ignorar'
}

/** O aviso do Ctrl+K com uma janela alterada aberta (o texto da amostra). */
export const AVISO_DA_BUSCA_COM_JANELA_ALTERADA =
  'Salve ou feche a janela aberta antes de buscar — o que foi digitado nela ainda não foi salvo.'

/** A lista que a janela "Atalhos de teclado" mostra (a da amostra). */
export const LISTA_DE_ATALHOS: readonly { teclas: readonly string[]; descricao: string }[] = [
  { teclas: ['Ctrl', 'K'], descricao: 'Buscar crédito, card, contato ou tela' },
  { teclas: ['/'], descricao: 'Ir para o filtro da tela' },
  { teclas: ['?'], descricao: 'Ver estes atalhos' },
  { teclas: ['Esc'], descricao: 'Fechar janela, menu ou painel' },
  { teclas: ['Ctrl', 'Enter'], descricao: 'Enviar a anotação' },
  { teclas: ['←', '→'], descricao: 'Andar entre abas' },
]
