// A JUNÇÃO DOS PDFs DOS AUTOS, documento por documento.
//
// A BIBLIOTECA ENTRA POR PARÂMETRO. A rotina passa o `PDFDocument` do
// `npm:pdf-lib@1.17.1` (o mesmo da dd-credor); o teste passa o do
// node_modules, mesma versão. Com o import `npm:` aqui dentro, o vitest não
// alcançaria este arquivo — e a junção é justamente o que precisa ser testado
// com PDF de verdade.
//
// MEMÓRIA: cada documento é aberto, tem as páginas copiadas para o PDF de
// destino e é largado em seguida — quem chama não guarda os bytes dele. O que
// cresce é só o destino. Medido em 07/10/2026: pico ~2,2× o tamanho da parte
// (ver ALVO_PARTE_BYTES em autosJuntos.ts).
//
// DOCUMENTO QUE NÃO ABRE NÃO DERRUBA A JUNÇÃO: PDF cifrado, corrompido, ou que
// nem é PDF volta como recusa, com o motivo, e entra na lista dos "não
// juntados" que a nota do card mostra.

import { ehPdf } from './falhasDosAutos.ts'

// deno-lint-ignore no-explicit-any
type Qualquer = any

/** O pedaço do pdf-lib que a junção usa. */
export interface BibliotecaPdf {
  PDFDocument: {
    create(): Promise<Qualquer>
    load(bytes: Uint8Array, opcoes?: Qualquer): Promise<Qualquer>
  }
}

export type ResultadoDoDocumento = { ok: true; paginas: number } | { ok: false; motivo: string }

/** O motivo da recusa, em português, a partir do erro do pdf-lib. */
export function motivoDaRecusa(e: unknown): string {
  const m = String((e as Error)?.message ?? e)
  if (/encrypt/i.test(m)) return 'PDF protegido por senha (cifrado)'
  return 'PDF corrompido ou ilegível'
}

export interface Juntador {
  /** Junta mais um documento ao fim. Nunca lança: recusa vem no resultado. */
  juntar(bytes: Uint8Array): Promise<ResultadoDoDocumento>
  readonly paginas: number
  readonly documentos: number
  /** O PDF juntado. Depois disto, o juntador não serve mais. */
  fechar(): Promise<Uint8Array>
}

export async function criarJuntador(lib: BibliotecaPdf): Promise<Juntador> {
  let destino: Qualquer = await lib.PDFDocument.create()
  let documentos = 0
  let paginas = 0
  return {
    async juntar(bytes: Uint8Array): Promise<ResultadoDoDocumento> {
      if (!destino) throw new Error('o juntador já foi fechado')
      if (!ehPdf(bytes)) return { ok: false, motivo: 'não é PDF' }
      let fonte: Qualquer
      try {
        // SEM `ignoreEncryption`: cifrado tem de ser recusado. Copiar as
        // páginas dele daria páginas com o conteúdo embaralhado, em silêncio.
        fonte = await lib.PDFDocument.load(bytes, { updateMetadata: false })
      } catch (e) {
        return { ok: false, motivo: motivoDaRecusa(e) }
      }
      try {
        const indices: number[] = fonte.getPageIndices()
        if (indices.length === 0) return { ok: false, motivo: 'PDF sem páginas' }
        const copiadas: unknown[] = await destino.copyPages(fonte, indices)
        for (const p of copiadas) destino.addPage(p)
        documentos++
        paginas += copiadas.length
        return { ok: true, paginas: copiadas.length }
      } catch (e) {
        return { ok: false, motivo: motivoDaRecusa(e) }
      } finally {
        fonte = null
      }
    },
    get paginas() {
      return paginas
    },
    get documentos() {
      return documentos
    },
    async fechar(): Promise<Uint8Array> {
      if (!destino) throw new Error('o juntador já foi fechado')
      const d = destino
      // O DESTINO SAI DE ALCANCE antes de quem chamou subir os bytes: são
      // dezenas de MB que o coletor pode devolver enquanto o envio acontece.
      destino = null
      return await d.save()
    },
  }
}
