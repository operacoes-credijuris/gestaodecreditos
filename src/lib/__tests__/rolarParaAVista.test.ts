// A aba/opção escolhida vem à vista numa fila que rola de lado (celular).
import { describe, it, expect } from 'vitest'
import { rolarParaAVista } from '../rolarParaAVista'

const fila = (scrollLeft: number, clientWidth = 300, scrollWidth = 600) =>
  ({ scrollLeft, clientWidth, scrollWidth }) as unknown as HTMLElement
const item = (offsetLeft: number, offsetWidth = 100) => ({ offsetLeft, offsetWidth }) as unknown as HTMLElement

describe('rolarParaAVista', () => {
  it('rola para a direita quando o item passa da borda, com folga', () => {
    const f = fila(0)
    rolarParaAVista(f, item(450))
    expect(f.scrollLeft).toBe(450 + 100 - 300 + 16)
  })
  it('rola para a esquerda quando o item ficou para trás', () => {
    const f = fila(400)
    rolarParaAVista(f, item(100))
    expect(f.scrollLeft).toBe(84)
  })
  it('não mexe quando o item já está à vista ou a fila não rola', () => {
    const f = fila(100)
    rolarParaAVista(f, item(150))
    expect(f.scrollLeft).toBe(100)
    const g = fila(0, 600, 600)
    rolarParaAVista(g, item(550))
    expect(g.scrollLeft).toBe(0)
    rolarParaAVista(null, item(0))
  })
})
