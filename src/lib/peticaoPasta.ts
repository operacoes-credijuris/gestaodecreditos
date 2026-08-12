// Onde no Drive a petição gerada vai ser salva.
//
// O caminho tem quatro níveis:
//
//   B. Processos
//   └── Precatórios | Requisições de Pequeno Valor      (espécie do requisitório)
//       └── Intermediador - NOME                        (originador do crédito)
//           └── CNJ ou nome do cedente                  (o crédito)
//               └── 5. Petições  ou  7. RPV complementar
//
// NADA AQUI ADIVINHA POR SEMELHANÇA. A comparação é por nome exato depois de
// normalizar, e quando não casa a função devolve os CANDIDATOS para a pessoa
// escolher. O motivo é concreto: as pastas do Drive têm "Intermediador - Guilherme"
// e "Intermediador - Luiz Guilherme Batista Carvalho", que são pessoas DIFERENTES.
// Comparação por pedaço de nome acertaria nove vezes e na décima salvaria a petição
// na pasta de outro originador — pior que não achar.
import { normalizarBusca, onlyDigits } from './format'
import { listarSubpastas, PASTA_PROCESSOS, type PastaDrive } from './drive'
import type { EspecieRequisitorio, Processo } from './types'

/** Nome da pasta de topo de cada espécie, como está no Drive. */
export const PASTA_DA_ESPECIE: Record<EspecieRequisitorio, string> = {
  rpv: 'Requisições de Pequeno Valor',
  precatorio: 'Precatórios',
}

/**
 * Prefixos que as pastas de originador usam no Drive e que não fazem parte do nome.
 *
 * "Intermediador" é o termo antigo — a plataforma passou a chamar de originador na
 * migração 0029, mas as pastas seguem com o nome velho, e renomeá-las é decisão de
 * quem organiza o Drive, não deste código. "PitchYes" não tem prefixo nenhum, e é
 * por isso que a remoção é opcional.
 */
const PREFIXOS = ['intermediador -', 'originador -']

/** Nome da pasta sem o prefixo, sem acento, sem espaço sobrando, em minúsculas. */
export function nomeDePasta(bruto: string): string {
  const limpo = normalizarBusca(bruto)
  for (const p of PREFIXOS) {
    if (limpo.startsWith(p)) return limpo.slice(p.length).trim()
  }
  return limpo
}

/** A pasta cujo nome casa exatamente com o valor, ou nada. */
function casarExato(pastas: PastaDrive[], valor: string): PastaDrive | null {
  const alvo = normalizarBusca(valor)
  if (!alvo) return null
  const achadas = pastas.filter((p) => nomeDePasta(p.nome) === alvo)
  // Duas pastas com o mesmo nome normalizado é ambiguidade: escolher uma seria
  // sorteio. Devolve nada, e quem chama pergunta.
  return achadas.length === 1 ? achadas[0] : null
}

/**
 * A pasta do crédito. Casa por CNJ (só dígitos) ou pelo nome do cedente — as duas
 * convenções convivem no Drive: sob "Intermediador - Hebert..." as pastas são
 * CNJ, e sob "Intermediador - Lys Andrea..." é o nome do cedente.
 */
function casarCredito(pastas: PastaDrive[], processo: Processo): PastaDrive | null {
  const digitos = onlyDigits(processo.numero_cnj)
  if (digitos.length >= 6) {
    const porCnj = pastas.filter((p) => onlyDigits(p.nome) === digitos)
    if (porCnj.length === 1) return porCnj[0]
  }
  return casarExato(pastas, processo.cedente ?? '')
}

/** Uma das sete pastas do crédito, pelo NÚMERO do prefixo. */
function casarPorNumero(pastas: PastaDrive[], numero: number): PastaDrive | null {
  // Pelo número, e não pelo nome inteiro: renomear "5. Petições" para "5. Peças" não
  // pode quebrar a geração. O número é a parte estável da convenção.
  const achadas = pastas.filter((p) => p.nome.trim().startsWith(`${numero}.`))
  return achadas.length === 1 ? achadas[0] : null
}

/**
 * Qual das sete pastas recebe a petição.
 *
 * Regra do produto: tudo vai para "5. Petições", MENOS a de RPV complementar, que vai
 * para "7. RPV complementar".
 */
export const numeroDaPastaDestino = (nomeDoModelo: string): number =>
  normalizarBusca(nomeDoModelo).includes('rpv complementar') ? 7 : 5

export type Etapa = 'especie' | 'originador' | 'credito' | 'destino'

const COMO_CHAMAR: Record<Etapa, string> = {
  especie: 'a pasta da espécie do requisitório',
  originador: 'a pasta do originador',
  credito: 'a pasta do crédito',
  destino: 'a pasta de destino dentro do crédito',
}

/**
 * O que a resolução devolve.
 *
 * `pronto` é o caminho inteiro achado. `escolher` é a parada: diz em que etapa
 * parou, o que estava procurando e QUAIS pastas existem ali, para a janela oferecer
 * a escolha em vez de falhar com "não encontrado".
 */
export type Resolucao =
  | { tipo: 'pronto'; pastaId: string; caminho: string[] }
  | {
      tipo: 'escolher'
      etapa: Etapa
      procurado: string
      dentroDe: string
      candidatas: PastaDrive[]
      caminho: string[]
      motivo: string
    }

/**
 * Desce até a pasta DO CRÉDITO — espécie, originador, crédito.
 *
 * Separada da resolução da petição porque tem dois usos: a geração desce um nível a
 * mais (até `5. Petições`), e o número do processo nas telas de Créditos e Tarefas
 * abre exatamente esta. Duas descidas escritas em separado divergiriam, e o clique
 * no número levaria a uma pasta e a petição a outra.
 *
 * Para na primeira etapa que não resolve, informando onde parou — descer "no chute"
 * a partir de um nível errado apontaria para um lugar plausível e errado, que é o
 * pior resultado possível aqui.
 */
export async function resolverPastaDoCredito(processo: Processo): Promise<Resolucao> {
  const caminho: string[] = []

  if (!processo.especie_requisitorio) {
    return {
      tipo: 'escolher',
      etapa: 'especie',
      procurado: '',
      dentroDe: PASTA_PROCESSOS,
      candidatas: await listarSubpastas(PASTA_PROCESSOS),
      caminho,
      motivo:
        'O crédito não tem a espécie do requisitório preenchida, então não há como saber se a petição vai em Precatórios ou em Requisições de Pequeno Valor.',
    }
  }

  const nomeEspecie = PASTA_DA_ESPECIE[processo.especie_requisitorio]
  const naRaiz = await listarSubpastas(PASTA_PROCESSOS)
  const pastaEspecie = casarExato(naRaiz, nomeEspecie)
  if (!pastaEspecie) {
    return {
      tipo: 'escolher',
      etapa: 'especie',
      procurado: nomeEspecie,
      dentroDe: PASTA_PROCESSOS,
      candidatas: naRaiz,
      caminho,
      motivo: `Não achei a pasta "${nomeEspecie}" na raiz de B. Processos.`,
    }
  }
  caminho.push(pastaEspecie.nome)

  const originador = (processo.originador ?? '').trim()
  const pastasOriginador = await listarSubpastas(pastaEspecie.id)
  const pastaOriginador = originador
    ? casarExato(pastasOriginador, originador)
    : null
  if (!pastaOriginador) {
    return {
      tipo: 'escolher',
      etapa: 'originador',
      procurado: originador,
      dentroDe: pastaEspecie.id,
      candidatas: pastasOriginador,
      caminho,
      motivo: originador
        ? `Não achei a pasta do originador "${originador}" dentro de ${pastaEspecie.nome}.`
        : 'O crédito não tem originador informado.',
    }
  }
  caminho.push(pastaOriginador.nome)

  const pastasCredito = await listarSubpastas(pastaOriginador.id)
  const pastaCredito = casarCredito(pastasCredito, processo)
  if (!pastaCredito) {
    return {
      tipo: 'escolher',
      etapa: 'credito',
      procurado: `${processo.numero_cnj} ou ${processo.cedente ?? 'cedente'}`,
      dentroDe: pastaOriginador.id,
      candidatas: pastasCredito,
      caminho,
      motivo: `Não achei a pasta do crédito dentro de ${pastaOriginador.nome}. As pastas ali são nomeadas por número do processo ou por nome do cedente.`,
    }
  }
  caminho.push(pastaCredito.nome)

  return { tipo: 'pronto', pastaId: pastaCredito.id, caminho }
}

/**
 * Desce até a pasta que RECEBE a petição: a do crédito, e dentro dela a `5.
 * Petições` — ou a `7. RPV complementar`, quando o modelo é esse.
 */
export async function resolverPastaDaPeticao(
  processo: Processo,
  nomeDoModelo: string,
  /**
   * Força a pasta de destino, ignorando o nome. A GERAÇÃO POR IA passa 5 sempre:
   * ali não existe "nome do modelo", e o título que a IA escreve não pode decidir
   * pasta — um título contendo "RPV complementar" mandaria a peça para a 7 sem
   * ninguém ter escolhido isso. Por decisão do produto, peça de IA vai toda para
   * "5. Petições".
   */
  numeroForcado?: number,
): Promise<Resolucao> {
  const doCredito = await resolverPastaDoCredito(processo)
  if (doCredito.tipo !== 'pronto') return doCredito

  const numero = numeroForcado ?? numeroDaPastaDestino(nomeDoModelo)
  const setePastas = await listarSubpastas(doCredito.pastaId)
  const destino = casarPorNumero(setePastas, numero)
  const nomeCredito = doCredito.caminho[doCredito.caminho.length - 1]
  if (!destino) {
    return {
      tipo: 'escolher',
      etapa: 'destino',
      procurado: `pasta começando com "${numero}."`,
      dentroDe: doCredito.pastaId,
      candidatas: setePastas,
      caminho: doCredito.caminho,
      motivo: `Não achei a pasta "${numero}." dentro de ${nomeCredito}.`,
    }
  }

  return {
    tipo: 'pronto',
    pastaId: destino.id,
    caminho: [...doCredito.caminho, destino.nome],
  }
}

/** Link de uma pasta do Drive, para abrir em outra aba. */
export const linkDaPasta = (pastaId: string) =>
  `https://drive.google.com/drive/folders/${pastaId}`

export { COMO_CHAMAR }
