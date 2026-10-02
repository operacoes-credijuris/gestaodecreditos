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

/** Colunas do Funil Geral RPV para as quais o app permite mover. */
export const COLUNAS: Record<number, string> = {
  107272803: 'Análise Jurídica-Econômico',
  107272807: 'Revisão e Decisão do Pedro',
  107830027: 'Diligência',
  107830035: 'Apresentação de Proposta',
  107830031: 'Reprovados Operacional',
}
