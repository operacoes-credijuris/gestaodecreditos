// Regras puras da bullai-certidoes (sem `npm:`), para a Edge Function e os
// testes do Vitest importarem o mesmo código.

/**
 * AS DATAS DA CERTIDÃO SÓ NA PASSAGEM PARA OBTIDA (23/10/2026). Enquanto o job
 * fica aberto, cada "atualizar" relia o resultado e regravava `emitida_em = hoje`
 * e `validade_ate` nos itens que JÁ estavam OBTIDA — a certidão de segunda-feira
 * aparecia emitida na sexta, e a validade andava junto, escondendo o vencimento.
 * Devolve os campos a gravar: as datas quando o item ainda não era OBTIDA, nada
 * quando já era.
 */
export function datasDaObtencao(
  statusAnterior: string | null | undefined,
  hoje: string,
  validade: string | null,
): { emitida_em?: string; validade_ate?: string | null } {
  if (statusAnterior === 'OBTIDA') return {}
  return { emitida_em: hoje, validade_ate: validade }
}
