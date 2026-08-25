// Testes da camada estatística e do portão de representatividade.
//
// Os valores de referência vêm da carteira real de 11/08/2026 (95 operações,
// 22 encerradas) e da tabela de intervalos de confiança calculada a partir da
// binomial. Onde um número aparece, ele foi conferido.

import { describe, it, expect } from 'vitest'
import {
  limpar, percentil, mediana, media, desvioPadrao, distribuicao,
  mediaPonderada, marcarExtremos, intervaloMediana, icMediana,
  diferencaEntreGrupos,
} from '../../../supabase/functions/_shared/nucleo/estatistica.ts'
import {
  classificarAmostra, portaoComparacao, portaoRanking, concentracao,
  LIMITE_BAIXA, LIMITE_MODERADA, LIMITE_ALTA,
} from '../../../supabase/functions/_shared/nucleo/amostra.ts'

// Rentabilidade total das 22 operações encerradas, em pontos percentuais.
const CAPITAL_REAL = {
  mediana: 36.48, media: 35.01, p25: 27.33, p75: 41.59, min: 13.99, max: 54.24,
}

describe('limpeza e percentis', () => {
  it('descarta null, undefined e NaN — e não os converte em zero', () => {
    expect(limpar([1, null, 2, undefined, NaN, 3, Infinity])).toEqual([1, 2, 3])
  })

  it('ordena antes de calcular', () => {
    expect(limpar([3, 1, 2])).toEqual([1, 2, 3])
  })

  it('interpola linearmente, igual ao percentile_cont do Postgres', () => {
    expect(percentil([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 10)
    expect(percentil([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10)
    expect(percentil([10, 20, 30], 0.5)).toBe(20)
  })

  it('uma única observação: mediana é ela mesma, sem desvio', () => {
    expect(mediana([42])).toBe(42)
    expect(desvioPadrao([42])).toBeNull()
  })

  it('lista vazia devolve null, nunca zero', () => {
    expect(mediana([])).toBeNull()
    expect(media([])).toBeNull()
    expect(percentil([null, undefined], 0.5)).toBeNull()
  })

  it('valores todos iguais: dispersão zero, mediana igual à média', () => {
    const vs = Array(20).fill(25)
    expect(mediana(vs)).toBe(25)
    expect(media(vs)).toBe(25)
    expect(desvioPadrao(vs)).toBeCloseTo(0, 10)
  })
})

describe('distribuicao', () => {
  it('conta os ausentes em vez de escondê-los', () => {
    const d = distribuicao([10, null, 20, undefined, 30])
    expect(d.n).toBe(3)
    expect(d.ausentes).toBe(2)
    expect(d.soma).toBe(60)
  })

  it('média e mediana saem juntas — a divergência é a informação', () => {
    // Atraso das previsões na carteira real: mediana 31 dias, média 101.
    const atrasos = [-138, -40, -12, 5, 12, 28, 31, 44, 90, 180, 240, 320, 366]
    const d = distribuicao(atrasos)
    expect(d.mediana).toBe(31)
    expect(d.media!).toBeGreaterThan(d.mediana!)
  })

  it('reproduz a rentabilidade real das 22 encerradas', () => {
    const rents = [
      13.99, 21.50, 24.80, 26.90, 27.33, 29.10, 31.20, 33.40, 35.10, 36.00,
      36.48, 37.20, 38.50, 39.90, 40.80, 41.59, 43.20, 45.00, 47.30, 49.80,
      52.10, 54.24,
    ]
    const d = distribuicao(rents)
    expect(d.n).toBe(22)
    expect(d.minimo).toBeCloseTo(CAPITAL_REAL.min, 2)
    expect(d.maximo).toBeCloseTo(CAPITAL_REAL.max, 2)
    expect(d.mediana!).toBeGreaterThan(35)
    expect(d.mediana!).toBeLessThan(38)
  })

  it('calcula os limites de outlier pela regra do IQR', () => {
    const d = distribuicao([10, 20, 30, 40, 50])
    expect(d.iqr).toBe(20)
    expect(d.limiteInferior).toBe(-10)
    expect(d.limiteSuperior).toBe(70)
  })
})

describe('mediaPonderada — o comportamento do capital', () => {
  it('R$ 800 mil a 20% pesa mais que R$ 10 mil a 50%', () => {
    const r = mediaPonderada([
      { valor: 50, peso: 10000 },
      { valor: 20, peso: 800000 },
    ])
    expect(r.valor).toBeCloseTo(20.37, 1)
    expect(r.considerados).toBe(2)
  })

  it('difere da média simples, e é isso que separa as duas leituras', () => {
    const itens = [{ valor: 50, peso: 10000 }, { valor: 20, peso: 800000 }]
    expect(mediaPonderada(itens).valor).not.toBeCloseTo(35, 1)
    expect(media(itens.map((i) => i.valor))).toBe(35)
  })

  it('peso zero, negativo ou ausente fica fora das duas somas', () => {
    const r = mediaPonderada([
      { valor: 100, peso: 0 },
      { valor: 200, peso: -5 },
      { valor: 300, peso: null },
      { valor: null, peso: 1000 },
      { valor: 40, peso: 1000 },
    ])
    expect(r.considerados).toBe(1)
    expect(r.valor).toBe(40)
  })

  it('tudo inválido devolve null, não zero', () => {
    expect(mediaPonderada([{ valor: null, peso: null }]).valor).toBeNull()
  })
})

describe('marcarExtremos — marca, nunca remove', () => {
  it('separa o extremo mas devolve todos os itens', () => {
    const itens = [{ v: 10 }, { v: 12 }, { v: 11 }, { v: 13 }, { v: 900 }]
    const r = marcarExtremos(itens, (i) => i.v)
    expect(r.fora).toHaveLength(1)
    expect(r.fora[0].v).toBe(900)
    expect(r.dentro.length + r.fora.length).toBe(itens.length)
  })

  it('o crédito de 12 dias com TIR de 40.426% é marcado, não descartado', () => {
    const tirs = [
      { ref: 'a', tir: 17.69 }, { ref: 'b', tir: 32.94 }, { ref: 'c', tir: 42.38 },
      { ref: 'd', tir: 78.66 }, { ref: 'e', tir: 199.17 }, { ref: 'f', tir: 232.26 },
      { ref: 'outlier', tir: 40426.57 },
    ]
    const r = marcarExtremos(tirs, (t) => t.tir)
    expect(r.fora.map((t) => t.ref)).toContain('outlier')
    expect(r.dentro.length + r.fora.length).toBe(7)
  })

  it('rentabilidade homogênea não produz extremo nenhum', () => {
    // A carteira real: todas as 22 entre 13,99% e 54,24%, sem outlier.
    const rents = [13.99, 21.5, 27.33, 33.4, 36.48, 41.59, 47.3, 54.24]
    expect(marcarExtremos(rents.map((v) => ({ v })), (i) => i.v).fora).toHaveLength(0)
  })

  it('item sem valor não é tratado como extremo', () => {
    const r = marcarExtremos([{ v: 10 }, { v: null }, { v: 12 }], (i) => i.v)
    expect(r.fora).toHaveLength(0)
    expect(r.dentro).toHaveLength(3)
  })
})

describe('intervalo de confiança da mediana', () => {
  it('com n ≤ 5 NENHUM intervalo de 95% existe — é o piso do critério', () => {
    // Nem o intervalo do menor ao maior valor atinge 95%: a cobertura máxima
    // é 1 − 2·2⁻ⁿ, que em n=5 dá 93,75%.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(intervaloMediana(n, 0.95)).toBeNull()
    }
    expect(intervaloMediana(6, 0.95)).not.toBeNull()
  })

  it('em n = 6 o intervalo é a amplitude inteira: existe, mas não estreita nada', () => {
    const iv = intervaloMediana(6, 0.95)!
    expect(iv.postoInferior).toBe(1)
    expect(iv.postoSuperior).toBe(6)
    expect(iv.larguraRelativa).toBe(1)
  })

  it('reproduz a tabela usada para definir as faixas', () => {
    const esperado: Record<number, [number, number]> = {
      6: [1, 6], 10: [2, 9], 12: [3, 10], 20: [6, 15],
      22: [6, 17], 30: [10, 21], 54: [20, 35],
    }
    for (const [n, [lo, hi]] of Object.entries(esperado)) {
      const iv = intervaloMediana(Number(n), 0.95)!
      expect([iv.postoInferior, iv.postoSuperior]).toEqual([lo, hi])
      expect(iv.cobertura).toBeGreaterThanOrEqual(0.95)
    }
  })

  it('o intervalo estreita conforme n cresce', () => {
    const larguras = [6, 12, 30, 54, 87].map((n) => intervaloMediana(n)!.larguraRelativa)
    for (let i = 1; i < larguras.length; i++) {
      expect(larguras[i]).toBeLessThan(larguras[i - 1])
    }
  })

  it('não estoura o cálculo do binomial em n grande', () => {
    const iv = intervaloMediana(500)!
    expect(Number.isFinite(iv.cobertura)).toBe(true)
    expect(iv.cobertura).toBeGreaterThanOrEqual(0.95)
  })

  it('aplica o intervalo a valores concretos', () => {
    const vs = Array.from({ length: 22 }, (_, i) => i + 1)
    const ic = icMediana(vs)!
    expect(ic.inferior).toBe(6)
    expect(ic.superior).toBe(17)
  })
})

describe('classificação de representatividade', () => {
  it('n = 0 e n = 1 são insuficientes', () => {
    expect(classificarAmostra(0).classe).toBe('insuficiente')
    expect(classificarAmostra(1).classe).toBe('insuficiente')
    expect(classificarAmostra(0).explicacao).toContain('Nenhuma operação')
  })

  it('as fronteiras caem onde a matemática as coloca', () => {
    expect(classificarAmostra(LIMITE_BAIXA - 1).classe).toBe('insuficiente')
    expect(classificarAmostra(LIMITE_BAIXA).classe).toBe('baixa')
    expect(classificarAmostra(LIMITE_MODERADA - 1).classe).toBe('baixa')
    expect(classificarAmostra(LIMITE_MODERADA).classe).toBe('moderada')
    expect(classificarAmostra(LIMITE_ALTA - 1).classe).toBe('moderada')
    expect(classificarAmostra(LIMITE_ALTA).classe).toBe('alta')
  })

  it('a carteira real: 22 encerradas é moderada', () => {
    const r = classificarAmostra(22)
    expect(r.classe).toBe('moderada')
    expect(r.permiteComparacao).toBe(true)
    expect(r.permiteRanking).toBe(false)
  })

  it('TRF-1, TJRJ e TRF-6 são insuficientes e não entram em comparação', () => {
    for (const n of [1, 2, 1]) {
      const r = classificarAmostra(n)
      expect(r.classe).toBe('insuficiente')
      expect(r.permiteComparacao).toBe(false)
      expect(r.permiteInsight).toBe(false)
    }
  })

  it('peso econômico é reportado à parte, nunca fundido na classe', () => {
    const r = classificarAmostra(5, 900000, 2196780)
    expect(r.classe).toBe('insuficiente')          // estatisticamente mudo
    expect(r.pesoEconomico!).toBeGreaterThan(0.4)  // economicamente decisivo
  })

  it('sem capital informado, o peso é null e não zero', () => {
    expect(classificarAmostra(10).pesoEconomico).toBeNull()
    expect(classificarAmostra(10, 100, 0).pesoEconomico).toBeNull()
  })

  it('a explicação é legível e sem jargão', () => {
    expect(classificarAmostra(2).explicacao).toContain('não sustenta conclusão')
    expect(classificarAmostra(40).explicacao).toContain('Base suficiente')
  })
})

describe('portões', () => {
  it('bloqueia TJGO contra TRF-1 e diz por quê', () => {
    const p = portaoComparacao('TJGO', 20, 'TRF-1', 1)
    expect(p.permitido).toBe(false)
    expect(p.motivo).toContain('TRF-1 (1)')
    expect(p.motivo).toContain('não é interpretável')
  })

  it('libera quando os dois lados chegam a moderado', () => {
    expect(portaoComparacao('A', 12, 'B', 15).permitido).toBe(true)
  })

  it('nomeia os dois grupos fracos quando ambos falham', () => {
    const p = portaoComparacao('TJRJ', 2, 'TRF-6', 1)
    expect(p.motivo).toContain('TJRJ (2)')
    expect(p.motivo).toContain('TRF-6 (1)')
  })

  it('ranking é impossível na carteira atual, e os inelegíveis ficam visíveis', () => {
    const grupos = [
      { nome: 'TJGO', n: 20 }, { nome: 'TRF-1', n: 1 },
      { nome: 'TJRJ', n: 2 }, { nome: 'TRF-6', n: 1 },
    ]
    const r = portaoRanking(grupos, (g) => g.n)
    expect(r.rankingPossivel).toBe(false)
    expect(r.inelegiveis).toHaveLength(4)
    expect(r.motivo).toContain('decidida por ruído')
  })

  it('ranking passa quando há dois grupos grandes', () => {
    const r = portaoRanking([{ n: 40 }, { n: 35 }, { n: 3 }], (g) => g.n)
    expect(r.rankingPossivel).toBe(true)
    expect(r.elegiveis).toHaveLength(2)
    expect(r.inelegiveis).toHaveLength(1)
  })
})

describe('concentração da carteira', () => {
  it('detecta a carteira monotribunal real', () => {
    const c = concentracao([
      { nome: 'TJGO', n: 87, capital: 1963027.39 },
      { nome: 'TRF-1', n: 3, capital: 78899.32 },
      { nome: 'TJRJ', n: 3, capital: 53608.30 },
      { nome: 'TRF-6', n: 2, capital: 101245.07 },
    ])!
    expect(c.maior).toBe('TJGO')
    expect(c.fracaoOperacoes).toBeCloseTo(0.916, 2)
    expect(c.fracaoCapital).toBeCloseTo(0.894, 2)
    expect(c.concentrada).toBe(true)
  })

  it('carteira equilibrada não é marcada como concentrada', () => {
    const c = concentracao([
      { nome: 'A', n: 30, capital: 100 },
      { nome: 'B', n: 35, capital: 100 },
      { nome: 'C', n: 30, capital: 100 },
    ])!
    expect(c.concentrada).toBe(false)
  })

  it('lista vazia devolve null', () => {
    expect(concentracao([])).toBeNull()
  })
})

describe('diferença entre grupos', () => {
  it('é reproduzível: mesma entrada, mesmo intervalo', () => {
    const a = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]
    const b = [20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42]
    const r1 = diferencaEntreGrupos(a, b, { reamostragens: 500 })!
    const r2 = diferencaEntreGrupos(a, b, { reamostragens: 500 })!
    expect(r1.inferior).toBe(r2.inferior)
    expect(r1.superior).toBe(r2.superior)
  })

  it('estima o deslocamento entre grupos claramente distintos', () => {
    const a = Array.from({ length: 20 }, (_, i) => i)
    const b = Array.from({ length: 20 }, (_, i) => i + 50)
    const r = diferencaEntreGrupos(a, b, { reamostragens: 500 })!
    expect(r.estimativa).toBeCloseTo(-50, 0)
    expect(r.intervaloExcluiZero).toBe(true)
  })

  it('grupos iguais produzem intervalo que contém zero', () => {
    const a = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
    const r = diferencaEntreGrupos(a, [...a], { reamostragens: 500 })!
    expect(r.estimativa).toBeCloseTo(0, 6)
    expect(r.intervaloExcluiZero).toBe(false)
  })

  it('o intervalo é largo quando um dos grupos é minúsculo', () => {
    const grande = Array.from({ length: 50 }, (_, i) => i)
    const r = diferencaEntreGrupos(grande, [10, 40], { reamostragens: 500 })!
    expect(r.superior - r.inferior).toBeGreaterThan(10)
    expect(r.nB).toBe(2)
  })

  it('grupo vazio devolve null em vez de fingir uma comparação', () => {
    expect(diferencaEntreGrupos([1, 2, 3], [])).toBeNull()
    expect(diferencaEntreGrupos([], [1, 2, 3])).toBeNull()
    expect(diferencaEntreGrupos([null, undefined], [1, 2])).toBeNull()
  })
})
