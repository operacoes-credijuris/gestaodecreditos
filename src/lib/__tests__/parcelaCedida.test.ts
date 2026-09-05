import { describe, it, expect } from 'vitest'
import { classificarParcelaCedida } from '../kommo'

/**
 * O que está sendo cedido, lido do "PARCELA CEDIDA" das anotações do card.
 *
 * Testado porque a resposta decide DUAS coisas caras: sobre o que o deságio é
 * calibrado, e qual das quatro colunas de cenário sobra no arquivo entregue ao
 * cliente. Classificar "honorários sucumbenciais" como cessão de honorários em
 * geral, por exemplo, precifica sobre a verba errada — e nada na tela acusa.
 */
describe('classificarParcelaCedida', () => {
  it('principal sozinho', () => {
    expect(classificarParcelaCedida('Crédito principal')).toBe('principal')
    expect(classificarParcelaCedida('apenas o PRINCIPAL')).toBe('principal')
  })

  it('principal com honorários, em qualquer redação', () => {
    expect(classificarParcelaCedida('Principal + honorários')).toBe('ambos')
    expect(classificarParcelaCedida('principal e honorários contratuais')).toBe('ambos')
    expect(classificarParcelaCedida('principal + sucumbenciais')).toBe('ambos')
  })

  it('honorários sem dizer o tipo', () => {
    expect(classificarParcelaCedida('Honorários')).toBe('honorarios')
    expect(classificarParcelaCedida('honorários contratuais')).toBe('honorarios')
  })

  it('contratuais E sucumbenciais é cessão de honorários, não o caso próprio', () => {
    // Este é o par que a coluna Z da planilha representa.
    expect(classificarParcelaCedida('Honorários contratuais + sucumbenciais')).toBe('honorarios')
    expect(classificarParcelaCedida('contratuais e sucumbenciais')).toBe('honorarios')
  })

  it('SUCUMBENCIAIS SOZINHOS são caso próprio', () => {
    // A verba é do advogado, paga pelo vencido, e pode ser cedida sem o
    // principal — que às vezes nem é RPV.
    expect(classificarParcelaCedida('Honorários sucumbenciais')).toBe('sucumbenciais')
    expect(classificarParcelaCedida('apenas honorários sucumbenciais')).toBe('sucumbenciais')
    expect(classificarParcelaCedida('SUCUMBENCIAIS')).toBe('sucumbenciais')
  })

  it('não distingue por acento nem por caixa', () => {
    expect(classificarParcelaCedida('HONORARIOS SUCUMBENCIAIS')).toBe('sucumbenciais')
    expect(classificarParcelaCedida('Honorários Sucumbenciais')).toBe('sucumbenciais')
  })

  it('sem informação devolve "auto", e quem decide passa a ser o destaque da contadoria', () => {
    expect(classificarParcelaCedida('')).toBe('auto')
    expect(classificarParcelaCedida(null)).toBe('auto')
    expect(classificarParcelaCedida(undefined)).toBe('auto')
    expect(classificarParcelaCedida('a combinar')).toBe('auto')
  })
})
