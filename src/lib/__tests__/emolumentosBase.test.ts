import { describe, it, expect } from 'vitest'
import { custoParaPreco, type RegraAto } from '../../../supabase/functions/_shared/emolumentos-calculo.ts'
import { calibrarDesagio, montarParcelas, type Parcela } from '../../../supabase/functions/_shared/precificacao.ts'

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
  const parcelas: Parcela[] = [{ nome: 'principal', liquido: 100_000, bruto: 100_000, desagiavel: true }]

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

describe('a base é o VALOR DE FACE da verba, não o líquido', () => {
  /**
   * Onde o estado cobra o ato sobre o valor do crédito, o que se declara na
   * escritura é o crédito cedido pelo seu valor de face: IR e INSS são retenção
   * na fonte de quem paga, não abatimento do crédito. Passar o líquido
   * subestimava o emolumento — e de forma invisível, porque o número saía
   * plausível.
   */
  it('o emolumento sai sobre o bruto da verba, e não sobre o líquido', () => {
    const parcelas: Parcela[] = [
      { nome: 'principal', liquido: 80_000, bruto: 100_000, desagiavel: true },
    ]
    const regra = { escritura: porcentual('valor_credito'), registro: null }
    const r = calibrarDesagio({ parcelas, T5: 8, regra, desagioFixo: 0.2 })
    expect(r.Y10).toBe(1_000)   // 1% de 100.000, não de 80.000
  })

  it('montarParcelas preenche o bruto de cada verba', () => {
    const ps = montarParcelas({
      brutoTotal: 100_000, ir: 12_000, inss: 3_000,
      contratuaisBrutos: 30_000, sucumbenciaisBrutos: 10_000,
      verbas: { principal: true, contratuais: true, sucumbenciais: true },
    })
    const por = (n: string) => ps.find((p) => p.nome === n)!
    // O principal de face é o bruto MENOS a parte que já é do advogado.
    expect(por('principal').bruto).toBe(70_000)
    expect(por('contratuais').bruto).toBe(30_000)
    expect(por('sucumbenciais').bruto).toBe(10_000)
    // E o líquido continua descontando as retenções, como sempre.
    expect(por('principal').liquido).toBe(55_000)
  })

  it('sem base declarada nada muda: o preço continua mandando', () => {
    const parcelas: Parcela[] = [
      { nome: 'principal', liquido: 80_000, bruto: 100_000, desagiavel: true },
    ]
    const regra = { escritura: porcentual(), registro: null }
    const r = calibrarDesagio({ parcelas, T5: 8, regra, desagioFixo: 0.5 })
    expect(r.Y10).toBe(400)     // 1% de 40.000 (o preço), não do bruto
  })
})
