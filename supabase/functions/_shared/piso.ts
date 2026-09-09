// O PISO DO NEGÓCIO: abaixo dele não se transaciona.
//
// SEM DEPENDÊNCIA DE NADA. A decisão morava dentro da Edge Function, e são
// quatro desfechos diferentes sobre uma regra da casa — reprovar cedo, recusar o
// salvar, liberar à mão, apenas avisar —, cada um com consequência distinta para
// quem está com o card aberto, e nenhum com um caso escrito.
//
// ONDE ELE INCIDE JÁ MUDOU DUAS VEZES, e as duas foram conserto.
//
// Era no portão, sobre o BRUTO que a leitura viu, e errava dos dois lados: uma
// cessão só de honorários de R$ 15 mil passava porque o crédito inteiro tinha
// R$ 100 mil, e um bruto de R$ 25 mil que líquido dá R$ 17 mil também passava.
// Passou então a incidir sobre o VALOR TOTAL LÍQUIDO NEGOCIADO.
//
// E O LÍQUIDO DE QUEM? O DOS AUTOS. A segunda versão media o líquido já
// REDUZIDO ao cenário conservador, e aí o mínimo da casa passava a barrar
// crédito por causa de uma conclusão NOSSA: um crédito de R$ 22 mil nos autos
// que a auditoria estima em R$ 17 mil não é um crédito abaixo do mínimo — é um
// crédito acima do mínimo com uma divergência apontada. Quem analisa pode não
// concordar com o corte, e discordar é justamente o que o chat existe para
// permitir; barrar antes disso fecha a porta antes de a conversa começar. O
// corte continua decidindo o PREÇO, que é o que ele decide; não decide mais se
// o negócio pode existir.
//
// O portão continua reprovando quando o bruto já está abaixo do mínimo: é
// barato e seguro por construção, porque o líquido nunca é maior que o bruto.

/** O mínimo, em reais. Decisão do dono. */
export const PISO_NEGOCIO = 20000

export type DesfechoDoPiso =
  /** Passa: o negócio alcança o mínimo (ou não há valor a comparar). */
  | { desfecho: 'ok' }
  /** Reprova, e cedo: nem somando todas as verbas se chega ao mínimo. */
  | { desfecho: 'reprovado'; motivo: string; cabe: false }
  /** Recusa o salvar: a planilha não sai sem liberação expressa. */
  | { desfecho: 'erro'; motivo: string; cabe: boolean }
  /** Segue com aviso: liberado à mão, ou ação que não gera documento. */
  | { desfecho: 'aviso'; motivo: string; cabe: boolean; liberado: boolean }

/**
 * O que fazer com um negócio abaixo do mínimo.
 *
 * A MENSAGEM SEPARA DOIS CASOS porque a AÇÃO é diferente. Se o processo tem o
 * mínimo somando todas as verbas e o que está estreito é a parcela cedida, quem
 * lê pode alargar o negócio — e por isso a análise SEGUE, com o aviso
 * impeditivo no topo, em vez de morrer numa tela sem seletor de cenário. Se nem
 * tudo somado chega lá, o crédito não serve e não há o que ajustar: reprovar
 * cedo poupa uma leitura de IA que não mudaria nada.
 *
 * A LIBERAÇÃO É POR CHAMADA, nunca por análise: ela viaja no corpo da
 * requisição, não no objeto que dá a volta pelo navegador. Assim o próximo
 * salvar de uma análise que mudou volta a esbarrar no piso, em vez de herdar um
 * "pode" dado sobre outros números.
 */
export function avaliarPiso(o: {
  /**
   * O líquido das verbas negociadas COMO OS AUTOS O INDICAM — antes do corte da
   * auditoria. Passar aqui o líquido já reduzido é o defeito descrito no topo.
   */
  negociado: number
  /** O líquido de TODAS as verbas do processo, comprando tudo, também dos autos. */
  tudoSomado: number
  /** O rótulo do que está sendo comprado, para a mensagem. */
  tipoCredito?: string | null
  acao: string | null
  /** `abaixo_do_minimo_ok` veio no corpo desta chamada? */
  liberado: boolean
  /** Formatador de moeda de quem chama, para a mensagem sair na língua da casa. */
  brl: (n: number) => string
}): DesfechoDoPiso {
  const negociado = Number(o.negociado)
  if (!(negociado > 0) || negociado >= PISO_NEGOCIO) return { desfecho: 'ok' }

  const tudo = Number(o.tudoSomado) || 0
  const cabe = tudo >= PISO_NEGOCIO
  const motivo =
    `O valor total líquido negociado, como os autos o indicam, é ${o.brl(negociado)}, abaixo do mínimo de ${o.brl(PISO_NEGOCIO)} ` +
    `(${String(o.tipoCredito ?? 'verbas do negócio')}). ` +
    (cabe
      ? `Somando TODAS as verbas do processo dá ${o.brl(tudo)} — se a cessão puder incluir as demais, ` +
        'corrija o "PARCELA CEDIDA" do card (ou troque o cenário aqui na janela) e rode de novo.'
      : `Nem somando todas as verbas do processo se chega ao mínimo: o total líquido disponível é ${o.brl(tudo)}.`)

  if ((o.acao === 'analisar' || o.acao === null) && !cabe) {
    return { desfecho: 'reprovado', motivo, cabe: false }
  }
  if (o.acao === 'salvar' && !o.liberado) {
    return { desfecho: 'erro', motivo, cabe }
  }
  return { desfecho: 'aviso', motivo, cabe, liberado: o.acao === 'salvar' && o.liberado }
}
