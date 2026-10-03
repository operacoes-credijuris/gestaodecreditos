// _shared/focoNoCedente.ts
// ONDE O CEDENTE APARECE NOS AUTOS — para a leitura da qualificação olhar para
// ele, e só para ele.
//
// O QUE ISTO CONSERTA (pedido do dono, 03/10/2026). A leitura da IA recebia o
// título do card e "o exequente/autor titular", sem o NOME de quem cede, e um
// recorte cego dos autos (60% do começo, 40% do fim). Num processo com vários
// autores, com o advogado qualificado no cabeçalho e o réu logo depois, a IA
// escolhia — e às vezes escolhia outra pessoa. O CPF de outra pessoa passa em
// toda conferência de dígito, e cada portal responde "nada consta" sobre ela.
//
// Daqui saem três coisas:
//   - `posicoesDoNome`: onde o nome aparece, tolerando acento, caixa, nome do
//     meio abreviado ou omitido e sobrenome a mais no título;
//   - `recortarAutos`: o recorte que cabe no pedido, com as janelas em volta de
//     cada aparição do nome no lugar do meio cego;
//   - as conferências de proximidade que `normalizarQualificacao` usa para
//     derrubar o dado que a IA tirou de longe do cedente.
//
// MÓDULO PURO — sem `Deno.` e sem `npm:`: o vitest e o navegador o alcançam.

// ------------------------------------------------------------------ texto plano

/**
 * O texto sem acento, minúsculo, com tudo o que não é letra ou dígito virado
 * UM espaço — e, para cada caractere dele, a posição no texto original.
 *
 * O MAPA É O QUE IMPORTA. As buscas rodam no texto plano (é ali que "IANA" e
 * "Iana" e "IÂNA" são a mesma palavra), mas o que se devolve é a posição no
 * ORIGINAL, que é onde o recorte corta e onde a evidência é procurada.
 */
export interface TextoPlano {
  plano: string
  origem: number[]
}

export function aplainar(texto: string): TextoPlano {
  const partes: string[] = []
  const origem: number[] = []
  let ultimoEspaco = true
  for (let i = 0; i < texto.length; i++) {
    // ASCII sem a volta pelo `normalize`: é quase todo o texto de um processo,
    // e são centenas de milhares de caracteres por leitura.
    const cod = texto.charCodeAt(i)
    const n =
      cod < 128
        ? texto[i].toLowerCase()
        : texto[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    for (const ch of n) {
      const c = /[a-z0-9]/.test(ch) ? ch : ' '
      if (c === ' ' && ultimoEspaco) continue
      ultimoEspaco = c === ' '
      partes.push(c)
      origem.push(i)
    }
  }
  return { plano: partes.join(''), origem }
}

/** Sem acento, minúsculo, só letras e dígitos — para comparar palavras. */
const semAcento = (s: string) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// ------------------------------------------------------------------ PF ou PJ

/**
 * O nome é de EMPRESA? Pela forma societária e pelas palavras que só aparecem
 * em razão social.
 *
 * "SÁ" NÃO ENTRA, e é de propósito: "S/A" e "S.A." sim, mas "José de Sá" é
 * gente. ME, EPP e MEI só no FIM do nome, que é onde a forma societária vai.
 * Devolve null quando o nome não diz — o que não quer dizer pessoa física, e
 * quem chama decide com o resto (o CNPJ nos autos, a leitura da IA).
 */
const RE_PJ_PALAVRA = new RegExp(
  '(?<![A-Z0-9])(' +
    [
      'LTDA', 'LIMITADA', 'EIRELI', 'S\\s?/\\s?A', 'S\\.\\s?A\\.?', 'SOCIEDADE', 'ASSOCIADOS',
      'ADVOGADOS', 'ADVOCACIA', 'COOPERATIVA', 'ASSOCIACAO', 'FUNDACAO', 'CONDOMINIO',
      'EMPRESA', 'COMERCIO', 'INDUSTRIA', 'SERVICOS', 'HOLDING', 'PARTICIPACOES',
      'CONSTRUTORA', 'EMPREENDIMENTOS', 'INCORPORADORA', 'TRANSPORTES', 'LOGISTICA',
      'DISTRIBUIDORA', 'FOMENTO', 'SECURITIZADORA', 'CONSULTORIA', 'ASSESSORIA',
      'INVESTIMENTOS', 'BANCO', 'FUNDO',
    ].join('|') +
    ')(?![A-Z0-9])',
)
const RE_PJ_FIM = /(?:^|[\s\-–,])(ME|EPP|MEI)\.?\s*$/

export function tipoPessoaPeloNome(nome: string): 'PJ' | null {
  const t = semAcento(nome).toUpperCase().trim()
  if (!t) return null
  return RE_PJ_PALAVRA.test(t) || RE_PJ_FIM.test(t) ? 'PJ' : null
}

// ------------------------------------------------------------------ o nome

/** Palavras que ligam um nome mas não o distinguem. */
const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em'])

/** A forma societária: não distingue uma empresa de outra, e o texto a abrevia. */
const FORMAS_SOCIETARIAS = new Set(['ltda', 'limitada', 'eireli', 'me', 'epp', 'mei', 'sa'])

/**
 * As palavras que distinguem o nome: sem acento, sem conectivo, sem forma
 * societária e sem letra solta (a inicial de "Iana K. Pontes" não ajuda a
 * achar "IANA KELLE PONTES" — ajuda a atrapalhar).
 */
export function palavrasDoNome(nome: string): string[] {
  return semAcento(nome)
    .replace(/s\s*[/.]\s*a\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((p) => p.length >= 2 && !CONECTIVOS.has(p) && !FORMAS_SOCIETARIAS.has(p))
}

/** Uma ocorrência do nome no texto original: [inicio, fim). */
export interface Ocorrencia {
  inicio: number
  fim: number
}

/**
 * Os padrões que reconhecem o nome no texto plano.
 *
 * TOLERANTE NA MEDIDA DO TÍTULO. O comercial escreve o nome curto ("Iana
 * Pontes"), às vezes com abreviação ("Iana K. Pontes"), às vezes com um
 * sobrenome que os autos não trazem, às vezes com uma letra trocada. Os autos
 * escrevem por extenso e em maiúsculas. Então:
 *   - o primeiro nome seguido, em até cinco palavras, de qualquer outro nome
 *     do título ("iana … pontes");
 *   - com três palavras ou mais, qualquer par seguido ("kelle pontes") — é o
 *     que salva o primeiro nome digitado errado;
 *   - nome de uma palavra só, ela inteira, se tiver ao menos quatro letras.
 */
function padroesDoNome(nome: string): RegExp[] {
  const p = palavrasDoNome(nome)
  if (p.length === 0) return []
  if (p.length === 1) return p[0].length >= 4 ? [new RegExp(`\\b${p[0]}\\b`, 'g')] : []
  const outros = p.slice(1).join('|')
  const fora = [new RegExp(`\\b${p[0]}(?: [a-z0-9]+){0,5}? (?:${outros})\\b`, 'g')]
  if (p.length >= 3) {
    for (let i = 0; i + 1 < p.length; i++) {
      fora.push(new RegExp(`\\b${p[i]} (?:[a-z0-9]{1,3} )?${p[i + 1]}\\b`, 'g'))
    }
  }
  // EMPRESA É CHAMADA PELO NOME DE FANTASIA: o título diz "Credijuris Gestão de
  // Ativos Ltda" e a peça diz "CREDIJURIS LTDA". A primeira palavra sozinha
  // basta — se for marca, e não palavra de ramo ("Banco", "Construtora").
  if (tipoPessoaPeloNome(nome) === 'PJ' && p[0].length >= 5 && !RE_PJ_PALAVRA.test(p[0].toUpperCase())) {
    fora.push(new RegExp(`\\b${p[0]}\\b`, 'g'))
  }
  return fora
}

/**
 * Onde o nome aparece no texto, em ordem, sem sobreposição.
 *
 * Aceita o texto já aplainado para quem vai procurar mais de um nome no mesmo
 * texto grande (o normalizador procura o do cedente e o do cônjuge).
 */
export function posicoesDoNome(texto: string, nome: string, plano?: TextoPlano): Ocorrencia[] {
  const padroes = padroesDoNome(nome)
  if (padroes.length === 0 || !texto) return []
  const tp = plano ?? aplainar(texto)
  const achadas: Ocorrencia[] = []
  for (const re of padroes) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(tp.plano)) !== null) {
      const ini = tp.origem[m.index]
      const fim = tp.origem[m.index + m[0].length - 1] + 1
      achadas.push({ inicio: ini, fim })
      if (m[0].length === 0) re.lastIndex++
    }
  }
  achadas.sort((a, b) => a.inicio - b.inicio || b.fim - a.fim)
  const fora: Ocorrencia[] = []
  for (const o of achadas) {
    const ult = fora[fora.length - 1]
    if (ult && o.inicio < ult.fim) ult.fim = Math.max(ult.fim, o.fim)
    else fora.push({ ...o })
  }
  return fora
}

/** O nome aparece neste trecho? */
export function mencionaNome(trecho: string, nome: string): boolean {
  return posicoesDoNome(trecho, nome).length > 0
}

/** Distância de edição, abandonada assim que passa de `max`. */
function distancia(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let ant = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const at = [i]
    for (let j = 1; j <= b.length; j++) {
      at[j] = Math.min(ant[j] + 1, at[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    if (Math.min(...at) > max) return max + 1
    ant = at
  }
  return ant[b.length]
}

/**
 * Os dois nomes podem ser da MESMA pessoa?
 *
 * É a trava contra a IA devolver outra pessoa inteira: o título diz "Iana
 * Pontes" e a resposta vem com "José Carlos Lima" — dados coerentes entre si,
 * CPF escrito nos autos, e de quem não cede nada. Dois nomes em comum bastam
 * (um, quando um dos lados só tem um); a letra trocada conta como igual em
 * palavra de cinco letras ou mais.
 */
export function nomesCompativeis(a: string, b: string): boolean {
  const pa = palavrasDoNome(a)
  const pb = palavrasDoNome(b)
  if (pa.length === 0 || pb.length === 0) return false
  const igual = (x: string, y: string) =>
    x === y || (Math.min(x.length, y.length) >= 5 && distancia(x, y, 1) <= 1)
  const comuns = pa.filter((x) => pb.some((y) => igual(x, y))).length
  return comuns >= Math.min(2, pa.length, pb.length)
}

// ------------------------------------------------------------------ recorte

/** O que marca, no recorte, um trecho cortado. Nenhuma proximidade atravessa isto. */
export const MARCA_DE_CORTE = '[...trecho omitido...]'
const SEPARADOR = `\n\n${MARCA_DE_CORTE}\n\n`

/** Quanto do texto antes e depois de cada aparição do nome entra na janela. */
const JANELA_ANTES = 300
const JANELA_DEPOIS = 2200

/** A qualificação: é ela que se quer em cada janela. */
const RE_QUALIFICACAO =
  /\b(cpf|cnpj|inscrit[oa]|residente|domiciliad[oa]|portador[a]?|nascid[oa]|nascimento|estado civil|casad[oa]|solteir[oa]|divorciad[oa]|vi[uú]v[oa]|filh[oa] de|sede|raz[aã]o social)\b/i

export interface RecorteDosAutos {
  texto: string
  /** Quantas vezes o nome do cedente aparece no texto inteiro. */
  ocorrencias: number
  /** O recorte foi montado em volta do cedente (e não às cegas). */
  focado: boolean
}

function fundir(intervalos: [number, number][]): [number, number][] {
  const ord = [...intervalos].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const fora: [number, number][] = []
  for (const [a, b] of ord) {
    const ult = fora[fora.length - 1]
    if (ult && a <= ult[1]) ult[1] = Math.max(ult[1], b)
    else fora.push([a, b])
  }
  return fora
}

function juntar(texto: string, intervalos: [number, number][]): string {
  return fundir(intervalos)
    .map(([a, b]) => texto.slice(a, b))
    .join(SEPARADOR)
}

/**
 * O texto que vai à IA, dentro de `max` caracteres.
 *
 * Cabendo inteiro, vai inteiro. Não cabendo:
 *   - SEM NOME (ou nome que não aparece): as duas pontas, como sempre foi — a
 *     qualificação está na inicial, o endereço novo nas peças do fim;
 *   - COM NOME: o começo e o fim continuam (menores), e o meio deixa de ser
 *     cortado às cegas: entram janelas em volta de cada aparição do nome, as
 *     que têm cara de qualificação (CPF, "residente", "casada") primeiro.
 *
 * O LIMITE É DURO, separadores incluídos: este módulo responde ao teto de
 * `orcamentoLeitura.ts`, e passar dele é o pedido voltar 400.
 */
export function recortarAutos(texto: string, nome: string, max: number): RecorteDosAutos {
  const ocs = nome ? posicoesDoNome(texto, nome) : []
  if (texto.length <= max) return { texto, ocorrencias: ocs.length, focado: ocs.length > 0 }

  const L = texto.length
  const sep = SEPARADOR.length

  if (ocs.length === 0) {
    const cabeca = Math.floor((max - sep) * 0.6)
    const cauda = max - sep - cabeca
    return { texto: juntar(texto, [[0, cabeca], [L - cauda, L]]), ocorrencias: 0, focado: false }
  }

  let cabeca = Math.floor(max * 0.2)
  const cauda = Math.floor(max * 0.1) - sep
  let orcamento = max - cabeca - Math.floor(max * 0.1)

  const janelas = fundir(
    ocs.map((o) => [Math.max(0, o.inicio - JANELA_ANTES), Math.min(L, o.fim + JANELA_DEPOIS)]),
  )
    // A janela que já está inteira na cabeça ou na cauda não custa nada — e
    // não entra, para não gastar o orçamento duas vezes.
    .filter(([a, b]) => !(b <= cabeca) && !(a >= L - cauda))
    .map(([a, b], i) => ({
      a,
      b,
      nota: (RE_QUALIFICACAO.test(texto.slice(a, b)) ? 2 : 0) + (i === 0 ? 1 : 0),
    }))
    .sort((x, y) => y.nota - x.nota || x.a - y.a)

  const escolhidas: [number, number][] = []
  for (const j of janelas) {
    const custo = j.b - j.a + sep
    if (custo <= orcamento) {
      escolhidas.push([j.a, j.b])
      orcamento -= custo
    } else if (orcamento > 1000) {
      escolhidas.push([j.a, j.a + orcamento - sep])
      orcamento = 0
    }
    if (orcamento <= sep) break
  }
  // O QUE SOBRAR VOLTA PARA O COMEÇO: é onde mora a petição inicial.
  cabeca += Math.max(0, orcamento)

  let recorte = juntar(texto, [[0, cabeca], ...escolhidas, [L - cauda, L]])
  // Rede de segurança — a conta acima já fecha dentro do teto.
  if (recorte.length > max) recorte = recorte.slice(0, max)
  return { texto: recorte, ocorrencias: ocs.length, focado: true }
}

// ------------------------------------------------------------------ proximidade

/** Um texto grande, preparado uma vez para as várias buscas do normalizador. */
export interface TextoPreparado {
  texto: string
  plano: TextoPlano
  /** O plano sem espaço nenhum, com o mapa para o original. */
  esqueleto: string
  origemEsqueleto: number[]
}

export function preparar(texto: string): TextoPreparado {
  const plano = aplainar(texto)
  const chars: string[] = []
  const origemEsqueleto: number[] = []
  for (let i = 0; i < plano.plano.length; i++) {
    if (plano.plano[i] === ' ') continue
    chars.push(plano.plano[i])
    origemEsqueleto.push(plano.origem[i])
  }
  return { texto, plano, esqueleto: chars.join(''), origemEsqueleto }
}

const esqueletoDe = (s: string) => semAcento(s).replace(/[^a-z0-9]/g, '')

/**
 * Onde o trecho (a evidência que a IA citou) está no texto.
 *
 * SEM ESPAÇO E SEM PONTUAÇÃO na comparação: o pdf.js quebra linha e junta
 * palavra onde quer, e a IA devolve o trecho com o espaço "certo". Trecho
 * longo é procurado pelo começo, pelo meio e pelo fim — a IA às vezes encurta
 * um pedaço do meio —, e basta um deles. Trecho curto demais para ser achado
 * com segurança (menos de seis letras) devolve lista vazia.
 */
export function localizarTrecho(prep: TextoPreparado, trecho: string): number[] {
  const e = esqueletoDe(trecho)
  if (e.length < 6) return []
  const T = 40
  const pedacos =
    e.length <= T ? [e] : [e.slice(0, T), e.slice(Math.floor((e.length - T) / 2), Math.floor((e.length - T) / 2) + T), e.slice(-T)]
  const fora: number[] = []
  for (const p of pedacos) {
    let de = 0
    while (fora.length < 60) {
      const i = prep.esqueleto.indexOf(p, de)
      if (i < 0) break
      fora.push(prep.origemEsqueleto[i])
      de = i + 1
    }
  }
  return fora.sort((a, b) => a - b)
}

/** Há um corte do recorte entre as duas posições? */
function cortadoEntre(texto: string, a: number, b: number): boolean {
  return texto.slice(Math.min(a, b), Math.max(a, b)).includes(MARCA_DE_CORTE)
}

/**
 * Alguma das posições está PERTO de alguma ocorrência do nome — até `antes`
 * caracteres antes do nome, até `depois` depois dele, sem corte no meio.
 */
export function pertoDoNome(
  texto: string,
  posicoes: number[],
  nomes: Ocorrencia[],
  antes = 400,
  depois = 1500,
): boolean {
  return posicoes.some((p) =>
    nomes.some((n) => p >= n.inicio - antes && p <= n.fim + depois && !cortadoEntre(texto, p, n.inicio)),
  )
}

/** Um CPF ou CNPJ escrito no texto, com onde está. */
export interface DocumentoNoTexto {
  doc: string
  inicio: number
}

/**
 * Todo número com forma de CPF (11) ou CNPJ (14) escrito no texto, com
 * fronteira dos dois lados — formatado ou em dígitos seguidos.
 *
 * A FRONTEIRA É A TRAVA, como em `cpfsEscritosNoTexto`: o número tem de estar
 * escrito como número, e não ser pedaço de um protocolo.
 */
export function documentosNoTexto(texto: string): DocumentoNoTexto[] {
  const fora: DocumentoNoTexto[] = []
  const reCpf = /(?<![\d.\-/])(\d{3})\.?\s?(\d{3})\.?\s?(\d{3})\s?[-.–]?\s?(\d{2})(?![\d\-/]|\.\d)/g
  const reCnpj = /(?<![\d.\-/])(\d{2})\.?\s?(\d{3})\.?\s?(\d{3})\s?\/?\s?(\d{4})\s?[-.–]?\s?(\d{2})(?![\d\-/]|\.\d)/g
  for (const m of texto.matchAll(reCpf)) fora.push({ doc: m[1] + m[2] + m[3] + m[4], inicio: m.index ?? 0 })
  for (const m of texto.matchAll(reCnpj)) {
    fora.push({ doc: m[1] + m[2] + m[3] + m[4] + m[5], inicio: m.index ?? 0 })
  }
  return fora.sort((a, b) => a.inicio - b.inicio)
}

/**
 * O documento está escrito DEPOIS do nome, na qualificação dele?
 *
 * A qualificação tem ordem fixa — "IANA KELLE PONTES, brasileira, casada, …,
 * inscrita no CPF sob o nº …" —, e o número pertence ao NOME QUE VEM ANTES
 * DELE. Por isso: depois do nome, até `alcance` caracteres, e SEM OUTRO CPF OU
 * CNPJ NO MEIO. Num processo com dois autores, o CPF do primeiro está a
 * poucos caracteres do nome do segundo — mas ANTES dele, e o do segundo vem
 * depois do do primeiro. As duas regras juntas separam os dois.
 *
 * `outros` são os documentos de dígito válido do texto (os que contam como
 * "outro número no meio").
 */
export function documentoDepoisDoNome(
  texto: string,
  doc: string,
  nomes: Ocorrencia[],
  outros: DocumentoNoTexto[],
  alcance = 800,
): boolean {
  const meus = outros.filter((d) => d.doc === doc)
  return meus.some((d) =>
    nomes.some(
      (n) =>
        d.inicio >= n.inicio &&
        d.inicio - n.fim <= alcance &&
        !cortadoEntre(texto, n.inicio, d.inicio) &&
        !outros.some((o) => o.doc !== doc && o.inicio > n.fim && o.inicio < d.inicio) &&
        !fimDaQualificacao(texto.slice(n.fim, d.inicio)),
    ),
  )
}

/** Abreviações que terminam em ponto sem terminar a frase: "Av.", "nº.", "Ltda.". */
const ABREVIACOES = new Set(['av', 'dr', 'dra', 'sr', 'sra', 'n', 'no', 'nº', 'apto', 'ap', 'ltda', 'cia', 'res', 'qd', 'lt', 'bl', 'cep', 'a'])

/**
 * A qualificação ACABOU no meio do trecho? Ponto-e-vírgula, frase terminada
 * ("… Aracaju/SE (contrato social). A ré, …"), ou a passagem para a parte
 * contrária ("em face de", "contra"). Depois disso, o documento é de outra
 * pessoa — a ré qualificada logo em seguida é o caso que isto pega.
 */
export function fimDaQualificacao(trecho: string): boolean {
  if (/;/.test(trecho)) return true
  if (/\bem face d[aeo]s?\b|\bcontra\b/i.test(trecho)) return true
  for (const m of trecho.matchAll(/([A-Za-zÀ-ÿº]+|\d+|\))\.\s+[A-ZÀ-Ý]/g)) {
    const palavra = m[1].toLowerCase()
    if (/^[a-zà-ÿº]+$/.test(palavra) && ABREVIACOES.has(palavra)) continue
    return true
  }
  return false
}
