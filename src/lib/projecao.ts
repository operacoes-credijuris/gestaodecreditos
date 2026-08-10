// Projeção do valor do crédito — coluna "Valor projetado" da carteira.
//
// Duas situações, e a primeira não é projeção nenhuma:
//   LIQUIDADO      o valor é o que efetivamente entrou (coluna "Já recebido").
//                  Não se projeta o que já aconteceu.
//   NÃO LIQUIDADO  atualiza o VALOR DE FACE da data de referência do face até a
//                  data estimada de recebimento, pelo índice cadastrado no
//                  crédito (SELIC ou IPCA + 2%).
import { mesesEntre } from './format'

export interface ParametrosAtualizacao {
  /** SELIC vigente em % ao ano, como digitado (15.00 = 15%). */
  selic_aa: number | null
  /** IPCA acumulado 12 meses em % ao ano, como digitado. */
  ipca_12m_aa: number | null
  /** Competência do relatório. */
  data_referencia: string | null
}

/**
 * IPCA + 2% a.a. por SOMA SIMPLES, por definição do produto: IPCA de 4,50 vira
 * 6,50. A composição financeira daria 6,59 ((1,045 × 1,02) − 1), diferença de
 * 0,09 ponto — irrelevante no resultado e a soma é a leitura que se usa aqui.
 */
export function ipcaMais2(ipca: number | null | undefined): number | null {
  return typeof ipca === 'number' && !Number.isNaN(ipca) ? ipca + 2 : null
}

/**
 * REGIME DE CAPITALIZAÇÃO da projeção.
 *
 * 'simples'  valor × (1 + taxa × anos)   — definido pelo produto
 * 'composta' valor × (1 + taxa) ^ anos   — convenção de mercado
 *
 * Iguais em exatamente 1 ano. Abaixo de 1 ano a simples devolve um pouco mais;
 * acima, devolve menos, e a diferença cresce com o prazo (a 15% a.a., em 3 anos
 * a simples fica ~4,7% abaixo da composta). A simples erra para baixo, o que num
 * número mostrado a investidor é o lado seguro de errar. Trocar aqui troca a
 * tela e o Excel juntos.
 */
export const CAPITALIZACAO: 'simples' | 'composta' = 'simples'

/** Taxa anual em % aplicável ao crédito, conforme o índice cadastrado nele. */
export function taxaAnual(
  indice: string | null | undefined,
  params: ParametrosAtualizacao | undefined,
): number | null {
  if (!params) return null
  if (indice === 'selic') {
    return typeof params.selic_aa === 'number' ? params.selic_aa : null
  }
  if (indice === 'ipca_2') return ipcaMais2(params.ipca_12m_aa)
  return null
}

/** Campos do crédito que a projeção usa. */
export interface CreditoProjecao {
  valor_face: number | null
  data_referencia: string | null
  expectativa_liquidacao: string | null
  data_liquidacao: string | null
  ja_recebido: number | null
  indice_atualizacao: string | null
}

export interface Projecao {
  valor: number | null
  /** Por que não há valor, para a célula explicar o "—" em vez de só exibi-lo. */
  motivo?: string
  /** true quando o valor é o recebido de fato, não uma projeção. */
  realizado: boolean
}

export function valorProjetado(
  c: CreditoProjecao,
  params: ParametrosAtualizacao | undefined,
): Projecao {
  // Liquidado: o valor é o que entrou, não uma projeção.
  if ((c.data_liquidacao ?? '').slice(0, 10)) {
    if (typeof c.ja_recebido !== 'number') {
      return { valor: null, motivo: 'Crédito liquidado sem valor recebido cadastrado.', realizado: true }
    }
    return { valor: c.ja_recebido, realizado: true }
  }

  if (typeof c.valor_face !== 'number') {
    return { valor: null, motivo: 'Sem valor de face cadastrado.', realizado: false }
  }
  if (!c.indice_atualizacao) {
    return { valor: null, motivo: 'Sem índice de atualização cadastrado.', realizado: false }
  }
  const taxa = taxaAnual(c.indice_atualizacao, params)
  if (taxa === null) {
    return {
      valor: null,
      motivo: 'Parâmetro do índice não informado. Preencha em Parâmetros de atualização.',
      realizado: false,
    }
  }
  const meses = mesesEntre(c.data_referencia, c.expectativa_liquidacao)
  if (meses === null) {
    return {
      valor: null,
      motivo: 'Falta a data de referência do face ou a data estimada de recebimento.',
      realizado: false,
    }
  }
  // Prazo negativo (estimativa anterior à referência do face) não encurta o
  // valor: sem tempo a correr, o projetado é o próprio face.
  const anos = Math.max(0, meses) / 12
  const i = taxa / 100
  const fator =
    CAPITALIZACAO === 'composta' ? Math.pow(1 + i, anos) : 1 + i * anos
  // Arredonda a centavos: é dinheiro, e o resíduo de float vazaria para o Excel.
  return { valor: Math.round(c.valor_face * fator * 100) / 100, realizado: false }
}
