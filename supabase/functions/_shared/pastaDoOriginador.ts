// A PASTA DO ORIGINADOR NO DRIVE, pelo NOME IGUAL — e só por ele.
//
// POR QUE NÃO "CONTÉM". A busca aceitava a primeira pasta cujo nome CONTINHA o
// do originador, e no Drive real isso erra de pessoa: em B. Processos /
// Precatórios há "Intermediador - Luiz Guilherme Batista Carvalho", e um card
// cujo intermediador fosse "Guilherme" teria o contrato gravado na pasta dele.
// Decisão do dono (02/10/2026): só nome igual. Sem pasta igual, a geração cria
// uma com o nome do card e avisa — "confira se não é erro de digitação" —, que
// é um erro que aparece, em vez de um contrato na pasta de outra pessoa.
//
// IGUAL QUER DIZER: sem contar acento, maiúsculas, espaços, pontuação e o
// prefixo "Intermediador - " / "Originador - ". O prefixo é a convenção das
// pastas antigas (B. Processos é toda assim), e "Fernando" no card É a pasta
// "Intermediador - Fernando". Ele sai do nome CRU, antes de normalizar: a
// normalização tira o hífen e os espaços, e aí "Originadora Brasil" perderia
// as letras do começo junto com um prefixo que não tem.
import { normalizarParaComparar } from './nucleo/texto.ts'

const RE_PREFIXO = /^\s*(?:intermediador|originador)\s*-\s*/i

/** O nome do originador como se compara: sem prefixo de pasta, acento, caixa nem pontuação. */
export function chaveDoOriginador(nome: string | null | undefined): string {
  return normalizarParaComparar(String(nome ?? '').replace(RE_PREFIXO, ''))
}

/**
 * A pasta de nome igual ao do originador, ou null.
 *
 * Duas pastas iguais depois da normalização ("CMR Advogados" e "Intermediador
 * - CMR Advogados") são a mesma pessoa escrita de dois jeitos: fica a primeira
 * da lista, e qualquer uma é a certa.
 */
export function pastaDoOriginador<T extends { name: string }>(pastas: T[], originador: string): T | null {
  const alvo = chaveDoOriginador(originador)
  if (!alvo) return null
  return pastas.find((p) => chaveDoOriginador(p.name) === alvo) ?? null
}

/** A casa também origina crédito, e aparece na lista mesmo sem pasta própria. */
export const ORIGINADOR_CREDIJURIS = 'Credijuris'

/** "Credijuris", "Originador - Credijuris", "Intermediador - CREDIJURIS" — e não "Credijuris Parceiros". */
export function ehPastaCredijuris(nome: string): boolean {
  return chaveDoOriginador(nome) === chaveDoOriginador(ORIGINADOR_CREDIJURIS)
}
