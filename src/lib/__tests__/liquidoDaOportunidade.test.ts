/**
 * O VALOR LÍQUIDO VALIDADO, lido da nota de oportunidade do card — a base do
 * spread desde 06/10/2026 ("o spread tem que ser sobre o valor líquido
 * validado"). Qual nota, qual rótulo, qual valor; e o que fica de fora.
 */
import { describe, it, expect } from 'vitest'
import {
  liquidoDaNota,
  liquidoValidadoDasNotas,
  lerValorDoRotulo,
  origemDoLiquido,
} from '../../../supabase/functions/_shared/liquidoDaOportunidade.ts'
import { resumoDaOportunidade } from '../../../supabase/functions/_shared/anotacaoKommo.ts'
import { marcarComoDePessoa } from '../../../supabase/functions/_shared/notaCredijuris.ts'

const nota = (texto: string, criado_em: string | null = '2026-10-03T14:00:00Z') => ({ texto, criado_em })

describe('liquidoDaNota — qual nota e qual rótulo', () => {
  it('a nota que a plataforma escreve (resumoDaOportunidade), com a linha do Drive antes e a assinatura depois', () => {
    const texto = marcarComoDePessoa(
      resumoDaOportunidade({
        ficha: { tipo: 'Precatório', tribunal: 'TJSP', uf: 'SP', cedente: 'ACME', valor_cedido: 800000 },
        link: 'https://drive.google.com/x',
      }),
      'Fulana',
    )
    expect(texto.startsWith('Planilha e análise no Drive')).toBe(true)
    expect(liquidoDaNota(texto)).toEqual({
      centavos: 80_000_000,
      rotulo: 'Valor líquido validado',
      trecho: expect.stringMatching(/^Valor líquido validado: R\$\s800\.000,00$/),
    })
  })

  it('tolera caixa, acento, espaços, marcador de lista, negrito e a assinatura "(Fulana) " na frente', () => {
    for (const t of [
      'OPORTUNIDADE CREDIJURIS\nVALOR LIQUIDO VALIDADO: R$ 800.000,00',
      '  oportunidade:   precatório\n   valor   líquido   validado :  800.000,00',
      '(Fulana) Oportunidade Credijuris — RPV\n- Valor líquido validado: R$ 800.000,00',
      '📌 Oportunidade\n• **Valor líquido validado:** R$ 800.000,00',
      'Oi, segue.\n\nOportunidade — crédito\nValor Líquido Validado: R$ 800.000,00',
    ]) {
      expect(liquidoDaNota(t)?.centavos, t).toBe(80_000_000)
    }
  })

  it('sem linha começando por "Oportunidade", a nota não conta (mesmo com o rótulo)', () => {
    expect(liquidoDaNota('Valor líquido validado: R$ 800.000,00')).toBeNull()
    expect(liquidoDaNota('Nova oportunidade de crédito\nValor: R$ 800.000,00')).toBeNull()
    expect(liquidoDaNota('Oportunidades da semana… nada\nValor: 1')).toBeNull()
  })

  it('a precedência: "Valor líquido validado", senão "Valor líquido", senão "Valor" — em qualquer ordem na nota', () => {
    const tres = 'Oportunidade\nValor: R$ 900.000,00\nValor líquido: R$ 850.000,00\nValor líquido validado: R$ 800.000,00'
    expect(liquidoDaNota(tres)).toMatchObject({ centavos: 80_000_000, rotulo: 'Valor líquido validado' })
    const dois = 'Oportunidade\nValor: R$ 900.000,00\nValor líquido: R$ 850.000,00'
    expect(liquidoDaNota(dois)).toMatchObject({ centavos: 85_000_000, rotulo: 'Valor líquido' })
    expect(liquidoDaNota('Oportunidade\nValor: R$ 900.000,00')).toMatchObject({ centavos: 90_000_000, rotulo: 'Valor' })
  })

  it('NÃO pega "Valor de face", "Valor cedido", "Valor atualizado" nem frase sem dois-pontos', () => {
    const t = [
      'Oportunidade Credijuris',
      'Valor de face: R$ 1.000.000,00',
      'Valor cedido: R$ 950.000,00',
      'VALOR ATUALIZADO: R$ 1.100.000,00',
      'Valor líquido validado pelo jurídico em 02/10',
      'Valor da causa: R$ 2.000.000,00',
    ].join('\n')
    expect(liquidoDaNota(t)).toBeNull()
  })

  it('o rótulo legível vale; o mesmo rótulo ilegível não esconde um rótulo menor legível', () => {
    const t = 'Oportunidade\nValor líquido validado: a confirmar\nValor líquido: R$ 850.000,00'
    expect(liquidoDaNota(t)).toMatchObject({ centavos: 85_000_000, rotulo: 'Valor líquido' })
  })
})

describe('lerValorDoRotulo — o dinheiro, só o que é seguro', () => {
  it('lê os formatos de BRL', () => {
    expect(lerValorDoRotulo(' R$ 1.234.567,89')).toBe(123_456_789)
    expect(lerValorDoRotulo('1.234.567,89')).toBe(123_456_789)
    expect(lerValorDoRotulo('R$ 800 mil')).toBe(80_000_000)
    expect(lerValorDoRotulo('R$ 800.000,00')).toBe(80_000_000)
    expect(lerValorDoRotulo('** R$ 800.000,00')).toBe(80_000_000)
  })
  it('com comentário depois, o único valor em dinheiro', () => {
    expect(lerValorDoRotulo('R$ 800.000,00 (conferido em 02/10/2026)')).toBe(80_000_000)
    expect(lerValorDoRotulo('R$ 800.000,00 · líquido de IR (27,5%)')).toBe(80_000_000)
  })
  it('o que tem duas leituras, ou dois valores, ou nenhum, fica de fora', () => {
    expect(lerValorDoRotulo('R$ 800.000,00 a R$ 820.000,00')).toBeNull()
    expect(lerValorDoRotulo('850.5')).toBeNull()
    expect(lerValorDoRotulo('a confirmar')).toBeNull()
    expect(lerValorDoRotulo('')).toBeNull()
    expect(lerValorDoRotulo('R$ 0,00')).toBeNull()
  })
})

describe('liquidoValidadoDasNotas — entre as notas do card', () => {
  it('a mais nova vale (a casa revalidou o crédito), na ordem que for', () => {
    const notas = [
      nota('Oportunidade\nValor líquido validado: R$ 900.000,00', '2026-10-05T09:00:00Z'),
      nota('Oportunidade\nValor líquido validado: R$ 700.000,00', '2026-09-20T09:00:00Z'),
      nota('Seguir com a proposta do BTG.', '2026-10-06T09:00:00Z'),
    ]
    const l = liquidoValidadoDasNotas(notas)
    expect(l).toMatchObject({ centavos: 90_000_000, criadoEm: '2026-10-05T09:00:00Z', data: '05/10/2026' })
    expect(liquidoValidadoDasNotas([...notas].reverse())?.centavos).toBe(90_000_000)
  })

  it('a nota de oportunidade mais nova SEM valor legível não apaga a anterior', () => {
    const l = liquidoValidadoDasNotas([
      nota('Oportunidade\nValor líquido validado: R$ 800.000,00', '2026-10-03T14:00:00Z'),
      nota('Oportunidade (rascunho)\nValor: a definir', '2026-10-04T14:00:00Z'),
    ])
    expect(l?.centavos).toBe(80_000_000)
  })

  it('a data é a de Brasília: 03/10 às 23h30 de Brasília é 04/10 em UTC', () => {
    expect(liquidoValidadoDasNotas([nota('Oportunidade\nValor: R$ 1,00', '2026-10-04T02:30:00Z')])?.data).toBe('03/10/2026')
  })

  it('nota sem data conta como a mais antiga; e a origem diz a data quando há', () => {
    const l = liquidoValidadoDasNotas([
      nota('Oportunidade\nValor: R$ 2,00', null),
      nota('Oportunidade\nValor: R$ 1,00', '2026-10-01T12:00:00Z'),
    ])
    expect(l?.centavos).toBe(100)
    expect(origemDoLiquido(l!)).toBe('da nota de oportunidade de 01/10/2026')
    const semData = liquidoValidadoDasNotas([nota('Oportunidade\nValor: R$ 2,00', null)])
    expect(semData).toMatchObject({ centavos: 200, criadoEm: null, data: '' })
    expect(origemDoLiquido(semData!)).toBe('da nota de oportunidade')
  })

  it('sem notas, ou sem nota de oportunidade: null', () => {
    expect(liquidoValidadoDasNotas(null)).toBeNull()
    expect(liquidoValidadoDasNotas([])).toBeNull()
    expect(liquidoValidadoDasNotas([nota('VALOR CEDIDO: R$ 800.000,00'), { texto: null }])).toBeNull()
  })
})
