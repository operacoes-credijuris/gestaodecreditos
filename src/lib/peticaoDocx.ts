// Desenha a petição em .docx.
//
// NÃO interpreta o modelo: quem lê o markdown e decide o que é título, citação ou
// dado é lerModelo(), em peticaoLayout.ts, compartilhado com o gerador de PDF.
// Aqui só se resolve a mecânica do Office Open XML. Duas leituras do mesmo
// markdown divergiriam, e a divergência apareceria como duas petições do mesmo
// escritório com formatações diferentes.
//
// AS UNIDADES do .docx são as do Word, e cada uma é diferente:
//   • tamanho de fonte em MEIOS-PONTOS  -> 11pt = 22
//   • espaçamento em TWIPS (1/20 de pt) -> 12pt = 240
//   • entrelinha em 240-avos de linha    -> 1,08 = 259
//   • recuo e margem em TWIPS            -> 1 mm = 56,7
// Os números vêm de peticaoLayout em mm e pt; a conversão fica toda aqui.
//
// A fonte declarada é CALIBRI, e não Carlito como no PDF: aqui a fonte não é
// embutida — é um NOME que o Word resolve na máquina de quem abre. Como todo
// mundo aqui tem Office, sai Calibri de verdade, sem questão de licença. No PDF a
// fonte tem de viajar dentro do arquivo, e daí a Carlito.
import {
  CITACAO,
  COR,
  CORPO,
  DEPOIS_PT,
  lerModelo,
  MARGENS_MM,
  RECUO_CITACAO_MM,
  type Alinhamento,
  type Trecho,
} from './peticaoLayout'

/** 1 mm em twips. */
const MM_TWIP = 1440 / 25.4

/** 1 pt em twips. */
const PT_TWIP = 20

const mm = (v: number) => Math.round(v * MM_TWIP)
const pt = (v: number) => Math.round(v * PT_TWIP)
/** Meios-pontos, que é como o Word mede fonte. */
const meioPt = (v: number) => Math.round(v * 2)
/** Entrelinha do Word: 240-avos de linha. 1,08 -> 259, igual ao contrato modelo. */
const entrelinha = (v: number) => Math.round(v * 240)

/**
 * A4 em PIXELS A 96 DPI — 794 x 1123.
 *
 * ⚠️ Não troque por pontos. O `transformation` do ImageRun mede em pixels de 96 DPI
 * (converte com 9525 EMU por pixel), não nos 72 DPI do PostScript. Passando os
 * 595x842 pontos do A4, a imagem sai a 75% do tamanho (72/96) — o timbrado
 * encolhia e o rodapé dele subia para o meio da página, por cima do texto.
 */
const A4_PX = { largura: (210 / 25.4) * 96, altura: (297 / 25.4) * 96 }

/**
 * Monta o documento. Recebe o timbrado em bytes porque o `docx` embute a imagem no
 * arquivo — diferente do PDF, onde ela vira data URI.
 */
export async function gerarDocxPeticao(
  md: string,
  timbrado: Uint8Array | null,
): Promise<Blob> {
  // Sob demanda: o pacote é grande e só quem gera petição precisa dele.
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Header,
    HorizontalPositionRelativeFrom,
    ImageRun,
    Packer,
    Paragraph,
    ShadingType,
    TextRun,
    VerticalPositionRelativeFrom,
  } = await import('docx')

  const ALINHA: Record<Alinhamento, (typeof AlignmentType)[keyof typeof AlignmentType]> =
    {
      justificado: AlignmentType.JUSTIFIED,
      esquerda: AlignmentType.LEFT,
      centro: AlignmentType.CENTER,
    }

  const runs = (trechos: Trecho[], extra?: { size?: number; color?: string }) =>
    trechos.flatMap((t) =>
      // O \n dentro de um trecho vem do bloco de dados bancários, um dado por
      // linha. No Word, quebra dentro do parágrafo é `break`, não outro parágrafo:
      // como parágrafo separado, cada linha ganharia o espaçamento de 12pt e o
      // cartão viraria uma lista espaçada.
      t.texto.split('\n').map(
        (linha, i) =>
          new TextRun({
            text: linha,
            bold: t.negrito,
            italics: t.italico,
            break: i > 0 ? 1 : undefined,
            size: extra?.size,
            color: extra?.color,
          }),
      ),
    )

  const blocos = lerModelo(md)
  const paragrafos: InstanceType<typeof Paragraph>[] = []

  blocos.forEach((b, i) => {
    switch (b.tipo) {
      case 'citacao':
        paragrafos.push(
          new Paragraph({
            children: runs(b.trechos, { size: meioPt(CITACAO.fonte) }),
            alignment: AlignmentType.JUSTIFIED,
            indent: { left: mm(RECUO_CITACAO_MM) },
            spacing: {
              after: pt(DEPOIS_PT),
              line: entrelinha(CITACAO.entrelinha),
              lineRule: 'auto',
            },
            // Régua à esquerda, como no PDF: marca que a palavra é do tribunal.
            border: {
              left: { style: BorderStyle.SINGLE, size: 12, color: COR.regua, space: 6 },
            },
          }),
        )
        break

      case 'dados':
        // Cartão com fundo e moldura, na largura toda e sem recuo: o juízo precisa
        // achar de relance ao expedir alvará.
        paragrafos.push(
          new Paragraph({
            children: runs(b.trechos),
            alignment: AlignmentType.LEFT,
            spacing: { after: pt(DEPOIS_PT), before: pt(2) },
            shading: { type: ShadingType.CLEAR, fill: COR.fundoDados },
            border: {
              top: { style: BorderStyle.SINGLE, size: 6, color: COR.regua, space: 6 },
              bottom: { style: BorderStyle.SINGLE, size: 6, color: COR.regua, space: 6 },
              left: { style: BorderStyle.SINGLE, size: 6, color: COR.regua, space: 8 },
              right: { style: BorderStyle.SINGLE, size: 6, color: COR.regua, space: 8 },
            },
          }),
        )
        break

      case 'item':
        // Marcador como texto, e não lista automática do Word: a numeração é a do
        // modelo, e o Word renumeraria por conta própria.
        paragrafos.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${b.marcador}\t`, bold: true, color: COR.titulo }),
              ...runs(b.trechos),
            ],
            alignment: AlignmentType.JUSTIFIED,
            indent: { left: mm(12), hanging: mm(7) },
            spacing: { after: pt(b.ultimo ? DEPOIS_PT : DEPOIS_PT / 2) },
          }),
        )
        break

      case 'titulo':
        paragrafos.push(
          new Paragraph({
            children: runs(b.trechos, {
              color: b.cabecalho ? COR.cabecalho : COR.titulo,
            }),
            alignment: AlignmentType.LEFT,
            spacing: {
              // Título de seção com o dobro de espaço acima; o primeiro bloco da
              // peça sem nada, senão o texto desceria em relação ao timbrado.
              before: b.cabecalho ? (i > 0 ? pt(DEPOIS_PT) : 0) : pt(DEPOIS_PT * 2),
              after: b.cabecalho ? pt(DEPOIS_PT * 2) : pt(DEPOIS_PT),
            },
            // A régua do PDF vira borda inferior do parágrafo.
            border: b.cabecalho
              ? undefined
              : {
                  bottom: {
                    style: BorderStyle.SINGLE,
                    size: 6,
                    color: COR.regua,
                    space: 4,
                  },
                },
          }),
        )
        break

      case 'paragrafo':
        paragrafos.push(
          new Paragraph({
            children: runs(b.trechos),
            alignment: ALINHA[b.alinhamento],
            spacing: {
              before: b.abreFecho ? pt(DEPOIS_PT) : 0,
              after: pt(DEPOIS_PT),
            },
          }),
        )
        break
    }
  })

  /**
   * O timbrado vai no CABEÇALHO, ancorado à página e atrás do texto.
   *
   * É o equivalente do "fundo de página" do PDF: o Word repete o cabeçalho em todas
   * as folhas, então a arte repete. Sem `behindDocument`, a imagem cobriria o texto;
   * sem a âncora na PÁGINA, ela se deslocaria com a margem do cabeçalho.
   */
  const cabecalho = timbrado
    ? new Header({
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                type: 'jpg',
                data: timbrado,
                transformation: { width: A4_PX.largura, height: A4_PX.altura },
                floating: {
                  horizontalPosition: {
                    relative: HorizontalPositionRelativeFrom.PAGE,
                    offset: 0,
                  },
                  verticalPosition: {
                    relative: VerticalPositionRelativeFrom.PAGE,
                    offset: 0,
                  },
                  behindDocument: true,
                  allowOverlap: true,
                },
              }),
            ],
          }),
        ],
      })
    : undefined

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Calibri',
            size: meioPt(CORPO.fonte),
            color: COR.corpo,
          },
          paragraph: {
            spacing: { line: entrelinha(CORPO.entrelinha), lineRule: 'auto' },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: mm(210), height: mm(297) },
            margin: {
              top: mm(MARGENS_MM.topo),
              right: mm(MARGENS_MM.direita),
              bottom: mm(MARGENS_MM.rodape),
              left: mm(MARGENS_MM.esquerda),
              // O cabeçalho começa na borda: é lá que a imagem do timbrado se
              // ancora. Valor maior empurraria a arte para dentro da página.
              header: 0,
            },
          },
        },
        headers: cabecalho ? { default: cabecalho } : undefined,
        children: paragrafos,
      },
    ],
  })

  return await Packer.toBlob(doc)
}
