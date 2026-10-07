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

// ------------------------------------------------------------------
// A FALHA DO ROBÔ DO ESCAVADOR NO TRIBUNAL (pedido do dono, 07/10/2026).
//
// O pedido foi aceito e pago, o robô deles foi ao tribunal e voltou com ERRO.
// Parte desses erros é do caminho, e não do processo: o sistema do tribunal
// fora do ar, o login do certificado que não passou naquela hora. Nos dados de
// 07/10 eram ~13 processos parados assim, muitos do TJAP (.8.03), com
// INTERNAL_ERROR e LOGIN_ERROR. Esses se repetem sozinhos, de 10 em 10 minutos,
// até um teto — cada repetição é um pedido novo, e o Escavador não diz na
// documentação se pedido que falha é cobrado; aqui se assume que é (R$ 1,34).
//
// O RESTO NÃO SE REPETE: processo físico, segredo de justiça, processo não
// encontrado — e a recusa do pedido por falta de certificado/2FA (HTTP 422),
// que pede ação do dono no painel do Escavador e que nem chega até aqui (é
// recusada no pedido, não no tribunal).
// ------------------------------------------------------------------

/**
 * Os códigos de erro do robô que passam sozinhos.
 *
 * INTERNAL_ERROR e LOGIN_ERROR são os vistos em produção. Os outros são os
 * nomes de indisponibilidade e de tempo esgotado — falha do caminho por
 * definição —, para o caso de o Escavador os usar. Captcha fica de fora: pode
 * ser bloqueio que não passa, e repetir seria pagar seis vezes pelo mesmo não.
 */
export const FALHAS_PASSAGEIRAS_DO_ROBO = [
  'INTERNAL_ERROR',
  'LOGIN_ERROR',
  'TIMEOUT',
  'TIMEOUT_ERROR',
  'CONNECTION_ERROR',
  'SISTEMA_INDISPONIVEL',
  'TRIBUNAL_INDISPONIVEL',
] as const

/** Tentativas (pedidos pagos) por processo, no padrão: seis, de 10 em 10 minutos — uma hora. */
export const TENTATIVAS_DO_ROBO_PADRAO = 6
/** O teto que se aceita por processo, configurado ou não. */
export const TENTATIVAS_DO_ROBO_MAX = 24
/** De quanto em quanto se repete o pedido que o robô não conseguiu cumprir. */
export const INTERVALO_REPETIR_MIN = 10
/** Folga do relógio: o cron dispara de 10 em 10 minutos, e um segundo a menos não pode virar 20. */
const FOLGA_DO_CRON_MS = 60_000

/**
 * O código da falha do robô, se ela passa sozinha; null se não passa (ou se
 * não é falha do robô).
 *
 * SÓ O STATUS ERRO: NAO_ENCONTRADO e os outros são o tribunal dizendo algo do
 * processo, não o robô tropeçando no caminho.
 */
export function falhaPassageiraDoRobo(status: string | null | undefined, motivo: string | null | undefined): string | null {
  if (String(status ?? '').trim().toUpperCase() !== 'ERRO') return null
  const codigo = String(motivo ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  return (FALHAS_PASSAGEIRAS_DO_ROBO as readonly string[]).includes(codigo) ? codigo : null
}

/**
 * O código da falha do robô no TEXTO que a rotina gravou no processo
 * ("o robô não conseguiu entrar no tribunal (INTERNAL_ERROR)"). É o que
 * permite achar, entre os processos que já estão em FALHOU, os que valem uma
 * nova rodada — quando o registro do pedido não tem o motivo.
 */
export function codigoDoRoboNoDetalhe(detalhe: string | null | undefined): string | null {
  const m = /conseguiu entrar no tribunal \(([A-Za-z_ -]+)\)/.exec(String(detalhe ?? ''))
  return m ? falhaPassageiraDoRobo('ERRO', m[1]) : null
}

/** O teto de tentativas do processo: o configurado nele, ou o padrão; sempre entre 1 e 24. */
export function tetoDoRobo(configurado: number | null | undefined, padrao = TENTATIVAS_DO_ROBO_PADRAO): number {
  const n = Math.floor(Number(configurado))
  const t = Number.isFinite(n) && n > 0 ? n : padrao
  return Math.min(TENTATIVAS_DO_ROBO_MAX, Math.max(1, t))
}

/**
 * O que fazer depois de uma falha passageira do robô.
 *
 * `tentativas` são os pedidos pagos deste processo nesta rodada (o que acabou
 * de falhar incluído). Um pedido feito antes de a contagem existir conta como 1.
 *
 * A NOTA SÓ NA PRIMEIRA E NA ÚLTIMA: escrever a cada tentativa seriam seis
 * avisos iguais no chat do card em uma hora. A primeira diz que é do Escavador
 * e que a rotina vai tentar de novo; a última, que ela desistiu e como pedir
 * outra rodada. No meio, silêncio — e se der certo, quem fala é a nota dos
 * autos.
 */
export function depoisDaFalhaDoRobo(o: { tentativas: number; teto: number; jaAvisou: boolean }): {
  estado: 'REPETIR' | 'FALHOU'
  nota: 'primeira' | 'fim' | null
  tentativas: number
} {
  const tentativas = Math.max(1, Math.floor(Number(o.tentativas) || 0))
  if (tentativas >= o.teto) return { estado: 'FALHOU', nota: 'fim', tentativas }
  return { estado: 'REPETIR', nota: o.jaAvisou ? null : 'primeira', tentativas }
}

/**
 * Já é hora de repetir o pedido? Dez minutos desde o último pedido PAGO (e não
 * desde a última conferência): o aviso do Escavador acorda a rotina a qualquer
 * hora, e um robô que falha em segundos faria seis pedidos em dez minutos.
 */
export function horaDeRepetir(ultimoPedidoMs: number | null, agoraMs: number, intervaloMin = INTERVALO_REPETIR_MIN): boolean {
  if (!ultimoPedidoMs) return true
  return agoraMs - ultimoPedidoMs >= intervaloMin * 60_000 - FOLGA_DO_CRON_MS
}

/**
 * Já é hora de conferir um pedido em andamento? De meia em meia hora no
 * normal; de 10 em 10 minutos quando o processo está numa rodada de repetição
 * — senão cada tentativa levaria 40 minutos, e não 10.
 */
export function horaDeConferir(
  verificadoMs: number | null,
  agoraMs: number,
  emRepeticao: boolean,
  normalMin = 30,
): boolean {
  if (!verificadoMs) return true
  const min = emRepeticao ? INTERVALO_REPETIR_MIN : normalMin
  return agoraMs - verificadoMs >= min * 60_000 - FOLGA_DO_CRON_MS
}

/**
 * O card voltou à coluna de entrada DEPOIS que a rotina desistiu do processo?
 * É o jeito de a equipe pedir outra rodada sem chamar ninguém: tirar o card da
 * entrada e devolvê-lo.
 */
export function voltouParaAEntrada(o: { naEntrada: boolean; etapaEm: string | null; desistiuEm: string | null }): boolean {
  if (!o.naEntrada || !o.etapaEm || !o.desistiuEm) return false
  const e = Date.parse(o.etapaEm)
  const d = Date.parse(o.desistiuEm)
  return Number.isFinite(e) && Number.isFinite(d) && e > d
}
