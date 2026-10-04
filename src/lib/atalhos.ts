// Os atalhos de teclado da plataforma (itens "Novo" da amostra): Ctrl+K abre a
// busca geral, "/" vai ao filtro da tela e "?" mostra a lista de atalhos. E,
// da revisão de qualidade de vida (03/10/2026), "G" e depois a letra vai a uma
// tela (`NAVEGACAO_POR_LETRA`).
//
// A REGRA QUE MAIS IMPORTA É QUANDO NÃO DISPARAR. Quem está digitando — num
// campo, numa caixa de texto (a do Assistente inclusive) ou num editável — não
// pode ter a barra ou a interrogação roubadas do texto. O Ctrl+K é a exceção
// (como na amostra): ele não escreve nada, e no campo o navegador o usaria para
// levar o foco à barra de endereço. E com uma janela aberta, a busca e o filtro
// não agem por baixo dela: a janela pode ter algo digitado que ainda não foi
// salvo.

export type Atalho = 'busca' | 'filtro' | 'atalhos' | 'navegar' | 'menu'

/**
 * A tecla que recolhe e abre o menu lateral (auditoria visual, 03/10/2026). O
 * "[" de editores e de aplicativos de mensagem para a barra lateral; não colide
 * com "/", "?", Ctrl+K, G+letra nem J/K. Mesmas regras do "/": digitando, ou com
 * uma janela aberta, não age. Quem age é o próprio menu (layout/Sidebar.tsx).
 */
export const TECLA_DO_MENU = '['

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
  if (e.key === TECLA_DO_MENU) return 'menu'
  // O "G" QUE COMEÇA A SEQUÊNCIA "ir para" (G e depois a letra da tela). Só o
  // minúsculo: com Shift ou Caps Lock é outra coisa, e não navega por engano.
  if (e.key === PREFIXO_DE_NAVEGACAO) return 'navegar'
  return null
}

// ─── "G" e depois a letra: ir para uma tela ─────────────────────────────────
//
// O PADRÃO DOS APLICATIVOS WEB (GitHub, Gmail): "g" e, logo depois, a letra da
// tela. Duas teclas sem modificador, longe de qualquer campo — as regras de
// quando não agir são as mesmas do "/" e do "?" (`decidirAtalho`): digitando,
// ou com uma janela aberta, não navega (sair da tela fecharia a janela com o que
// foi digitado nela).

/** A tecla que abre a sequência. */
export const PREFIXO_DE_NAVEGACAO = 'g'

/** Quanto tempo o "g" espera pela letra da tela (ms). Passou, vale nada. */
export const ESPERA_DO_PREFIXO_MS = 1500

/**
 * As letras e as telas, na ordem do menu. A letra é a do nome sempre que dá;
 * quando duas telas disputam a mesma, fica com a mais usada (Créditos é o "c",
 * Contatos é o "o" de cOntatos, Geração de contratos é o "g" de novo).
 * Configurações fica de fora: é só de administrador, e raro.
 *
 * FORA DAS LETRAS: "j" e "k" (andam entre os cards da Análise de crédito), "/"
 * e "?". O teste confere.
 */
export const NAVEGACAO_POR_LETRA: readonly { letra: string; to: string; rotulo: string }[] = [
  { letra: 'a', to: '/operacional/analise', rotulo: 'Análise de crédito' },
  { letra: 'd', to: '/comercial/dados-pessoais', rotulo: 'Dados cadastrais' },
  { letra: 'g', to: '/comercial/contratos', rotulo: 'Geração de contratos' },
  { letra: 'p', to: '/operacional/execucao/publicacoes', rotulo: 'Publicações e movimentações' },
  { letra: 't', to: '/operacional/execucao/tarefas', rotulo: 'Tarefas' },
  { letra: 'c', to: '/operacional/execucao/processos', rotulo: 'Créditos' },
  { letra: 'r', to: '/operacional/execucao/requerimentos', rotulo: 'Requerimentos administrativos' },
  { letra: 'o', to: '/operacional/execucao/contatos', rotulo: 'Contatos' },
  { letra: 'q', to: '/inteligencia', rotulo: 'Quadro econômico' },
]

/**
 * A tela da segunda tecla, se ela veio a tempo; senão null. Com modificador
 * (Ctrl+C logo depois de um "g" solto), não é a sequência.
 */
export function destinoDaSequencia(
  e: TeclaPressionada,
  prefixoEm: number | null,
  agora: number,
  espera: number = ESPERA_DO_PREFIXO_MS,
): string | null {
  if (prefixoEm === null || agora - prefixoEm > espera || agora < prefixoEm) return null
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  return NAVEGACAO_POR_LETRA.find((n) => n.letra === e.key)?.to ?? null
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
  { teclas: ['Ctrl', 'Enter'], descricao: 'Na busca: abrir a tela ou o card numa aba nova' },
  { teclas: ['/'], descricao: 'Ir para o filtro da tela' },
  { teclas: ['G', 'letra'], descricao: 'Ir para uma tela (as letras estão abaixo)' },
  { teclas: ['?'], descricao: 'Ver estes atalhos' },
  { teclas: [TECLA_DO_MENU], descricao: 'Recolher ou abrir o menu lateral' },
  { teclas: ['Esc'], descricao: 'Fechar janela, menu ou painel' },
  { teclas: ['Esc'], descricao: 'No campo de busca: limpar a busca' },
  { teclas: ['J', 'K'], descricao: 'Andar entre os cards (Análise de crédito)' },
  { teclas: ['Ctrl', 'Enter'], descricao: 'Enviar a anotação' },
  { teclas: ['Enter'], descricao: 'Enviar a pergunta ao assistente (Shift + Enter quebra a linha)' },
  { teclas: ['←', '→'], descricao: 'Andar entre abas' },
]
