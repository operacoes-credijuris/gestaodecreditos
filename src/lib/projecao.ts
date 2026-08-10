// Projeção do valor do crédito — coluna "Valor projetado" da carteira.
//
// Duas situações, e a primeira não é projeção nenhuma:
//   LIQUIDADO      o valor é o que efetivamente entrou (coluna "Já recebido").
//                  Não se projeta o que já aconteceu.
//   NÃO LIQUIDADO  atualiza o VALOR DE FACE da data de referência do face até a
//                  data estimada de recebimento, pelo índice cadastrado no
//                  crédito (SELIC ou IPCA + 2%).
import { diasEntre, mesesEntre } from './format'

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
  /** Data até onde o face foi atualizado (ISO). Ausente quando não houve conta. */
  atualizadoAte?: string
  /** true quando a expectativa venceu e a atualização seguiu até hoje. */
  expectativaVencida?: boolean
}

export function valorProjetado(
  c: CreditoProjecao,
  params: ParametrosAtualizacao | undefined,
  hoje: string,
): Projecao {
  // Liquidado: o valor é o que entrou, não uma projeção.
  const liq = (c.data_liquidacao ?? '').slice(0, 10)
  if (liq) {
    if (typeof c.ja_recebido !== 'number') {
      return { valor: null, motivo: 'Crédito liquidado sem valor recebido cadastrado.', realizado: true }
    }
    // atualizadoAte também no caso realizado: o campo significa "data a que o
    // valor se refere", e a TIR precisa dele para casar valor e prazo.
    return { valor: c.ja_recebido, realizado: true, atualizadoAte: liq }
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
  const exp = (c.expectativa_liquidacao ?? '').slice(0, 10)
  if (!c.data_referencia || !exp) {
    return {
      valor: null,
      motivo: 'Falta a data de referência do face ou a data estimada de recebimento.',
      realizado: false,
    }
  }
  // EXPECTATIVA VENCIDA E CRÉDITO NÃO PAGO: atualiza até HOJE, não até a
  // expectativa. Parar na data vencida congelaria o valor no dia em que o prazo
  // furou, subestimando justamente os créditos que mais demoram — o tempo
  // correu de fato e a correção acompanha. Daí o fim ser o MAIOR entre os dois.
  const vencida = exp < hoje
  const fim = vencida ? hoje : exp
  const meses = mesesEntre(c.data_referencia, fim)
  if (meses === null) {
    return {
      valor: null,
      motivo: 'Falta a data de referência do face ou a data estimada de recebimento.',
      realizado: false,
    }
  }
  // Prazo negativo (data final anterior à referência do face) não encurta o
  // valor: sem tempo a correr, o projetado é o próprio face.
  const anos = Math.max(0, meses) / 12
  const i = taxa / 100
  const fator =
    CAPITALIZACAO === 'composta' ? Math.pow(1 + i, anos) : 1 + i * anos
  return {
    // Arredonda a centavos: é dinheiro, e o resíduo de float vazaria para o Excel.
    valor: Math.round(c.valor_face * fator * 100) / 100,
    realizado: false,
    atualizadoAte: fim,
    expectativaVencida: vencida,
  }
}

/**
 * Ganho projetado do crédito.
 *
 *   ganho = (valor projetado − capital investido) + valor estimado complementar
 *
 * Primeiro a diferença entre o projetado e o capital, e sobre ela soma-se o
 * complementar. Escrito como `valor + comp − capital` porque é a mesma conta,
 * mas a ordem acima é a regra como o produto a enuncia.
 *
 * O complementar é RECEBÍVEL, nunca custo: nos créditos que o têm preenchido,
 * todos já liquidados, ele é o resto a receber por cima do que entrou (capital
 * 7.681,17 / recebido 10.248,89 / complementar 839,81 → ganho 3.407,53). Passá-lo
 * para o lado do capital daria 1.727,91 e subestimaria o ganho em duas vezes o
 * complementar.
 */
export function ganhoProjetado(
  proj: Projecao,
  capitalInvestido: number | null | undefined,
  valorComplementar: number | null | undefined,
): number | null {
  if (proj.valor === null) return null
  if (typeof capitalInvestido !== 'number') return null
  const comp = typeof valorComplementar === 'number' ? valorComplementar : 0
  return Math.round((proj.valor + comp - capitalInvestido) * 100) / 100
}

/**
 * Retorno do crédito, em % sobre o capital investido.
 *
 *   retorno = ganho projetado / capital investido × 100
 */
export function retorno(
  ganho: number | null,
  capitalInvestido: number | null | undefined,
): number | null {
  if (ganho === null) return null
  if (typeof capitalInvestido !== 'number' || capitalInvestido <= 0) return null
  return Math.round((ganho / capitalInvestido) * 10000) / 100
}

/**
 * Retorno projetado da carteira: soma dos ganhos dividida pela soma dos capitais.
 *
 * É AGREGADO, e não média dos retornos individuais — assim cada real investido
 * pesa igual, e um crédito pequeno de retorno alto não distorce o número.
 *
 * Crédito cujo ganho não dá para calcular fica fora das DUAS somas. Deixar o
 * capital dele no denominador sem o ganho correspondente no numerador equivaleria
 * a afirmar que rendeu zero, quando o que falta é cadastro.
 */
export function retornoProjetadoCarteira(
  itens: { ganho: number | null; capital: number | null | undefined }[],
): { valor: number | null; considerados: number } {
  let somaGanho = 0
  let somaCapital = 0
  let considerados = 0
  for (const it of itens) {
    if (it.ganho === null) continue
    if (typeof it.capital !== 'number' || it.capital <= 0) continue
    somaGanho += it.ganho
    somaCapital += it.capital
    considerados++
  }
  if (somaCapital === 0) return { valor: null, considerados: 0 }
  return {
    valor: Math.round((somaGanho / somaCapital) * 10000) / 100,
    considerados,
  }
}

/**
 * "A receber estimado" da carteira. Soma DUAS parcelas, porque há dinheiro por
 * vir em dois estados diferentes:
 *
 *   1. créditos ainda NÃO liquidados  -> o valor projetado inteiro;
 *   2. créditos JÁ liquidados que ainda têm complementar pendente -> só o
 *      complementar, já que o principal entrou.
 *
 * Sem a segunda parcela o card ignorava o complementar a receber dos créditos
 * liquidados — na base de 2026-08, R$ 93 mil que o investidor ainda vai receber.
 */
export function aReceberEstimado(
  itens: {
    proj: Projecao
    dataLiquidacao: string | null | undefined
    valorComplementar: number | null | undefined
  }[],
): { total: number | null; emAberto: number; complementares: number } {
  let total = 0
  let emAberto = 0
  let complementares = 0
  for (const it of itens) {
    const liquidado = !!(it.dataLiquidacao ?? '').slice(0, 10)
    if (!liquidado) {
      if (it.proj.valor === null) continue
      total += it.proj.valor
      emAberto++
      continue
    }
    const comp = it.valorComplementar
    if (typeof comp === 'number' && comp > 0) {
      total += comp
      complementares++
    }
  }
  const nenhum = emAberto === 0 && complementares === 0
  return {
    total: nenhum ? null : Math.round(total * 100) / 100,
    emAberto,
    complementares,
  }
}

/**
 * TIR da CARTEIRA, tratada como um fluxo único.
 *
 *   taxa = (Σ valor / Σ capital) ^ (365 / prazo médio ponderado) − 1
 *
 * O prazo médio é ponderado pelo capital, então cada crédito pesa pelo dinheiro
 * que representa.
 *
 * POR QUE NÃO É A MÉDIA DAS TIRs ANUAIS. Tirar média de taxas já anualizadas
 * deixa um crédito de prazo curto dominar o resultado. Na base de 2026-08 um
 * crédito real liquidado em 12 DIAS com ganho de 21,8% tem TIR de 40.426% a.a.
 * — número correto para ele —, e sozinho puxava a média da carteira para 406%,
 * respondendo por 344 dos 406 pontos. Ninguém ganhou 406% ali: entraram 2,2
 * milhões e voltam 2,9 em prazo médio de 276 dias, ou seja ~46,5% a.a. A média
 * de taxas superestimava a realidade em nove vezes.
 *
 * NADA É EXCLUÍDO. Todo crédito entra com o capital e o valor reais; o que muda
 * é não anualizar cada um isoladamente antes de somar. A TIR individual de cada
 * crédito continua exibida como é, inclusive os 40.426%.
 *
 * Crédito sem valor, sem capital ou sem prazo fica fora das somas — entrar com
 * zero afirmaria rentabilidade zero onde falta cadastro.
 */
export function tirAgregada(
  itens: {
    capital: number | null | undefined
    valor: number | null
    dias: number | undefined
  }[],
): { valor: number | null; considerados: number; prazoMedioDias: number | null } {
  let somaCapital = 0
  let somaValor = 0
  let somaDiasPonderados = 0
  let considerados = 0
  for (const it of itens) {
    if (typeof it.capital !== 'number' || it.capital <= 0) continue
    if (it.valor === null || typeof it.dias !== 'number' || it.dias <= 0) continue
    somaCapital += it.capital
    somaValor += it.valor
    somaDiasPonderados += it.dias * it.capital
    considerados++
  }
  if (somaCapital === 0) return { valor: null, considerados: 0, prazoMedioDias: null }
  const prazoMedio = somaDiasPonderados / somaCapital
  if (prazoMedio <= 0) return { valor: null, considerados, prazoMedioDias: null }
  const taxa = (Math.pow(somaValor / somaCapital, 365 / prazoMedio) - 1) * 100
  if (!Number.isFinite(taxa)) return { valor: null, considerados, prazoMedioDias: null }
  return {
    valor: Math.round(taxa * 100) / 100,
    considerados,
    prazoMedioDias: Math.round(prazoMedio),
  }
}

// ---------------------------------------------------------------------------
// TIR
// ---------------------------------------------------------------------------

export interface Tir {
  /** % ao ano. */
  anual: number | null
  /** % ao mês. */
  mensal: number | null
  /** Dias entre a cessão e a data a que o valor se refere. */
  dias?: number
  /** Data final usada, para a célula poder explicar o prazo. */
  ate?: string
  motivo?: string
}

const SEM_TIR = (motivo: string): Tir => ({ anual: null, mensal: null, motivo })

/**
 * TIR do crédito, tratado como fluxo único: sai `capital_investido` na data da
 * cessão e entra o valor da coluna "Valor projetado" na data a que esse valor se
 * refere.
 *
 *   anual  = (valor / capital) ^ (365 / dias) − 1
 *   mensal = (1 + anual) ^ (1/12) − 1
 *
 * É taxa EQUIVALENTE (composta), não a simples da projeção do valor: TIR é, por
 * definição, a taxa que desconta o fluxo, e anualizar de forma linear daria um
 * número que não se compara com nenhuma taxa de mercado.
 *
 * ⚠️ O PRAZO NÃO É "Dias em carteira". Aquela coluna conta até HOJE, enquanto o
 * valor projetado de um crédito com expectativa futura se refere a uma data
 * FUTURA. Casar os dois inflaria a TIR de forma grosseira — um crédito comprado
 * há 30 dias com expectativa em 2 anos renderia (valor/capital)^(365/30). Por
 * isso o prazo vem de `proj.atualizadoAte`, que é a data do próprio valor.
 */
export function tir(
  capitalInvestido: number | null | undefined,
  dataAquisicao: string | null | undefined,
  proj: Projecao,
): Tir {
  if (proj.valor === null) return SEM_TIR('Sem valor projetado.')
  if (typeof capitalInvestido !== 'number' || capitalInvestido <= 0) {
    return SEM_TIR('Sem capital investido cadastrado.')
  }
  if (!proj.atualizadoAte) return SEM_TIR('Sem data de referência do valor.')
  const dias = diasEntre(dataAquisicao, proj.atualizadoAte)
  if (dias === null) return SEM_TIR('Sem data da cessão.')
  if (dias <= 0) {
    // Sem prazo não há taxa a anualizar (e dividir por zero explodiria).
    return SEM_TIR('Prazo nulo entre a cessão e a data do valor.')
  }
  const razao = proj.valor / capitalInvestido
  const anual = (Math.pow(razao, 365 / dias) - 1) * 100
  if (!Number.isFinite(anual)) return SEM_TIR('Não foi possível calcular a TIR.')
  const mensal = (Math.pow(1 + anual / 100, 1 / 12) - 1) * 100
  return {
    anual: Math.round(anual * 100) / 100,
    mensal: Math.round(mensal * 100) / 100,
    dias,
    ate: proj.atualizadoAte,
  }
}
