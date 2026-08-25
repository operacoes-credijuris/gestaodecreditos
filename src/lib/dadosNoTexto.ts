// Acha DATA DE NASCIMENTO e CIDADE/UF em texto livre, para preencher o cadastro
// do sujeito do checklist.
//
// UM PARSER, QUALQUER FONTE — e é esse o ponto do arquivo. O mesmo código serve:
//
//   • ao PDF do processo, que já está lido na tela (custo zero, plataforma
//     nenhuma). A qualificação das partes traz nascimento e endereço na maioria
//     das petições iniciais;
//   • ao texto COLADO de qualquer lugar — Date Solutions, Serasa, o que a equipe
//     usar. Copia o resultado da consulta, cola na caixa, o parser lê;
//   • à resposta de uma API futura, se algum dia houver uma.
//
// O QUE ELE NÃO FAZ, igual ao cpfNoTexto.ts: escolher. Um processo tem o
// endereço do cedente, do advogado, do ente devedor e do fórum; e datas por toda
// parte. A função devolve CANDIDATOS com o trecho em volta, e quem confere clica.
// Adivinhar aqui produziria uma UF errada — e UF errada é o conjunto errado de
// certidões estaduais, com o dossiê fechando limpo.
//
// E VALE POR ARQUIVO, nunca sobre a junção de vários: juntar textos cria
// vizinhança que não existe em documento nenhum, e vizinhança falsa é achado
// falso. Ver o cabeçalho de cpfNoTexto.ts, onde isso mordeu de verdade.

// ------------------------------------------------------------------ comuns

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function limpar(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// ------------------------------------------------------------------ nascimento

export interface NascimentoEncontrado {
  /** ISO 'YYYY-MM-DD' — formato do <input type="date">. */
  iso: string
  comoApareceu: string
  /** ~100 caracteres em volta. */
  contexto: string
  posicao: number
}

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

// EXIGE RÓTULO, e esta é a decisão que torna a lista utilizável. Um processo é
// feito de datas: distribuição, audiência, publicação, citação, trânsito em
// julgado. Oferecer toda data como candidata entregaria trinta opções e nenhuma
// informação.
//
// O CONJUNTO DE VARIANTES E SEPARADORES É LARGO DE PROPÓSITO. A versão anterior
// aceitava só `[\s:.\-–—]` depois do rótulo, e perdia em SILÊNCIO as formas mais
// comuns da qualificação das partes:
//
//   "nascido(a) em 14/07/1962"                → o parêntese
//   "Nasc.: 14/07/1962" / "Data de Nasc.: …"  → a abreviação sem "dt"
//   "nascido em Belo Horizonte, em 14/07/1962" → a vírgula
//
// Perder é pior que exagerar: a tela não mostra nada, e a leitura natural passa a
// ser "o processo não tem a data" — que é exatamente o que este arquivo existe
// para não deixar acontecer.
const ROTULO_NASC =
  /(data\s+de\s+nasc(imento)?|nasc(imento|\.)|nascid[oa]s?|dt\.?\s*nasc\.?|\bDN\b)/gi

// "Certidão de Nascimento: 12/05/2011" casa o rótulo "nascimento", mas a data é a
// da CERTIDÃO, não da pessoa — e numa petição de inventário apareceria como
// nascimento do cedente.
const E_CERTIDAO = /certid(ao|ão)\s+de\s+nasc/i

const DATA_NUM = /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/g
const DATA_ISO = /(\d{4})-(\d{2})-(\d{2})/g
const DATA_ESCRITA = /(\d{1,2})\s+de\s+([a-zçà-ü]+)\s+de\s+(\d{4})/gi

/**
 * Data real e plausível como nascimento, ou null.
 *
 * Recusa data impossível (31/02), no futuro, e com mais de 120 anos. NÃO recusa
 * por idade baixa — herdeiro menor de idade existe, e recusar por isso esconderia
 * um caso legítimo.
 */
function dataValida(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (
    d.getUTCFullYear() !== ano ||
    d.getUTCMonth() !== mes - 1 ||
    d.getUTCDate() !== dia
  ) {
    return null // 31/02 e companhia
  }
  const hoje = new Date()
  if (d.getTime() > hoje.getTime()) return null
  if (hoje.getUTCFullYear() - ano > 120) return null
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Datas de nascimento no texto, sem repetir, na ordem em que aparecem.
 *
 * Lista vazia significa "não achei data ROTULADA como nascimento" — nunca "o
 * documento não tem a data". Quem chama tem de dizer isso na tela.
 */
export function acharNascimentos(texto: string, limite = 8): NascimentoEncontrado[] {
  if (!texto) return []
  const porIso = new Map<string, NascimentoEncontrado>()

  /**
   * Há rótulo de nascimento antes desta data?
   *
   * O RÓTULO NÃO PRECISA SER ADJACENTE, e é aqui que estava a perda silenciosa.
   * Exigir que a data viesse logo depois do rótulo derrubava duas formas comuns:
   *
   *   "nascido em Belo Horizonte, em 14/07/1962"
   *   "Data de nascimento (conforme documento apresentado): 03/11/1975"
   *
   * O que separa "rótulo desta data" de "rótulo de outra data" não é a distância
   * — é NÃO HAVER OUTRO NÚMERO NO MEIO. Em "nascido em 14/07/1962, e a audiência
   * em 12/03/2024", a segunda data tem "nascido" na janela, mas tem a primeira
   * data entre ela e o rótulo: reprovada. É essa a regra.
   */
  const temRotulo = (i: number) => {
    const antes = texto.slice(Math.max(0, i - 60), i)
    if (E_CERTIDAO.test(antes)) return false // rótulo de documento, não de pessoa

    ROTULO_NASC.lastIndex = 0
    let ultimo = -1
    let fimDoRotulo = -1
    let r: RegExpExecArray | null
    while ((r = ROTULO_NASC.exec(antes)) !== null) {
      ultimo = r.index
      fimDoRotulo = r.index + r[0].length
    }
    if (ultimo < 0) return false
    return !/\d/.test(antes.slice(fimDoRotulo))
  }

  const formas: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [DATA_NUM, (m) => dataValida(+m[3], +m[2], +m[1])],
    [DATA_ISO, (m) => dataValida(+m[1], +m[2], +m[3])],
    [
      DATA_ESCRITA,
      (m) => {
        const mes = MESES[semAcento(m[2])]
        return mes ? dataValida(+m[3], mes, +m[1]) : null
      },
    ],
  ]

  for (const [re, monta] of formas) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(texto)) !== null) {
      if (!temRotulo(m.index)) continue
      const iso = monta(m)
      if (!iso || porIso.has(iso)) continue
      porIso.set(iso, {
        iso,
        comoApareceu: m[0],
        contexto: limpar(
          texto.slice(Math.max(0, m.index - 85), m.index + m[0].length + 20),
        ),
        posicao: m.index,
      })
    }
  }

  return [...porIso.values()].sort((a, b) => a.posicao - b.posicao).slice(0, limite)
}

// ------------------------------------------------------------------ cidade/UF

export interface LocalEncontrado {
  uf: string
  municipio: string
  contexto: string
  posicao: number
  /** Havia palavra de residência por perto. */
  residencial: boolean
  /** Qual forma casou. Aparece na tela: dá ou tira confiança no achado. */
  forma: 'barra' | 'separador' | 'estado' | 'rotulado'
}

const UF_POR_NOME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA',
  ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
  'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR',
  pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO',
  roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE',
  tocantins: 'TO',
}

// PISTA DE LOCALIDADE, e ela existe por causa de um falso positivo concreto e
// perigoso: "SE" é sigla de Sergipe E pronome do português. Texto de contrato
// costuma vir em maiúsculas, e então
//
//   "O CEDENTE, JOSÉ CARLOS SALGADO, SE OBRIGA A..."
//
// casava o padrão `Cidade, UF` e virava "Salgado/SE" — mostrado na tela como
// "conferido contra a lista do IBGE", que é o pior tipo de erro: falso com cara
// de verificado. Salgado, Capela e Pinhão são municípios reais de Sergipe e
// sobrenomes comuns; 774 municípios têm nome de até seis letras.
//
// O mesmo vale para nome de estado por extenso: `para` sem acento é "Pará", então
// "Fulano, para efeitos de..." viraria "Fulano/PA".
//
// Por isso a forma `Cidade/UF` (barra) passa livre — a barra é específica o
// bastante —, e as formas com vírgula, hífen e nome de estado exigem uma palavra
// de localidade por perto.
const PISTA_LOCALIDADE =
  /(residente|domiciliad|resid[êe]ncia|morador|domic[íi]lio|comarca|cidade|munic[íi]pio|natural\s+d|logradouro|bairro|\bCEP\b|\brua\b|\bavenida\b|\bav\.|\bpra[çc]a\b|\brodovia\b|\bestrada\b|endere[çc]o(?!\s+eletr))/i

// Separado da pista: "comarca" e "rua" indicam LUGAR, mas não indicam que a
// pessoa MORA ali. Só estas palavras justificam o selo de residencial.
//
// "endereço" ficou de fora de propósito: "com endereço eletrônico x@y.com, e sede
// em Curitiba/PR" marcava Curitiba como residência do cedente.
const PERTO_DE_RESIDENCIA =
  /(residen|resid[ei]m?\b|resid[êe]ncia|domiciliad[oa]|morador[a]?|domic[íi]lio|natural\s+d)/i

// FIM DE FRASE EM TEXTO JURÍDICO NÃO É "PONTO".
//
// Petição é cheia de abreviação com ponto: "n. 320", "RG n. MG-4.556.778",
// "CPF/MF sob o n. 529.982.247-25", "Sr.", "art.". Cortar em todo ponto partia o
// endereço no meio e jogava fora o "residente" que estava no começo dele.
//
// O limite é ponto (ou ; ! ?) seguido de espaço e MAIÚSCULA. "n. 320" não casa,
// porque vem dígito; "Uberlândia/MG. O autor" casa.
const FIM_DE_FRASE = /[.;!?]\s+(?=[A-ZÀ-Ý])/g

/**
 * O trecho em volta de uma posição, limitado à MESMA FRASE.
 *
 * Existe porque uma janela de vizinhança pura marcava a comarca como residência:
 * em "Comarca de Uberlândia/MG. O autor, residente em Contagem/MG", o
 * "residente" da frase seguinte caía na janela de Uberlândia — e a tela então
 * sugeria a cidade do fórum como endereço do cedente, com selo de residencial.
 */
function fraseEmVolta(texto: string, inicio: number, fim: number): string {
  const antes = texto.slice(Math.max(0, inicio - 200), inicio)
  FIM_DE_FRASE.lastIndex = 0
  let corte = 0
  let m: RegExpExecArray | null
  while ((m = FIM_DE_FRASE.exec(antes)) !== null) corte = m.index + m[0].length

  const depois = texto.slice(fim, fim + 60)
  FIM_DE_FRASE.lastIndex = 0
  const adiante = FIM_DE_FRASE.exec(depois)

  return (
    antes.slice(corte) +
    texto.slice(inicio, fim) +
    (adiante ? depois.slice(0, adiante.index) : depois)
  )
}

/**
 * Índice cidade-sem-acento -> UFs em que ela existe, em CACHE.
 *
 * Montar o índice é percorrer os 5571 municípios do IBGE normalizando acento de
 * cada um. Dentro de acharLocais isso parecia inofensivo até a caixa de colar
 * existir: ali a função roda a cada TECLA digitada, e cada tecla passaria a
 * custar 5571 normalize().
 *
 * ⚠️ O cache é por REFERÊNCIA do objeto. Mutar a lista no lugar (um `push` num
 * array de município) NÃO invalida o índice. Nada muta hoje; se algum dia
 * precisar mudar a lista, troque o objeto em vez de alterá-lo.
 */
const CACHE_INDICE = new WeakMap<
  Record<string, string[]>,
  Map<string, { uf: string; nome: string }[]>
>()

function indiceDeMunicipios(municipiosPorUf: Record<string, string[]>) {
  const emCache = CACHE_INDICE.get(municipiosPorUf)
  if (emCache) return emCache
  const porNome = new Map<string, { uf: string; nome: string }[]>()
  for (const [uf, cidades] of Object.entries(municipiosPorUf)) {
    for (const c of cidades) {
      const k = semAcento(c)
      const l = porNome.get(k) ?? []
      l.push({ uf, nome: c })
      porNome.set(k, l)
    }
  }
  CACHE_INDICE.set(municipiosPorUf, porNome)
  return porNome
}

/**
 * Pares cidade/UF no texto, VALIDADOS contra a lista do IBGE.
 *
 * A validação contra o IBGE é o que torna isto utilizável, e não um regex
 * otimista: só sobrevive par em que a cidade EXISTE naquela UF. Mas validar
 * contra o IBGE não basta sozinho — ver PISTA_LOCALIDADE acima.
 *
 * `municipiosPorUf` vem por parâmetro porque a lista tem 5571 municípios e é
 * importada sob demanda (lib/municipios.ts). Este módulo não a puxa para o bundle
 * de quem nunca abre o cadastro.
 */
export function acharLocais(
  texto: string,
  municipiosPorUf: Record<string, string[]>,
  limite = 10,
): LocalEncontrado[] {
  if (!texto || !municipiosPorUf || Object.keys(municipiosPorUf).length === 0) return []
  const porNome = indiceDeMunicipios(municipiosPorUf)
  const achados = new Map<string, LocalEncontrado>()

  const registrar = (
    uf: string,
    municipio: string,
    inicio: number,
    fim: number,
    forma: LocalEncontrado['forma'],
  ) => {
    const residencial = PERTO_DE_RESIDENCIA.test(fraseEmVolta(texto, inicio, fim))
    const novo: LocalEncontrado = {
      uf,
      municipio,
      contexto: limpar(texto.slice(Math.max(0, inicio - 110), fim + 25)),
      posicao: inicio,
      residencial,
      forma,
    }
    const chave = `${uf}|${municipio}`
    const jaTem = achados.get(chave)
    // A APARIÇÃO RESIDENCIAL GANHA, não a primeira. A versão anterior guardava a
    // primeira e só "acrescentava sinal" depois — então quando o mesmo par
    // aparecia primeiro como comarca e depois como residência, o contexto ficava
    // sendo o da comarca e a evidência que importava era descartada.
    if (!jaTem || (novo.residencial && !jaTem.residencial)) achados.set(chave, novo)
  }

  /**
   * A cidade é o sufixo MAIS LONGO das palavras anteriores que exista nesta UF.
   *
   * Testar do mais longo ao mais curto é o que faz "Comarca de Uberlândia/MG"
   * chegar em "Uberlândia" e "São José do Rio Preto/SP" não virar "Preto". Um
   * padrão guloso capturava "Comarca de Uberlândia", não achava esse município, e
   * seguia adiante — o trecho já tinha sido consumido, e a cidade que estava ali
   * nunca aparecia na lista.
   */
  const cidadeAntesDe = (posSeparador: number, uf: string) => {
    const antes = texto.slice(Math.max(0, posSeparador - 70), posSeparador)
    const palavras = antes.split(/[^A-Za-zÀ-ÿ']+/).filter(Boolean)
    for (let n = Math.min(6, palavras.length); n >= 1; n--) {
      const tentativa = palavras.slice(palavras.length - n).join(' ')
      const casa = (porNome.get(semAcento(tentativa)) ?? []).find((c) => c.uf === uf)
      if (casa) {
        const primeira = palavras[palavras.length - n]
        return {
          casa,
          inicio:
            Math.max(0, posSeparador - 70) + Math.max(0, antes.lastIndexOf(primeira)),
        }
      }
    }
    return null
  }

  const temPista = (i: number) =>
    PISTA_LOCALIDADE.test(texto.slice(Math.max(0, i - 150), i + 40))

  let m: RegExpExecArray | null

  // ---- Forma A: "Cidade/UF". A barra é específica: passa sem pista. ----
  const BARRA = /\/\s*([A-Za-z]{2})\b/g
  BARRA.lastIndex = 0
  while ((m = BARRA.exec(texto)) !== null) {
    const uf = m[1].toUpperCase()
    if (!municipiosPorUf[uf]) continue
    const achou = cidadeAntesDe(m.index, uf)
    if (achou) registrar(uf, achou.casa.nome, achou.inicio, m.index + m[0].length, 'barra')
  }

  // ---- Forma B: "Cidade - UF" / "Cidade, UF". EXIGE pista. ----
  const SEPARADOR = /[,\-–]\s*([A-Za-z]{2})\b/g
  SEPARADOR.lastIndex = 0
  while ((m = SEPARADOR.exec(texto)) !== null) {
    const uf = m[1].toUpperCase()
    if (!municipiosPorUf[uf] || !temPista(m.index)) continue
    const achou = cidadeAntesDe(m.index, uf)
    if (achou) {
      registrar(uf, achou.casa.nome, achou.inicio, m.index + m[0].length, 'separador')
    }
  }

  // ---- Forma C: "Estado de Minas Gerais". As palavras "Estado de" são a pista. ----
  const ESTADO_EXPLICITO =
    /[Ee]stado\s+d[eo]\s+([A-Za-zÀ-ÿ]+(?:\s+d[aeo]s?\s+[A-Za-zÀ-ÿ]+|\s+[A-Za-zÀ-ÿ]+)?)/g
  ESTADO_EXPLICITO.lastIndex = 0
  while ((m = ESTADO_EXPLICITO.exec(texto)) !== null) {
    // O grupo pode ter engolido uma palavra a mais ("Minas Gerais desde"): testa
    // do mais longo ao mais curto em vez de desistir, como a versão anterior fazia.
    const partes = m[1].trim().split(/\s+/)
    let uf = ''
    for (let n = partes.length; n >= 1 && !uf; n--) {
      uf = UF_POR_NOME[semAcento(partes.slice(0, n).join(' '))] ?? ''
    }
    if (!uf || !municipiosPorUf[uf]) continue
    const achou = cidadeAntesDe(m.index, uf)
    if (achou) registrar(uf, achou.casa.nome, achou.inicio, m.index + m[0].length, 'estado')
  }

  // ---- Forma D: "Cidade, Minas Gerais" (estado por extenso, sem "Estado de"). Pista. ----
  const NOMES_ESTADO = Object.keys(UF_POR_NOME)
    .sort((a, b) => b.length - a.length)
    .join('|')
  const ESTADO_NU = new RegExp(`[,\\-–]\\s*(${NOMES_ESTADO})\\b`, 'gi')
  ESTADO_NU.lastIndex = 0
  while ((m = ESTADO_NU.exec(texto)) !== null) {
    const uf = UF_POR_NOME[semAcento(m[1])]
    if (!uf || !municipiosPorUf[uf] || !temPista(m.index)) continue
    const achou = cidadeAntesDe(m.index, uf)
    if (achou) registrar(uf, achou.casa.nome, achou.inicio, m.index + m[0].length, 'estado')
  }

  // ---- Forma E: campos ROTULADOS, um por linha. ----
  //
  // É o formato de plataforma de consulta — "CIDADE: BELO HORIZONTE" numa linha,
  // "UF: MG" na outra — e era justamente o que a caixa de colar mais recebe e o
  // que nenhuma das formas acima pegava: sem separador entre cidade e UF, elas
  // não têm por onde casar. Os próprios rótulos são a pista.
  const CAMPO_UF = /\b(?:uf|estado)\s*:?\s*([A-Za-zÀ-ÿ]{2}(?:[A-Za-zÀ-ÿ\s]{0,18})?)/gi
  const CAMPO_CIDADE = /\b(?:cidade|munic[íi]pio|localidade)\s*:?\s*([A-Za-zÀ-ÿ' ]{2,45})/gi

  const ufsRotuladas: { uf: string; pos: number }[] = []
  CAMPO_UF.lastIndex = 0
  while ((m = CAMPO_UF.exec(texto)) !== null) {
    const bruto = m[1].trim()
    const porSigla = bruto.slice(0, 2).toUpperCase()
    const uf = municipiosPorUf[porSigla]
      ? porSigla
      : (UF_POR_NOME[semAcento(bruto)] ?? '')
    if (uf && municipiosPorUf[uf]) ufsRotuladas.push({ uf, pos: m.index })
  }

  CAMPO_CIDADE.lastIndex = 0
  while ((m = CAMPO_CIDADE.exec(texto)) !== null) {
    const inicio = m.index
    const nome = limpar(m[1])
    const cands = porNome.get(semAcento(nome)) ?? []
    if (cands.length === 0) continue
    // A UF rotulada MAIS PRÓXIMA. 300 caracteres cobrem um bloco de campos.
    const casa = ufsRotuladas
      .map((u) => ({ u, dist: Math.abs(u.pos - inicio) }))
      .filter((x) => x.dist <= 300)
      .sort((a, b) => a.dist - b.dist)
      .map((x) => cands.find((c) => c.uf === x.u.uf))
      .find(Boolean)
    if (casa) registrar(casa.uf, casa.nome, inicio, inicio + m[0].length, 'rotulado')
  }

  // Residencial primeiro; depois ordem de aparição no documento. É sugestão de
  // leitura, não escolha: o endereço do fórum e o do advogado casam o mesmo padrão.
  return [...achados.values()]
    .sort(
      (a, b) =>
        Number(b.residencial) - Number(a.residencial) || a.posicao - b.posicao,
    )
    .slice(0, limite)
}

// ------------------------------------------------------------------ estado civil

export type EstadoCivil =
  | 'solteiro'
  | 'casado'
  | 'divorciado'
  | 'viuvo'
  | 'separado'
  | 'uniao_estavel'

export interface EstadoCivilEncontrado {
  estado: EstadoCivil
  /** Nome do cônjuge, quando o texto traz ("casada com FULANO DE TAL"). */
  conjuge: string | null
  contexto: string
  posicao: number
  /** Apareceu na qualificação do CEDENTE, e não na de outra parte. */
  doCedente: boolean
}

// O estado civil vem na QUALIFICAÇÃO DAS PARTES, sempre no mesmo lugar da frase:
//
//   TATIANA HIIGA, brasileira, casada, do lar, portadora do RG ..., CPF ...
//                  ^^^^^^^^^^  ^^^^^^
//
// Então "brasileiro/brasileira" e "estado civil" são as âncoras que distinguem a
// qualificação de uma menção qualquer. Sem elas, "separados" pega "em autos
// separados" e "viúva" pega "pensão por morte à viúva" — duas coisas que não têm
// nada a ver com o estado civil do cedente.
const ANCORA_QUALIFICACAO = /(brasileir[oa]|estado\s+civil|nacionalidade)/i

const TERMOS: [RegExp, EstadoCivil][] = [
  [/\bsolteir[oa]s?\b/i, 'solteiro'],
  [/\bcasad[oa]s?\b/i, 'casado'],
  [/\bdivorciad[oa]s?\b/i, 'divorciado'],
  [/\bvi[úu]v[oa]s?\b/i, 'viuvo'],
  [/\b(separad[oa]s?\s+judicialmente|desquitad[oa]s?)\b/i, 'separado'],
  [/\buni[ãa]o\s+est[áa]vel\b/i, 'uniao_estavel'],
  [/\b(companheir[oa]|convivente)\b/i, 'uniao_estavel'],
]

// "casada com MARIA DA SILVA" — o nome do cônjuge vem de graça quando aparece, e
// é dado que a tela pede logo em seguida.
//
// ============================================================
// ANCORADO NO INÍCIO (`^`), E O MOTIVO É UM NOME TROCADO
// ============================================================
//
// Isto é testado contra os 120 caracteres que começam EXATAMENTE no termo que
// acabou de casar. Sem o `^`, a busca varria esses 120 caracteres inteiros e
// pegava qualquer "casado com FULANO" que houvesse ali — inclusive o de OUTRA
// PESSOA. Provado em teste:
//
//   "FULANO, brasileiro, casado, e CICRANO, brasileiro, casado com BETA."
//                        ^^^^^^ este aqui recebia "BETA" como cônjuge
//
// Num processo isso é rotina: o cedente é qualificado como "casada," sem o nome
// do marido, e poucas linhas abaixo aparece o executado "casado com MARIA". O
// nome de MARIA entrava no cadastro do cônjuge do CEDENTE — e cônjuge é sujeito
// de emissão: sairiam certidões em nome de uma pessoa que não tem relação
// nenhuma com o crédito, e o dossiê fecharia completo.
//
// Ancorado, o nome só é aceito quando pertence ao termo que estamos lendo. Quando
// a frase separa os dois ("casada, sob o regime de comunhão parcial, com JOÃO"),
// o nome não é capturado e a pessoa digita — que é o desfecho certo: cônjuge em
// branco dá trabalho, cônjuge errado dá certidão errada.
//
// O `i` é a segunda correção: petição em CAIXA ALTA é comum, e sem ele
// "CASADA COM ROBERTO CARLOS" não casava nada. A inicial maiúscula continua
// exigida no NOME, que é o que impede o padrão de engolir prosa minúscula.
//
// "união estável com RITA DIAS" entrou na lista porque `uniao_estavel` também
// liga o bloco do cônjuge, e a forma por extenso é a mais comum das duas.
const CONJUGE_APOS =
  /^(?:casad[oa]s?|convivente|companheir[oa]|uni[ãa]o\s+est[áa]vel)\s+(?:com|de)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ']*(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ']*){0,5})/i

/**
 * Estado civil na qualificação das partes.
 *
 * POR QUE ISTO IMPORTA MAIS QUE PARECE: o estado civil DOBRA o checklist. Cedente
 * casado tem bloco próprio de certidões para o cônjuge (planilha, linhas 52 a 67).
 * Marcar "casado" errado exige certidões de um terceiro; deixar de marcar fecha o
 * dossiê com um bloco inteiro faltando, e o placar não acusa nada.
 *
 * POR ISSO CONTINUA SENDO SUGESTÃO. Duas razões, e a segunda é a que decide:
 *
 *   1. A petição pode ser de 2005. "casada" naquela data não é "casada hoje", e o
 *      cônjuge de então pode não ser o de agora.
 *   2. Uma petição qualifica várias pessoas — autor, réu, advogado. `doCedente`
 *      marca as que aparecem perto do nome ou do CPF do cedente, mas "perto" é
 *      heurística, não prova.
 *
 * `ancoras` são o nome e/ou o CPF do cedente, em qualquer formato: a comparação
 * ignora acento, caixa e pontuação.
 */
export function acharEstadoCivil(
  texto: string,
  ancoras: string[] = [],
  limite = 6,
): EstadoCivilEncontrado[] {
  if (!texto) return []

  // Onde o cedente é mencionado. Serve para separar a qualificação dele da das
  // outras partes.
  const posicoesDoCedente: number[] = []
  const plano = semAcento(texto)
  for (const a of ancoras) {
    const alvo = semAcento(a).trim()
    if (alvo.length < 4) continue
    // CPF entra também só com os dígitos: no texto ele aparece mascarado.
    const formas = /^\d[\d.\-]*$/.test(alvo)
      ? [alvo, alvo.replace(/\D/g, '')]
      : [alvo]
    for (const f of formas) {
      if (!f) continue
      let de = 0
      for (;;) {
        const i = plano.indexOf(f, de)
        if (i < 0) break
        posicoesDoCedente.push(i)
        de = i + 1
      }
      // Máscara do CPF: procura também a forma pontuada quando veio só dígitos.
      if (/^\d{11}$/.test(f)) {
        const mascarado = `${f.slice(0, 3)}.${f.slice(3, 6)}.${f.slice(6, 9)}-${f.slice(9)}`
        let d2 = 0
        for (;;) {
          const i = plano.indexOf(mascarado, d2)
          if (i < 0) break
          posicoesDoCedente.push(i)
          d2 = i + 1
        }
      }
    }
  }

  const achados: EstadoCivilEncontrado[] = []
  // chave -> posição em `achados`. É um Map, e não um Set de "já vi", porque a
  // repetida pode ser MELHOR que a guardada. Ver o bloco da substituição abaixo.
  const vistos = new Map<string, number>()

  for (const [re, estado] of TERMOS) {
    const global = new RegExp(re.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = global.exec(texto)) !== null) {
      const i = m.index
      // A âncora da qualificação tem de estar por perto, na mesma frase.
      const janela = fraseEmVolta(texto, i, i + m[0].length)
      if (!ANCORA_QUALIFICACAO.test(janela)) continue

      // SÓ PARA TRÁS, e curto. A qualificação tem ordem fixa:
      //
      //   TATIANA HIIGA, brasileira, casada, do lar, RG ..., CPF ...
      //   ^^^^^^^^^^^^^                ^^^^^^
      //
      // O estado civil pertence ao NOME QUE VEM ANTES DELE. Uma janela em volta,
      // de qualquer tamanho, erra: numa petição o advogado é qualificado logo
      // acima do autor, e o "solteiro, advogado" dele fica a poucos caracteres do
      // nome do cedente. Testado: com janela de 400 nos dois sentidos, o estado
      // civil do ADVOGADO era oferecido como o da cedente.
      //
      // Para trás e curto resolve, porque reproduz a estrutura do documento em
      // vez de medir distância. O CPF não serve de âncora aqui: ele vem DEPOIS do
      // estado civil na qualificação, não antes.
      const doCedente = posicoesDoCedente.some((p) => p < i && i - p <= 150)

      const depois = texto.slice(i, i + 120)
      const mc = CONJUGE_APOS.exec(depois)
      const conjuge = mc ? limpar(mc[1]) : null

      const chave = `${estado}|${conjuge ?? ''}`

      // ============================================================
      // A REPETIDA PODE SER A BOA — e a primeira é quase sempre a errada.
      // ============================================================
      //
      // Antes isto era um `if (vistos.has(chave)) continue`: a PRIMEIRA ocorrência
      // no documento vencia e as demais eram descartadas. Numa petição, quem se
      // qualifica primeiro é o ADVOGADO, no cabeçalho, antes de apresentar o
      // cliente. Então bastava cedente e advogado terem o MESMO estado civil —
      // "solteiro" advogado e "solteira" cedente é combinação de todo dia — para o
      // achado da cedente ser jogado fora como duplicata, e sobrar o do advogado,
      // marcado (corretamente) como NÃO sendo do cedente.
      //
      // Efeito na tela: em vez de "o processo qualifica TATIANA HIIGA como
      // solteira", saía "achei estado civil mas não consegui ligar ao cedente".
      // Não é mentira — é pior de um jeito específico: a função falha justamente
      // no caso mais comum, e falha em silêncio, parecendo que o documento é que
      // estava ruim.
      //
      // Achado por teste, caso 3 de teste-placar.ts.
      const jaEm = vistos.get(chave)
      if (jaEm !== undefined) {
        // Substitui só na direção que informa: o do cedente vence o de terceiro.
        // O contrário nunca — um achado ancorado no cedente não pode ser
        // rebaixado por uma repetição solta que apareça depois no documento.
        if (doCedente && !achados[jaEm].doCedente) {
          achados[jaEm] = {
            estado,
            conjuge,
            contexto: limpar(texto.slice(Math.max(0, i - 110), i + m[0].length + 60)),
            posicao: i,
            doCedente: true,
          }
        }
        continue
      }
      vistos.set(chave, achados.length)

      achados.push({
        estado,
        conjuge,
        contexto: limpar(texto.slice(Math.max(0, i - 110), i + m[0].length + 60)),
        posicao: i,
        doCedente,
      })
    }
  }

  // O do cedente primeiro; depois ordem no documento.
  return achados
    .sort((a, b) => Number(b.doCedente) - Number(a.doCedente) || a.posicao - b.posicao)
    .slice(0, limite)
}
