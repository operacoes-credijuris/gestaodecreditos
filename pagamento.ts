// NÚCLEO COMPARTILHADO — a regra de "este crédito foi pago?".
//
// Resposta única em toda a plataforma, frontend e Edge Functions.

import { diasEntre } from './datas.ts'

/**
 * "Este crédito foi pago?" — a única resposta na plataforma.
 *
 * É a PRESENÇA da data efetiva de liquidação que decide, nunca o campo de status
 * nem a expectativa. Quatro lugares dependiam disso (valorProjetado, statusTir,
 * diasEmCarteira e aReceberEstimado) e o teste estava escrito em cinco grafias,
 * uma delas sem o `slice` — o que já divergia no Excel entregue ao investidor.
 */
export function estaPago(dataLiquidacao: string | null | undefined): boolean {
  return !!(dataLiquidacao ?? '').slice(0, 10)
}

/**
 * Dias em carteira — CALCULADO. Enquanto o crédito não foi pago, conta da
 * cessão até hoje; quando foi pago, PARA na data de liquidação, porque crédito
 * liquidado saiu da carteira e não segue acumulando tempo.
 *
 * ⚠️ A data de corte é `data_liquidacao` (coluna "Data receb. efetivo" da
 * carteira), NUNCA `expectativa_liquidacao` (coluna "Data est. recebimento"):
 * a expectativa é previsão, e usá-la contaria tempo que pode nunca ter
 * existido. É o mesmo campo que acende o verde em statusLiquidacao e o
 * "Efetivada" em statusTir — as três regras giram em torno de estaPago().
 */
export function diasEmCarteira(
  dataAquisicao: string | null | undefined,
  dataLiquidacao: string | null | undefined,
  hoje: string,
): number | null {
  const fim = estaPago(dataLiquidacao) ? dataLiquidacao!.slice(0, 10) : hoje
  const dias = diasEntre(dataAquisicao, fim)
  // Prazo negativo é dado inconsistente, não "zero dia": acontece com erro de
  // ano na data de liquidação (01/12/2025 no lugar de 01/12/2026), e a célula
  // imprimia "-40" como se fosse informação. Devolvendo null, a coluna mostra
  // "—" e não finge saber. O formulário de Créditos agora barra a inversão na
  // origem; isto é a rede de baixo, para o que já está gravado.
  if (dias !== null && dias < 0) return null
  return dias
}
