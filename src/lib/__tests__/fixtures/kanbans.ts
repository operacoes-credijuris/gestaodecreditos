// Os kanbans do Kommo que os testes usam como espelho (public.kommo_etapa).
//
// SAÍRAM DE `kommoPrecatorio.test.ts` PARA SEREM UM SÓ. Os testes de botões e de
// movimentos (botoesDaAba.test.ts, matrizDeMovimentos.test.ts) precisam dos
// mesmos três funis, e duas cópias do mesmo kanban acabam divergindo — que é a
// família de defeito que esses testes existem para pegar.
//
// NÃO É ARQUIVO DE TESTE (não termina em `.test.ts`): o vitest não o roda, só o
// importa.
import {
  FUNIL_PRECATORIO,
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_RPV,
  type EtapaKommo,
} from '@/lib/kommo'

/**
 * As colunas do funil do Interno, como o Kommo as devolveu em 01/10/2026 — na
 * ordem do kanban e com os nomes de lá.
 *
 * O KOMMO RENOMEOU AS COLUNAS SEM MUDAR O ID: "REVISÃO DA ANÁLISE" virou "Revisão"
 * e "PROTOCOLAR" virou "Protocolo". Enquanto o Interno se ligava só pelo nome,
 * essa troca deixou as abas Revisão e p/ Protocolo sem coluna; desde 02/10/2026
 * ele se liga pelo id, como o Externo (ver `IDS_INTERNO`).
 *
 * As colunas do comercial (negociação, fechados, oferta, escritura, pagamento,
 * sem resposta, não fechados) existem no kanban e NÃO viram aba, por decisão de
 * quem opera. Ficam no espelho de propósito: é o que garante que a ausência delas
 * na tela se leia como escolha, e não como coluna perdida no remapeamento.
 */
export const COLUNAS_INTERNO = [
  'Etapa de leads de entrada',
  'Análise jurídica e econômica',
  'Revisão',
  'Diligência',
  'Produção de proposta',
  'Negociação',
  'Fechados',
  'Oferta aos investidores',
  'Escritura pública',
  'Protocolo',
  'Pagamento finalizado',
  'Reprovados',
  'Sem resposta',
  'Não fechados',
]

/** OS IDS REAIS do funil do Interno, lidos do kommo_etapa em 01/10/2026. */
export const IDS_INTERNO: Record<string, number> = {
  'Etapa de leads de entrada': 111533936,
  'Análise jurídica e econômica': 111533940,
  'Revisão': 111533944,
  'Diligência': 111533960,
  'Produção de proposta': 111533948,
  'Negociação': 112466260,
  'Fechados': 111533952,
  'Oferta aos investidores': 112466032,
  'Escritura pública': 111533956,
  'Protocolo': 111693840,
  'Pagamento finalizado': 112466340,
  'Reprovados': 111534108,
  'Sem resposta': 112465960,
  'Não fechados': 112382612,
}

/**
 * As colunas do funil do Externo, como o Kommo as devolveu em 29/09/2026 — na
 * ordem do kanban.
 *
 * EM CAIXA ALTA PORQUE É ASSIM QUE ESTÃO LÁ, e é assim que aparecem na tela: o
 * Externo espelha o kanban inteiro, com os nomes de lá (ver `espelhoCompleto`).
 * As duas colunas de sistema do Kommo entram no espelho à parte, com os ids fixos
 * delas (142 e 143), e são as únicas que ficam fora das abas.
 */
export const COLUNAS_EXTERNO = [
  'Etapa de leads de entrada',
  'QUALIFICAÇÃO PRELIMINAR',
  'REVISÃO DA QUALIFICAÇÃO',
  'DILIGÊNCIA',
  'MEMORANDO DE NEGOCIAÇÃO',
  'ENCAMINHAR AOS FUNDOS',
  'EM PRECIFICAÇÃO',
  'PRODUÇÃO DE PROPOSTA',
  'NEGOCIAÇÃO',
  'FECHADOS',
  'OBTENÇÃO DE DOCUMENTAÇÃO',
  'AGUARDANDO APROVAÇÃO DO FUNDO',
  'REVISÃO/ASSINATURA DA ESCRITURA',
  'PAGOS',
  'REPROVADOS',
  'NÃO FECHADO',
]

/**
 * OS IDS REAIS do funil do Externo, lidos do espelho em 29/09/2026. É por eles
 * que a plataforma se liga ao kanban desde então — renomear a coluna no Kommo não
 * tira função nenhuma. A de entrada vem com `tipo` 1, que é como o Kommo a marca.
 */
export const IDS_EXTERNO: Record<string, number> = {
  'Etapa de leads de entrada': 111533964,
  'QUALIFICAÇÃO PRELIMINAR': 111533968,
  'REVISÃO DA QUALIFICAÇÃO': 111533972,
  'DILIGÊNCIA': 111533996,
  'MEMORANDO DE NEGOCIAÇÃO': 111533976,
  'ENCAMINHAR AOS FUNDOS': 111533980,
  'EM PRECIFICAÇÃO': 111533984,
  'PRODUÇÃO DE PROPOSTA': 111533988,
  'NEGOCIAÇÃO': 112339984,
  'FECHADOS': 111533992,
  'OBTENÇÃO DE DOCUMENTAÇÃO': 112341608,
  'AGUARDANDO APROVAÇÃO DO FUNDO': 112341612,
  'REVISÃO/ASSINATURA DA ESCRITURA': 112341616,
  'PAGOS': 112006404,
  'REPROVADOS': 111534212,
  'NÃO FECHADO': 111985976,
}

/** O espelho do Externo com os ids reais — e com nomes trocados, quando se quer. */
export const colunasExterno = (nomes: string[], renomear: Record<string, string> = {}): EtapaKommo[] =>
  nomes.map((nome, i) => ({
    pipeline_id: FUNIL_PRECATORIO_EXTERNO,
    status_id: IDS_EXTERNO[nome] ?? 95_000 + i,
    pipeline_nome: 'Funil Precatório Externo',
    nome: renomear[nome] ?? nome,
    ordem: i,
    tipo: nome === 'Etapa de leads de entrada' ? 1 : 0,
  }))

/** O espelho do Interno com os ids reais — e com nomes trocados, quando se quer. */
export const colunasInterno = (nomes: string[], renomear: Record<string, string> = {}): EtapaKommo[] =>
  nomes.map((nome, i) => ({
    pipeline_id: FUNIL_PRECATORIO,
    status_id: IDS_INTERNO[nome] ?? 96_000 + i,
    pipeline_nome: 'Funil Precatório Interno',
    nome: renomear[nome] ?? nome,
    ordem: i,
    tipo: nome === 'Etapa de leads de entrada' ? 1 : 0,
  }))

/** As colunas de sistema que todo funil do Kommo tem. */
export const DE_SISTEMA = (pipelineId: number): EtapaKommo[] => [
  { pipeline_id: pipelineId, status_id: 142, pipeline_nome: null, nome: 'Closed - won', ordem: 10000, tipo: 0 },
  { pipeline_id: pipelineId, status_id: 143, pipeline_nome: null, nome: 'Closed - lost', ordem: 11000, tipo: 0 },
]

export const colunasDe = (pipelineId: number, nomes: string[], base: number): EtapaKommo[] =>
  nomes.map((nome, i) => ({
    pipeline_id: pipelineId,
    status_id: base + i,
    pipeline_nome:
      pipelineId === FUNIL_PRECATORIO ? 'Funil Precatório Interno' : 'Funil Precatório Externo',
    nome,
    ordem: i,
    tipo: 0,
  }))

/** O espelho como o kommo-sync o gravaria: os dois funis, lado a lado. */
export const espelho = (
  internas: string[] = COLUNAS_INTERNO,
  externas: string[] = COLUNAS_EXTERNO,
): EtapaKommo[] => [
  ...colunasInterno(internas),
  ...colunasExterno(externas),
  ...DE_SISTEMA(FUNIL_PRECATORIO_EXTERNO),
]

/**
 * O id de uma coluna, SEMPRE COM O FUNIL JUNTO.
 *
 * OS DOIS KANBANS REPETEM NOMES desde que o Interno migrou: "DILIGÊNCIA",
 * "REPROVADOS", "PRODUÇÃO DE PROPOSTA" e "FECHADOS" existem nos dois. Buscar só
 * pelo nome devolvia o id do primeiro funil da lista, e os testes do Externo
 * passariam a comparar com a coluna do Interno — exatamente o erro que a
 * produção não comete, porque lá a busca é escopada por pipeline.
 */
export const idDe = (nome: string, etapas = espelho(), pipelineId = FUNIL_PRECATORIO) =>
  etapas.find((e) => e.pipeline_id === pipelineId && e.nome === nome)!.status_id

/** O mesmo, no funil do Externo. */
export const idExt = (nome: string, etapas = espelho()) =>
  idDe(nome, etapas, FUNIL_PRECATORIO_EXTERNO)

/** Uma coluna do kanban do RPV, com a ordem e o tipo que o Kommo deu a ela. */
const doRpv = (status_id: number, nome: string, ordem: number, tipo = 0): EtapaKommo => ({
  pipeline_id: FUNIL_RPV,
  status_id,
  // O NOME DO FUNIL NÃO ENTRA EM REGRA NENHUMA; este é o que a migration 0014
  // registra para o 13901939.
  pipeline_nome: 'Funil Geral RPV',
  nome,
  ordem,
  tipo,
})

/**
 * O kanban do RPV (pipeline 13901939), como o `kommo_etapa` o devolveu em
 * 02/10/2026: os ids, os nomes, a ordem e o tipo de lá — inclusive a entrada de
 * leads (tipo 1) e as duas colunas de sistema.
 *
 * OS NOMES DE HOJE NÃO SÃO OS DAS CONSTANTES. `ST_DECISAO` se chama "Revisão" no
 * kanban, `ST_PROPOSTA` virou "Produção de proposta", e a anotação de auditoria
 * da `kommo-mover` ainda escreve os nomes antigos (ver `_shared/colunasRpv.ts`).
 * O RPV se liga pelo ID, e é o id que este espelho prende.
 *
 * HOJE A TELA SÓ MOSTRA SEIS DELAS (`TELAS`); as outras estão aqui porque as
 * próximas etapas do redesenho vão mostrá-las, e um teste que só conhece as seis
 * não teria como dizer que uma coluna nova ganhou botão.
 */
export const KANBAN_RPV: readonly EtapaKommo[] = [
  doRpv(107272795, 'Leads de entrada', 10, 1),
  doRpv(107272803, 'Análise Jurídica e Econômica', 20),
  doRpv(107272807, 'Revisão', 30),
  doRpv(107830027, 'Diligência', 40),
  doRpv(107830035, 'Produção de proposta', 50),
  doRpv(107830039, 'Negociação', 60),
  doRpv(107830043, 'Fechados', 70),
  doRpv(107830047, 'Oferta aos investidores', 80),
  doRpv(107830051, 'Elaboração de contratos', 90),
  doRpv(107830055, 'Aguardando assinaturas', 100),
  doRpv(107830059, 'Protocolo', 110),
  doRpv(107830063, 'Pagamento finalizado', 120),
  doRpv(107830031, 'Reprovados operacional', 130),
  doRpv(107272811, 'Reprovados comercial', 140),
  doRpv(112466388, 'Sem resposta', 150),
  doRpv(107830067, 'Não fechado', 160),
  doRpv(142, 'Fechado - ganho', 10000),
  doRpv(143, 'Fechado - perdido', 11000),
]

/** OS IDS REAIS do RPV, pelo nome que a coluna tinha em 02/10/2026. */
export const IDS_RPV: Readonly<Record<string, number>> = Object.fromEntries(
  KANBAN_RPV.map((e) => [e.nome, e.status_id]),
)

/** Os três funis do operacional, como o kommo-sync os gravaria lado a lado. */
export const espelhoDosTresFunis = (): EtapaKommo[] => [...espelho(), ...KANBAN_RPV]
