// Texto de dentro de um arquivo, para a IA ler.
//
// Três formatos, porque são os três que a pasta do crédito tem: PDF (petições,
// decisões, contratos escaneados de origem digital), DOCX (procuração, contrato de
// cessão) e XLSX (a análise de crédito, que é a fonte mais rica).
//
// TUDO NO NAVEGADOR, de propósito. O trabalho pesado fica na máquina de quem está
// usando, e não na Edge Function — que tem teto de CPU e, como o episódio do DJEN
// mostrou, um IP de datacenter que serviços externos tratam pior. Para o servidor
// vai só o TEXTO, que é leve.
/** Teto por arquivo. Documento gigante não pode estourar o pedido à IA. */
const MAX_CHARS_ARQUIVO = 120_000

/** Corta pelo meio, preservando começo e fim — é onde ficam partes e valores. */
function cortar(texto: string, max = MAX_CHARS_ARQUIVO): string {
  if (texto.length <= max) return texto
  const inicio = Math.floor(max * 0.6)
  return (
    texto.slice(0, inicio) +
    '\n\n[...TRECHO DO MEIO OMITIDO POR TAMANHO...]\n\n' +
    texto.slice(texto.length - (max - inicio))
  )
}

/**
 * Texto de um PDF, página por página.
 *
 * O pdf.js entra por import DINÂMICO: são mais de 1 MB, e quem escolhe uma pasta
 * cujos documentos são só planilha e Word não tem por que baixá-lo. De carona, o
 * módulo passa a ser testável fora do navegador — o `?url` do worker é resolução
 * do Vite e não existe em Node.
 */
export async function textoDePdf(bytes: ArrayBuffer): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  const { default: pdfWorkerUrl } = await import(
    'pdfjs-dist/build/pdf.worker.min.js?url'
  )
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  let texto = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const pagina = await pdf.getPage(p)
    const conteudo = await pagina.getTextContent()
    texto +=
      (conteudo.items as Array<{ str?: string }>).map((i) => i.str ?? '').join(' ') + '\n'
  }
  return texto
}

/**
 * Texto de um DOCX.
 *
 * Um .docx é um zip, e o texto vive em `word/document.xml`. Em vez de uma
 * biblioteca de conversão, descompacta e tira as marcas: `</w:p>` vira quebra de
 * linha (é o fim de parágrafo) e `<w:tab/>` vira tabulação, senão o texto sairia
 * numa única linha colada e a IA perderia a estrutura do contrato.
 */
export async function textoDeDocx(bytes: ArrayBuffer): Promise<string> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const doc = zip.file('word/document.xml')
  if (!doc) throw new Error('Não parece um .docx (falta word/document.xml).')
  const xml = await doc.async('string')
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Texto de uma planilha, uma linha por célula preenchida: `Aba!C2: valor`.
 *
 * O ENDEREÇO DA CÉLULA VAI JUNTO, e é o ponto todo. A análise de crédito é gerada
 * pela própria plataforma a partir de um modelo, então célula tem significado fixo
 * (C6 é o tribunal, K5 é o valor bruto). Mandando o endereço, a IA pode se apoiar
 * nele quando reconhece o modelo — e continua conseguindo ler pelo rótulo ao lado
 * quando a planilha é outra, como a de precatório, que é um modelo diferente.
 *
 * Data vira ISO e número vira número: `toString()` numa data daria "Tue Aug 12
 * 2026 00:00:00 GMT-0300", que é ruído e induz erro de fuso.
 */
export async function textoDeXlsx(bytes: ArrayBuffer): Promise<string> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes)
  const linhas: string[] = []
  wb.eachSheet((aba) => {
    aba.eachRow({ includeEmpty: false }, (linha) => {
      linha.eachCell({ includeEmpty: false }, (celula) => {
        const v = celula.value
        if (v == null || v === '') return
        let texto: string
        if (v instanceof Date) texto = v.toISOString().slice(0, 10)
        else if (typeof v === 'object' && 'result' in v)
          texto = String((v as { result?: unknown }).result ?? '') // fórmula: o valor
        else if (typeof v === 'object' && 'richText' in v)
          texto = (v as { richText: { text: string }[] }).richText
            .map((r) => r.text)
            .join('')
        else if (typeof v === 'object' && 'text' in v)
          texto = String((v as { text?: unknown }).text ?? '') // hyperlink
        else texto = String(v)
        texto = texto.trim()
        if (texto) linhas.push(`${aba.name}!${celula.address}: ${texto}`)
      })
    })
  })
  return linhas.join('\n')
}

/**
 * Texto de um arquivo qualquer, escolhido pelo tipo. Devolve null quando o formato
 * não rende texto (imagem, zip) — o chamador conta como ignorado, em vez de mandar
 * lixo para a IA.
 */
export async function textoDeArquivo(
  bytes: ArrayBuffer,
  mime: string,
  nome: string,
): Promise<string | null> {
  const ext = (nome.split('.').pop() ?? '').toLowerCase()
  const eh = (m: string, e: string) => mime.includes(m) || ext === e

  if (eh('pdf', 'pdf')) return cortar(await textoDePdf(bytes))
  if (eh('wordprocessingml', 'docx')) return cortar(await textoDeDocx(bytes))
  if (eh('spreadsheetml', 'xlsx')) return cortar(await textoDeXlsx(bytes))
  if (mime.startsWith('text/') || ext === 'txt' || ext === 'md' || ext === 'csv') {
    return cortar(new TextDecoder().decode(bytes))
  }
  return null
}
