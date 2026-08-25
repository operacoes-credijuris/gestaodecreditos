// NÚCLEO COMPARTILHADO — representatividade da amostra.
//
// Decide o que o sistema tem o direito de afirmar sobre um grupo. É o portão
// que impede "Tribunal X rende mais" quando o Tribunal X tem duas operações.
//
// OS LIMITES NÃO SÃO ARBITRADOS. Saem da largura do intervalo de confiança
// não-paramétrico de 95% da mediana, calculado em estatistica.ts a partir da
// binomial.
//
// Com n ≤ 5 NENHUM intervalo de 95% existe — nem o que vai do menor ao maior
// valor observado. A cobertura máxima possível é 1 − 2·2⁻ⁿ, que em n=5 chega a
// 93,75%. Não é que o intervalo seja largo: ele não existe. Esse é o piso, e
// vem da matemática, não de escolha.
//
// As faixas seguintes seguem a mesma medida — quanto da amostra o intervalo
// ainda precisa abranger:
//     n =  6  ->  100%     n = 20  ->  50%
//     n = 10  ->   80%     n = 30  ->  40%
//     n = 12  ->   67%     n = 54  ->  30%

import { intervaloMediana } from './estatistica.ts'

export type ClasseAmostra = 'insuficiente' | 'baixa' | 'moderada' | 'alta'

export interface Representatividade {
  n: number
  classe: ClasseAmostra
  rotulo: string
  /** Texto de explicabilidade (item 19) — vai no tooltip, sem jargão. */
  explicacao: string
  /** Fração da amostra abrangida pelo IC de 95% da mediana. null se n ≤ 5. */
  larguraIC: number | null
  /** Comparar este grupo com outro é permitido? */
  permiteComparacao: boolean
  /** Este grupo pode entrar num ranking? */
  permiteRanking: boolean
  /** Um insight automático pode citar este grupo? */
  permiteInsight: boolean
  /** Participação no capital analisado, quando informada. 0 a 1. */
  pesoEconomico: number | null
}

export const LIMITE_BAIXA = 6
export const LIMITE_MODERADA = 12
export const LIMITE_ALTA = 30

/**
 * Classifica um grupo. `capitalGrupo` e `capitalTotal` são opcionais e
 * alimentam o segundo eixo — peso econômico —, que NUNCA é fundido com a
 * classe estatística num índice único (item 27). Um grupo pode ser
 * economicamente decisivo e estatisticamente mudo ao mesmo tempo, e o sistema
 * precisa conseguir dizer as duas coisas.
 */
export function classificarAmostra(
  n: number,
  capitalGrupo?: number | null,
  capitalTotal?: number | null,
): Representatividade {
  const iv = intervaloMediana(n, 0.95)
  const larguraIC = iv && n > 5 ? iv.larguraRelativa : null

  const peso =
    typeof capitalGrupo === 'number' && typeof capitalTotal === 'number' && capitalTotal > 0
      ? capitalGrupo / capitalTotal
      : null

  let classe: ClasseAmostra
  let rotulo: string
  let explicacao: string

  if (n < LIMITE_BAIXA) {
    classe = 'insuficiente'
    rotulo = 'Amostra insuficiente'
    explicacao =
      n === 0
        ? 'Nenhuma operação neste grupo.'
        : `Com ${n} ${n === 1 ? 'operação' : 'operações'}, não existe intervalo de confiança ` +
          'de 95% para a mediana — nem usando toda a faixa observada, do menor ao maior valor. ' +
          'O número é exibido, mas não sustenta conclusão sobre o comportamento do grupo.'
  } else if (n < LIMITE_MODERADA) {
    classe = 'baixa'
    rotulo = 'Baixa representatividade'
    explicacao =
      `Com ${n} operações, o intervalo de confiança de 95% da mediana ainda abrange ` +
      `cerca de ${Math.round((larguraIC ?? 0) * 100)}% da amostra — em boa parte dos casos, ` +
      'toda a faixa observada. Serve para indicar tendência, não para comparar com outros grupos.'
  } else if (n < LIMITE_ALTA) {
    classe = 'moderada'
    rotulo = 'Representatividade moderada'
    explicacao =
      `Com ${n} operações, o intervalo de confiança de 95% da mediana abrange cerca de ` +
      `${Math.round((larguraIC ?? 0) * 100)}% da amostra. Permite comparação, desde que o ` +
      'intervalo seja exibido junto.'
  } else {
    classe = 'alta'
    rotulo = 'Alta representatividade'
    explicacao =
      `Com ${n} operações, o intervalo de confiança de 95% da mediana abrange cerca de ` +
      `${Math.round((larguraIC ?? 0) * 100)}% da amostra. Base suficiente para comparação ` +
      'e classificação.'
  }

  return {
    n,
    classe,
    rotulo,
    explicacao,
    larguraIC,
    permiteComparacao: n >= LIMITE_MODERADA,
    permiteRanking: n >= LIMITE_ALTA,
    permiteInsight: n >= LIMITE_BAIXA,
    pesoEconomico: peso,
  }
}

export interface PortaoComparacao {
  permitido: boolean
  /** Frase pronta para a interface quando não é permitido. */
  motivo: string | null
  a: Representatividade
  b: Representatividade
}

/**
 * O portão do item 8: comparação só existe se AMBOS os grupos chegarem a
 * moderado. Abaixo disso os números continuam visíveis lado a lado — esconder
 * seria pior —, mas a interface afirma que não há base para comparar.
 */
export function portaoComparacao(
  nomeA: string, nA: number,
  nomeB: string, nB: number,
): PortaoComparacao {
  const a = classificarAmostra(nA)
  const b = classificarAmostra(nB)
  if (a.permiteComparacao && b.permiteComparacao) {
    return { permitido: true, motivo: null, a, b }
  }
  const fracos = [
    !a.permiteComparacao ? `${nomeA} (${nA})` : null,
    !b.permiteComparacao ? `${nomeB} (${nB})` : null,
  ].filter(Boolean).join(' e ')
  return {
    permitido: false,
    motivo:
      `Não há base para comparar ${nomeA} com ${nomeB}: ${fracos} ` +
      `${fracos.includes(' e ') ? 'estão' : 'está'} abaixo do mínimo de ` +
      `${LIMITE_MODERADA} operações encerradas. Os números de cada grupo são exibidos, ` +
      'mas a diferença entre eles não é interpretável.',
    a,
    b,
  }
}

/**
 * O portão do ranking. Devolve quem entra e quem fica de fora — e os de fora
 * são exibidos numa lista à parte, nunca escondidos (item 7).
 */
export function portaoRanking<T>(
  grupos: readonly T[],
  nDe: (g: T) => number,
): { elegiveis: T[]; inelegiveis: T[]; rankingPossivel: boolean; motivo: string | null } {
  const elegiveis = grupos.filter((g) => nDe(g) >= LIMITE_ALTA)
  const inelegiveis = grupos.filter((g) => nDe(g) < LIMITE_ALTA)
  if (elegiveis.length < 2) {
    return {
      elegiveis,
      inelegiveis,
      rankingPossivel: false,
      motivo:
        `Ranking exige ao menos dois grupos com ${LIMITE_ALTA} ou mais operações encerradas. ` +
        `${elegiveis.length === 0 ? 'Nenhum grupo atinge' : 'Apenas um grupo atinge'} esse ` +
        'patamar, então uma classificação seria decidida por ruído.',
    }
  }
  return { elegiveis, inelegiveis, rankingPossivel: true, motivo: null }
}

/**
 * Concentração da carteira num único grupo. Serve para o módulo dizer em voz
 * alta o que a base de 2026-08 mostra: 91,6% das operações são do TJGO, e
 * portanto "qual tribunal rende mais" não é uma pergunta respondível.
 */
export function concentracao(
  grupos: readonly { nome: string; n: number; capital: number }[],
): { maior: string; fracaoOperacoes: number; fracaoCapital: number; concentrada: boolean } | null {
  if (grupos.length === 0) return null
  const totalN = grupos.reduce((s, g) => s + g.n, 0)
  const totalCap = grupos.reduce((s, g) => s + g.capital, 0)
  if (totalN === 0) return null
  const maior = grupos.reduce((m, g) => (g.n > m.n ? g : m))
  const fracaoOperacoes = maior.n / totalN
  return {
    maior: maior.nome,
    fracaoOperacoes,
    fracaoCapital: totalCap > 0 ? maior.capital / totalCap : 0,
    // Dois terços num grupo só é o ponto em que a comparação entre grupos
    // deixa de descrever a carteira e passa a descrever um grupo contra ruído.
    concentrada: fracaoOperacoes >= 2 / 3,
  }
}
