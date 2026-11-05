/**
 * motorAtualizacao — atalho de cenário financeiro (Fase 1).
 *
 * NÃO equivale à atualização jurídica homologada de cada precatório.
 * Usa duas taxas anuais de cenário (a vencer / em mora) com juros simples
 * dentro do ano. Valores aportados às contas especiais deixam de ser
 * atualizados a partir do aporte (§ 30; Provimento CNJ 207/2025, art. 10).
 */
import type { Centavos, MomentoDeposito } from '../dominio/tipos';
import { arred } from '../dominio/dinheiro';

/**
 * Fração do ano que resta, em média, depois de cada aporte.
 * - inicio: tudo aportado em 1º/jan (nada do aporte é atualizado);
 * - mensal: 12 aportes iguais no fim de cada mês → média (11+10+…+0)/144 = 66/144;
 * - meio: um aporte em 1º/jul;
 * - fim: um aporte em 31/dez (o valor aportado é atualizado o ano todo).
 */
export const FRACAO_RESTANTE: Record<MomentoDeposito, number> = {
  inicio: 1,
  mensal: 66 / 144,
  meio: 0.5,
  fim: 0,
};

export const ROTULO_MOMENTO: Record<MomentoDeposito, string> = {
  inicio: 'Em 1º de janeiro',
  mensal: 'Mensal, em parcelas iguais',
  meio: 'Em 1º de julho',
  fim: 'Em 31 de dezembro',
};

/**
 * Atualização do ano sobre um saldo que recebe um aporte no momento indicado:
 *   atualização = saldo × taxa − aporte × taxa × fração_restante
 * O valor aportado só é atualizado até a data do aporte (T18).
 */
export function atualizacaoComAporte(saldo: Centavos, taxa: number, aporte: Centavos, momento: MomentoDeposito): Centavos {
  const f = FRACAO_RESTANTE[momento];
  return arred(saldo * taxa - aporte * taxa * f);
}

/** Maior aporte que um saldo pode absorver no ano sem ficar negativo (quitação integral). */
export function aporteMaximoParaQuitar(saldo: Centavos, taxa: number, momento: MomentoDeposito): Centavos {
  if (saldo <= 0) return 0;
  const f = FRACAO_RESTANTE[momento];
  return arred((saldo * (1 + taxa)) / (1 + taxa * f));
}
