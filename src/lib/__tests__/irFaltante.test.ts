import { describe, it, expect } from 'vitest'
import {
  calcularIrFaltante,
  MAX_ITENS_IR,
  memoriaDoIrFaltante,
} from '../../../supabase/functions/_shared/irFaltante.ts'
import { irProgressivo } from '../../../supabase/functions/_shared/irpf.ts'

/**
 * O IMPOSTO QUE A CONTA NÃO RETEVE.
 *
 * O caso que criou este bloco: a auditoria achou, corretamente, que não houve
 * retenção sobre a parcela de lucros cessantes — tributável — e então PAROU,
 * escrevendo "sem memória de competências, não é possível apurar a alíquota".
 * Leitura impecável, número nenhum. E número nenhum não desconta nada: o preço
 * seguia contando com um líquido que não vai ser pago.
 *
 * E ELE É O BLOCO QUE DOBRAVA O IR a cada ação, porque somava ao campo em vez de
 * reconstruir do valor lido. A conta ficou pura para que o dobro tenha onde ser
 * travado.
 */
const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const item = (extra: Record<string, unknown> = {}) => ({
  verba: 'lucros cessantes',
  base: 60_000,
  meses: 24,
  ...extra,
})

describe('calcularIrFaltante', () => {
  it('sem itens, não há nada a fazer', () => {
    for (const itens of [undefined, null, [], 'x', {}]) {
      expect(calcularIrFaltante({ itens, bruto: 100_000, brl })).toEqual({
        soma: 0, memorias: [], avisos: [], avisosAuditoria: [],
      })
    }
  })

  // A CONTA É A DE irpf.ts, e é a MESMA que calcula o IR dos honorários: dois
  // caminhos calculando o mesmo imposto fariam tela e planilha divergirem no
  // mesmo processo.
  it('usa a tabela progressiva com as competências declaradas', () => {
    const r = calcularIrFaltante({ itens: [item()], bruto: 100_000, brl })
    expect(r.soma).toBeCloseTo(irProgressivo(60_000, 24).imposto, 2)
    expect(r.memorias[0]).toContain('lucros cessantes')
    expect(r.avisosAuditoria).toEqual([])
  })

  it('soma as verbas, uma memória por verba', () => {
    const r = calcularIrFaltante({
      itens: [item(), item({ verba: 'horas extras', base: 30_000, meses: 12 })],
      bruto: 100_000,
      brl,
    })
    expect(r.memorias.length).toBe(2)
    expect(r.soma).toBeCloseTo(
      irProgressivo(60_000, 24).imposto + irProgressivo(30_000, 12).imposto, 2,
    )
  })

  // O PERÍODO SUBSTITUI OS MESES: é o caminho normal, porque a auditoria já leu
  // o termo inicial e o final para o confronto com o título.
  it('conta as competências do período quando os meses não vêm', () => {
    const r = calcularIrFaltante({
      itens: [item({ meses: undefined, de: '01/2015', ate: '12/2016' })],
      bruto: 100_000,
      brl,
    })
    expect(r.soma).toBeCloseTo(irProgressivo(60_000, 24).imposto, 2)
  })

  it('meses declarados vencem o período', () => {
    const r = calcularIrFaltante({
      itens: [item({ meses: 12, de: '01/2015', ate: '12/2016' })],
      bruto: 100_000,
      brl,
    })
    expect(r.soma).toBeCloseTo(irProgressivo(60_000, 12).imposto, 2)
  })

  // SEM COMPETÊNCIAS NÃO SE CALCULA, e isto NÃO é conservadorismo: o art. 12-A
  // da Lei 7.713/88 tributa rendimento acumulado pela tabela do MÊS sobre a
  // média mensal. Jogar a tabela mensal sobre o total inteiro é outro regime.
  it('sem meses e sem período, avisa em vez de assumir pagamento único', () => {
    const r = calcularIrFaltante({ itens: [item({ meses: undefined })], bruto: 100_000, brl })
    expect(r.soma).toBe(0)
    expect(r.avisosAuditoria[0]).toMatch(/IR NÃO CALCULADO/)
    expect(r.avisosAuditoria[0]).toMatch(/art\. 12-A/)
    expect(r.avisosAuditoria[0]).toMatch(/o preço se refaz/i)
  })

  it('período pela metade também não serve', () => {
    for (const extra of [{ de: '01/2015' }, { ate: '12/2016' }, { de: 'NÃO LOCALIZADO', ate: '12/2016' }]) {
      const r = calcularIrFaltante({ itens: [item({ meses: undefined, ...extra })], bruto: 100_000, brl })
      expect(r.soma).toBe(0)
      expect(r.avisosAuditoria.length).toBe(1)
    }
  })

  // BASE ILEGÍVEL SE DIZ. Era um `continue` MUDO, enquanto a falta dos meses
  // gerava aviso — e as duas omissões custam a mesma coisa: o preço segue sem
  // embutir um imposto que a auditoria já sabe que existe.
  it('base ausente ou ilegível vira aviso, não silêncio', () => {
    for (const base of [undefined, null, '', 'abc', 0, -100]) {
      const r = calcularIrFaltante({ itens: [item({ base })], bruto: 100_000, brl })
      expect(r.soma).toBe(0)
      expect(r.avisosAuditoria[0]).toMatch(/não disse sobre QUE VALOR/)
    }
  })

  // BASE MAIOR QUE O BRUTO é valor lido errado — o total de outro credor, a soma
  // de requisitórios. Tributar sobre ela devolveria um imposto que engoliria o
  // crédito, e a precificação aceitaria sem reclamar.
  it('base maior que o bruto é recusada, com o motivo', () => {
    const r = calcularIrFaltante({ itens: [item({ base: 150_000 })], bruto: 100_000, brl })
    expect(r.soma).toBe(0)
    expect(r.avisos[0]).toMatch(/maior que o bruto/)
  })

  it('sem bruto conhecido, a base passa', () => {
    const r = calcularIrFaltante({ itens: [item()], bruto: 0, brl })
    expect(r.soma).toBeGreaterThan(0)
  })

  it('base na faixa isenta diz que não há nada a reter', () => {
    const r = calcularIrFaltante({ itens: [item({ base: 12_000, meses: 24 })], bruto: 100_000, brl })
    expect(r.soma).toBe(0)
    expect(r.avisosAuditoria[0]).toMatch(/nada a reter/)
  })

  // O TETO DE ITENS existe porque a lista vem do modelo: seis verbas é mais do
  // que qualquer conta real traz, e uma lista longa seria leitura ruim.
  it('mais itens que o teto: só os primeiros entram', () => {
    const itens = Array.from({ length: MAX_ITENS_IR + 3 }, (_, i) =>
      item({ verba: `verba ${i}`, base: 30_000, meses: 12 }))
    const r = calcularIrFaltante({ itens, bruto: 500_000, brl })
    expect(r.memorias.length).toBe(MAX_ITENS_IR)
  })

  // IDEMPOTÊNCIA POR CONSTRUÇÃO: a função não toca em `dados`, então rodar dez
  // vezes com a mesma entrada dá a mesma saída. Era somando ao campo que o
  // imposto dobrava a cada ação.
  it('a mesma entrada dá sempre a mesma soma', () => {
    const itens = [item()]
    const um = calcularIrFaltante({ itens, bruto: 100_000, brl })
    const dois = calcularIrFaltante({ itens, bruto: 100_000, brl })
    expect(dois).toEqual(um)
  })

  it('o item torto não derruba os bons', () => {
    const r = calcularIrFaltante({
      itens: [item({ base: 'abc' }), item(), item({ meses: undefined })],
      bruto: 100_000,
      brl,
    })
    expect(r.memorias.length).toBe(1)
    expect(r.avisosAuditoria.length).toBe(2)
    expect(r.soma).toBeCloseTo(irProgressivo(60_000, 24).imposto, 2)
  })

  it('a verba sem nome ganha um rótulo, e o nome longo é cortado', () => {
    const semNome = calcularIrFaltante({ itens: [item({ verba: undefined, meses: undefined })], bruto: 0, brl })
    expect(semNome.avisosAuditoria[0]).toContain('verba tributável')
    const longo = calcularIrFaltante({
      itens: [item({ verba: 'x'.repeat(200), meses: undefined })], bruto: 0, brl,
    })
    expect(longo.avisosAuditoria[0]).toContain('x'.repeat(60))
    expect(longo.avisosAuditoria[0]).not.toContain('x'.repeat(61))
  })
})

describe('memoriaDoIrFaltante', () => {
  // A MEMÓRIA VAI PARA A CÉLULA DO IR na planilha: é lá que alguém confere o
  // número seis meses depois, sem esta análise à mão.
  it('diz de quanto para quanto o IR foi', () => {
    const t = memoriaDoIrFaltante({
      soma: 500, memorias: ['lucros cessantes — RRA'], irAntes: 1_000, irDepois: 1_500, brl,
    })
    expect(t).toContain('lucros cessantes')
    expect(t).toContain(brl(500))
    expect(t).toContain(brl(1_000))
    expect(t).toContain(brl(1_500))
    expect(t).toMatch(/tabela progressiva \d{4}/)
  })
})
