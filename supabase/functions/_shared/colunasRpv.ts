// AS COLUNAS DO RPV PARA ONDE A `kommo-mover` ACEITA MOVER UM CARD, e o nome com
// que cada uma aparece na anotação de auditoria que ela grava no card.
//
// SAIU DE `kommo-mover/index.ts` PARA SER LIDA POR TESTE. É a lista de permissão
// do servidor no funil de RPV — o que não está aqui é recusado com "Coluna de
// destino não reconhecida" —, e mover card no Kommo dispara automações que não
// se desfazem. O `matrizDeMovimentos.test.ts` a escreve por extenso: destino novo
// aqui só passa se alguém mudar o teste junto, de propósito.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, como `trilhasDoPrecatorio.ts`: o
// mesmo arquivo roda na Edge Function e no vitest do site.

/**
 * O DESFECHO DA NEGOCIAÇÃO NO RPV (etapa 10a do redesenho, 02/10/2026): da
 * Negociação (107830039), o card vai para Fechados, Não fechado ou Sem resposta.
 * Os ids são os do `kommo_etapa` de 02/10/2026.
 *
 * O MESMO DESENHO DO `negociacao` DAS TRILHAS DO PRECATÓRIO: entra primeiro só no
 * servidor. No RPV a tela não lê `COLUNAS` para desenhar botão (os botões saem de
 * `ACOES`, em `src/lib/kommo.ts`), então acrescentar aqui não põe botão nenhum na
 * tela oficial. A Negociação em si é a ORIGEM, e não destino: não entra em
 * `COLUNAS`. A nota destes três sai com o serviço "Comercial" (ver
 * `servicoDaNota.ts`).
 */
export const NEGOCIACAO_RPV = {
  coluna: 107830039,
  fechados: 107830043,
  naoFechados: 107830067,
  semResposta: 112466388,
} as const

/** Os três destinos do desfecho da Negociação no RPV. */
export const DESTINOS_DA_NEGOCIACAO_RPV: ReadonlySet<number> = new Set([
  NEGOCIACAO_RPV.fechados,
  NEGOCIACAO_RPV.naoFechados,
  NEGOCIACAO_RPV.semResposta,
])

/** Colunas do Funil Geral RPV para as quais o app permite mover. */
export const COLUNAS: Record<number, string> = {
  107272803: 'Análise Jurídica-Econômico',
  107272807: 'Revisão e Decisão do Pedro',
  107830027: 'Diligência',
  107830035: 'Apresentação de Proposta',
  107830031: 'Reprovados Operacional',
  // O DESFECHO DA NEGOCIAÇÃO — ver `NEGOCIACAO_RPV`. Os nomes são os do kanban
  // de 02/10/2026, e ficam só de reserva: a nota usa o nome do `kommo_etapa`.
  [NEGOCIACAO_RPV.fechados]: 'Fechados',
  [NEGOCIACAO_RPV.naoFechados]: 'Não fechado',
  [NEGOCIACAO_RPV.semResposta]: 'Sem resposta',
}
