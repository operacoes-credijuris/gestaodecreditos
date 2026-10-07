/**
 * A COTAÇÃO DO FUNDO: o texto que vai para o campo do card no Kommo, a leitura
 * de volta (tolerante ao que alguém digitou lá) e o campo achado pelo nome.
 *
 * O texto gravado é EXATAMENTE "R$ 850.000,00 / R$ 40.000,00" ou
 * "R$ 850.000,00 / Spread" — pedido do dono em 05/10/2026. E, no spread com o
 * percentual (o pedido seguinte, no mesmo dia), "R$ 807.500,00 / R$ 42.500,00
 * (Spread de 5%)": a final, a comissão e o percentual, com a conta em centavos.
 */
import { describe, it, expect } from 'vitest'
import {
  calcularSpread,
  campoDoFundo,
  chaveDoNome,
  comCotacaoGravada,
  cotacoesDoCard,
  ehGrupoDasCotacoes,
  formatarPercentual,
  formatarReais,
  inicioDaCotacao,
  lerCotacao,
  lerPercentual,
  lerReais,
  resumoDoSpread,
  textoDaCotacao,
  validarCotacao,
  valorDigitadoDaCotacao,
  type CampoDoKommo,
  type Cotacao,
} from '../../../supabase/functions/_shared/cotacaoDoFundo.ts'
import { FUNDOS_DA_PRECIFICACAO } from '../../../supabase/functions/_shared/etiquetasDoFundo.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('formatarReais', () => {
  it('ponto de milhar, vírgula e espaço COMUM depois do R$', () => {
    expect(formatarReais(123456789)).toBe('R$ 1.234.567,89')
    expect(formatarReais(85000000)).toBe('R$ 850.000,00')
    expect(formatarReais(5)).toBe('R$ 0,05')
    expect(formatarReais(100000)).toBe('R$ 1.000,00')
    expect(formatarReais(99900)).toBe('R$ 999,00')
    expect(formatarReais(85000000)).not.toContain(' ')
  })
})

describe('lerReais (centavos)', () => {
  it.each([
    ['850000', 85000000],
    ['850.000', 85000000],
    ['850.000,00', 85000000],
    ['R$ 850.000,00', 85000000],
    ['R$ 850.000,00', 85000000],
    ['r$850.000,5', 85000050],
    ['850000,5', 85000050],
    ['850000.00', 85000000],
    ['1.234.567,89', 123456789],
    ['850 mil', 85000000],
    ['R$ 850 mil', 85000000],
    ['1,5 mi', 150000000],
    ['1.5 milhão', 150000000],
    ['2 milhões', 200000000],
    ['1.500 mil', 150000000],
    ['40.000', 4000000],
  ])('%s', (texto, centavos) => {
    expect(lerReais(texto)).toBe(centavos)
  })

  it.each(['', '   ', 'abc', '850.5', '1.23.456', '12,345', '850,000.00', 'R$', '-', '850 reais e pouco'])(
    'recusa o que tem duas leituras ou não é número: %j',
    (texto) => {
      expect(lerReais(texto)).toBeNull()
    },
  )

  it('volta o que formatarReais escreveu', () => {
    for (const c of [1, 99, 100, 85000000, 123456789, 4000000]) {
      expect(lerReais(formatarReais(c))).toBe(c)
    }
  })
})

describe('textoDaCotacao', () => {
  it('limitada: proposta / comissão em reais', () => {
    expect(
      textoDaCotacao({ propostaCentavos: 85000000, comissao: { modalidade: 'limitada', centavos: 4000000 } }),
    ).toBe('R$ 850.000,00 / R$ 40.000,00')
  })
  it('spread: proposta / Spread', () => {
    expect(textoDaCotacao({ propostaCentavos: 85000000, comissao: { modalidade: 'spread' } })).toBe(
      'R$ 850.000,00 / Spread',
    )
  })
})

describe('validarCotacao', () => {
  it('aceita as duas modalidades', () => {
    expect(validarCotacao({ propostaCentavos: 100, comissao: { modalidade: 'spread' } }).ok).toBe(true)
    expect(validarCotacao({ propostaCentavos: 100, comissao: { modalidade: 'limitada', centavos: 10 } }).ok).toBe(
      true,
    )
  })
  it('recusa proposta ausente, zero, negativa ou fracionada', () => {
    for (const p of [undefined, 0, -1, 10.5, '100', NaN]) {
      expect(validarCotacao({ propostaCentavos: p, comissao: { modalidade: 'spread' } }).ok).toBe(false)
    }
  })
  it('limitada sem valor é recusada', () => {
    const r = validarCotacao({ propostaCentavos: 100, comissao: { modalidade: 'limitada' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/comissão/)
  })
  it('modalidade desconhecida é recusada', () => {
    expect(validarCotacao({ propostaCentavos: 100, comissao: { modalidade: 'fixa' } }).ok).toBe(false)
    expect(validarCotacao({ propostaCentavos: 100 }).ok).toBe(false)
    expect(validarCotacao(null).ok).toBe(false)
  })
})

describe('lerCotacao (o texto do campo, de volta)', () => {
  it('lê o que a plataforma grava', () => {
    expect(lerCotacao('R$ 850.000,00 / R$ 40.000,00')).toEqual({
      texto: 'R$ 850.000,00 / R$ 40.000,00',
      proposta: 85000000,
      comissao: { modalidade: 'limitada', centavos: 4000000 },
    })
    expect(lerCotacao('R$ 850.000,00 / Spread')).toEqual({
      texto: 'R$ 850.000,00 / Spread',
      proposta: 85000000,
      comissao: { modalidade: 'spread' },
    })
  })

  it('tolera o que alguém digitou no Kommo', () => {
    expect(lerCotacao('850 mil / 40 mil')).toMatchObject({
      proposta: 85000000,
      comissao: { modalidade: 'limitada', centavos: 4000000 },
    })
    expect(lerCotacao('R$ 850.000 - spread')).toMatchObject({ proposta: 85000000, comissao: { modalidade: 'spread' } })
    expect(lerCotacao('850000 spread')).toMatchObject({ proposta: 85000000, comissao: { modalidade: 'spread' } })
    expect(lerCotacao('Proposta: 850.000,00 | Comissão: 40.000,00')).toMatchObject({
      proposta: 85000000,
      comissao: { modalidade: 'limitada', centavos: 4000000 },
    })
    expect(lerCotacao('R$ 850.000,00')).toMatchObject({ proposta: 85000000, comissao: null })
  })

  it('texto sem número fica como texto, sem valor adivinhado', () => {
    expect(lerCotacao('aguardando o comitê')).toEqual({
      texto: 'aguardando o comitê',
      proposta: null,
      comissao: null,
    })
  })

  it('campo vazio (ou o "..." do Kommo) é null', () => {
    for (const t of [null, undefined, '', '   ', '...', '…', '-']) expect(lerCotacao(t)).toBeNull()
  })

  it('volta exatamente o que textoDaCotacao escreveu', () => {
    const casos = [
      { propostaCentavos: 123456789, comissao: { modalidade: 'limitada' as const, centavos: 987654 } },
      { propostaCentavos: 100, comissao: { modalidade: 'spread' as const } },
    ]
    for (const c of casos) {
      const l = lerCotacao(textoDaCotacao(c))
      expect(l?.proposta).toBe(c.propostaCentavos)
      expect(l?.comissao).toEqual(c.comissao)
    }
  })
})

// ------------------------------------------------------------------ o spread com percentual (05/10/2026)

/** A cotação em spread com o percentual em centésimos (5% = 500). */
const spread = (propostaCentavos: number, percentualCentesimos: number): Cotacao => ({
  propostaCentavos,
  comissao: { modalidade: 'spread', percentualCentesimos },
})

describe('lerPercentual (o campo do percentual do spread)', () => {
  it.each([
    ['5', 500],
    ['5,5', 550],
    ['12,25', 1225],
    ['0,05', 5],
    ['99,99', 9999],
    ['5,', 500],
    ['05', 500],
    ['5%', 500],
    [' 5,5 % ', 550],
    ['5.5', 550],
  ])('%j → %i centésimos', (texto, centesimos) => {
    expect(lerPercentual(texto)).toEqual({ ok: true, centesimos })
  })

  it.each([
    ['', 'vazio'],
    ['   ', 'vazio'],
    ['0', 'zero'],
    ['0,00', 'zero'],
    ['100', 'teto'],
    ['100,5', 'teto'],
    ['250', 'teto'],
    ['5,555', 'casas'],
    ['12,345', 'casas'],
    ['abc', 'formato'],
    ['-5', 'formato'],
    ['5,5,5', 'formato'],
    ['1.234,5', 'formato'],
  ])('recusa %j (%s), com a mensagem', (texto, motivo) => {
    const r = lerPercentual(texto)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.motivo).toBe(motivo)
      expect(r.erro.length).toBeGreaterThan(10)
    }
  })

  it('as mensagens dizem o limite', () => {
    const msg = (t: string) => {
      const r = lerPercentual(t)
      return r.ok ? '' : r.erro
    }
    expect(msg('0')).toMatch(/maior que 0/)
    expect(msg('100')).toMatch(/menor que 100/)
    expect(msg('5,555')).toMatch(/duas casas/)
  })
})

describe('formatarPercentual', () => {
  it('sem zeros à toa, com vírgula', () => {
    expect(formatarPercentual(500)).toBe('5')
    expect(formatarPercentual(550)).toBe('5,5')
    expect(formatarPercentual(1225)).toBe('12,25')
    expect(formatarPercentual(1205)).toBe('12,05')
    expect(formatarPercentual(1000)).toBe('10')
    expect(formatarPercentual(5)).toBe('0,05')
    expect(formatarPercentual(9999)).toBe('99,99')
  })
  it('volta o que lerPercentual leu', () => {
    for (const t of ['5', '5,5', '12,25', '0,05', '99,99', '10']) {
      const r = lerPercentual(t)
      expect(r.ok && formatarPercentual(r.centesimos)).toBe(t)
    }
  })
})

describe('calcularSpread (centavos inteiros, meio para cima)', () => {
  it('o exemplo do dono: R$ 850.000,00 a 5%', () => {
    expect(calcularSpread(85_000_000, 500)).toEqual({ comissaoCentavos: 4_250_000, finalCentavos: 80_750_000 })
  })

  it.each([
    // valor, %, comissão — e por quê
    [1_000, 550, 55], //             R$ 10,00 × 5,5% = 0,55 exato
    [12_345, 1_225, 1_512], //       123,45 × 12,25% = 15,122625 → 15,12 (abaixo da metade)
    [12_346, 1_225, 1_512], //       123,46 × 12,25% = 15,12385 → 15,12
    [10, 500, 1], //                 0,10 × 5% = 0,005 → meio centavo SOBE para 0,01
    [30, 500, 2], //                 0,30 × 5% = 0,015 → 0,02 (meio para cima, não para o par)
    [50, 500, 3], //                 0,50 × 5% = 0,025 → 0,03 (o "para o par" daria 0,02)
    [9, 500, 0], //                  0,09 × 5% = 0,0045 → 0,00 (abaixo da metade)
    [99_999, 333, 3_330], //         999,99 × 3,33% = 33,299667 → 33,30
    [100_001, 1, 10], //             1.000,01 × 0,01% = 0,1000001 → 0,10
    [123_456_789, 9_999, 123_444_443], // 1.234.567,89 × 99,99% = 1.234.444,433211 → 1.234.444,43
  ])('%i centavos a %i centésimos → comissão %i', (valor, pct, comissao) => {
    const r = calcularSpread(valor, pct)
    expect(r.comissaoCentavos).toBe(comissao)
    expect(r.finalCentavos).toBe(valor - comissao)
    // A conferência por outro caminho (BigInt, sem ponto flutuante).
    const esperado = (BigInt(valor) * BigInt(pct) + 5_000n) / 10_000n
    expect(BigInt(r.comissaoCentavos)).toBe(esperado)
  })

  it('perto do teto (R$ 1 trilhão × 99,99%), a conta não estoura o inteiro seguro', () => {
    const valor = 100_000_000_000_000
    const r = calcularSpread(valor - 1, 9_999)
    const esperado = (BigInt(valor - 1) * 9_999n + 5_000n) / 10_000n
    expect(BigInt(r.comissaoCentavos)).toBe(esperado)
    expect(r.comissaoCentavos + r.finalCentavos).toBe(valor - 1)
  })

  it('comissão + final é sempre o valor, em centenas de casos', () => {
    for (let v = 1; v < 400_000; v += 997) {
      for (const p of [1, 99, 500, 550, 1_225, 3_333, 9_999]) {
        const r = calcularSpread(v, p)
        expect(r.comissaoCentavos + r.finalCentavos).toBe(v)
        expect(BigInt(r.comissaoCentavos)).toBe((BigInt(v) * BigInt(p) + 5_000n) / 10_000n)
      }
    }
  })
})

describe('textoDaCotacao — o spread com percentual', () => {
  it('o exemplo do dono, EXATO', () => {
    expect(textoDaCotacao(spread(85_000_000, 500))).toBe('R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)')
  })
  it('percentual com casas, sem zeros à toa', () => {
    expect(textoDaCotacao(spread(85_000_000, 550))).toBe('R$ 803.250,00 / R$ 46.750,00 (Spread de 5,5%)')
    expect(textoDaCotacao(spread(100_000_000, 1_225))).toBe('R$ 877.500,00 / R$ 122.500,00 (Spread de 12,25%)')
    expect(textoDaCotacao(spread(100_000_000, 1_000))).toBe('R$ 900.000,00 / R$ 100.000,00 (Spread de 10%)')
  })
  it('com arredondamento: R$ 123,45 a 12,25%', () => {
    expect(textoDaCotacao(spread(12_345, 1_225))).toBe('R$ 108,33 / R$ 15,12 (Spread de 12,25%)')
  })
  it('espaço COMUM em todo o texto', () => {
    expect(textoDaCotacao(spread(85_000_000, 500))).not.toMatch(/[\u00a0\u202f]/)
  })
  it('spread SEM percentual (a tela antiga): o formato antigo', () => {
    expect(textoDaCotacao({ propostaCentavos: 85_000_000, comissao: { modalidade: 'spread' } })).toBe(
      'R$ 850.000,00 / Spread',
    )
  })
  it('a limitada NÃO muda', () => {
    expect(
      textoDaCotacao({ propostaCentavos: 85_000_000, comissao: { modalidade: 'limitada', centavos: 4_000_000 } }),
    ).toBe('R$ 850.000,00 / R$ 40.000,00')
  })
})

describe('resumoDoSpread (a linha da prévia)', () => {
  it('a comissão com o percentual e a proposta final', () => {
    const r = resumoDoSpread(spread(85_000_000, 500))
    expect(r).toEqual({ comissao: 'Comissão (5%): R$ 42.500,00', final: 'Proposta final: R$ 807.500,00' })
    expect(`${r!.comissao} · ${r!.final}`).toBe('Comissão (5%): R$ 42.500,00 · Proposta final: R$ 807.500,00')
  })
  it('fora do spread com percentual, null', () => {
    expect(resumoDoSpread({ propostaCentavos: 1, comissao: { modalidade: 'spread' } })).toBeNull()
    expect(resumoDoSpread({ propostaCentavos: 2, comissao: { modalidade: 'limitada', centavos: 1 } })).toBeNull()
  })
})

describe('validarCotacao — o formato de entrada com o percentual', () => {
  it('spread com percentual: aceito, e o texto sai da conta do servidor', () => {
    const r = validarCotacao({ propostaCentavos: 85_000_000, comissao: { modalidade: 'spread', percentualCentesimos: 500 } })
    expect(r).toEqual({ ok: true, cotacao: spread(85_000_000, 500) })
    if (r.ok) expect(textoDaCotacao(r.cotacao)).toBe('R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)')
  })

  it('o que vier a mais (um texto pronto, uma comissão) é ignorado: o servidor recalcula', () => {
    const r = validarCotacao({
      propostaCentavos: 85_000_000,
      texto: 'R$ 1,00 / R$ 0,01 (Spread de 5%)',
      comissao: { modalidade: 'spread', percentualCentesimos: 500, centavos: 1 },
    })
    expect(r).toEqual({ ok: true, cotacao: spread(85_000_000, 500) })
  })

  it('A TELA ANTIGA (spread sem percentual) continua aceita, e grava o formato antigo', () => {
    for (const comissao of [{ modalidade: 'spread' }, { modalidade: 'spread', percentualCentesimos: null }]) {
      const r = validarCotacao({ propostaCentavos: 85_000_000, comissao })
      expect(r).toEqual({ ok: true, cotacao: { propostaCentavos: 85_000_000, comissao: { modalidade: 'spread' } } })
      if (r.ok) expect(textoDaCotacao(r.cotacao)).toBe('R$ 850.000,00 / Spread')
    }
  })

  it('a tela nova exige o percentual (exigirPercentualNoSpread)', () => {
    const r = validarCotacao(
      { propostaCentavos: 85_000_000, comissao: { modalidade: 'spread' } },
      { exigirPercentualNoSpread: true },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/percentual/)
    expect(validarCotacao(spread(85_000_000, 500), { exigirPercentualNoSpread: true }).ok).toBe(true)
  })

  it('percentual presente e fora da faixa: recusado sempre (0, 100, fração, texto, negativo)', () => {
    for (const p of [0, 10_000, 12_000, 5.5, '500', -1, NaN]) {
      const r = validarCotacao({ propostaCentavos: 85_000_000, comissao: { modalidade: 'spread', percentualCentesimos: p } })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.erro).toMatch(/maior que 0 e menor que 100/)
    }
  })

  it('valor pequeno demais para o percentual (comissão ou final abaixo de um centavo): recusado', () => {
    expect(validarCotacao(spread(9, 500)).ok).toBe(false) // comissão 0
    expect(validarCotacao(spread(1, 5_000)).ok).toBe(false) // comissão 1, final 0
    expect(validarCotacao(spread(10, 500)).ok).toBe(true) // comissão 1, final 9
  })
})

describe('lerCotacao — os três formatos', () => {
  it('spread NOVO: a final, a comissão e o percentual', () => {
    expect(lerCotacao('R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)')).toEqual({
      texto: 'R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)',
      proposta: 80_750_000,
      comissao: { modalidade: 'spread', percentualCentesimos: 500, centavos: 4_250_000 },
    })
    expect(lerCotacao('R$ 877.500,00 / R$ 122.500,00 (Spread de 12,25%)')?.comissao).toEqual({
      modalidade: 'spread',
      percentualCentesimos: 1_225,
      centavos: 12_250_000,
    })
  })

  it('spread ANTIGO: como hoje (o valor, sem comissão)', () => {
    expect(lerCotacao('R$ 850.000,00 / Spread')).toEqual({
      texto: 'R$ 850.000,00 / Spread',
      proposta: 85_000_000,
      comissao: { modalidade: 'spread' },
    })
  })

  it('limitada: como hoje', () => {
    expect(lerCotacao('R$ 850.000,00 / R$ 40.000,00')).toEqual({
      texto: 'R$ 850.000,00 / R$ 40.000,00',
      proposta: 85_000_000,
      comissao: { modalidade: 'limitada', centavos: 4_000_000 },
    })
  })

  it('tolera o spread novo digitado à mão', () => {
    expect(lerCotacao('807.500 / 42.500 (spread 5%)')).toMatchObject({
      proposta: 80_750_000,
      comissao: { modalidade: 'spread', percentualCentesimos: 500, centavos: 4_250_000 },
    })
    expect(lerCotacao('r$ 807.500,00 / r$ 42.500,00 (SPREAD DE 5,5 %)')).toMatchObject({
      comissao: { modalidade: 'spread', percentualCentesimos: 550, centavos: 4_250_000 },
    })
    expect(lerCotacao('807,5 mil | 42,5 mil spread de 5%')).toMatchObject({
      proposta: 80_750_000,
      comissao: { modalidade: 'spread', percentualCentesimos: 500, centavos: 4_250_000 },
    })
    // A comissão em reais sem o percentual: lê a comissão, o percentual fica sem.
    expect(lerCotacao('R$ 807.500,00 / R$ 42.500,00 (Spread)')?.comissao).toEqual({
      modalidade: 'spread',
      centavos: 4_250_000,
    })
  })

  it('o percentual sem a comissão em reais: o valor é o da proposta, como no antigo', () => {
    expect(lerCotacao('850 mil / spread de 5%')).toEqual({
      texto: '850 mil / spread de 5%',
      proposta: 85_000_000,
      comissao: { modalidade: 'spread', percentualCentesimos: 500 },
    })
    expect(lerCotacao('850000 spread 5%')).toMatchObject({
      proposta: 85_000_000,
      comissao: { modalidade: 'spread', percentualCentesimos: 500 },
    })
  })

  it('percentual impossível escrito à mão fica de fora (o resto se lê)', () => {
    expect(lerCotacao('R$ 807.500,00 / R$ 42.500,00 (Spread de 150%)')?.comissao).toEqual({
      modalidade: 'spread',
      centavos: 4_250_000,
    })
  })

  it('volta exatamente o que textoDaCotacao escreveu, nos três formatos', () => {
    for (const c of [
      spread(85_000_000, 500),
      spread(12_345, 1_225),
      spread(123_456_789, 9_999),
      { propostaCentavos: 85_000_000, comissao: { modalidade: 'spread' as const } },
      { propostaCentavos: 85_000_000, comissao: { modalidade: 'limitada' as const, centavos: 4_000_000 } },
    ]) {
      const l = lerCotacao(textoDaCotacao(c))
      // O valor que a pessoa digitou volta inteiro (a final + a comissão).
      expect(valorDigitadoDaCotacao(l)).toBe(c.propostaCentavos)
      if (c.comissao.modalidade === 'spread' && c.comissao.percentualCentesimos !== undefined) {
        const conta = calcularSpread(c.propostaCentavos, c.comissao.percentualCentesimos)
        expect(l?.proposta).toBe(conta.finalCentavos)
        expect(l?.comissao).toEqual({
          modalidade: 'spread',
          percentualCentesimos: c.comissao.percentualCentesimos,
          centavos: conta.comissaoCentavos,
        })
      } else {
        expect(l?.proposta).toBe(c.propostaCentavos)
        expect(l?.comissao).toEqual(c.comissao)
      }
    }
  })
})

describe('valorDigitadoDaCotacao (o pré-preenchimento ao recotar)', () => {
  it('spread novo: a final + a comissão', () => {
    expect(valorDigitadoDaCotacao(lerCotacao('R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)'))).toBe(85_000_000)
  })
  it('spread antigo e limitada: o valor como está', () => {
    expect(valorDigitadoDaCotacao(lerCotacao('R$ 850.000,00 / Spread'))).toBe(85_000_000)
    expect(valorDigitadoDaCotacao(lerCotacao('R$ 850.000,00 / R$ 40.000,00'))).toBe(85_000_000)
  })
  it('sem cotação, ou ilegível: null', () => {
    expect(valorDigitadoDaCotacao(null)).toBeNull()
    expect(valorDigitadoDaCotacao(lerCotacao('aguardando o comitê'))).toBeNull()
  })
})

describe('o campo do fundo, pelo nome', () => {
  const grupos = [
    { id: 'leads_1', name: 'Principal' },
    { id: 'leads_9', name: 'Cotações/propostas' },
  ]
  const campo = (id: number, name: string, group_id: string | null = 'leads_9', type = 'text'): CampoDoKommo => ({
    id,
    name,
    type,
    group_id,
  })

  it('a chave ignora caixa, acento e símbolo', () => {
    expect(chaveDoNome('PJUS')).toBe(chaveDoNome('PJus'))
    expect(chaveDoNome('K&WC Ativos')).toBe(chaveDoNome('K & WC Ativos'))
    expect(chaveDoNome('Invest Precatorios')).toBe(chaveDoNome('Invest Precatórios'))
  })

  it('o grupo é reconhecido com ou sem acento e barra', () => {
    for (const n of ['Cotações/propostas', 'Cotacoes / Propostas', 'COTAÇÕES E PROPOSTAS', 'cotações-propostas']) {
      expect(ehGrupoDasCotacoes(n)).toBe(true)
    }
    expect(ehGrupoDasCotacoes('Principal')).toBe(false)
  })

  it('acha os sete fundos, e "PJUS" serve à PJus', () => {
    const campos = [
      campo(1, 'PJUS'),
      campo(2, 'BTG'),
      campo(3, 'PX Ativos'),
      campo(4, 'Invest Precatórios'),
      campo(5, 'K & WC Ativos'),
      campo(6, 'Precatur'),
      campo(7, 'Carbon'),
    ]
    const ids = FUNDOS_DA_PRECIFICACAO.map((f) => {
      const r = campoDoFundo(f, campos, grupos)
      return r.ok ? r.campo.id : null
    })
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('prefere o do grupo Cotações/propostas ao de mesmo nome noutra aba', () => {
    const r = campoDoFundo('BTG', [campo(10, 'BTG', 'leads_1'), campo(11, 'BTG', 'leads_9')], grupos)
    expect(r.ok && r.campo.id).toBe(11)
  })

  it('sem o grupo, vale o de mesmo nome se for um só', () => {
    const r = campoDoFundo('BTG', [campo(10, 'BTG', null)], [])
    expect(r.ok && r.campo.id).toBe(10)
  })

  it('campo ausente: o erro diz qual falta', () => {
    const r = campoDoFundo('Carbon', [campo(2, 'BTG')], grupos)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toContain('"Carbon"')
  })

  it('dois candidatos no mesmo nível: recusa, em vez de adivinhar', () => {
    const r = campoDoFundo('BTG', [campo(10, 'BTG'), campo(11, 'btg')], grupos)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/2 campos/)
  })

  it('campo de tipo que não aceita texto: recusa e diz o tipo', () => {
    const r = campoDoFundo('BTG', [campo(10, 'BTG', 'leads_9', 'numeric')], grupos)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toContain('"numeric"')
    expect(campoDoFundo('BTG', [campo(10, 'BTG', 'leads_9', 'textarea')], grupos).ok).toBe(true)
  })
})

describe('cotacoesDoCard (o que a janela de escolha mostra)', () => {
  it('lê por fundo, pelo nome do campo, e o que falta é null', () => {
    const c = cotacoesDoCard([
      { field_id: 1, field_name: 'PJUS', values: [{ value: 'R$ 850.000,00 / Spread' }] },
      { field_id: 2, field_name: 'BTG', values: [{ value: 'R$ 900.000,00 / R$ 40.000,00' }] },
      { field_id: 9, field_name: 'Telefone', values: [{ value: '11 99999-0000' }] },
    ])
    expect(Object.keys(c)).toEqual([...FUNDOS_DA_PRECIFICACAO])
    expect(c.PJus?.proposta).toBe(85000000)
    expect(c.BTG?.comissao).toEqual({ modalidade: 'limitada', centavos: 4000000 })
    expect(c.Carbon).toBeNull()
  })

  it('com dois campos de mesmo nome, vale o que tem cotação legível', () => {
    const c = cotacoesDoCard([
      { field_id: 1, field_name: 'BTG', values: [{ value: 'cliente pediu retorno' }] },
      { field_id: 2, field_name: 'BTG', values: [{ value: 'R$ 1.000,00 / Spread' }] },
    ])
    expect(c.BTG?.proposta).toBe(100000)
  })

  it('os três formatos lado a lado (a janela "Escolher proposta")', () => {
    const c = cotacoesDoCard([
      { field_id: 1, field_name: 'PJUS', values: [{ value: 'R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)' }] },
      { field_id: 2, field_name: 'BTG', values: [{ value: 'R$ 850.000,00 / R$ 40.000,00' }] },
      { field_id: 3, field_name: 'PX Ativos', values: [{ value: 'R$ 800.000,00 / Spread' }] },
    ])
    expect(c.PJus).toMatchObject({ proposta: 80_750_000, comissao: { modalidade: 'spread', percentualCentesimos: 500, centavos: 4_250_000 } })
    expect(c.BTG).toMatchObject({ proposta: 85_000_000, comissao: { modalidade: 'limitada', centavos: 4_000_000 } })
    expect(c['PX Ativos']).toMatchObject({ proposta: 80_000_000, comissao: { modalidade: 'spread' } })
    expect(c['PX Ativos']?.comissao).toEqual({ modalidade: 'spread' })
  })

  it('card sem campos (null do Kommo) não quebra', () => {
    expect(cotacoesDoCard(null).PJus).toBeNull()
  })

  it('comCotacaoGravada troca só o campo gravado', () => {
    const antes = [
      { field_id: 1, field_name: 'PJUS', values: [{ value: 'velho' }] },
      { field_id: 9, field_name: 'Telefone', values: [{ value: 'x' }] },
    ]
    const depois = comCotacaoGravada(antes, { id: 1, name: 'PJUS' }, 'R$ 1,00 / Spread')
    expect(depois).toHaveLength(2)
    expect(cotacoesDoCard(depois).PJus?.texto).toBe('R$ 1,00 / Spread')
    expect(depois.find((v) => v.field_id === 9)?.values?.[0]?.value).toBe('x')
  })
})

// ------------------------------------------------------------------ o spread sobre o líquido (06/10/2026)
//
// "O spread tem que ser sobre o valor líquido validado": comissão = líquido ×
// percentual, e final = proposta − comissão. O texto do campo é o mesmo.

const sobreLiquido = (proposta: number, pct: number, base: number): Cotacao => ({
  propostaCentavos: proposta,
  comissao: { modalidade: 'spread', percentualCentesimos: pct, baseCentavos: base },
})

describe('o spread sobre o valor líquido validado', () => {
  it('o exemplo do dono, EXATO: proposta 850 mil, líquido 800 mil, 5%', () => {
    expect(calcularSpread(85_000_000, 500, 80_000_000)).toEqual({ comissaoCentavos: 4_000_000, finalCentavos: 81_000_000 })
    const c = sobreLiquido(85_000_000, 500, 80_000_000)
    expect(textoDaCotacao(c)).toBe('R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)')
    expect(resumoDoSpread(c)).toEqual({
      comissao: 'Comissão (5% sobre o líquido de R$ 800.000,00): R$ 40.000,00',
      final: 'Proposta final: R$ 810.000,00',
    })
    const r = resumoDoSpread(c)!
    expect(`${r.comissao} · ${r.final}`).toBe(
      'Comissão (5% sobre o líquido de R$ 800.000,00): R$ 40.000,00 · Proposta final: R$ 810.000,00',
    )
  })

  it.each([
    // proposta, líquido, %, comissão, texto
    [100_000_000, 12_345, 1_225, 1_512, 'R$ 999.984,88 / R$ 15,12 (Spread de 12,25%)'], // 15,122625 → 15,12
    [100_000, 30, 500, 2, 'R$ 999,98 / R$ 0,02 (Spread de 5%)'], //                         0,015 → 0,02 (meio para cima)
    [100_000, 50, 500, 3, 'R$ 999,97 / R$ 0,03 (Spread de 5%)'], //                         0,025 → 0,03 (não para o par)
    [50_000_000, 123_456_789, 333, 4_111_111, 'R$ 458.888,89 / R$ 41.111,11 (Spread de 3,33%)'], // líquido > proposta
  ])('proposta %i, líquido %i, %i centésimos → comissão %i', (proposta, base, pct, comissao, texto) => {
    const r = calcularSpread(proposta, pct, base)
    expect(r.comissaoCentavos).toBe(comissao)
    expect(r.finalCentavos).toBe(proposta - comissao)
    expect(BigInt(r.comissaoCentavos)).toBe((BigInt(base) * BigInt(pct) + 5_000n) / 10_000n)
    const v = validarCotacao(sobreLiquido(proposta, pct, base), { exigirPercentualNoSpread: true, exigirBaseNoSpread: true })
    expect(v.ok).toBe(true)
    if (v.ok) expect(textoDaCotacao(v.cotacao)).toBe(texto)
  })

  it('perto do teto, a base também não estoura o inteiro seguro', () => {
    const base = 100_000_000_000_000 - 1
    const r = calcularSpread(100_000_000_000_000, 9_999, base)
    expect(BigInt(r.comissaoCentavos)).toBe((BigInt(base) * 9_999n + 5_000n) / 10_000n)
  })

  it('o servidor aceita a base, confere e recalcula (texto pronto e comissão no corpo são ignorados)', () => {
    const r = validarCotacao({
      propostaCentavos: 85_000_000,
      texto: 'R$ 1,00 / R$ 0,01 (Spread de 5%)',
      comissao: { modalidade: 'spread', percentualCentesimos: 500, baseCentavos: 80_000_000, centavos: 1 },
    })
    expect(r).toEqual({ ok: true, cotacao: sobreLiquido(85_000_000, 500, 80_000_000) })
    if (r.ok) expect(textoDaCotacao(r.cotacao)).toBe('R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)')
  })

  it('COMISSÃO ≥ PROPOSTA: recusada, com os dois valores na mensagem', () => {
    // 50% de 800 mil = 400 mil ≥ proposta de 400 mil → final zero.
    const igual = validarCotacao(sobreLiquido(40_000_000, 5_000, 80_000_000))
    expect(igual.ok).toBe(false)
    if (!igual.ok) {
      expect(igual.erro).toBe(
        'A comissão (R$ 400.000,00) não pode ser igual ou maior que o valor da proposta (R$ 400.000,00): ' +
          'a proposta final precisa ser maior que zero. Confira o percentual e o valor líquido validado.',
      )
    }
    expect(validarCotacao(sobreLiquido(30_000_000, 5_000, 80_000_000)).ok).toBe(false) // final negativa
    expect(validarCotacao(sobreLiquido(40_000_001, 5_000, 80_000_000)).ok).toBe(true) // final de 1 centavo
  })

  it('comissão abaixo de um centavo: recusada', () => {
    const r = validarCotacao(sobreLiquido(85_000_000, 500, 9))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toMatch(/menos de um centavo/)
  })

  it('base presente e inválida: recusada sempre (0, negativa, fração, texto, acima do teto)', () => {
    for (const b of [0, -1, 1.5, '80000000', NaN, 100_000_000_000_001]) {
      const r = validarCotacao({
        propostaCentavos: 85_000_000,
        comissao: { modalidade: 'spread', percentualCentesimos: 500, baseCentavos: b },
      })
      expect(r.ok, String(b)).toBe(false)
      if (!r.ok) expect(r.erro).toMatch(/valor líquido validado/)
    }
  })

  it('COMPATIBILIDADE: a tela de 05/10/2026 (percentual sem base) continua aceita, sobre o valor da proposta', () => {
    for (const comissao of [
      { modalidade: 'spread', percentualCentesimos: 500 },
      { modalidade: 'spread', percentualCentesimos: 500, baseCentavos: null },
    ]) {
      const r = validarCotacao({ propostaCentavos: 85_000_000, comissao })
      expect(r).toEqual({ ok: true, cotacao: spread(85_000_000, 500) })
      if (r.ok) {
        expect(textoDaCotacao(r.cotacao)).toBe('R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)')
        expect(resumoDoSpread(r.cotacao)?.comissao).toBe('Comissão (5%): R$ 42.500,00')
      }
    }
    // E a de antes dela (sem percentual) também: "R$ X / Spread".
    const antiga = validarCotacao({ propostaCentavos: 85_000_000, comissao: { modalidade: 'spread' } })
    expect(antiga.ok && textoDaCotacao(antiga.cotacao)).toBe('R$ 850.000,00 / Spread')
  })

  it('a tela nova exige a base (exigirBaseNoSpread)', () => {
    const r = validarCotacao(spread(85_000_000, 500), { exigirPercentualNoSpread: true, exigirBaseNoSpread: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erro).toBe('Com a comissão em spread, informe o valor líquido validado.')
  })

  it('a LIMITADA não muda, com ou sem base no corpo', () => {
    const r = validarCotacao({
      propostaCentavos: 85_000_000,
      comissao: { modalidade: 'limitada', centavos: 4_000_000, baseCentavos: 80_000_000 },
    })
    expect(r).toEqual({ ok: true, cotacao: { propostaCentavos: 85_000_000, comissao: { modalidade: 'limitada', centavos: 4_000_000 } } })
    if (r.ok) expect(textoDaCotacao(r.cotacao)).toBe('R$ 850.000,00 / R$ 40.000,00')
  })

  it('LEITURA DE VOLTA: o texto gravado se lê, e o valor digitado volta (final + comissão = proposta)', () => {
    const c = sobreLiquido(85_000_000, 500, 80_000_000)
    const lida = lerCotacao(textoDaCotacao(c))
    expect(lida).toEqual({
      texto: 'R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)',
      proposta: 81_000_000,
      comissao: { modalidade: 'spread', percentualCentesimos: 500, centavos: 4_000_000 },
    })
    expect(valorDigitadoDaCotacao(lida)).toBe(85_000_000)
    // A base não está no texto: ao recotar, ela volta da nota de oportunidade.
    expect(lida?.comissao).not.toHaveProperty('baseCentavos')
  })
})

/**
 * O BTG SÓ COM COMISSÃO LIMITADA (07/10/2026): "a comissão do BTG é sempre
 * limitada, nunca tem spread". A regra é do fundo (`comissoesDoFundo`), e a
 * porta (`validarCotacao` com o `fundo`) é a mesma da tela e do servidor.
 */
describe('o BTG sem spread', () => {
  const SPREAD_NOVO = {
    propostaCentavos: 85_000_000,
    comissao: { modalidade: 'spread', percentualCentesimos: 500, baseCentavos: 80_000_000 },
  }
  const LIMITADA = { propostaCentavos: 85_000_000, comissao: { modalidade: 'limitada', centavos: 4_000_000 } }

  // SEM TOLERÂNCIA PARA A ABA ANTIGA: o spread no BTG é recusado em qualquer
  // formato — com percentual e base, só com percentual, ou sem nenhum (o "R$ X
  // / Spread" da primeira tela). A mensagem diz para recarregar.
  it('o servidor recusa spread no BTG, com uma mensagem clara', () => {
    for (const comissao of [
      SPREAD_NOVO.comissao,
      { modalidade: 'spread', percentualCentesimos: 500 },
      { modalidade: 'spread' },
    ]) {
      const v = validarCotacao({ propostaCentavos: 85_000_000, comissao }, { fundo: 'BTG' })
      expect(v.ok, JSON.stringify(comissao)).toBe(false)
      if (!v.ok) {
        expect(v.erro).toBe(
          'O BTG não trabalha com spread: a comissão dele é sempre limitada, em reais. ' +
            'Recarregue a página (F5) e informe a comissão em R$.',
        )
      }
    }
  })

  it('a limitada passa no BTG; o spread passa nos outros fundos e sem fundo (como antes)', () => {
    expect(validarCotacao(LIMITADA, { fundo: 'BTG' }).ok).toBe(true)
    expect(validarCotacao(SPREAD_NOVO, { fundo: 'PX Ativos' }).ok).toBe(true)
    expect(validarCotacao(SPREAD_NOVO).ok).toBe(true)
  })

  it('a kommo-etiquetar confere a cotação COM o fundo da etiqueta', () => {
    const fonte = readFileSync(
      fileURLToPath(new URL('../../../supabase/functions/kommo-etiquetar/index.ts', import.meta.url)),
      'utf8',
    )
    expect(fonte).toContain('validarCotacao(body.cotacao, { fundo: daLista.destino })')
  })

  // A LEITURA DE VOLTA NÃO MUDA: o BTG antigo gravado com spread continua lido como está.
  it('um BTG antigo com spread continua sendo lido como spread', () => {
    const l = lerCotacao('R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)')
    expect(l?.comissao).toEqual({ modalidade: 'spread', percentualCentesimos: 500, centavos: 4_000_000 })
    expect(cotacoesDoCard([{ field_name: 'BTG', values: [{ value: 'R$ 850.000,00 / Spread' }] }]).BTG?.comissao).toEqual({
      modalidade: 'spread',
    })
  })

  it('a janela do BTG começa na limitada, sem spread; com um spread antigo, a comissão vem vazia e o texto à vista', () => {
    expect(inicioDaCotacao(null, 'BTG')).toEqual({
      modalidades: ['limitada'],
      proposta: null,
      modalidade: 'limitada',
      comissao: null,
      percentual: '',
      foraDoFundo: false,
    })
    const antigo = lerCotacao('R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)')
    expect(inicioDaCotacao(antigo, 'BTG')).toEqual({
      modalidades: ['limitada'],
      proposta: 85_000_000,
      modalidade: 'limitada',
      comissao: null,
      percentual: '',
      foraDoFundo: true,
    })
    // O MESMO TEXTO NUM FUNDO QUE ACEITA SPREAD volta como era.
    expect(inicioDaCotacao(antigo, 'PX Ativos')).toMatchObject({ modalidade: 'spread', percentual: '5', foraDoFundo: false })
    // A LIMITADA DO BTG volta preenchida.
    expect(inicioDaCotacao(lerCotacao('R$ 850.000,00 / R$ 40.000,00'), 'BTG')).toMatchObject({
      modalidade: 'limitada',
      proposta: 85_000_000,
      comissao: 4_000_000,
      foraDoFundo: false,
    })
  })
})
