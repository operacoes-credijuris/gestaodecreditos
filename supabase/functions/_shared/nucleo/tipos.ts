// NÚCLEO COMPARTILHADO — o registro analítico de uma operação.
//
// É a forma normalizada que toda a camada de inteligência consome. Sai de
// public.processos, mas com os cálculos de projecao.ts já aplicados, para que
// nenhuma tela, relatório ou ferramenta do assistente refaça a conta por conta
// própria.
//
// A montagem fica em analitico.ts; aqui só os tipos e as regras de população.

/** Status da operação, como gravado em public.processos. */
export type StatusOperacao = 'ativo' | 'complementar' | 'encerrado'

export interface OperacaoAnalitica {
  /** Identificador curto, para rastrear um número até a linha de origem. */
  ref: string
  numeroCnj: string | null
  tribunal: string | null
  ente: string | null
  investidor: string | null
  status: StatusOperacao | string

  dataAquisicao: string | null
  dataReferencia: string | null
  expectativaLiquidacao: string | null
  dataLiquidacao: string | null

  capitalInvestido: number | null
  valorFace: number | null
  jaRecebido: number | null
  valorComplementar: number | null
  indice: string | null

  // ---- derivados, calculados por projecao.ts ----
  /** Recebido, se liquidada; face corrigido, se em aberto. */
  valor: number | null
  /** Data a que `valor` se refere. Casa valor e prazo. */
  valorAte: string | null
  /** Motivo da ausência, quando `valor` é null. */
  motivoSemValor: string | null
  ganho: number | null
  /** Fração, não percentual: 0,3648 = 36,48%. */
  retorno: number | null
  /** Fração ao ano. */
  tirAnual: number | null
  prazoDias: number | null
  /** Previsão já venceu e a operação segue sem pagamento. */
  previsaoVencida: boolean
  /** Dias além da previsão, quando vencida. */
  diasVencida: number | null
}

/**
 * As três populações, que nunca se misturam.
 *
 * `encerrada` é a única elegível para performance realizada. `complementar`
 * recebeu o principal e aguarda um segundo valor — tratá-la como encerrada
 * divide um numerador incompleto por um denominador completo, e o erro é
 * sempre para baixo. Na carteira de 2026-08 isso derrubaria a rentabilidade
 * ponderada de 34,61% para 27,27%.
 */
export type Populacao = 'encerrada' | 'parcial' | 'aberta'

export function populacaoDe(op: OperacaoAnalitica): Populacao {
  if (op.status === 'encerrado') return 'encerrada'
  if (op.status === 'complementar') return 'parcial'
  return 'aberta'
}

/**
 * Elegível para métrica de performance realizada: encerrada de fato E com os
 * quatro dados que a conta exige. Sem isso, fica fora do numerador e do
 * denominador — nunca entra como zero.
 */
export function elegivelPerformance(op: OperacaoAnalitica): boolean {
  return (
    op.status === 'encerrado' &&
    !!op.dataAquisicao &&
    !!op.dataLiquidacao &&
    typeof op.capitalInvestido === 'number' && op.capitalInvestido > 0 &&
    typeof op.jaRecebido === 'number' && op.jaRecebido > 0
  )
}

/** Em aberto: ainda não recebeu nada. Base do forecast. */
export function emAberto(op: OperacaoAnalitica): boolean {
  return !op.dataLiquidacao
}
