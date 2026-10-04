// As contas dos gráficos novos do Quadro (evolução, histograma) e as iniciais do
// avatar. São só tela — nada grava —, mas número errado num gráfico financeiro
// engana do mesmo jeito que numa tabela.

import { describe, it, expect } from 'vitest'
import {
  evolucaoDaCarteira,
  distribuicaoDoRetorno,
  brlAbreviado,
  valorAbreviado,
  cabeRotuloNaBarra,
} from '@/lib/graficosDoQuadro'
import { restaAlemDaBorda } from '@/lib/rolagemLateral'
import { iniciais } from '@/lib/iniciais'

const op = (
  dataAquisicao: string | null,
  capitalInvestido: number | null,
  dataLiquidacao: string | null = null,
  jaRecebido: number | null = null,
) => ({ dataAquisicao, capitalInvestido, dataLiquidacao, jaRecebido })

describe('evolucaoDaCarteira', () => {
  it('doze meses, do mais antigo ao mês de hoje, atravessando a virada do ano', () => {
    const e = evolucaoDaCarteira([], '2026-03-15')
    expect(e).toHaveLength(12)
    expect(e[0].mes).toBe('2025-04')
    expect(e[11].mes).toBe('2026-03')
  })

  it('acumula o capital pela data de cessão e o recebido pela de liquidação', () => {
    const e = evolucaoDaCarteira(
      [
        op('2025-12-10', 100),
        op('2026-01-31', 50, '2026-02-01', 80), // fim do mês entra no próprio mês
        op('2026-02-28', 25),
      ],
      '2026-02-20',
      3,
    )
    expect(e.map((p) => p.mes)).toEqual(['2025-12', '2026-01', '2026-02'])
    expect(e.map((p) => p.capital)).toEqual([100, 150, 175])
    expect(e.map((p) => p.recebido)).toEqual([0, 0, 80])
  })

  it('sem data ou sem valor fica fora da linha, em vez de cair num mês qualquer', () => {
    const e = evolucaoDaCarteira(
      [op(null, 999), op('2026-01-05', null), op('2026-01-05', 10, null, 500), op('2026-01-05', 10, '2026-01-20', null)],
      '2026-01-31',
      1,
    )
    expect(e[0].capital).toBe(20)
    expect(e[0].recebido).toBe(0)
  })

  it('aceita data com hora (timestamp) sem errar o mês', () => {
    const e = evolucaoDaCarteira([op('2026-01-31T23:00:00', 10)], '2026-02-10', 2)
    expect(e.map((p) => p.capital)).toEqual([10, 10])
  })
})

describe('distribuicaoDoRetorno', () => {
  it('as sete faixas da amostra, com os limites fechados no lugar certo', () => {
    const d = distribuicaoDoRetorno(
      [-0.1, 0, 0.199, 0.2, 0.5, 0.79, 0.8, 1, 1.0001, 3].map((retorno) => ({ retorno })),
    )
    expect(d.map((f) => f.rotulo)).toEqual(['< 0%', '0–20%', '20–40%', '40–60%', '60–80%', '80–100%', '> 100%'])
    expect(d.map((f) => f.operacoes)).toEqual([1, 2, 1, 1, 1, 2, 2])
  })

  it('operação sem retorno não vira zero', () => {
    const d = distribuicaoDoRetorno([{ retorno: null }, { retorno: Number.NaN }, { retorno: 0.1 }])
    expect(d.reduce((s, f) => s + f.operacoes, 0)).toBe(1)
  })
})

describe('brlAbreviado', () => {
  it('milhões com uma casa, milhares sem casa, o resto inteiro', () => {
    expect(brlAbreviado(16_512_702.29)).toBe('R$ 16,5 mi')
    expect(brlAbreviado(820_400)).toBe('R$ 820 mil')
    expect(brlAbreviado(950)).toBe('R$ 950')
    expect(brlAbreviado(0)).toBe('R$ 0')
  })
})

describe('valorAbreviado (o rótulo acima da barra das Previsões, Q1)', () => {
  it('o mesmo número do brlAbreviado, sem o "R$"', () => {
    expect(valorAbreviado(84_300)).toBe('84 mil')
    expect(valorAbreviado(1_300_000)).toBe('1,3 mi')
    expect(valorAbreviado(950)).toBe('950')
    expect(brlAbreviado(84_300)).toBe('R$ ' + valorAbreviado(84_300))
  })

  it('valor que não é número vira o traço, e não "NaN mil"', () => {
    expect(valorAbreviado(Number.NaN)).toBe('—')
    expect(brlAbreviado(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('cabeRotuloNaBarra', () => {
  it('cabe com pelo menos 40px por mês; abaixo disso, nenhum rótulo', () => {
    expect(cabeRotuloNaBarra(800, 20)).toBe(true) // 40px
    expect(cabeRotuloNaBarra(799, 20)).toBe(false)
    expect(cabeRotuloNaBarra(300, 4, 80)).toBe(false)
  })

  it('largura ainda não medida, ou nenhum mês, não cabe', () => {
    expect(cabeRotuloNaBarra(0, 12)).toBe(false)
    expect(cabeRotuloNaBarra(Number.NaN, 12)).toBe(false)
    expect(cabeRotuloNaBarra(900, 0)).toBe(false)
  })
})

describe('restaAlemDaBorda (a pista de rolagem lateral, Q2)', () => {
  it('há coluna escondida à direita enquanto não chegou ao fim', () => {
    expect(restaAlemDaBorda(0, 800, 1200)).toBe(true)
    expect(restaAlemDaBorda(390, 800, 1200)).toBe(true)
    expect(restaAlemDaBorda(400, 800, 1200)).toBe(false)
  })

  it('tabela que cabe inteira não tem pista, e o arredondamento do zoom não engana', () => {
    expect(restaAlemDaBorda(0, 800, 800)).toBe(false)
    expect(restaAlemDaBorda(399.4, 800, 1200)).toBe(false)
  })
})

describe('iniciais', () => {
  it('primeira letra do primeiro e do último nome', () => {
    expect(iniciais('Pedro Henrique Alves')).toBe('PA')
    expect(iniciais('josé da silva')).toBe('JS')
    expect(iniciais('Ércio')).toBe('É')
  })

  it('o sufixo de empresa não conta', () => {
    expect(iniciais('Atlas Capital Ltda.')).toBe('AC')
    expect(iniciais('Fundo Beta S/A')).toBe('FB')
  })

  it('nome vazio não deixa o círculo em branco', () => {
    expect(iniciais('')).toBe('?')
    expect(iniciais(null)).toBe('?')
    expect(iniciais('   ')).toBe('?')
  })
})
