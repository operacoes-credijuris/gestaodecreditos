// Renderiza páginas de um PDF em JPEG, no navegador, com o pdf.js.
//
// É a metade "faz" de paginasDigitalizadas.ts, que é a metade "escolhe". Fica em
// arquivo próprio porque importa o pdf.js, que o vitest não carrega — e a
// escolha, que é a regra, precisa ser testada.
//
// LARGURA-ALVO DE 1.400 PX. É o que faz uma tabela de contadoria digitalizada
// sair legível para a IA sem estourar o tamanho: a 0,72 de qualidade, uma
// página A4 fica entre 120 e 300 KB. Menos que isso e os dígitos de uma coluna
// de centavos viram borrão; mais e o upload de 60 páginas passa de 20 MB.
import * as pdfjsLib from 'pdfjs-dist'

export interface PaginaRenderizada {
  numero: number
  blob: Blob
}

const LARGURA_ALVO = 1400
const ESCALA_MAXIMA = 2.5
const QUALIDADE_JPEG = 0.72

/**
 * Renderiza as páginas pedidas (1-based). Página que falhar é pulada, e o erro
 * vai no retorno em vez de derrubar as outras — uma página corrompida não pode
 * custar a análise inteira.
 */
export async function renderizarPaginas(
  bytes: ArrayBuffer,
  numeros: number[],
  onProgresso?: (feitas: number, total: number) => void,
): Promise<{ imagens: PaginaRenderizada[]; falhas: number[] }> {
  const imagens: PaginaRenderizada[] = []
  const falhas: number[] = []
  // O pdf.js toma posse do buffer: cópia, para o chamador poder reutilizá-lo.
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise
  let feitas = 0
  for (const numero of numeros) {
    try {
      if (numero < 1 || numero > pdf.numPages) throw new Error('fora da faixa')
      const page = await pdf.getPage(numero)
      const base = page.getViewport({ scale: 1 })
      const escala = Math.min(ESCALA_MAXIMA, LARGURA_ALVO / Math.max(1, base.width))
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
      imagens.push({ numero, blob })
      // Libera a memória do canvas: 60 páginas de 1400×2000 são muitos MB.
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    } catch {
      falhas.push(numero)
    } finally {
      feitas++
      onProgresso?.(feitas, numeros.length)
    }
  }
  await pdf.destroy()
  return { imagens, falhas }
}
