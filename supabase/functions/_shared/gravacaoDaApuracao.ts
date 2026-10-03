// COMO A APURAÇÃO DE PROCESSOS (dd-processos) ENTRA NO BANCO depois de paga
// (revisão de 03/10/2026).
//
// A REGRA QUE GOVERNA TUDO AQUI: depois que o Escavador cobrou, o consumo é
// SEMPRE registrado e o resultado é salvo de forma que reabrir a janela não
// pague de novo. Os três defeitos que a revisão achou eram o contrário disso:
//
//   1. REFAZER DEPOIS DE "SEGUIR" MANTINHA A LIBERAÇÃO. `liberado_em` (0062) é
//      a declaração "li estes processos e eles não impedem a cessão". A
//      reapuração trocava os processos e deixava a declaração de pé: o processo
//      que acabou de chegar já nascia liberado, por alguém que nunca o viu.
//
//   2. FALHA EM LINHA LIBERADA. Gravar FALHA por cima de uma linha liberada (ou
//      recusada, 0063) viola o check "liberado/reprovado exige APURADO": a
//      função respondia 400 DEPOIS de pagar, sem registrar o consumo — e sem
//      gravar os alvos seguintes.
//
//   3. A BUSCA DA LINHA EXISTENTE IA PELO FILTRO `.or()` DO PostgREST, com o
//      nome sem aspas (vírgula, ponto ou parêntese no nome quebram a sintaxe) e
//      com o erro ignorado; com duas linhas casando, `maybeSingle` dava erro, a
//      função achava que não havia linha, e o INSERT batia no índice único
//      `dd_historico_alvo_uk` — também depois de pagar.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, para o vitest o testar.

export type StatusDaApuracao = 'APURADO' | 'FALHA'

/** Uma linha de dd_historico, nos campos que a gravação consulta. */
export interface LinhaDoHistorico {
  id: string
  documento?: string | null
  oab?: string | null
  nome?: string | null
  status?: string | null
  apurado_em?: string | null
}

/** A identidade de um alvo, como a apuração a tem. */
export interface IdentidadeDoAlvo {
  documento?: string | null
  oab?: string | null
  nome?: string | null
}

/**
 * A CHAVE DO ÍNDICE ÚNICO `dd_historico_alvo_uk` (0056):
 * `coalesce(documento, oab, nome)`. Como o coalesce do Postgres, só o NULL cai
 * para o próximo — texto vazio é valor.
 */
export function chaveDoAlvo(a: IdentidadeDoAlvo): string | null {
  return a.documento ?? a.oab ?? a.nome ?? null
}

const igual = (x: unknown, y: unknown) =>
  x != null && y != null && String(x).trim() !== '' && String(x).trim() === String(y).trim()

/**
 * A linha que esta apuração substitui, entre as do mesmo crédito e papel.
 *
 * PRIMEIRO A DA MESMA CHAVE DO ÍNDICE: se ela existe, é ela que o INSERT
 * acertaria, e atualizar qualquer outra levaria a chave dela para cima da que
 * já existe — o mesmo erro de índice por outro caminho. Depois, como o filtro
 * antigo fazia, pelo documento, pela OAB e pelo nome (nesta ordem): é o que liga
 * a apuração feita só pela OAB à de agora, que já tem o CPF.
 *
 * Feito aqui, sobre as linhas lidas, e não num filtro de texto do PostgREST:
 * nome é dado de quem digitou, e não pode virar sintaxe de consulta.
 */
export function historicoDoAlvo(
  linhas: LinhaDoHistorico[],
  alvo: IdentidadeDoAlvo,
): LinhaDoHistorico | null {
  const chave = chaveDoAlvo(alvo)
  const mesmaChave = linhas.find((l) => chave != null && chaveDoAlvo(l) === chave)
  if (mesmaChave) return mesmaChave
  return (
    linhas.find((l) => igual(l.documento, alvo.documento)) ??
    linhas.find((l) => igual(l.oab, alvo.oab)) ??
    linhas.find((l) => igual(l.nome, alvo.nome)) ??
    null
  )
}

/** O que fazer com a linha do histórico diante do resultado de agora. */
export type DestinoDaApuracao =
  /** Grava (insere ou atualiza) a linha e troca a foto dos processos. */
  | { tipo: 'GRAVAR'; limparLiberacao: boolean }
  /**
   * A busca falhou e havia uma apuração boa: ela fica como estava — status,
   * data, processos, liberação e recusa. A falha vai para a tela e o consumo
   * para o registro; a foto anterior não é trocada por um "não sei".
   */
  | { tipo: 'MANTER_ANTERIOR' }

/**
 * A DECISÃO DA GRAVAÇÃO.
 *
 * APURADO de novo: grava, e a LIBERAÇÃO SAI. A pessoa liberou a foto que viu;
 * a foto nova pode ter processo que ninguém leu, e "Seguir" precisa ser clicado
 * outra vez. A RECUSA FICA: ela já tirou a verba da cessão e foi anotada no
 * card; uma busca refeita não desfaz uma decisão — quem mudou de ideia a muda
 * na tela, como sempre.
 *
 * FALHA sobre uma apuração boa: mantém a anterior (ver acima). É o que impede
 * o check da 0062/0063 de recusar a gravação, e é o certo por si: uma busca que
 * não aconteceu não diz nada sobre a que aconteceu.
 *
 * FALHA sem apuração boa antes: grava a FALHA, que é a lacuna que o motor
 * transforma em aviso — "procurei e não achei" e "não procurei" são respostas
 * diferentes.
 */
export function destinoDaApuracao(
  anterior: LinhaDoHistorico | null,
  status: StatusDaApuracao,
): DestinoDaApuracao {
  if (status === 'FALHA' && anterior?.status === 'APURADO') return { tipo: 'MANTER_ANTERIOR' }
  return { tipo: 'GRAVAR', limparLiberacao: Boolean(anterior) }
}

/**
 * O que a tela lê quando a busca falhou e a apuração anterior ficou: a falha de
 * agora E o aviso de que a lista na tela é a de antes, com a data dela.
 */
export function observacaoDaFalhaMantida(observacao: string | null, apuradoEm: string | null | undefined): string {
  const t = apuradoEm ? new Date(apuradoEm) : null
  const dia = t && !Number.isNaN(t.getTime())
    ? t.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : null
  const falha = String(observacao ?? '').trim().replace(/[.\s]+$/, '')
  return (
    (falha ? falha + '. ' : '') +
    `A apuração anterior${dia ? `, de ${dia},` : ''} continua valendo — nada foi apagado.`
  )
}

/**
 * O que a tela lê quando a busca VOLTOU (e foi paga) mas o banco recusou a
 * gravação: o resultado não está salvo, e o gasto está registrado.
 */
export function observacaoDaGravacaoFalha(erro: string, centavos: number): string {
  const pago = centavos > 0 ? ` e paga (R$ ${(centavos / 100).toFixed(2).replace('.', ',')})` : ''
  return (
    `A busca foi feita${pago}, mas o resultado não foi salvo: ${erro.slice(0, 300)}. ` +
    'O consumo ficou registrado.'
  )
}

/** Violação de índice único no Postgres (o INSERT perdeu a corrida). */
export function ehConflitoDeUnicidade(erro: { code?: string | null; message?: string | null } | null): boolean {
  if (!erro) return false
  return erro.code === '23505' || /duplicate key|unique constraint/i.test(String(erro.message ?? ''))
}

/** A coluna da 0062 ainda não existe no banco (migração pendente). */
export function faltaColunaDaLiberacao(erro: { message?: string | null } | null): boolean {
  return /liberado_(em|por)/i.test(String(erro?.message ?? ''))
}
