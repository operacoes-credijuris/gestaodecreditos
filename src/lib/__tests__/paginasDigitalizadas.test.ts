import { describe, it, expect } from 'vitest'
import {
  escolherPaginasParaImagem,
  descreverSelecao,
  resumirNumeros,
  type ArquivoParaImagem,
} from '../paginasDigitalizadas'

/**
 * Quais páginas digitalizadas vão para a IA como imagem.
 *
 * Testado porque cada página custa tokens e a escolha errada é silenciosa: se o
 * teto fosse gasto no começo do processo, a conta da contadoria (no fim) não
 * iria — e a IA diria "não há conta", com a conta a três páginas de distância.
 */

const bytes = new ArrayBuffer(8)
const escaneado = (nome: string, paginas: number): ArquivoParaImagem => ({ nome, paginas, texto: '', bytes })
const hibrido = (nome: string, paginas: number, imgs: number[]): ArquivoParaImagem => ({
  nome, paginas, texto: 'tem texto', paginasImagem: imgs, bytes,
})

describe('escolherPaginasParaImagem', () => {
  it('arquivo inteiramente digitalizado: o fim inteiro e o começo, dentro do teto', () => {
    const [s] = escolherPaginasParaImagem([escaneado('proc.pdf', 200)], { max: 60, inicio: 6, fim: 40 })
    expect(s.numeros).toHaveLength(46)
    expect(s.numeros.slice(0, 6)).toEqual([1, 2, 3, 4, 5, 6])
    expect(s.numeros[s.numeros.length - 1]).toBe(200)
    expect(s.numeros[6]).toBe(161)
    expect(s.total).toBe(200)
  })

  it('arquivo curto vai inteiro, sem repetir página', () => {
    const [s] = escolherPaginasParaImagem([escaneado('curto.pdf', 10)])
    expect(s.numeros).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('híbrido: só as páginas de imagem, e elas têm prioridade sobre tudo', () => {
    // Processo digital de 300 páginas com a conta escaneada nas 120-123, e um
    // segundo arquivo todo escaneado disputando o teto.
    const sel = escolherPaginasParaImagem(
      [hibrido('proc.pdf', 300, [120, 121, 122, 123]), escaneado('anexo.pdf', 100)],
      { max: 10, inicio: 2, fim: 8 },
    )
    const proc = sel.find((s) => s.arquivo === 'proc.pdf')!
    expect(proc.numeros).toEqual([120, 121, 122, 123])
    const anexo = sel.find((s) => s.arquivo === 'anexo.pdf')!
    // Sobram 6 vagas: vão para o FIM do escaneado, não para o começo.
    expect(anexo.numeros).toEqual([95, 96, 97, 98, 99, 100])
  })

  it('o teto vale para o total, e o fim vence o começo quando não cabe tudo', () => {
    const [s] = escolherPaginasParaImagem([escaneado('p.pdf', 500)], { max: 20, inicio: 6, fim: 40 })
    expect(s.numeros).toHaveLength(20)
    // Todas do fim: 481-500. Nenhuma do começo coube.
    expect(s.numeros[0]).toBe(481)
    expect(s.numeros[19]).toBe(500)
  })

  it('arquivo sem bytes, sem páginas ou com erro fica de fora', () => {
    expect(escolherPaginasParaImagem([
      { nome: 'a', paginas: 10, texto: '' },
      { nome: 'b', paginas: 0, texto: '', bytes },
      { nome: 'c', paginas: 10, texto: '', bytes, erro: 'não baixou' },
    ])).toEqual([])
  })

  it('arquivo com texto e sem páginas de imagem não gera imagem nenhuma', () => {
    expect(escolherPaginasParaImagem([hibrido('t.pdf', 50, [])])).toEqual([])
  })

  it('página de imagem fora da faixa do arquivo é ignorada', () => {
    const [s] = escolherPaginasParaImagem([hibrido('t.pdf', 50, [0, 10, 51, 10])])
    expect(s.numeros).toEqual([10])
  })

  it('a saída mantém a ordem dos arquivos', () => {
    const sel = escolherPaginasParaImagem([escaneado('b.pdf', 5), escaneado('a.pdf', 5)])
    expect(sel.map((s) => s.arquivo)).toEqual(['b.pdf', 'a.pdf'])
  })
})

describe('resumirNumeros e descreverSelecao', () => {
  it('comprime sequências', () => {
    expect(resumirNumeros([1, 2, 3, 7, 40, 41, 42])).toBe('1-3, 7, 40-42')
    expect(resumirNumeros([5])).toBe('5')
    expect(resumirNumeros([3, 1, 2])).toBe('1-3')
  })

  it('descreve o que foi e o que não foi', () => {
    const sel = escolherPaginasParaImagem([escaneado('curto.pdf', 3), escaneado('longo.pdf', 100)], { max: 60, inicio: 6, fim: 40 })
    const d = descreverSelecao(sel)
    expect(d).toContain('"curto.pdf": todas as 3 página(s)')
    expect(d).toContain('"longo.pdf": 46 de 100 página(s) digitalizadas (p. 1-6, 61-100)')
  })
})
