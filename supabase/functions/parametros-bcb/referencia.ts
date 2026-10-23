// parametros-bcb/referencia.ts
// A DATA DE REFERÊNCIA SÓ ANDA COM OS DOIS ÍNDICES GRAVADOS (23/10/2026).
//
// Puro, para o vitest alcançar.
//
// `data_referencia` é UMA coluna para os dois índices, e o que ela promete é "o
// mês mais recente que a SELIC E o IPCA gravados já fecharam". Quando um índice
// era gravado e o outro falhava, a competência era calculada só com o que deu
// certo, e a data andava para o mês dele — por cima de um índice que continuava
// o de antes. O relatório passava a dizer "posição de setembro" com um IPCA de
// julho, e nada na tela distinguia isso.
//
// Com um índice só, a competência conjunta é o mínimo entre a dele e a do índice
// velho — que é a data já gravada. Ou seja: não anda. Por isso a data só é
// escrita quando os dois foram gravados nesta passada.

export interface Competencia {
  ano: number
  mes: number
}

/**
 * Último dia do mês mais antigo entre as competências dos dois índices, ou null
 * quando algum dos dois NÃO foi gravado agora (aí a data gravada fica como está).
 */
export function dataDeReferencia(
  selic: Competencia | null,
  ipca: Competencia | null,
): string | null {
  if (!selic || !ipca) return null
  const menor = selic.ano * 12 + selic.mes <= ipca.ano * 12 + ipca.mes ? selic : ipca
  // Último dia do mês de competência: dia 0 do mês seguinte.
  return new Date(Date.UTC(menor.ano, menor.mes, 0)).toISOString().slice(0, 10)
}
