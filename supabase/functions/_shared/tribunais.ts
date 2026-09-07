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
// A JUSTIÇA ESTADUAL TAMBÉM TEM MAPA (TJ_UF, abaixo), pela tabela do Anexo I da
// Resolução CNJ 65/2008: um código por tribunal, de 01 (AC) a 27 (TO). A ordem é
// alfabética com uma inversão conhecida — Sergipe é 25 e São Paulo é 26 —, e
// cada código confere com o formato que se vê em qualquer processo do estado
// (…8.26.… é TJSP, …8.19.… é TJRJ, …8.09.… é TJGO, …8.17.… é TJPE). Com ele, o
// estado de um processo estadual sai do NÚMERO, sem depender da IA transcrever a
// sigla certa — e a sigla, quando vem, é conferida contra o número.

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

/**
 * Código do Tribunal de Justiça no número CNJ -> estado. Fonte: Anexo I da
 * Resolução CNJ 65/2008. Cada tribunal cobre um estado só, então aqui a
 * resposta é sempre uma — e sai do número, não da sigla que a IA transcreveu.
 */
const TJ_UF: Record<number, string> = {
  1: 'AC', 2: 'AL', 3: 'AP', 4: 'AM', 5: 'BA', 6: 'CE', 7: 'DF', 8: 'ES', 9: 'GO',
  10: 'MA', 11: 'MT', 12: 'MS', 13: 'MG', 14: 'PA', 15: 'PB', 16: 'PR', 17: 'PE', 18: 'PI',
  19: 'RJ', 20: 'RN', 21: 'RS', 22: 'RO', 23: 'RR', 24: 'SC', 25: 'SE', 26: 'SP', 27: 'TO',
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
  if (segmento === 'estadual') return TJ_UF[regiao] ? [TJ_UF[regiao]] : []
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
    : regiao?.segmento === 'estadual' ? `TJ${TJ_UF[regiao.tribunal] ?? regiao.tribunal}`
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

  // Sem pontuação: "TJ-GO", "TJ/GO" e "TJ GO" são o mesmo tribunal que "TJGO",
  // e a IA escreve dos quatro jeitos. Antes só o último casava, e os outros
  // deixavam a UF vazia — sem cartório e sem teto, em silêncio.
  const m = /^TJ([A-Z]{2})$/.exec(String(dados.tribunal ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
  const daSigla = m ? uf2(m[1]) : null
  if (daSigla) return { uf: daSigla, fonte: 'sigla' }

  return { uf: null, fonte: 'nenhuma' }
}

/**
 * QUAL município é o devedor, quando o ente é municipal.
 *
 * Existe porque o teto da RPV municipal é de CADA MUNICÍPIO, por lei sua (CF,
 * art. 100, §4º) — e o que estava guardado por estado era o número da CAPITAL.
 * Comparar um crédito contra o Município de Anápolis com o teto de Goiânia é
 * comparar com a lei errada, e o erro anda para os dois lados: passa sem alerta
 * um crédito que precisa de renúncia, ou alerta um que não precisa.
 *
 * Devolve o nome LIMPO do município, ou null quando o ente não é municipal ou
 * quando o nome não dá para isolar. Null não é falha: significa "use a
 * referência da capital e diga que é referência".
 *
 * NÃO ADIVINHA. "Fazenda Pública Municipal" sem cidade nenhuma devolve null, e
 * não a capital do estado — inventar o nome aqui produziria uma pesquisa de teto
 * de um município que não é o do crédito, gravada no cache como se fosse.
 */
export function municipioDoEnte(ente: unknown): string | null {
  const bruto = String(ente ?? '').replace(/\s+/g, ' ').trim()
  if (!bruto) return null

  const semAcento = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const t = semAcento(bruto)
  if (!/\bmunicip|prefeitura|camara municipal/.test(t)) return null

  // Os prefixos que vêm antes do nome, do mais longo para o mais curto — senão
  // "Prefeitura Municipal de X" casaria só o "Prefeitura" e sobraria
  // "Municipal de X".
  const PREFIXOS = [
    /^(?:a\s+)?prefeitura\s+municipal\s+d[eoa]s?\s+/i,
    /^(?:a\s+)?camara\s+municipal\s+d[eoa]s?\s+/i,
    /^(?:o\s+)?municipio\s+d[eoa]s?\s+/i,
    /^(?:a\s+)?fazenda\s+publica\s+d[oe]\s+municipio\s+d[eoa]s?\s+/i,
    /^(?:a\s+)?prefeitura\s+d[eoa]s?\s+/i,
  ]
  // Comparado sem acento, recortado NO ORIGINAL: o nome tem de sair com os
  // acentos que tem, porque é ele que vai para a busca web e para o aviso.
  for (const re of PREFIXOS) {
    const m = re.exec(t)
    if (m) {
      const nome = bruto.slice(m[0].length).trim()
      return limparNomeMunicipio(nome)
    }
  }

  // "Município de São Paulo/SP" com outra redação, ou "Fazenda Pública
  // Municipal de Caruaru": pega o que vem depois do último "de" que segue a
  // palavra municipal.
  const m2 = /municip\w*\s+(?:d[eoa]s?\s+)?([^,;()]+)/i.exec(bruto)
  if (m2) return limparNomeMunicipio(m2[1])
  return null
}

/** Tira a UF colada, artigos soltos e pontuação de sobra do nome recortado. */
function limparNomeMunicipio(s: string): string | null {
  const nome = String(s ?? '')
    // "São Paulo/SP", "Campinas - SP", "Anápolis (GO)" -> só a cidade.
    .replace(/\s*[\/\-–—(]\s*[A-Za-z]{2}\s*\)?\s*$/, '')
    .replace(/[.,;]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Uma palavra genérica sozinha não é nome de cidade.
  if (!nome || nome.length < 2) return null
  if (/^(municipal|municipio|prefeitura|publica|fazenda)$/i.test(nome)) return null
  return nome
}
