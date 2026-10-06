// As caixas flutuantes do card da Análise cabem na tela (src/lib/dentroDaJanela.ts).
//
// NO CELULAR, A FILEIRA DE BOTÕES DO CARD QUEBRA, e o botão muda de lado: a
// caixa de 360px ancorada à direita de um botão na metade esquerda saía pela
// borda esquerda, e a das etiquetas (460px) pela direita — com rolagem lateral
// enquanto aberta. No último card, a caixa abria abaixo do pé da tela.
import { describe, it, expect } from 'vitest'
import { ajusteParaCaber, MARGEM_DA_JANELA } from '@/lib/dentroDaJanela'

const CELULAR = { largura: 375, altura: 812 }
const COMPUTADOR = { largura: 1440, altura: 900 }
const M = MARGEM_DA_JANELA

describe('ajusteParaCaber — de lado', () => {
  it('cabendo, não mexe', () => {
    expect(ajusteParaCaber({ esquerda: 900, largura: 360, topo: 300, altura: 200 }, 260, COMPUTADOR)).toEqual({
      dx: 0,
      acima: false,
    })
  })

  it('passando da direita, puxa para a esquerda até a margem', () => {
    // As etiquetas (460px) a partir de x=120 num celular de 375px.
    const { dx } = ajusteParaCaber({ esquerda: 120, largura: 343, topo: 300, altura: 300 }, 260, CELULAR)
    expect(120 + dx + 343).toBe(375 - M)
  })

  it('passando da esquerda, empurra para a direita até a margem', () => {
    // A anotação (360px) ancorada à direita de um botão em x=200: começa em -160.
    const { dx } = ajusteParaCaber({ esquerda: -160, largura: 327, topo: 300, altura: 300 }, 260, CELULAR)
    expect(-160 + dx).toBe(M)
  })

  it('mais larga que a janela, encosta na margem esquerda', () => {
    const { dx } = ajusteParaCaber({ esquerda: 40, largura: 500, topo: 300, altura: 100 }, 260, CELULAR)
    expect(40 + dx).toBe(M)
  })
})

describe('ajusteParaCaber — para cima', () => {
  it('sem lugar embaixo e com lugar em cima, abre para cima', () => {
    expect(ajusteParaCaber({ esquerda: 900, largura: 360, topo: 800, altura: 300 }, 760, COMPUTADOR).acima).toBe(true)
  })

  it('sem lugar em cima também, continua embaixo (rolar é melhor que cobrir o topo)', () => {
    expect(ajusteParaCaber({ esquerda: 900, largura: 360, topo: 200, altura: 800 }, 160, COMPUTADOR).acima).toBe(false)
  })

  it('cabendo embaixo, nunca vira', () => {
    expect(ajusteParaCaber({ esquerda: 900, largura: 360, topo: 500, altura: 300 }, 460, COMPUTADOR).acima).toBe(false)
  })
})
