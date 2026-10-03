// A busca das telas do Operacional (Créditos, Requerimentos, Publicações,
// Tarefas e Contatos), num lugar só.
//
// POR QUE UMA FUNÇÃO SÓ: cada tela tinha a sua cópia da mesma regra — texto sem
// acento e, para número de processo, a comparação por dígito —, e cada cópia
// decidia sozinha EM QUE CAMPOS o número valia. Em Créditos o número só casava
// com o CNJ, o RTDPJ e o administrativo; em Contatos, só com os telefones. Quem
// colava o número de um e-mail de gabinete ("vara13@trt5.jus.br" → "13") ou o
// CPF que está nas observações não achava nada.
//
// A REGRA (a da amostra aprovada, `casaBusca`):
//   1. o texto, sem acento e sem maiúscula, contido em QUALQUER campo;
//   2. senão, com `minDigitos` dígitos ou mais, os dígitos da busca contidos nos
//      dígitos de QUALQUER campo — o número colado cru acha o formatado, e o
//      formatado acha o cru.
// Tudo o que as telas achavam antes continua achando: a regra só alargou.
import { normalizarBusca, onlyDigits } from './format'

/** Um campo da busca: texto, número ou vazio (vazio nunca casa). */
export type CampoDeBusca = string | number | null | undefined

/**
 * A busca casa com algum dos campos? Busca vazia casa com tudo.
 *
 * @param minDigitos a partir de quantos dígitos a comparação por número vale.
 *   4 nas telas de processo (com menos, "20" traria meia lista pelo ano); 3 em
 *   Contatos, onde o que se procura é um pedaço de telefone.
 */
export function casaBusca(
  campos: readonly CampoDeBusca[],
  busca: string | null | undefined,
  minDigitos = 4,
): boolean {
  const q = normalizarBusca(busca)
  if (!q) return true
  const textos = campos
    .filter((c) => c !== null && c !== undefined && c !== '')
    .map((c) => String(c))
  if (textos.some((t) => normalizarBusca(t).includes(q))) return true
  const qd = onlyDigits(busca)
  return qd.length >= minDigitos && textos.some((t) => onlyDigits(t).includes(qd))
}
