// Os atalhos de teclado da plataforma (itens "Novo" da amostra): Ctrl+K abre a
// busca geral, "/" vai ao filtro da tela e "?" mostra a lista de atalhos.
//
// A REGRA QUE MAIS IMPORTA É QUANDO NÃO DISPARAR. Quem está digitando — num
// campo, numa caixa de texto (a do Assistente inclusive) ou num editável — não
// pode ter a barra ou a interrogação roubadas do texto, nem ser arrancado dali
// por uma janela que se abre. E com uma janela aberta, a busca e o filtro não
// agem por baixo dela: a janela pode ter algo digitado que ainda não foi salvo.

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
 * - Digitando: nenhum.
 * - Com janela aberta: a busca AVISA (quem chama mostra o aviso) e o filtro não
 *   faz nada — os dois agiriam por baixo da janela. Os atalhos ("?") abrem POR
 *   CIMA dela: é consulta, e consultar não custa o que foi digitado embaixo.
 */
export function decidirAtalho(
  atalho: Atalho,
  alvo: AlvoDaTecla | null | undefined,
  janelaAberta: boolean,
): 'agir' | 'avisar' | 'ignorar' {
  if (estaDigitando(alvo)) return 'ignorar'
  if (!janelaAberta || atalho === 'atalhos') return 'agir'
  return atalho === 'busca' ? 'avisar' : 'ignorar'
}

/** A lista que a janela "Atalhos de teclado" mostra (a da amostra). */
export const LISTA_DE_ATALHOS: readonly { teclas: readonly string[]; descricao: string }[] = [
  { teclas: ['Ctrl', 'K'], descricao: 'Buscar crédito, card, contato ou tela' },
  { teclas: ['/'], descricao: 'Ir para o filtro da tela' },
  { teclas: ['?'], descricao: 'Ver estes atalhos' },
  { teclas: ['Esc'], descricao: 'Fechar janela, menu ou painel' },
  { teclas: ['Ctrl', 'Enter'], descricao: 'Enviar a anotação' },
  { teclas: ['←', '→'], descricao: 'Andar entre abas' },
]
