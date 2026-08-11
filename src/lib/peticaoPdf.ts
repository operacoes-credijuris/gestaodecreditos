// Desenha a petição em PDF.
//
// NÃO interpreta o modelo: quem lê o markdown e decide o que é título, citação ou
// dado é lerModelo(), em peticaoLayout.ts, compartilhado com o gerador de .docx.
// Aqui só se resolve a mecânica do pdfmake. Duas leituras do mesmo markdown
// divergiriam, e a divergência apareceria como duas petições do mesmo escritório
// com formatações diferentes.
//
// O papel timbrado entra como FUNDO DE TODAS AS PÁGINAS. O documento é remontado, e
// não convertido de .docx: converter .docx em PDF no navegador não tem caminho
// confiável.
//
// A fonte é CARLITO, não Calibri: a Calibri é da Microsoft e embuti-la num
// aplicativo web não é coberto pela licença dela. A Carlito foi desenhada para ser
// metricamente idêntica — mesmas larguras, mesmas quebras de linha — e é livre.
// Ver scripts/woff-para-ttf.js.
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import {
  CITACAO,
  COR,
  CORPO,
  DEPOIS_PT,
  lerModelo,
  MARGENS_MM,
  RECUO_CITACAO_MM,
  type Alinhamento,
  type Bloco,
  type Trecho,
} from './peticaoLayout'

/** 1 mm em pontos PostScript, que é a unidade do pdfmake. */
const MM = 72 / 25.4

const A4_PT = { largura: 210 * MM, altura: 297 * MM }

const LARGURA_TEXTO_PT =
  (210 - MARGENS_MM.esquerda - MARGENS_MM.direita) * MM

/** O `#` que o pdfmake espera nas cores; peticaoLayout guarda sem ele. */
const hex = (c: string) => `#${c}`

const ALINHA: Record<Alinhamento, 'justify' | 'left' | 'center'> = {
  justificado: 'justify',
  esquerda: 'left',
  centro: 'center',
}

const texto = (trechos: Trecho[]): Content[] =>
  trechos.map((t) => ({ text: t.texto, bold: t.negrito, italics: t.italico }))

/** Régua fina sob o título de seção, na cor de borda do contrato. */
const regua = (): Content => ({
  canvas: [
    {
      type: 'line',
      x1: 0,
      y1: 0,
      x2: LARGURA_TEXTO_PT,
      y2: 0,
      lineWidth: 1,
      lineColor: hex(COR.regua),
    },
  ],
  margin: [0, 2, 0, DEPOIS_PT],
})

/**
 * Moldura de uma célula única — usada na citação e no cartão de dados.
 *
 * `celula` recebe as propriedades já soltas, e não um Content pronto: espalhar um
 * Content dentro da célula obrigaria a um cast que apaga a checagem de tipo
 * justamente no lugar onde um nome de propriedade errado passa em silêncio.
 */
function celula(
  conteudo: {
    text: Content[]
    alignment: 'justify' | 'left'
    fontSize?: number
    lineHeight?: number
  },
  opcoes: {
    fundo?: string
    bordas: [boolean, boolean, boolean, boolean]
    recuoMm: number
    padding: [number, number, number, number]
  },
): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            ...conteudo,
            fillColor: opcoes.fundo,
            border: opcoes.bordas,
            margin: opcoes.padding,
          },
        ],
      ],
    },
    layout: {
      vLineWidth: () => 2,
      hLineWidth: () => 1,
      vLineColor: () => hex(COR.regua),
      hLineColor: () => hex(COR.regua),
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [opcoes.recuoMm * MM, 0, 0, DEPOIS_PT],
  }
}

function desenhar(blocos: Bloco[]): Content[] {
  const saida: Content[] = []

  blocos.forEach((b, i) => {
    switch (b.tipo) {
      case 'citacao':
        // Corpo menor, sem entrelinha, recuado, com régua à esquerda marcando que
        // a palavra é do tribunal.
        saida.push(
          celula(
            {
              text: texto(b.trechos),
              alignment: 'justify',
              fontSize: CITACAO.fonte,
              lineHeight: CITACAO.entrelinha,
            },
            {
              bordas: [true, false, false, false],
              recuoMm: RECUO_CITACAO_MM,
              padding: [6, 2, 0, 2],
            },
          ),
        )
        break

      case 'dados':
        // Cartão na largura toda, sem recuo: o juízo precisa achar de relance ao
        // expedir alvará.
        saida.push(
          celula(
            { text: texto(b.trechos), alignment: 'left' },
            {
              fundo: hex(COR.fundoDados),
              bordas: [true, true, true, true],
              recuoMm: 0,
              padding: [8, 6, 8, 6],
            },
          ),
        )
        break

      case 'item':
        saida.push({
          columns: [
            { text: b.marcador, width: 20, color: hex(COR.titulo), bold: true },
            { text: texto(b.trechos), alignment: 'justify' },
          ],
          columnGap: 0,
          margin: [12, 0, 0, b.ultimo ? DEPOIS_PT : DEPOIS_PT / 2],
        })
        break

      case 'titulo':
        saida.push({
          text: texto(b.trechos),
          alignment: 'left',
          bold: true,
          color: hex(b.cabecalho ? COR.cabecalho : COR.titulo),
          margin: [
            0,
            // Título de seção ganha o dobro de espaço acima: o pedido foi afastá-lo
            // do parágrafo que encerra o tópico anterior. O primeiro bloco da peça
            // não leva nada, senão o texto desceria em relação ao timbrado.
            b.cabecalho ? (i > 0 ? DEPOIS_PT : 0) : DEPOIS_PT * 2,
            0,
            b.cabecalho ? DEPOIS_PT * 2 : 2,
          ],
        })
        if (!b.cabecalho) saida.push(regua())
        break

      case 'paragrafo':
        saida.push({
          text: texto(b.trechos),
          alignment: ALINHA[b.alinhamento],
          margin: [0, b.abreFecho ? DEPOIS_PT : 0, 0, DEPOIS_PT],
        })
        break
    }
  })

  return saida
}

/**
 * Definição do documento. O timbrado entra por `background`, que o pdfmake chama
 * uma vez por página — é o que faz o papel repetir da primeira à última folha, com
 * as bordas justas às da página.
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
    content: desenhar(lerModelo(md)),
    defaultStyle: {
      font: 'Carlito',
      fontSize: CORPO.fonte,
      lineHeight: CORPO.entrelinha,
      color: hex(COR.corpo),
    },
  }
}

/**
 * URLs dos quatro arquivos da Carlito.
 *
 * Importados DENTRO da função, e não no topo do módulo, por dois motivos: as fontes
 * só descem quando alguém gera uma petição, e o topo do módulo fica livre de
 * dependência do Vite — o que permite testar a montagem do documento fora do
 * navegador, que é como as margens e o leitor foram conferidos.
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
 * quem só olha a lista de tarefas não deve baixar isso.
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
  // na primeira linha. Escrever como os tipos mandam COMPILA e quebra em produção.
  // Não troque por await sem antes conferir a versão instalada.
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
