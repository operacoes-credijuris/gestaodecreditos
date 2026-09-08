// Renderiza páginas de um PDF em JPEG, no navegador, com o pdf.js.
//
// É a metade "faz" de paginasDigitalizadas.ts, que é a metade "escolhe". Fica em
// arquivo próprio porque importa o pdf.js, que o vitest não carrega — e a
// escolha, que é a regra, precisa ser testada.
//
// 1.568 PX NA ARESTA MAIOR, e não 1.400 de largura. A diferença não é estética.
//
// A API reduz toda imagem cuja aresta maior passe de 1.568 px ANTES de contar
// tokens. Uma A4 renderizada a 1400×1980 chegava ao modelo como 1108×1568 — ou
// seja, renderizávamos, comprimíamos, subíamos ao Storage e baixávamos na Edge
// Function 60% mais pixels do que o modelo ia olhar, e pagávamos exatamente os
// mesmos tokens. Rasterizar direto no tamanho final é ~37% menos bytes em cada
// perna do trajeto e uma imagem um pouco MAIS nítida, porque não passa por JPEG
// e depois por reamostragem.
//
// A 0,72 de qualidade, uma página A4 fica entre 80 e 190 KB. Menos que isso e os
// dígitos de uma coluna de centavos viram borrão.
import * as pdfjsLib from 'pdfjs-dist'

export interface PaginaRenderizada {
  numero: number
  blob: Blob
}

/**
 * Onde o tempo desta etapa foi, medido por dentro.
 *
 * Existe porque a etapa de imagens variou de 7s a 2m46s entre processos e eu
 * não tinha como dizer o que dominava: a rasterização (pdf.js decodificando a
 * imagem embutida e desenhando no canvas, na thread principal) ou a rede. São
 * consertos opostos — Web Worker de um lado, concorrência ou compressão do
 * outro —, e escolher sem medir foi o que já me custou três tentativas erradas
 * neste projeto.
 */
export interface TempoDaRenderizacao {
  /** Páginas que saíram prontas. */
  paginas: number
  /** Milissegundos dentro da rasterização: decodificar, desenhar, comprimir. */
  rasterizacao: number
  /** Milissegundos parados esperando o consumidor — na prática, a fila de upload. */
  consumidor: number
}

/** O teto da API: acima disto ela reduz por conta própria, e o excedente é lixo. */
const ARESTA_MAIOR_ALVO = 1568
const ESCALA_MAXIMA = 2.5
const QUALIDADE_JPEG = 0.72

/**
 * Renderiza as páginas pedidas (1-based). Página que falhar é pulada, e o erro
 * vai no retorno em vez de derrubar as outras — uma página corrompida não pode
 * custar a análise inteira.
 *
 * ENTREGA PÁGINA A PÁGINA quando `onPagina` é passado, e aí NÃO acumula os
 * blobs. Isto existe por um número medido: num processo com dezenas de páginas
 * digitalizadas, esta etapa levou 2m04s no navegador. A rasterização é serial e
 * na thread principal (é o pdf.js decodificando a imagem embutida e desenhando
 * no canvas), e o upload — que era uma SEGUNDA fila, depois de todas as páginas
 * prontas — somava o seu tempo inteiro por cima.
 *
 * Entregando cada página assim que ela sai, quem chama já começa a subir, e o
 * upload passa a acontecer DENTRO do tempo de renderização em vez de depois
 * dele. De brinde, o pico de memória cai: eram sessenta blobs de 80 a 190 KB
 * vivos ao mesmo tempo; agora são os poucos em voo.
 *
 * `onPagina` pode devolver promessa, e ela é AGUARDADA — é o que dá
 * contrapressão: quem chama segura a esteira enquanto a fila de upload está
 * cheia, em vez de renderizar tudo na frente e empilhar bytes.
 */
export async function renderizarPaginas(
  bytes: ArrayBuffer,
  numeros: number[],
  onProgresso?: (feitas: number, total: number) => void,
  onPagina?: (pagina: PaginaRenderizada) => void | Promise<void>,
): Promise<{ imagens: PaginaRenderizada[]; falhas: number[]; tempo: TempoDaRenderizacao }> {
  const imagens: PaginaRenderizada[] = []
  const falhas: number[] = []
  const tempo: TempoDaRenderizacao = { paginas: 0, rasterizacao: 0, consumidor: 0 }
  const agora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  // O pdf.js toma posse do buffer: cópia, para o chamador poder reutilizá-lo.
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise
  let feitas = 0
  for (const numero of numeros) {
    const t0 = agora()
    try {
      if (numero < 1 || numero > pdf.numPages) throw new Error('fora da faixa')
      const page = await pdf.getPage(numero)
      const base = page.getViewport({ scale: 1 })
      // Pela aresta MAIOR, não pela largura: uma página em paisagem — e conta de
      // contadoria em paisagem é comum — tinha a altura livre para passar do
      // teto e ser reduzida pela API do mesmo jeito.
      const escala = Math.min(ESCALA_MAXIMA, ARESTA_MAIOR_ALVO / Math.max(1, base.width, base.height))
      const viewport = page.getViewport({ scale: escala })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('sem contexto 2d')
      // Fundo branco: página escaneada com transparência sairia preta no JPEG.
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALIDADE_JPEG))
      if (!blob) throw new Error('toBlob devolveu vazio')
      // A CONTA DOS DOIS TEMPOS SE FECHA AQUI: o que veio antes é rasterização,
      // o que o consumidor segurar é rede. Sem esta linha os dois viriam
      // somados, e somados eles não dizem o que consertar.
      tempo.rasterizacao += agora() - t0
      tempo.paginas++
      const tCons = agora()
      // Com consumidor, a página vai embora agora e não fica na memória; sem
      // consumidor, o comportamento antigo continua valendo.
      if (onPagina) await onPagina({ numero, blob })
      else imagens.push({ numero, blob })
      tempo.consumidor += agora() - tCons
      // Libera a memória do canvas: 60 páginas de 1400×2000 são muitos MB.
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    } catch {
      falhas.push(numero)
      tempo.rasterizacao += agora() - t0
    } finally {
      feitas++
      onProgresso?.(feitas, numeros.length)
    }
  }
  await pdf.destroy()
  return { imagens, falhas, tempo }
}
