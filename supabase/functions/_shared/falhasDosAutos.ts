// O QUE É FALHA DE VERDADE NA ROTINA DOS AUTOS, e o que só passa.
//
// POR QUE ISTO EXISTE. Antes da primeira volta real (02/10/2026), a revisão da
// rotina achou o mesmo erro em cinco lugares: resposta passageira tratada como
// definitiva. Um 429 do Kommo, um 5xx do Escavador ou um token vencido
// terminavam em FALHOU — que é para sempre, com nota no card dizendo "anexe à
// mão" —, e o processo não era pedido nem anexado de novo depois que o problema
// passava. E no sentido contrário, o mais caro: consulta de status que falhou
// era lida como "não há pedido", e a rotina pagava um pedido novo.
//
// A REGRA: só é definitivo o que o serviço AFIRMA (o processo não existe, o
// número é inválido, não há permissão para aquele recurso). Silêncio, demora,
// limite de uso e erro do lado deles passam, e a próxima volta tenta de novo.

/** Status 0 = a requisição nem voltou (rede, DNS, tempo esgotado). */
export const SEM_RESPOSTA = 0

/** Falha que passa sozinha: tempo esgotado, limite de uso, erro do lado do serviço. */
export function falhaPassageira(status: number): boolean {
  return status === SEM_RESPOSTA || status === 408 || status === 429 || status >= 500
}

/**
 * A consulta de status RESPONDEU algo em que se pode confiar.
 *
 * 200 traz a última verificação; 404 e 422 dizem que não há nada (processo
 * desconhecido, número recusado). Fora disso — 401, 403, 429, 5xx, tempo
 * esgotado — a consulta não disse nada, e pedir com base nela é pagar no
 * escuro: o reaproveitamento dos 30 dias e a adoção do pedido de uma volta que
 * morreu dependem justamente desta resposta.
 */
export function consultaRespondeu(status: number): boolean {
  return status === 200 || status === 404 || status === 422
}

/**
 * O pedido foi recusado por um problema da CONTA, não do processo.
 *
 * Token recusado (401/403) e limite de chamadas (429) valem para todos os
 * processos da volta: marcar cada um como FALHOU encerraria todos, e nenhum
 * seria pedido de novo depois que o token fosse trocado.
 */
export function recusaDaConta(status: number): boolean {
  return status === 401 || status === 403 || status === 429
}

/**
 * O Kommo recusou o ACESSO ao drive ou ao card — isso não passa sozinho.
 *
 * É o caso de token sem o escopo de arquivos: tentar de novo em meia hora daria
 * o mesmo 401/403 para sempre. O resto (5xx, 429, cota, rede) passa.
 */
export function semAcessoAoKommo(erro: string): boolean {
  return /Kommo recusou (?:a sessão|o anexo) \(HTTP 40[13]\)/.test(erro)
}

/**
 * A mensagem de erro descreve uma falha que passa: 5xx, 429, 408, tempo
 * esgotado, queda de rede.
 *
 * É o que decide se a tentativa volta para o documento quando o disjuntor
 * abre. Recusa que não passa sozinha (400, 413 — a cota do drive cheia, por
 * exemplo) continua contando, e o processo termina com a lista do que não
 * desceu, em vez de tentar de meia em meia hora para sempre.
 */
export function erroPassageiro(erro: string): boolean {
  return /\bHTTP (?:5\d\d|429|408)\b/.test(erro) || /timed? ?out|timeout|abort|network|connection|ECONN/i.test(erro)
}

/** O arquivo começa como PDF ("%PDF")? O anexo sobe com esse tipo. */
export function ehPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/**
 * Maior PDF que a função carrega na memória.
 *
 * A Edge Function tem 256 MB, e o documento é lido inteiro antes de subir em
 * partes. O drive do Kommo aceitaria 300 MB, mas a função cai antes — e uma
 * volta que morre no meio de um documento recomeçava por ele, para sempre. O
 * maior PDF do teste de 28/09 tinha 12,6 MB.
 */
export const MAX_BYTES_NA_MEMORIA = 150 * 1024 * 1024
