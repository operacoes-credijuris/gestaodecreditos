// De que estado é o crédito.
//
// A pergunta parece boba e não é: é ela que escolhe QUAL TABELA DE EMOLUMENTOS
// entra no preço, e é ela que escolhe o teto da RPV com que o valor bruto é
// comparado. Errar o estado aqui não dá erro em lugar nenhum — só produz um
// custo de cartório de outro estado dentro do deságio.
//
// Na Justiça Estadual a sigla resolve: TJPE tramita em PE. Nas outras duas
// justiças que pagam requisitório, não:
//
//   TRT — a sigla traz a REGIÃO, não o estado. TRT6 é Pernambuco, TRT18 é
//         Goiás. Vinte das vinte e quatro regiões cobrem um estado só, então o
//         mapa resolve quase sempre.
//
//   TRF — a região cobre vários estados (a 1ª cobre treze). Só o TRF6 é de um
//         estado só, Minas. Nos demais quem diz o estado é a SEÇÃO JUDICIÁRIA
//         do cabeçalho ("Seção Judiciária de Pernambuco", "Subseção Judiciária
//         de Campinas/SP") — que é o que a IA lê dos autos em `uf_tramitacao`.
//         Aqui a região serve de conferência: se a UF lida não pertence à
//         região do processo, uma das duas está errada e isso vira aviso.
//
// O NÚMERO CNJ é a fonte mais dura que existe para a região, e está sempre
// presente: NNNNNNN-DD.AAAA.J.TR.OOOO, onde J é o segmento (4 = Justiça
// Federal, 5 = Justiça do Trabalho, 8 = Justiça dos Estados) e TR é o tribunal
// dentro dele — a região, nos dois primeiros (Resolução CNJ 65/2008, art. 1º).
// Por isso ele é consultado antes da sigla: a sigla é a IA transcrevendo, o
// número é o número.
//
// NÃO HÁ MAPA DE TR PARA A JUSTIÇA ESTADUAL aqui de propósito. O código do TJ
// no número CNJ segue a ordem alfabética dos estados quase toda, mas não toda
// (São Paulo é 26, e a ordem alfabética daria 25), e eu não consegui confirmar
// a lista oficial inteira. Como a sigla TJxx já resolve o caso estadual sem
// ambiguidade, encodar uma tabela que eu não sei conferir só criaria uma
// chance de errar o estado em silêncio. Se um dia a lista for confirmada,
// entra aqui.

/** Região do TRT -> estados de jurisdição. Fonte: CSJT. */
const TRT_UF: Record<number, string[]> = {
  1: ['RJ'], 2: ['SP'], 3: ['MG'], 4: ['RS'], 5: ['BA'], 6: ['PE'],
  7: ['CE'], 8: ['PA', 'AP'], 9: ['PR'], 10: ['DF', 'TO'], 11: ['AM', 'RR'],
  12: ['SC'], 13: ['PB'], 14: ['RO', 'AC'], 15: ['SP'], 16: ['MA'],
  17: ['ES'], 18: ['GO'], 19: ['AL'], 20: ['SE'], 21: ['RN'], 22: ['PI'],
  23: ['MT'], 24: ['MS'],
}

/**
 * Região do TRF -> estados de jurisdição, já com o TRF6.
 *
 * O TRF6 foi instalado em 19/08/2022 e levou Minas Gerais, que até então era da
 * 1ª Região. Um mapa antigo mandaria um crédito mineiro para a lista da 1ª e a
 * conferência acusaria contradição onde não há.
 */
const TRF_UF: Record<number, string[]> = {
  1: ['AC', 'AM', 'AP', 'BA', 'DF', 'GO', 'MA', 'MT', 'PA', 'PI', 'RO', 'RR', 'TO'],
  2: ['RJ', 'ES'],
  3: ['SP', 'MS'],
  4: ['RS', 'SC', 'PR'],
  5: ['AL', 'CE', 'PB', 'PE', 'RN', 'SE'],
  6: ['MG'],
}

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
])
const uf2 = (s: unknown): string | null => {
  const t = String(s ?? '').trim().toUpperCase()
  return UFS.has(t) ? t : null
}

/** O segmento e o tribunal, lidos do número CNJ. */
export interface RegiaoDoProcesso {
  segmento: 'federal' | 'trabalho' | 'estadual' | 'outro'
  /** O campo TR: a região, na federal e na trabalhista. */
  tribunal: number
}

/**
 * Lê o segmento e a região do número único.
 *
 * Aceita o número com ou sem a pontuação, porque ele chega de campo digitado
 * tanto quanto de PDF. Devolve null se não houver um número CNJ reconhecível —
 * "NÃO LOCALIZADO" é uma resposta que a extração dá.
 */
export function lerNumeroCnj(numero: unknown): RegiaoDoProcesso | null {
  const cru = String(numero ?? '').replace(/[^\d]/g, '')
  if (cru.length !== 20) return null
  //  7 seq | 2 dv | 4 ano | 1 segmento | 2 tribunal | 4 origem
  const segmentoDigito = cru.slice(13, 14)
  const tribunal = Number(cru.slice(14, 16))
  const segmento =
    segmentoDigito === '4' ? 'federal'
    : segmentoDigito === '5' ? 'trabalho'
    : segmentoDigito === '8' ? 'estadual'
    : 'outro'
  return { segmento, tribunal }
}

/** Os estados que uma região cobre; lista vazia se a região não existe. */
function estadosDaRegiao(segmento: string, regiao: number): string[] {
  if (segmento === 'trabalho') return TRT_UF[regiao] ?? []
  if (segmento === 'federal') return TRF_UF[regiao] ?? []
  return []
}

/** A região, lida da sigla do tribunal ("TRT18" -> trabalho 18, "TRF6" -> federal 6). */
function regiaoDaSigla(tribunal: unknown): RegiaoDoProcesso | null {
  const t = String(tribunal ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const trt = /^TRT(\d{1,2})$/.exec(t)
  if (trt) return { segmento: 'trabalho', tribunal: Number(trt[1]) }
  const trf = /^TRF(\d)$/.exec(t)
  if (trf) return { segmento: 'federal', tribunal: Number(trf[1]) }
  return null
}

export interface OrigemUf {
  uf: string | null
  /** De onde a UF saiu — a tela e os avisos dizem isso em português. */
  fonte: 'autos' | 'regiao' | 'sigla' | 'nenhuma'
  /** Quando a região cobre vários estados e não houve como desempatar. */
  candidatas?: string[]
  /** Contradição ou ambiguidade que o operador precisa saber. */
  aviso?: string
}

/**
 * A UF do tribunal onde o crédito tramita — é a tabela de emolumentos dela que
 * vale, e é o teto de RPV dela que se aplica.
 *
 * A ordem é deliberada:
 *
 *   1. O que a IA leu do cabeçalho (`uf_tramitacao`). É a comarca, a vara ou a
 *      seção judiciária do próprio documento: a resposta direta.
 *   2. A região, quando ela tem um estado só. Vale para vinte dos vinte e
 *      quatro TRTs e para o TRF6.
 *   3. A sigla TJxx.
 *
 * E em qualquer caso a região CONFERE o que veio dos autos: uma UF que não
 * pertence à região do processo é contradição, e sai como aviso em vez de
 * escolher em silêncio qual das duas está certa.
 */
export function resolverUf(dados: {
  uf_tramitacao?: unknown
  tribunal?: unknown
  numero_processo?: unknown
}): OrigemUf {
  const regiao = lerNumeroCnj(dados.numero_processo) ?? regiaoDaSigla(dados.tribunal)
  const estados = regiao ? estadosDaRegiao(regiao.segmento, regiao.tribunal) : []
  const nome = regiao?.segmento === 'trabalho' ? `TRT${regiao.tribunal}`
    : regiao?.segmento === 'federal' ? `TRF${regiao.tribunal}`
    : null

  const lida = uf2(dados.uf_tramitacao)
  if (lida) {
    if (estados.length && !estados.includes(lida)) {
      return {
        uf: lida,
        fonte: 'autos',
        candidatas: estados,
        aviso: `A UF lida dos autos (${lida}) não fica na jurisdição do ${nome}, que abrange ${estados.join(', ')}. Usei ${lida}, que veio do cabeçalho — mas confira o tribunal e a tabela de emolumentos antes de fechar.`,
      }
    }
    return { uf: lida, fonte: 'autos' }
  }

  // Região de um estado só: não há o que desempatar.
  if (estados.length === 1) return { uf: estados[0], fonte: 'regiao' }

  if (estados.length > 1) {
    return {
      uf: null,
      fonte: 'nenhuma',
      candidatas: estados,
      aviso: `O ${nome} abrange ${estados.join(', ')} e a seção judiciária não apareceu nos autos lidos, então não dá para saber o estado. Sem ele não há tabela de emolumentos nem teto de RPV a aplicar — informe o custo de cartório à mão, ou junte ao card a peça com o cabeçalho da vara.`,
    }
  }

  const m = /^TJ([A-Z]{2})$/.exec(String(dados.tribunal ?? '').toUpperCase().trim())
  const daSigla = m ? uf2(m[1]) : null
  if (daSigla) return { uf: daSigla, fonte: 'sigla' }

  return { uf: null, fonte: 'nenhuma' }
}
