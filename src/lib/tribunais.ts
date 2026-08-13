// Nome dos tribunais por extenso, a partir da sigla.
//
// O cadastro guarda a SIGLA (é o que a equipe digita e o que a extração padroniza),
// mas o endereçamento de uma petição de segundo grau pede o nome inteiro:
// "COLENDO(A) PRESIDÊNCIA DO TRIBUNAL REGIONAL FEDERAL DA SEXTA REGIÃO".
//
// SIGLA DESCONHECIDA VOLTA COMO ESTÁ. Petição com a sigla no endereçamento é feia;
// petição que não gera não serve para nada.

/**
 * O nome do estado JÁ COM A PREPOSIÇÃO, tabelado nos 27 em vez de deduzido.
 *
 * "do Estado de Goiás" mas "do Estado do Rio Grande do Sul": a preposição depende do
 * artigo que o nome do estado carrega, e não há regra de terminação que acerte os 27
 * — "Bahia" pede "da", "Amapá" pede "do", "Goiás" pede "de". Errar aqui é errar no
 * cabeçalho de uma peça protocolada.
 */
const ESTADO: Record<string, string> = {
  AC: 'do Acre',
  AL: 'de Alagoas',
  AP: 'do Amapá',
  AM: 'do Amazonas',
  BA: 'da Bahia',
  CE: 'do Ceará',
  DF: 'do Distrito Federal',
  ES: 'do Espírito Santo',
  GO: 'de Goiás',
  MA: 'do Maranhão',
  MT: 'de Mato Grosso',
  MS: 'de Mato Grosso do Sul',
  MG: 'de Minas Gerais',
  PA: 'do Pará',
  PB: 'da Paraíba',
  PR: 'do Paraná',
  PE: 'de Pernambuco',
  PI: 'do Piauí',
  RJ: 'do Rio de Janeiro',
  RN: 'do Rio Grande do Norte',
  RS: 'do Rio Grande do Sul',
  RO: 'de Rondônia',
  RR: 'de Roraima',
  SC: 'de Santa Catarina',
  SP: 'de São Paulo',
  SE: 'de Sergipe',
  TO: 'do Tocantins',
}

/**
 * Ordinais femininos por extenso, até a 24ª — é até onde vão os TRTs. Índice 0 fica
 * vazio para o número servir de índice direto.
 */
const ORDINAL = [
  '',
  'Primeira',
  'Segunda',
  'Terceira',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sétima',
  'Oitava',
  'Nona',
  'Décima',
  'Décima Primeira',
  'Décima Segunda',
  'Décima Terceira',
  'Décima Quarta',
  'Décima Quinta',
  'Décima Sexta',
  'Décima Sétima',
  'Décima Oitava',
  'Décima Nona',
  'Vigésima',
  'Vigésima Primeira',
  'Vigésima Segunda',
  'Vigésima Terceira',
  'Vigésima Quarta',
]

/** Tribunais de nome único, sem padrão para derivar. */
const SUPERIORES: Record<string, string> = {
  STF: 'Supremo Tribunal Federal',
  STJ: 'Superior Tribunal de Justiça',
  TST: 'Tribunal Superior do Trabalho',
  TSE: 'Tribunal Superior Eleitoral',
  STM: 'Superior Tribunal Militar',
  // Nome OFICIAL, e não "do Estado do Distrito Federal" como o molde dos outros TJ
  // produziria: o DF não é estado e o tribunal responde também pelos territórios.
  TJDFT: 'Tribunal de Justiça do Distrito Federal e dos Territórios',
  TJDF: 'Tribunal de Justiça do Distrito Federal e dos Territórios',
}

/**
 * Nome por extenso de uma sigla de tribunal, em caixa mista.
 *
 * Tolera as formas em que a sigla aparece na prática — "TRF-6", "TRF6", "TRF 6",
 * "tj-go" — porque o campo é texto livre e a padronização da extração convive com o
 * que já foi digitado à mão.
 *
 * Quem endereça a petição aplica a caixa alta; aqui sai legível para poder ser
 * reaproveitado em tela ou em relatório.
 */
export function nomeTribunal(sigla: string | null | undefined): string {
  const bruto = String(sigla ?? '').trim()
  if (!bruto) return ''
  // Sem pontuação, sem espaço, em caixa alta: "TRF - 6" e "trf6" viram TRF6.
  const s = bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

  if (SUPERIORES[s]) return SUPERIORES[s]

  const regional = (prefixo: string) => {
    const m = new RegExp(`^${prefixo}(\\d{1,2})$`).exec(s)
    if (!m) return null
    const n = Number(m[1])
    return ORDINAL[n] ? `${ORDINAL[n]} Região` : null
  }

  const trf = regional('TRF')
  if (trf) return `Tribunal Regional Federal da ${trf}`

  const trt = regional('TRT')
  if (trt) return `Tribunal Regional do Trabalho da ${trt}`

  const tre = /^TRE([A-Z]{2})$/.exec(s)
  if (tre) {
    const uf = tre[1]
    if (uf === 'DF') return 'Tribunal Regional Eleitoral do Distrito Federal'
    if (ESTADO[uf]) return `Tribunal Regional Eleitoral do Estado ${ESTADO[uf]}`
  }

  const tj = /^TJ([A-Z]{2})$/.exec(s)
  if (tj && ESTADO[tj[1]]) return `Tribunal de Justiça do Estado ${ESTADO[tj[1]]}`

  const trm = /^TJM([A-Z]{2})$/.exec(s)
  if (trm && ESTADO[trm[1]]) {
    return `Tribunal de Justiça Militar do Estado ${ESTADO[trm[1]]}`
  }

  // Não reconhecido: devolve como o cadastro tem, sem inventar nome de tribunal.
  return bruto
}
