import { describe, it, expect } from 'vitest'
import {
  grauDaPlanilha,
  normalizarGrau,
  ORDEM_GRAU,
} from '../../../supabase/functions/_shared/graus.ts'

/**
 * O GRAU DE UM RISCO, num vocabulário só.
 *
 * Cinco chegavam aqui: a gravidade da auditoria (alta/media/baixa), o risco de
 * revisão (alto/medio/baixo/nenhum) e o grau do bloco de riscos que o modelo
 * escreve (Impeditivo/Elevado/Moderado/Ponto de atenção).
 *
 * A tradução da TELA já casava por radical; a do SERVIDOR — a que escreve a
 * coluna de riscos da planilha e o `riscos` do 'salvar' — casava por igualdade
 * exata, e por isso "média", "Alta " e "ALTA." caíam no degrau mais fraco. O
 * documento que alguém lê seis meses depois é o do servidor.
 */
describe('normalizarGrau', () => {
  // O RADICAL É O PONTO: a auditoria escreve no feminino ("alta") e o bloco de
  // riscos no masculino ("Alto"). Casar a palavra inteira errava um dos dois.
  it('feminino e masculino dão o mesmo grau', () => {
    expect(normalizarGrau('alta')).toBe('ALTO')
    expect(normalizarGrau('Alto')).toBe('ALTO')
    expect(normalizarGrau('ALTA')).toBe('ALTO')
    expect(normalizarGrau('Elevado')).toBe('ALTO')
  })

  it('acento, espaço e ponto não mudam o grau', () => {
    expect(normalizarGrau('média')).toBe('MODERADO')
    expect(normalizarGrau('media')).toBe('MODERADO')
    expect(normalizarGrau(' Alta ')).toBe('ALTO')
    expect(normalizarGrau('ALTA.')).toBe('ALTO')
    expect(normalizarGrau('Moderado')).toBe('MODERADO')
  })

  it('o impeditivo tem degrau próprio', () => {
    expect(normalizarGrau('IMPEDITIVO')).toBe('IMPEDITIVO')
    expect(normalizarGrau('impeditiva')).toBe('IMPEDITIVO')
  })

  it('nota e nenhum não são atenção', () => {
    expect(normalizarGrau('nota')).toBe('NOTA')
    expect(normalizarGrau('nenhum')).toBe('NOTA')
  })

  // O QUE NÃO SE RECONHECE VIRA ATENÇÃO, e não some: risco sem grau legível
  // continua sendo risco, e some da lista se for filtrado por grau.
  it('o desconhecido cai em atenção', () => {
    expect(normalizarGrau('baixa')).toBe('ATENÇÃO')
    expect(normalizarGrau('Ponto de atenção')).toBe('ATENÇÃO')
    expect(normalizarGrau('')).toBe('ATENÇÃO')
    expect(normalizarGrau(null)).toBe('ATENÇÃO')
    expect(normalizarGrau(undefined)).toBe('ATENÇÃO')
    expect(normalizarGrau(42)).toBe('ATENÇÃO')
  })

  it('a ordem vai do mais grave ao menos', () => {
    const graus = (['NOTA', 'ALTO', 'ATENÇÃO', 'IMPEDITIVO', 'MODERADO'] as const)
      .slice()
      .sort((a, b) => ORDEM_GRAU[a] - ORDEM_GRAU[b])
    expect(graus).toEqual(['IMPEDITIVO', 'ALTO', 'MODERADO', 'ATENÇÃO', 'NOTA'])
  })
})

describe('grauDaPlanilha', () => {
  // A COLUNA DA PLANILHA TEM TRÊS DEGRAUS, que é o que a lista suspensa aceita.
  it('a gravidade da auditoria chega no degrau certo', () => {
    expect(grauDaPlanilha('alta')).toBe('ALTO')
    expect(grauDaPlanilha('média')).toBe('MODERADO')
    expect(grauDaPlanilha('media')).toBe('MODERADO')
    expect(grauDaPlanilha('baixa')).toBe('PONTO DE ATENÇÃO')
  })

  // O DEFEITO QUE ISTO TRAVA: com igualdade exata, os três primeiros casos
  // abaixo saíam como "PONTO DE ATENÇÃO" — o achado que derruba o crédito com o
  // mesmo selo apagado de uma imprecisão sem efeito no valor.
  it('a variação de escrita não rebaixa mais o achado', () => {
    for (const escrito of ['ALTA', 'Alta ', 'ALTA.', 'Alto', 'elevada']) {
      expect(grauDaPlanilha(escrito)).toBe('ALTO')
    }
  })

  it('impeditivo desce para alto, que é o teto da planilha', () => {
    expect(grauDaPlanilha('Impeditivo')).toBe('ALTO')
  })

  it('sem grau legível, ponto de atenção', () => {
    expect(grauDaPlanilha(null)).toBe('PONTO DE ATENÇÃO')
    expect(grauDaPlanilha('')).toBe('PONTO DE ATENÇÃO')
  })
})
