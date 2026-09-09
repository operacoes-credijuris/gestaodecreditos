import { describe, it, expect } from 'vitest'
import {
  PISO_MESES,
  prazoMeses,
  REGRAS_PRAZO,
  roteiroValido,
} from '../../../supabase/functions/_shared/prazo.ts'

/**
 * O PRAZO ATÉ O DINHEIRO — T5, a variável que mais mexe no deságio.
 *
 * Morava dentro da Edge Function, junto do SDK da IA, e nenhum teste a
 * alcançava: um roteiro de 41 atos, um ato de 1.101 dias, uma data inválida,
 * cada um deles muda o preço, e nenhum tinha caso escrito.
 */
const AQUISICAO = new Date('2026-09-09T12:00:00Z')

const base = {
  esfera: 'estadual' as const,
  serventiaDias: 30,
  gabineteDias: 20,
  scenario: 'A' as const,
  dataAquisicao: AQUISICAO,
  exigeAlvara: false,
}

describe('roteiroValido', () => {
  // O TETO EXISTE PORQUE NÚMERO SOLTO DE UMA LEITURA RUIM não pode virar prazo
  // de três anos num campo que manda no preço.
  it('descarta o ato absurdo e mantém os demais', () => {
    const r = roteiroValido([
      { ato: 'habilitação', dias: 30 },
      { ato: 'erro de leitura', dias: 1101 },
      { ato: 'pagamento', dias: 60 },
    ])
    expect(r?.length).toBe(2)
    expect(r?.reduce((t, a) => t + a.dias, 0)).toBe(90)
  })

  it('ato sem nome ou com dias ilegível sai', () => {
    expect(roteiroValido([{ ato: '', dias: 30 }])).toBe(null)
    expect(roteiroValido([{ ato: 'x', dias: 'abc' }])).toBe(null)
    expect(roteiroValido([{ ato: 'x', dias: -1 }])).toBe(null)
  })

  it('mais de quarenta atos não é roteiro, é ruído', () => {
    const muitos = Array.from({ length: 41 }, (_, i) => ({ ato: `ato ${i}`, dias: 5 }))
    expect(roteiroValido(muitos)).toBe(null)
    expect(roteiroValido(muitos.slice(0, 40))?.length).toBe(40)
  })

  it('soma acima de cinco anos é implausível', () => {
    expect(roteiroValido([{ ato: 'a', dias: 1000 }, { ato: 'b', dias: 1000 }])).toBe(null)
  })

  it('o que não é lista não é roteiro', () => {
    expect(roteiroValido(null)).toBe(null)
    expect(roteiroValido([])).toBe(null)
    expect(roteiroValido('30 dias')).toBe(null)
    expect(roteiroValido({ ato: 'x', dias: 30 })).toBe(null)
  })
})

describe('prazoMeses', () => {
  // O ROTEIRO VEM PRIMEIRO, e a fórmula fica de rede: ele conta os atos que
  // faltam com a velocidade medida neste juízo; a fórmula é a mesma para todo
  // processo, e não sabe em que etapa ele está.
  it('o roteiro vence a fórmula quando serve', () => {
    const r = prazoMeses({ ...base, roteiro: [{ ato: 'a', dias: 300 }, { ato: 'b', dias: 300 }] })
    expect(r.roteiro?.length).toBe(2)
    expect(r.meses).toBeCloseTo(20, 6)
    expect(r.detalhe).toContain('2 ato(s)')
  })

  it('roteiro curto ainda respeita o piso', () => {
    const r = prazoMeses({ ...base, roteiro: [{ ato: 'a', dias: 30 }] })
    expect(r.meses).toBe(PISO_MESES)
    expect(r.detalhe).toContain('piso')
  })

  it('roteiro imprestável cai na fórmula', () => {
    const r = prazoMeses({ ...base, roteiro: [{ ato: '', dias: 0 }] })
    expect(r.roteiro).toBe(null)
    expect(r.detalhe).toContain('ciclos do processo')
  })

  // A REGRA VEM DA ESFERA DO ENTE DEVEDOR. Federal paga direto ao credor, sem
  // alvará; estadual pode exigir; Goiás segue o template do TJGO.
  it('federal não soma alvará nem quando os autos o exigem', () => {
    const r = prazoMeses({ ...base, esfera: 'federal', exigeAlvara: true })
    expect(r.regra.alvaraDias).toBe(0)
    expect(r.detalhe).not.toContain('alvará')
  })

  // CICLOS GRANDES DE PROPÓSITO: com os do `base` a conta fica abaixo do piso
  // de oito meses, e o piso esconderia a diferença que este teste mede.
  it('estadual soma alvará só quando os autos exigem', () => {
    const lento = { ...base, esfera: 'estadual' as const, serventiaDias: 60, gabineteDias: 40 }
    const sem = prazoMeses({ ...lento, exigeAlvara: false })
    const com = prazoMeses({ ...lento, exigeAlvara: true })
    expect(REGRAS_PRAZO.estadual.alvaraDias).toBe('se_exigir')
    expect(sem.meses).toBeGreaterThan(PISO_MESES)
    expect(com.meses - sem.meses).toBeCloseTo(21 / 30, 6)
  })

  it('Goiás sem convênio estima a expedição em 60 dias', () => {
    const semData = prazoMeses({ ...base, esfera: 'goias' })
    expect(semData.detalhe).toContain('(estimado)')
    const comData = prazoMeses({
      ...base,
      esfera: 'goias',
      dataFatalConvenio: new Date('2026-12-08T12:00:00Z'),
    })
    expect(comData.detalhe).toContain('(convênio)')
    expect(comData.meses).toBeGreaterThan(semData.meses)
  })

  // CENÁRIO B: a requisição já saiu, e o que resta é o prazo de pagamento menos
  // o que já correu desde a expedição.
  it('já expedida desconta o que já correu', () => {
    const recem = prazoMeses({ ...base, scenario: 'B', dataExpedicao: AQUISICAO })
    const antiga = prazoMeses({
      ...base,
      scenario: 'B',
      dataExpedicao: new Date('2026-06-11T12:00:00Z'), // 90 dias antes
    })
    expect(recem.detalhe).toContain('0d já decorridos')
    expect(antiga.detalhe).toContain('90d já decorridos')
    // Os 60 dias de pagamento já venceram: o restante é zero, não negativo.
    expect(antiga.detalhe).toContain('pagamento restante 0d')
    expect(antiga.meses).toBeLessThanOrEqual(recem.meses)
  })

  it('expedição no futuro não vira prazo negativo', () => {
    const r = prazoMeses({ ...base, scenario: 'B', dataExpedicao: new Date('2027-01-01T12:00:00Z') })
    expect(r.meses).toBeGreaterThanOrEqual(PISO_MESES)
    expect(r.detalhe).toContain('0d já decorridos')
  })

  // A ARMADILHA QUE ISTO FECHA: `new Date('31/02/2025')` é um Date, passa no
  // `if (d)` e devolve NaN em getTime(). O NaN chegava a `Math.max(8, NaN)` —
  // que é NaN — e a calibragem, sem prazo, devolvia 95% de deságio.
  it('data inválida não vira NaN no prazo', () => {
    const invalida = new Date('31/02/2025')
    expect(Number.isNaN(invalida.getTime())).toBe(true)
    const r = prazoMeses({ ...base, scenario: 'B', dataExpedicao: invalida })
    expect(Number.isFinite(r.meses)).toBe(true)
    expect(r.meses).toBeGreaterThanOrEqual(PISO_MESES)
  })

  it('data de aquisição inválida também sai finita', () => {
    const r = prazoMeses({ ...base, dataAquisicao: new Date('nada'), esfera: 'goias' })
    expect(Number.isFinite(r.meses)).toBe(true)
    expect(r.meses).toBeGreaterThanOrEqual(PISO_MESES)
  })

  it('ciclos ilegíveis não derrubam o prazo', () => {
    const r = prazoMeses({ ...base, serventiaDias: NaN, gabineteDias: NaN })
    expect(Number.isFinite(r.meses)).toBe(true)
    expect(r.meses).toBe(PISO_MESES)
  })

  it('toda esfera tem descrição, e ela vai para a tela', () => {
    for (const esfera of ['federal', 'estadual', 'goias'] as const) {
      expect(prazoMeses({ ...base, esfera }).regra.descricao.length).toBeGreaterThan(20)
    }
  })
})
