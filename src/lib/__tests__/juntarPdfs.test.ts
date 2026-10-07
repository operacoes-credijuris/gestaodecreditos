/**
 * A JUNÇÃO DE VERDADE, com o pdf-lib 1.17.1 do node_modules — a mesma versão
 * que a rotina importa como `npm:pdf-lib@1.17.1`. Os PDFs são gerados aqui.
 */
import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { criarJuntador, motivoDaRecusa } from '../../../supabase/functions/_shared/juntarPdfs.ts'

/** Um PDF com `n` páginas de largura `largura` — a largura marca de qual documento a página veio. */
async function pdf(n: number, largura: number): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  for (let i = 0; i < n; i++) d.addPage([largura, 500 + i])
  return d.save()
}

describe('criarJuntador', () => {
  it('junta os documentos na ordem em que chegam, página por página', async () => {
    const j = await criarJuntador({ PDFDocument })
    expect(await j.juntar(await pdf(2, 100))).toEqual({ ok: true, paginas: 2 })
    expect(await j.juntar(await pdf(3, 200))).toEqual({ ok: true, paginas: 3 })
    expect(await j.juntar(await pdf(1, 300))).toEqual({ ok: true, paginas: 1 })
    expect(j.documentos).toBe(3)
    expect(j.paginas).toBe(6)
    const bytes = await j.fechar()
    const junto = await PDFDocument.load(bytes)
    expect(junto.getPages().map((p) => p.getWidth())).toEqual([100, 100, 200, 200, 200, 300])
    expect(junto.getPages().map((p) => p.getHeight())).toEqual([500, 501, 500, 501, 502, 500])
  })

  it('documento que não abre fica de fora, com o motivo, e a junção segue', async () => {
    const j = await criarJuntador({ PDFDocument })
    expect(await j.juntar(await pdf(1, 100))).toMatchObject({ ok: true })
    expect(await j.juntar(new TextEncoder().encode('<html>erro</html>'))).toEqual({ ok: false, motivo: 'não é PDF' })
    const quebrado = await j.juntar(new TextEncoder().encode('%PDF-1.7\nisto não é um pdf de verdade'))
    expect(quebrado.ok).toBe(false)
    expect(await j.juntar(await pdf(2, 200))).toMatchObject({ ok: true, paginas: 2 })
    const junto = await PDFDocument.load(await j.fechar())
    expect(junto.getPageCount()).toBe(3)
  })

  it('PDF cifrado é recusado (copiar daria páginas embaralhadas em silêncio)', async () => {
    const d = await PDFDocument.create()
    d.addPage([100, 100])
    // O dicionário /Encrypt no trailer é o que marca o PDF como cifrado.
    d.context.trailerInfo.Encrypt = d.context.obj({ Filter: PDFName.of('Standard'), V: 2, R: 3 })
    const cifrado = await d.save({ useObjectStreams: false })
    const j = await criarJuntador({ PDFDocument })
    expect(await j.juntar(cifrado)).toEqual({ ok: false, motivo: 'PDF protegido por senha (cifrado)' })
    expect(j.documentos).toBe(0)
  })

  it('o motivo em português', () => {
    expect(motivoDaRecusa(new Error('Input document to `PDFDocument.load` is encrypted'))).toBe('PDF protegido por senha (cifrado)')
    expect(motivoDaRecusa(new Error('Failed to parse'))).toBe('PDF corrompido ou ilegível')
  })

  it('fechado, não serve mais', async () => {
    const j = await criarJuntador({ PDFDocument })
    await j.juntar(await pdf(1, 100))
    await j.fechar()
    await expect(j.fechar()).rejects.toThrow()
  })
})
