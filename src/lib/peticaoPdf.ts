// Montagem do PDF da petição.
//
// O documento é remontado aqui, e não convertido de .docx: converter .docx em PDF
// no navegador não tem caminho confiável. Em troca, o papel timbrado entra como
// FUNDO DE TODAS AS PÁGINAS, então a identidade visual é a de vocês.
//
// AS MEDIDAS E AS CORES NÃO SÃO ESCOLHA MINHA: saíram do
// CONTRATO_CREDIJURIS_MODELO, o documento que a Credijuris já usa — Calibri 11,
// entrelinha 1,08, 12pt depois de cada parágrafo, margens 25/34,9/25/33 mm, e a
// paleta abaixo. Antes de mudar um número aqui, vale conferir se o modelo de
// referência mudou também, senão a petição passa a divergir do resto da papelada.
//
// A fonte é CARLITO, não Calibri: a Calibri é da Microsoft e embuti-la num
// aplicativo web não é coberto pela licença dela. A Carlito foi desenhada para ser
// metricamente idêntica — mesmas larguras, mesmas quebras de linha — e é livre.
// Ver scripts/woff-para-ttf.js.
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'

/** 1 mm em pontos PostScript, que é a unidade do pdfmake. */
const MM = 72 / 25.4

/** Medidas do CONTRATO_CREDIJURIS_MODELO, em milímetros. */
export const MARGENS_MM = { esquerda: 25, topo: 34.9, direita: 25, rodape: 33 }

/** Corpo do texto, também do modelo de referência. */
const CORPO = { fonte: 11, entrelinha: 1.08 }

/**
 * Espaço depois de um parágrafo comum, em pontos — o `w:after="240"` do modelo.
 * O dobro é o que a vista lê como "uma linha em branco".
 */
const DEPOIS = 12

/**
 * Recuo da citação direta e do bloco de dados bancários, em milímetros.
 *
 * Na citação é convenção da peça: ementa transcrita entra afastada da margem, para
 * o juízo distinguir de relance o que é texto do peticionário e o que é palavra do
 * tribunal. Nos dados bancários é a mesma lógica visual — é informação para ser
 * copiada, não lida em sequência.
 */
const RECUO_MM = 40

/**
 * Paleta extraída do CONTRATO_CREDIJURIS_MODELO.
 *
 * O corpo do texto fica em `corpo`, quase preto, e não em azul: petição é peça
 * processual, e cor no texto corrido de uma peça judicial pesa contra a leitura. A
 * identidade entra na ESTRUTURA — títulos, réguas e o cartão dos dados.
 */
const COR = {
  /** #0A6296 — o azul escuro mais usado no contrato. */
  titulo: '#0A6296',
  /** #075278 — o marinho, para o endereçamento e o número do processo. */
  cabecalho: '#075278',
  /** #C9E2F2 — a cor de borda do contrato (50 ocorrências). */
  regua: '#C9E2F2',
  /** #F4FAFD — o fundo claro do contrato. */
  fundoDados: '#F4FAFD',
  corpo: '#111827',
}

const A4_PT = { largura: 210 * MM, altura: 297 * MM }

/**
 * Trechos em negrito e itálico.
 *
 * Roda no PARÁGRAFO INTEIRO, não linha por linha. Tem de ser assim: quando o
 * rótulo [DADOS BANCÁRIOS...] é substituído, entra um bloco de várias linhas
 * DENTRO do `**negrito**` do modelo. Lendo linha a linha, o `**` abriria numa e
 * fecharia noutra, e os asteriscos sairiam impressos no PDF. Como `[^*]` também
 * aceita `\n`, processar o bloco todo resolve.
 *
 * Aceita `_itálico_` e `*itálico*`: a conversão de .docx para .md gerou as duas.
 */
function trechos(texto: string): Content[] {
  const partes: Content[] = []
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g
  let ultimo = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) {
    if (m.index > ultimo) partes.push({ text: texto.slice(ultimo, m.index) })
    const negrito = m[1] ?? m[2]
    if (negrito !== undefined) partes.push({ text: negrito, bold: true })
    else partes.push({ text: (m[3] ?? m[4]) as string, italics: true })
    ultimo = m.index + m[0].length
  }
  if (ultimo < texto.length) partes.push({ text: texto.slice(ultimo) })
  return partes.length ? partes : [{ text: texto }]
}

/** Remove o escape de colchete que a conversão para .md introduziu. */
const semEscape = (s: string) => s.replace(/\\([[\]])/g, '$1')

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * O bloco é TODO negrito — nada fora de marcação, a não ser espaço.
 *
 * Aceita negrito PARTIDO, e não só um par de `**` envolvendo tudo: a conversão de
 * .docx para .md gerou `**II -** **CONSTRIÇÃO...**` num dos títulos, com o número
 * e o texto em marcações separadas. Exigindo um par único, aquele título deixava
 * de ser título — perdia cor, régua e espaçamento — e o defeito aparecia como
 * "uma seção diferente das outras", sem ninguém ligar à causa.
 */
const todoNegrito = (bloco: string) =>
  /\*\*/.test(bloco) && bloco.replace(/\*\*[^*]+\*\*/g, '').trim() === ''

/**
 * Título: todo em negrito e de uma só linha — o endereçamento, o número do
 * processo e cada seção numerada.
 */
const ehTitulo = (bloco: string) => todoNegrito(bloco) && !bloco.includes('\n')

/**
 * Bloco de dados: todo em negrito e com VÁRIAS linhas. É o que o rótulo de dados
 * bancários se torna depois da substituição, um dado por linha. A diferença com o
 * título é só a contagem de linhas, e é suficiente porque nenhum título dos dez
 * modelos ocupa duas linhas.
 */
const ehBlocoDados = (bloco: string) => todoNegrito(bloco) && bloco.includes('\n')

/** O fecho da peça: daqui até o fim tudo é centralizado. */
const ehFecho = (bloco: string) => semAcento(bloco).includes('pede deferimento')

/**
 * Citação direta é marcada com `>` no modelo, como em markdown.
 *
 * É MARCAÇÃO EXPLÍCITA de propósito, e não heurística: dava para tentar adivinhar
 * ementa pelo "(STF - ..." ou pelo caixa-alta, mas aí o recuo passaria a depender
 * de como o tribunal formata o acórdão, e uma citação de STJ, de TJ ou de doutrina
 * ficaria de fora sem ninguém entender por quê. Com `>`, quem escreve o modelo diz
 * o que é citação, e vale para qualquer fonte.
 */
const ehCitacao = (bloco: string) =>
  bloco.split('\n').every((l) => /^>\s?/.test(l.trim()))

const semMarcaCitacao = (s: string) =>
  s.split('\n').map((l) => l.trim().replace(/^>\s?/, '')).join('\n')

/** Uma régua fina sob o título, na cor de borda do contrato. */
const reguaTitulo = (): Content => ({
  canvas: [
    {
      type: 'line',
      x1: 0,
      y1: 0,
      x2: (210 - MARGENS_MM.esquerda - MARGENS_MM.direita) * MM,
      y2: 0,
      lineWidth: 1,
      lineColor: COR.regua,
    },
  ],
  margin: [0, 2, 0, DEPOIS],
})

/**
 * Markdown dos modelos para conteúdo do pdfmake.
 *
 * Cobre só o que os dez modelos usam: parágrafo, negrito, itálico, citação com
 * `>`, lista com marcador e lista numerada. Deliberadamente não é um parser
 * completo — um parser genérico traria casos que nenhum modelo exercita, e cada um
 * é uma forma de o PDF sair diferente do esperado sem ninguém perceber.
 *
 * A numeração das listas é a do texto, não gerada pelo pdfmake: o modelo de RPV
 * complementar tem uma lista que reinicia em 1 no original, e renumerar
 * automaticamente mudaria o texto jurídico.
 */
export function markdownParaConteudo(md: string): Content[] {
  const conteudo: Content[] = []
  const blocos = semEscape(md.replace(/\r\n/g, '\n'))
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  // O fecho começa no parágrafo do "pede deferimento" e vai até o fim: nome do
  // advogado, OAB e o local com a data da assinatura entram centralizados.
  const inicioFecho = blocos.findIndex(ehFecho)

  blocos.forEach((bloco, i) => {
    const noFecho = inicioFecho >= 0 && i >= inicioFecho

    // --- citação direta de jurisprudência --------------------------------------
    // Recuo de 4 cm, corpo 10 e espaçamento simples: o conjunto que a praxe usa
    // para destacar palavra de tribunal. A régua à esquerda é a mesma cor de borda
    // do contrato.
    if (ehCitacao(bloco)) {
      conteudo.push({
        table: {
          widths: ['*'],
          body: [
            [
              {
                text: trechos(semMarcaCitacao(bloco)),
                alignment: 'justify',
                fontSize: 10,
                lineHeight: 1,
                border: [true, false, false, false],
                margin: [6, 2, 0, 2],
              },
            ],
          ],
        },
        layout: {
          vLineWidth: () => 2,
          vLineColor: () => COR.regua,
          hLineWidth: () => 0,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
        margin: [RECUO_MM * MM, 0, 0, DEPOIS],
      })
      return
    }

    // --- bloco de dados bancários ---------------------------------------------
    // Recuado como a citação, com o fundo claro do contrato: é informação para ser
    // copiada pelo juízo ao expedir alvará, não texto para ler em sequência. Fora
    // do fecho, senão a assinatura (que também é toda em negrito e de duas linhas)
    // cairia aqui em vez de ser centralizada.
    if (ehBlocoDados(bloco) && !noFecho) {
      conteudo.push({
        table: {
          widths: ['*'],
          body: [
            [
              {
                text: trechos(bloco),
                alignment: 'left',
                fillColor: COR.fundoDados,
                border: [true, true, true, true],
                margin: [8, 6, 8, 6],
              },
            ],
          ],
        },
        layout: {
          vLineWidth: () => 1,
          hLineWidth: () => 1,
          vLineColor: () => COR.regua,
          hLineColor: () => COR.regua,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
        margin: [RECUO_MM * MM, 0, 0, DEPOIS],
      })
      return
    }

    const linhas = bloco.split('\n').map((l) => l.trim()).filter(Boolean)

    // --- listas ----------------------------------------------------------------
    if (linhas.length && linhas.every((l) => /^([-*]|\d+\.)\s/.test(l))) {
      linhas.forEach((l, j) => {
        const parte = l.match(/^(\d+\.|[-*])\s+(.*)$/)
        if (!parte) return
        const marcador = parte[1] === '-' || parte[1] === '*' ? '•' : parte[1]
        conteudo.push({
          columns: [
            { text: marcador, width: 20, color: COR.titulo, bold: true },
            { text: trechos(parte[2]), alignment: 'justify' },
          ],
          columnGap: 0,
          margin: [12, 0, 0, j === linhas.length - 1 ? DEPOIS : DEPOIS / 2],
        })
      })
      return
    }

    // --- títulos e parágrafos --------------------------------------------------
    const titulo = ehTitulo(bloco)
    // Os dois primeiros blocos são o cabeçalho da peça (endereçamento e número do
    // processo). Não levam o espaço extra dos títulos de seção: entre eles a folga
    // grande separaria o que é uma coisa só.
    const cabecalho = titulo && i < 2
    const temQuebra = linhas.length > 1

    conteudo.push({
      text: trechos(linhas.join('\n')),
      alignment: noFecho ? 'center' : temQuebra ? 'left' : 'justify',
      bold: titulo,
      color: cabecalho ? COR.cabecalho : titulo ? COR.titulo : COR.corpo,
      margin: [
        0,
        // Título de seção ganha o dobro do espaço acima: o pedido foi justamente
        // afastá-lo do parágrafo que encerra o tópico anterior.
        cabecalho ? (i > 0 ? DEPOIS : 0) : titulo || i === inicioFecho ? DEPOIS * 2 : 0,
        0,
        titulo ? (cabecalho ? DEPOIS * 2 : 2) : DEPOIS,
      ],
    })

    // A régua fecha o título de seção e já embute o espaço até o texto.
    if (titulo && !cabecalho) conteudo.push(reguaTitulo())
  })

  return conteudo
}

/**
 * Definição do documento. O timbrado entra por `background`, que o pdfmake chama
 * uma vez por página — é o que faz o papel repetir da primeira à última folha,
 * com as bordas justas às da página.
 */
export function documentoPeticao(
  md: string,
  timbradoDataUri: string | null,
): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageMargins: [
      MARGENS_MM.esquerda * MM,
      MARGENS_MM.topo * MM,
      MARGENS_MM.direita * MM,
      MARGENS_MM.rodape * MM,
    ],
    // Sem timbrado o documento sai em branco em vez de falhar: petição sem a arte
    // ainda é utilizável num aperto; petição que não gera, não.
    background: timbradoDataUri
      ? () => ({ image: 'timbrado', width: A4_PT.largura, height: A4_PT.altura })
      : undefined,
    images: timbradoDataUri ? { timbrado: timbradoDataUri } : undefined,
    content: markdownParaConteudo(md),
    defaultStyle: {
      font: 'Carlito',
      fontSize: CORPO.fonte,
      lineHeight: CORPO.entrelinha,
      color: COR.corpo,
    },
  }
}

/**
 * URLs dos quatro arquivos da Carlito.
 *
 * Importados DENTRO da função, e não no topo do módulo, por dois motivos: as
 * fontes só descem quando alguém gera uma petição, e o topo do módulo fica livre
 * de dependência do Vite — o que permite testar a montagem do documento fora do
 * navegador, que é como as margens e o parser foram conferidos.
 */
async function urlsCarlito(): Promise<Record<string, string>> {
  const [reg, bold, ital, boldItal] = await Promise.all([
    import('@/assets/fontes/Carlito-Regular.ttf?url'),
    import('@/assets/fontes/Carlito-Bold.ttf?url'),
    import('@/assets/fontes/Carlito-Italic.ttf?url'),
    import('@/assets/fontes/Carlito-BoldItalic.ttf?url'),
  ])
  return {
    'Carlito-Regular.ttf': reg.default,
    'Carlito-Bold.ttf': bold.default,
    'Carlito-Italic.ttf': ital.default,
    'Carlito-BoldItalic.ttf': boldItal.default,
  }
}

/** Baixa um arquivo e devolve só o base64 (sem o prefixo `data:`). */
async function base64De(url: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Falha ao carregar a fonte (HTTP ${resp.status}).`)
  const bytes = new Uint8Array(await resp.arrayBuffer())
  let bin = ''
  // Em pedaços: passar 200 mil bytes de uma vez para o apply estoura a pilha.
  const passo = 8192
  for (let i = 0; i < bytes.length; i += passo) {
    bin += String.fromCharCode(...bytes.subarray(i, i + passo))
  }
  return btoa(bin)
}

/**
 * Gera o PDF e devolve o blob. Importa o pdfmake sob demanda: é mais de 1 MB, e
 * quem só olha a lista de tarefas não deve baixar isso — mesmo tratamento que o
 * exceljs recebe na exportação da carteira.
 */
export async function gerarPdfPeticao(
  md: string,
  timbradoDataUri: string | null,
): Promise<Blob> {
  const [{ default: pdfMake }, urls] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    urlsCarlito(),
  ])

  const nomes = Object.keys(urls)
  const base64 = await Promise.all(nomes.map((n) => base64De(urls[n])))
  const vfs: Record<string, string> = {}
  nomes.forEach((nome, i) => {
    vfs[nome] = base64[i]
  })

  const mutavel = pdfMake as unknown as {
    vfs: Record<string, string>
    fonts: Record<string, Record<string, string>>
  }
  mutavel.vfs = vfs
  mutavel.fonts = {
    Carlito: {
      normal: 'Carlito-Regular.ttf',
      bold: 'Carlito-Bold.ttf',
      italics: 'Carlito-Italic.ttf',
      bolditalics: 'Carlito-BoldItalic.ttf',
    },
  }

  // ⚠️ O cast existe porque @types/pdfmake@0.3.3 declara `getBlob(): Promise<Blob>`
  // e a pdfmake@0.2.23 implementa `getBlob(cb, options)` — com um
  // `if (!cb) throw 'getBlob is an async method and needs a callback argument'`
  // na primeira linha. Escrever como os tipos mandam COMPILA e quebra em
  // produção. Não troque por await sem antes conferir a versão instalada.
  const doc = pdfMake.createPdf(documentoPeticao(md, timbradoDataUri)) as unknown as {
    getBlob: (cb: (blob: Blob) => void) => void
  }
  return await new Promise<Blob>((resolve, reject) => {
    try {
      doc.getBlob(resolve)
    } catch (err) {
      reject(err as Error)
    }
  })
}
