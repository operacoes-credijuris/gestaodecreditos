// O PDF.JS SOB DEMANDA, com o worker configurado uma vez só.
//
// São ~330 kB (mais o worker), e a Análise de crédito — a tela de início — os
// baixava na abertura por um import estático, antes de qualquer PDF ser pedido.
// Pior: o worker era configurado como efeito colateral do módulo da Análise, e
// `renderizarPaginas` dependia disso sem dizer (usado de outro lugar, ficaria
// sem worker). Agora todo uso passa por aqui.
//
// Falha ao carregar (rede, publicação nova no meio do dia) não fica guardada:
// a próxima chamada tenta de novo.

type PdfJs = typeof import('pdfjs-dist')

let carregando: Promise<PdfJs> | null = null

export function carregarPdfjs(): Promise<PdfJs> {
  if (!carregando) {
    carregando = (async () => {
      const pdfjsLib = await import('pdfjs-dist')
      const { default: urlDoWorker } = await import('pdfjs-dist/build/pdf.worker.min.js?url')
      pdfjsLib.GlobalWorkerOptions.workerSrc = urlDoWorker
      return pdfjsLib
    })().catch((e) => {
      carregando = null
      throw e
    })
  }
  return carregando
}
