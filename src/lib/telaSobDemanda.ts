// AS TELAS CARREGADAS SOB DEMANDA (revisão pós-virada, 03/10/2026).
//
// O pacote era UM arquivo de 2,4 MB: quem abria a plataforma baixava, antes da
// primeira tela, o Quadro (com os gráficos), a geração de contratos, as
// Publicações e tudo o mais. Agora cada tela do menu é um pedaço próprio, baixado
// quando se abre; o pacote de entrada fica com o que toda tela usa (layout,
// sessão, busca, componentes).
//
// O RISCO QUE ISSO TRAZ, E QUE ESTE MÓDULO TRATA: a plataforma fica aberta o dia
// inteiro. Quando sai uma versão nova, o GitHub Pages troca a pasta inteira, e os
// pedaços da versão antiga deixam de existir. Quem está com a aba aberta desde
// cedo clica numa tela que ainda não tinha aberto, e o navegador pede um arquivo
// que já não está lá: sem tratamento, a tela não abre. Aqui, essa falha vira UMA
// recarga da página (que traz a versão nova); se a recarga já aconteceu há pouco
// e o pedaço continua faltando — rede fora, por exemplo —, não recarrega de novo
// (seria um laço), e o erro segue para o limite de erro do layout, que explica.

import { lazy, type ComponentType } from 'react'

/** Onde fica a hora da última recarga por pedaço faltando (sessionStorage, por aba). */
export const CHAVE_DA_RECARGA = 'credijuris.recargaPorVersao'

/** Abaixo disto, uma segunda falha não recarrega de novo: é laço, não versão nova. */
export const INTERVALO_ENTRE_RECARGAS_MS = 30_000

/**
 * O erro é de um pedaço do pacote que não chegou? As mensagens são as dos
 * navegadores (Chrome/Edge, Firefox e Safari) e a do Vite ao pré-carregar CSS.
 */
export function ehFalhaDeCarga(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk \d+ failed/i.test(
    msg,
  )
}

/** Recarregar agora? Só se não houve recarga por este motivo nos últimos instantes. */
export function deveRecarregar(
  agora: number,
  ultima: number | null,
  intervalo: number = INTERVALO_ENTRE_RECARGAS_MS,
): boolean {
  if (ultima === null || !Number.isFinite(ultima)) return true
  // Relógio que voltou (ultima no futuro) conta como "não houve recarga".
  return agora - ultima > intervalo || agora < ultima
}

/**
 * Recarrega a página para buscar a versão publicada, se ainda não o fez há pouco.
 * Devolve se recarregou. SEM sessionStorage não há como saber se já tentou, e
 * então não recarrega: melhor o aviso do layout que um laço de recargas.
 */
export function recarregarPorVersaoNova(): boolean {
  try {
    const guardada = window.sessionStorage.getItem(CHAVE_DA_RECARGA)
    const agora = Date.now()
    if (!deveRecarregar(agora, guardada === null ? null : Number(guardada))) return false
    window.sessionStorage.setItem(CHAVE_DA_RECARGA, String(agora))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/**
 * Uma PEÇA sob demanda que vive fora das telas — no layout, presente em toda
 * página (a busca geral, o leitor de Markdown do assistente). Falhando o pedaço,
 * entra a `reserva`, e NÃO há recarga: a pessoa pode estar no meio de outra
 * coisa (um formulário, uma conversa), e recarregar sem ela pedir levaria isso
 * embora. Sem a reserva, a falha subiria até a raiz e a plataforma inteira
 * ficaria em branco — o layout não tem limite de erro acima dele.
 */
export function pecaSobDemanda<P extends object>(
  importar: () => Promise<ComponentType<P>>,
  reserva: ComponentType<P>,
) {
  return lazy(() =>
    importar()
      .then((c) => ({ default: c }))
      .catch((e: unknown) => {
        console.error('Não foi possível carregar uma parte da plataforma.', e)
        return { default: reserva }
      }),
  )
}

/**
 * Uma tela carregada sob demanda (o `React.lazy`, com a recarga acima).
 *
 * `adiantar` começa a baixar já, sem esperar a tela ser pedida: é o caso da tela
 * em que a plataforma abre (`INICIO`), que assim chega junto com a sessão em vez
 * de esperar por ela.
 */
export function telaSobDemanda<T extends ComponentType<object>>(
  importar: () => Promise<{ default: T }>,
  { adiantar = false }: { adiantar?: boolean } = {},
) {
  let adiantada: Promise<{ default: T }> | null = adiantar ? importar() : null
  // A rejeição do adiantamento é tratada quando a tela for pedida; até lá, não
  // pode virar "unhandled rejection" no console.
  adiantada?.catch(() => {})
  return lazy(() => {
    const pedido = adiantada ?? importar()
    adiantada = null
    return pedido.catch((e: unknown) => {
      // Recarregando, a promessa fica pendente: a página vai embora antes.
      if (ehFalhaDeCarga(e) && recarregarPorVersaoNova()) return new Promise<never>(() => {})
      throw e
    })
  })
}
