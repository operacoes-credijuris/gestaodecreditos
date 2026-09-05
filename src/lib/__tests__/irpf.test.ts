import { describe, it, expect } from 'vitest'
import { irProgressivo, TABELA_IRRF_MENSAL } from '../../../supabase/functions/_shared/irpf.ts'

/**
 * O IRRF sobre os honorários.
 *
 * Testado porque é um número que entra direto no líquido da operação e daí no
 * preço: a célula que o guarda é subtraída pela fórmula do honorário, e antes
 * disto ela trazia o texto "[ESTIMAR CONFORME TABELA PROGRESSIVA DE IR]" — que
 * fazia a fórmula devolver #VALUE! e contaminar o total e a rentabilidade.
 */
describe('tabela', () => {
  it('tem as cinco faixas, em ordem, terminando em aberto', () => {
    expect(TABELA_IRRF_MENSAL).toHaveLength(5)
    expect(TABELA_IRRF_MENSAL[TABELA_IRRF_MENSAL.length - 1].ate).toBeNull()
    const tetos = TABELA_IRRF_MENSAL.slice(0, -1).map((f) => f.ate as number)
    expect(tetos).toEqual([...tetos].sort((a, b) => a - b))
  })

  it('é contínua nas bordas — um centavo a mais não dá um salto de imposto', () => {
    // É para isto que existe a parcela a deduzir. Um degrau de verdade aqui
    // significaria que a tabela foi transcrita errado.
    //
    // A continuidade não é EXATA, e isso é da tabela oficial, não da
    // transcrição: as parcelas a deduzir são publicadas arredondadas ao
    // centavo, então na borda de 22,5% para 27,5% o imposto até CAI três
    // milésimos de centavo. Por isso a asserção é sobre o módulo da diferença.
    for (const f of TABELA_IRRF_MENSAL.slice(0, -1)) {
      const antes = irProgressivo(f.ate as number).imposto
      const depois = irProgressivo((f.ate as number) + 0.01).imposto
      expect(Math.abs(depois - antes)).toBeLessThan(0.01)
    }
  })
})

describe('pagamento único', () => {
  it('isento até o teto da primeira faixa', () => {
    expect(irProgressivo(2428.80).imposto).toBe(0)
    expect(irProgressivo(1000).imposto).toBe(0)
  })

  it('7,5% com a parcela a deduzir', () => {
    // 2.500 × 7,5% − 182,16 = 5,34
    expect(irProgressivo(2500).imposto).toBeCloseTo(5.34, 2)
  })

  it('15%', () => {
    // 3.000 × 15% − 394,16 = 55,84
    expect(irProgressivo(3000).imposto).toBeCloseTo(55.84, 2)
  })

  it('22,5%', () => {
    // 4.000 × 22,5% − 675,49 = 224,51
    expect(irProgressivo(4000).imposto).toBeCloseTo(224.51, 2)
  })

  it('27,5% — a faixa em que quase todo honorário destes casos cai', () => {
    // 21.655,84 × 27,5% − 908,73 = 5.046,63
    expect(irProgressivo(21655.84).imposto).toBeCloseTo(5046.63, 2)
    // 50.000 × 27,5% − 908,73 = 12.841,27
    expect(irProgressivo(50000).imposto).toBeCloseTo(12841.27, 2)
  })

  it('nunca devolve imposto negativo', () => {
    // Na borda de baixo de uma faixa, alíquota × base pode ficar abaixo da
    // parcela a deduzir. O imposto é zero, não um crédito.
    expect(irProgressivo(2428.81).imposto).toBeGreaterThanOrEqual(0)
    expect(irProgressivo(0.01).imposto).toBe(0)
  })

  it('valor zero, negativo ou lixo não quebra', () => {
    expect(irProgressivo(0).imposto).toBe(0)
    expect(irProgressivo(-500).imposto).toBe(0)
    expect(irProgressivo(NaN).imposto).toBe(0)
  })
})

describe('RRA — rendimentos recebidos acumuladamente', () => {
  it('divide pelo número de meses, tributa, e multiplica de volta', () => {
    // 24.000 em 12 meses = 2.000/mês, que é faixa isenta: imposto zero.
    // O mesmo valor como pagamento único pagaria 27,5%.
    expect(irProgressivo(24000, 12).imposto).toBe(0)
    expect(irProgressivo(24000, 1).imposto).toBeGreaterThan(5000)
  })

  it('em poucos meses ainda cai na faixa alta', () => {
    // 60.000 em 3 meses = 20.000/mês: 20.000 × 27,5% − 908,73 = 4.591,27/mês
    expect(irProgressivo(60000, 3).imposto).toBeCloseTo(4591.27 * 3, 1)
  })

  it('meses inválidos viram pagamento único, que é o mais conservador', () => {
    // Errar para mais deixa o preço conservador; errar para menos promete um
    // líquido que não vem.
    const unico = irProgressivo(21655.84).imposto
    expect(irProgressivo(21655.84, 0).imposto).toBeCloseTo(unico, 2)
    expect(irProgressivo(21655.84, -3).imposto).toBeCloseTo(unico, 2)
    expect(irProgressivo(21655.84, NaN).imposto).toBeCloseTo(unico, 2)
  })
})

describe('memória de cálculo', () => {
  it('mostra a conta, para a nota da célula', () => {
    const r = irProgressivo(21655.84)
    expect(r.memoria).toContain('27,5%')
    expect(r.memoria).toContain('908,73')
    expect(r.memoria).toContain('2026')
  })

  it('diz quando é RRA e quantos meses', () => {
    expect(irProgressivo(60000, 3).memoria).toContain('RRA')
    expect(irProgressivo(60000, 3).memoria).toContain('3 meses')
  })

  it('diz quando caiu na isenção', () => {
    expect(irProgressivo(1000).memoria).toContain('isenta')
  })
})
