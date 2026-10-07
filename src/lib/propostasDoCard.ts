// AS PROPOSTAS CADASTRADAS NO CARD (pedido do dono, 07/10/2026).
//
// "Na aba de Produção de proposta e Negociação, seria interessante que a gente
// pudesse ver as outras propostas. Só ver mesmo." Nessas duas colunas chegam
// propostas novas e é preciso comparar com as antigas, e as propostas moram nos
// campos do card no Kommo (aba "Cotações/propostas", um campo por fundo). A
// regra do que se mostra fica aqui, sem React, para ser testada:
//
// - EM QUE COLUNAS o indicador aparece (`mostraAsPropostas`);
// - O QUE CONTA COMO PROPOSTA (`propostasCadastradas`): o campo do fundo com
//   texto. O que se lê como valor e o que alguém escreveu à mão contam; o campo
//   vazio, ou só com "—", não;
// - A ORDEM, que é a dos fundos da precificação (`FUNDOS_DA_PRECIFICACAO`), a
//   mesma da janela "Escolher proposta": quem alterna entre as duas acha o
//   fundo no mesmo lugar.
//
// A "Escolher proposta" da Em precificação usa as mesmas linhas
// (`linhasDasCotacoes`), com os fundos sem valor incluídos: lá se escolhe entre
// todos, e o "—" diz que o fundo ainda não respondeu.

import {
  cotacoesDoCard,
  formatarPercentual,
  formatarReais,
  type CotacaoLida,
} from '../../supabase/functions/_shared/cotacaoDoFundo.ts'
import {
  desdeQuandoAEtiqueta,
  etiquetasPorDestino,
  FUNDOS_DA_PRECIFICACAO,
  mesmaEtiqueta,
} from '../../supabase/functions/_shared/etiquetasDoFundo.ts'
import type { KommoLead } from './types'

/**
 * AS COLUNAS EM QUE O CARD MOSTRA AS PROPOSTAS: a Produção de proposta e a
 * Negociação dos três funis, pelo id do Kommo (o nome muda; o id, não).
 */
export const COLUNAS_QUE_MOSTRAM_AS_PROPOSTAS: ReadonlyMap<number, string> = new Map([
  [111533988, 'Externo · Produção de proposta'],
  [112339984, 'Externo · Negociação'],
  [111533948, 'Interno · Produção de proposta'],
  [112466260, 'Interno · Negociação'],
  [107830035, 'RPV · Produção de proposta'],
  [107830039, 'RPV · Negociação'],
])

/** A aba (pelos status que ela cobre) mostra as propostas no card? */
export function mostraAsPropostas(statusIds: readonly number[] | null | undefined): boolean {
  return (statusIds ?? []).some((id) => COLUNAS_QUE_MOSTRAM_AS_PROPOSTAS.has(id))
}

/** A etiqueta que o card tem de um fundo (o ato) e desde quando. */
export interface SituacaoDoFundo {
  ato: string
  desde: string | null
}

/** Uma linha da lista das cotações: o fundo, o que ele respondeu e a etiqueta. */
export interface LinhaDaCotacao {
  fundo: string
  cotacao: CotacaoLida | null
  situacao: SituacaoDoFundo | null
}

type CardDasCotacoes = Pick<KommoLead, 'tags' | 'tags_em' | 'raw'>

/** A etiqueta que o card tem deste fundo, e desde quando — ou null. */
export function situacaoDoFundo(card: Pick<KommoLead, 'tags' | 'tags_em'>, destino: string): SituacaoDoFundo | null {
  const grupo = etiquetasPorDestino().find((g) => g.destino === destino)
  const e = grupo?.etiquetas.find((x) => (card.tags ?? []).some((t) => mesmaEtiqueta(t, x.nome)))
  return e ? { ato: e.ato, desde: desdeQuandoAEtiqueta(card.tags_em, e.nome) } : null
}

/**
 * TODOS OS FUNDOS, na ordem da precificação, com a cotação que o card tem de
 * cada um (ou null) e a etiqueta. É o que a "Escolher proposta" desenha.
 */
export function linhasDasCotacoes(card: CardDasCotacoes): LinhaDaCotacao[] {
  const cotacoes = cotacoesDoCard(card.raw?.custom_fields_values)
  return FUNDOS_DA_PRECIFICACAO.map((fundo) => ({
    fundo,
    cotacao: cotacoes[fundo] ?? null,
    situacao: situacaoDoFundo(card, fundo),
  }))
}

/**
 * AS PROPOSTAS CADASTRADAS: só os fundos cujo campo tem texto — valor legível
 * ou escrito à mão. É o número do indicador e a lista da caixa.
 */
export function propostasCadastradas(card: CardDasCotacoes): LinhaDaCotacao[] {
  return linhasDasCotacoes(card).filter((l) => l.cotacao !== null)
}

/** "1 proposta", "3 propostas". */
export const rotuloDasPropostas = (n: number): string => `${n} ${n === 1 ? 'proposta' : 'propostas'}`

/**
 * A linha da comissão, embaixo do valor — limitada, spread novo, spread antigo —
 * em dois pedaços: o `detalhe` ("(spread 5%)") desce para a linha de baixo
 * quando a caixa é estreita (celular), em vez de empurrar o nome do fundo.
 */
export function rotuloDaComissao(c: CotacaoLida['comissao']): { texto: string; detalhe?: string } {
  if (c === null) return { texto: 'Comissão —' }
  if (c.modalidade === 'limitada') return { texto: `Comissão ${formatarReais(c.centavos)}` }
  const pct = c.percentualCentesimos !== undefined ? `${formatarPercentual(c.percentualCentesimos)}%` : null
  if (c.centavos !== undefined) {
    return { texto: `Comissão ${formatarReais(c.centavos)}`, detalhe: `(spread${pct ? ` ${pct}` : ''})` }
  }
  return pct ? { texto: 'Comissão em spread', detalhe: `(${pct})` } : { texto: 'Comissão em spread' }
}
