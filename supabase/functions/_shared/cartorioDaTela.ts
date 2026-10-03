// O CARTÓRIO DA PLANILHA É O DA TELA (revisão de 03/10/2026).
//
// O DEFEITO, confirmado lendo `src/components/AnaliseRpvModal.tsx`. O 'salvar'
// da `gerar-analise-rpv` RECALCULA o preço — com a regra de emolumentos que vem
// no corpo (`regraCartorio ?? atual.emolumentos`) ou, sem ela, com a do cache
// do estado. Mas a tela mostra o preço da ÚLTIMA rodada que voltou, e as duas
// coisas se separam em dois caminhos reais:
//
//   1. A TABELA CHEGA NO MEIO DE UMA REVISÃO. `levantarRegraCartorio` guarda a
//      regra (`setRegraCartorio`) ANTES da guarda de revisão e, se a pessoa
//      trocou o cenário enquanto isso, não reprecifica. A tela fica com
//      "cartório não incluído" e o 'salvar' manda a regra nova: a planilha sai
//      com escritura e registro que a tela nunca mostrou, e outro preço.
//
//   2. O LEVANTAMENTO TERMINA NO SERVIDOR DEPOIS DE A TELA DESISTIR (o prazo
//      dela passa, a pesquisa continua). A tela manda `emolumentos: null`, e o
//      'salvar' acha a tabela no cache: de novo, outro preço na planilha.
//
// A CORREÇÃO, sem mexer na tela. Toda rodada que precifica grava em `dados` —
// que vai e volta da tela intacto — a regra que USOU (ou null, sem cartório).
// No 'salvar', essa regra manda: a planilha reproduz exatamente o preço que a
// pessoa viu e aprovou. A regra que chegou depois não se perde (a tela a guarda
// e a próxima rodada do chat a aplica, mostrando o preço novo antes de salvar).
//
// `dados` SEM A MARCA (tela aberta antes deste deploy): o 'salvar' decide como
// sempre decidiu.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, para o vitest o testar.

/** A chave em `dados` com a regra de emolumentos que precificou a última rodada. */
export const CHAVE_EMOLUMENTOS_PRECIFICADOS = '_emolumentos_precificados'

/** O mínimo de `Emolumentos` (`_shared/emolumentos.ts`) que a decisão lê. */
export interface RegraComUf {
  uf: string
  regra: unknown
}

export type FonteDaRegra<E> =
  /** A regra está decidida (pode ser null: preço sem cartório). */
  | { tipo: 'PRONTA'; emolumentos: E | null; origem: 'tela_precificada' | 'corpo' | 'nenhuma' }
  /** Nada veio: consultar o cache do estado (só leitura). */
  | { tipo: 'CACHE' }

const valeParaUf = (e: RegraComUf | null | undefined, uf: string | null): boolean =>
  !!e && !!e.regra && (!uf || e.uf === uf)

/**
 * QUE REGRA DE EMOLUMENTOS PRECIFICA ESTA RODADA.
 *
 *   salvar, com a marca   a regra que precificou a tela (null = sem cartório)
 *   recebida, da mesma UF a do corpo — como sempre
 *   nada                  o cache do estado, se houver UF — como sempre
 *
 * A regra recebida de OUTRA UF é descartada: a pessoa corrigiu o tribunal no
 * chat, e a de antes é de outro estado.
 */
export function regraParaPrecificar<E extends RegraComUf>(
  acao: string,
  dados: Record<string, unknown> | null | undefined,
  recebida: E | null | undefined,
  ufCredito: string | null,
): FonteDaRegra<E> {
  if (acao === 'salvar' && dados && Object.prototype.hasOwnProperty.call(dados, CHAVE_EMOLUMENTOS_PRECIFICADOS)) {
    const marcada = dados[CHAVE_EMOLUMENTOS_PRECIFICADOS] as E | null | undefined
    return valeParaUf(marcada, ufCredito)
      ? { tipo: 'PRONTA', emolumentos: marcada as E, origem: 'tela_precificada' }
      : { tipo: 'PRONTA', emolumentos: null, origem: 'nenhuma' }
  }
  if (valeParaUf(recebida, ufCredito)) return { tipo: 'PRONTA', emolumentos: recebida as E, origem: 'corpo' }
  return ufCredito ? { tipo: 'CACHE' } : { tipo: 'PRONTA', emolumentos: null, origem: 'nenhuma' }
}
