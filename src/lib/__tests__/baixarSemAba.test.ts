/**
 * BAIXAR ANEXO SEM ABA (pedido do dono, 07/10/2026): o clique no anexo do
 * histórico abria uma aba "Abrindo o anexo…" que ficava aberta depois do
 * download. Agora o arquivo é salvo pelo blob, e a reserva é um quadro escondido.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { baixarSemAba } from '../baixarSemAba'

// Um documento de mentira com o mínimo que a função usa — o projeto não tem
// jsdom, e não vale uma dependência para três elementos.
type Elemento = Record<string, unknown> & { tag: string; remove: () => void; click?: () => void }
function montarDocumento() {
  const criados: Elemento[] = []
  const cliques: string[] = []
  const doc = {
    createElement: (tag: string) => {
      const el: Elemento = { tag, remove: () => {} }
      if (tag === 'a') el.click = () => cliques.push(String(el.download))
      criados.push(el)
      return el
    },
    body: { appendChild: () => {} },
  }
  const abrir = vi.fn()
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', { open: abrir })
  return { criados, cliques, abrir }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('baixarSemAba', () => {
  it('salva pelo blob, com o nome do arquivo, sem abrir janela', async () => {
    const { cliques, abrir } = montarDocumento()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x']), { status: 200 })))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:teste')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    await baixarSemAba('https://drive.kommo.com/download/abc', 'oficio.pdf')
    expect(cliques).toEqual(['oficio.pdf'])
    expect(abrir).not.toHaveBeenCalled()
  })

  it('se o fetch falhar, usa um quadro escondido — nunca uma aba', async () => {
    const { criados, cliques, abrir } = montarDocumento()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await baixarSemAba('https://drive.kommo.com/download/abc', 'oficio.pdf')
    const quadro = criados.find((e) => e.tag === 'iframe')
    expect(quadro?.hidden).toBe(true)
    expect(quadro?.src).toBe('https://drive.kommo.com/download/abc')
    expect(cliques).toEqual([])
    expect(abrir).not.toHaveBeenCalled()
  })

  // AUDITORIA DE 09/10/2026: link vencido (403) ia para o quadro escondido, que
  // carregava a página de erro em silêncio — nada era salvo e não havia aviso.
  it('resposta de erro (link vencido) LANÇA, e não vai para o quadro', async () => {
    const { criados, cliques } = montarDocumento()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('negado', { status: 403 })))
    await expect(baixarSemAba('https://drive.kommo.com/download/abc', 'oficio.pdf')).rejects.toThrow(/403/)
    expect(criados.find((e) => e.tag === 'iframe')).toBeUndefined()
    expect(cliques).toEqual([])
  })

  it('o clique no anexo do card não abre aba', () => {
    const t = readFileSync(join(__dirname, '..', '..', 'pages/operacional/AnaliseCredito.tsx'), 'utf8')
    const corpo = t.slice(t.indexOf('async function abrirAnexo'), t.indexOf('async function baixarAnexosDoCard'))
    expect(corpo).toContain('baixarSemAba(')
    expect(corpo).not.toContain('window.open')
  })
})
