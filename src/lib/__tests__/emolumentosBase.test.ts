import { describe, it, expect } from 'vitest'
import { custoParaPreco, type RegraAto } from '../../../supabase/functions/_shared/emolumentos-calculo.ts'
import { calibrarDesagio, type Parcela } from '../../../supabase/functions/_shared/precificacao.ts'

/**
 * Sobre QUAL VALOR a tabela do estado cobra o ato numa cessão.
 *
 * Era fixo em "preço" para todo estado. Onde a lei manda cobrar sobre o valor
 * do crédito cedido, o cartório saía subestimado e o preço, otimista. Agora a
 * IA lê a base na tabela do estado e o cálculo a respeita, ato a ato.
 */

// 1% do valor, para o efeito da base aparecer nos números.
const porcentual = (base_calculo?: RegraAto['base_calculo']): RegraAto => ({
  faixas: [{ ate: null, percentual: 0.01 }],
  base_calculo,
})

describe('base de cálculo do emolumento', () => {
  it('sem base declarada, cobra sobre o preço — como sempre foi', () => {
    const r = custoParaPreco({ escritura: porcentual(), registro: null }, 60_000, 'principal', 100_000)
    expect(r.escritura).toBe(600)
    expect(r.descricao).toBe('Escritura R$ 600,00 + registro NÃO ENCONTRADO (principal)')
  })

  it('"preco" explícito é o mesmo que ausente', () => {
    const r = custoParaPreco({ escritura: porcentual('preco'), registro: null }, 60_000, undefined, 100_000)
    expect(r.escritura).toBe(600)
  })

  it('"valor_credito" cobra sobre o crédito cedido, e a descrição diz isso', () => {
    const r = custoParaPreco({ escritura: porcentual('valor_credito'), registro: null }, 60_000, 'principal', 100_000)
    expect(r.escritura).toBe(1_000)
    expect(r.descricao).toContain('sobre o valor do crédito')
  })

  it('"maior" cobra sobre o maior dos dois', () => {
    const regra = { escritura: porcentual('maior'), registro: null }
    expect(custoParaPreco(regra, 60_000, undefined, 100_000).escritura).toBe(1_000)
    expect(custoParaPreco(regra, 120_000, undefined, 100_000).escritura).toBe(1_200)
  })

  it('cada ato tem a sua base: escritura sobre o crédito, registro sobre o preço', () => {
    const r = custoParaPreco(
      { escritura: porcentual('valor_credito'), registro: porcentual('preco') },
      60_000, undefined, 100_000,
    )
    expect(r.escritura).toBe(1_000)
    expect(r.registro).toBe(600)
    expect(r.total).toBe(1_600)
  })

  it('sem o valor do crédito informado, só há o preço para usar', () => {
    // Quem chama sem o quarto argumento (código antigo, testes antigos) recebe
    // exatamente o comportamento antigo, mesmo com a base declarada.
    expect(custoParaPreco({ escritura: porcentual('valor_credito'), registro: null }, 60_000).escritura).toBe(600)
    expect(custoParaPreco({ escritura: porcentual('valor_credito'), registro: null }, 60_000, undefined, 0).escritura).toBe(600)
  })
})

describe('a calibragem passa o líquido da verba como valor do crédito', () => {
  const parcelas: Parcela[] = [{ nome: 'principal', liquido: 100_000, desagiavel: true }]

  it('com base no crédito, o cartório é o mesmo em qualquer deságio — incide sobre o que se compra, não sobre o que se paga', () => {
    const regra = { escritura: porcentual('valor_credito'), registro: null }
    const a = calibrarDesagio({ parcelas, T5: 8, regra, desagioFixo: 0.2 })
    const b = calibrarDesagio({ parcelas, T5: 8, regra, desagioFixo: 0.5 })
    expect(a.Y10).toBe(1_000)
    expect(b.Y10).toBe(1_000)
  })

  it('com base no preço, o cartório cai com o deságio', () => {
    const regra = { escritura: porcentual('preco'), registro: null }
    const a = calibrarDesagio({ parcelas, T5: 8, regra, desagioFixo: 0.2 })
    const b = calibrarDesagio({ parcelas, T5: 8, regra, desagioFixo: 0.5 })
    expect(a.Y10).toBe(800)
    expect(b.Y10).toBe(500)
  })
})
