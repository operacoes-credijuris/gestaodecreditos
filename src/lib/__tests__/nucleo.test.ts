// Testes das regras de dinheiro do núcleo compartilhado.
//
// Os valores de referência não são inventados: saem da validação feita contra
// as 95 operações reais da carteira em 11/08/2026, com SELIC 14,72% e
// IPCA+2 = 6,64%. Onde um número aparece aqui, ele foi conferido contra o
// resultado que a plataforma produz hoje.
//
// Cobre os casos que o briefing do módulo de Inteligência Econômica exige:
// uma operação, muitas, muito pequena, muito grande, outlier, prazo curto,
// prazo longo, valores iguais, ausência de data, ausência de valor, operação
// aberta, operação encerrada e grupos de tamanhos muito diferentes.

import { describe, it, expect } from 'vitest'
import { diasEntre, mesesEntre } from '../../../supabase/functions/_shared/nucleo/datas.ts'
import { estaPago, diasEmCarteira } from '../../../supabase/functions/_shared/nucleo/pagamento.ts'
import {
  ipcaMais2,
  taxaAnual,
  valorProjetado,
  ganhoProjetado,
  retorno,
  retornoProjetadoCarteira,
  aReceberEstimado,
  tir,
  tirAgregada,
  type CreditoProjecao,
  type ParametrosAtualizacao,
} from '../../../supabase/functions/_shared/nucleo/projecao.ts'

const PARAMS: ParametrosAtualizacao = {
  selic_aa: 14.72,
  ipca_12m_aa: 4.64,
  data_referencia: '2026-08-10',
}
const HOJE = '2026-08-11'

/** Crédito mínimo válido; sobrescreva só o que o teste precisa. */
function credito(over: Partial<CreditoProjecao> = {}): CreditoProjecao {
  return {
    valor_face: 30000,
    data_referencia: '2025-01-01',
    expectativa_liquidacao: '2027-01-01',
    data_liquidacao: null,
    ja_recebido: null,
    indice_atualizacao: 'ipca_2',
    ...over,
  }
}

// ---------------------------------------------------------------------------
describe('datas', () => {
  it('conta dias entre duas datas ISO', () => {
    expect(diasEntre('2025-01-01', '2025-01-31')).toBe(30)
    expect(diasEntre('2024-02-01', '2024-03-01')).toBe(29) // ano bissexto
  })

  it('atravessa a virada do ano sem erro de fuso', () => {
    expect(diasEntre('2025-12-31', '2026-01-01')).toBe(1)
  })

  it('aceita timestamp e considera só a data', () => {
    expect(diasEntre('2025-01-01T23:59:00Z', '2025-01-02T00:01:00Z')).toBe(1)
  })

  it('devolve null para data ausente ou malformada', () => {
    expect(diasEntre(null, '2025-01-01')).toBeNull()
    expect(diasEntre('01/01/2025', '2025-01-01')).toBeNull()
    expect(diasEntre(undefined, '2025-01-01')).toBeNull()
  })

  it('aceita prazo negativo em diasEntre (quem filtra é a camada de cima)', () => {
    expect(diasEntre('2025-06-01', '2025-01-01')).toBe(-151)
  })

  it('conta meses inteiros quando o dia do mês coincide', () => {
    expect(mesesEntre('2025-01-15', '2025-04-15')).toBe(3)
    expect(mesesEntre('2025-01-15', '2026-01-15')).toBe(12)
  })

  it('devolve fração quando o dia não coincide', () => {
    const m = mesesEntre('2025-01-01', '2025-01-16')!
    expect(m).toBeGreaterThan(0.48)
    expect(m).toBeLessThan(0.49)
  })

  it('lida com o dia final anterior ao inicial', () => {
    const m = mesesEntre('2025-01-20', '2025-03-10')!
    expect(m).toBeGreaterThan(1.6)
    expect(m).toBeLessThan(1.7)
  })

  it('não quebra na virada de ano com dia final menor', () => {
    expect(mesesEntre('2025-12-20', '2026-01-10')).not.toBeNull()
    expect(mesesEntre('2025-12-20', '2026-01-10')!).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
describe('estaPago — a regra única', () => {
  it('é pago quando existe data de liquidação', () => {
    expect(estaPago('2026-01-15')).toBe(true)
    expect(estaPago('2026-01-15T10:00:00Z')).toBe(true)
  })

  it('não é pago sem data', () => {
    expect(estaPago(null)).toBe(false)
    expect(estaPago(undefined)).toBe(false)
    expect(estaPago('')).toBe(false)
  })

  it('LIMITAÇÃO CONHECIDA: qualquer texto não vazio é lido como pago', () => {
    // Documentado, não desejado. Se um dia o campo aceitar texto livre, isto
    // vira defeito. Hoje a coluna é DATE no banco, então não acontece.
    expect(estaPago('a definir')).toBe(true)
  })
})

describe('diasEmCarteira', () => {
  it('conta até hoje quando em aberto', () => {
    expect(diasEmCarteira('2026-08-01', null, HOJE)).toBe(10)
  })

  it('para na liquidação quando pago, e ignora a expectativa', () => {
    expect(diasEmCarteira('2026-01-01', '2026-03-02', HOJE)).toBe(60)
  })

  it('devolve null em prazo negativo em vez de imprimir número absurdo', () => {
    expect(diasEmCarteira('2026-08-01', '2025-08-01', HOJE)).toBeNull()
  })

  it('devolve null sem data de aquisição', () => {
    expect(diasEmCarteira(null, '2026-03-01', HOJE)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('índices', () => {
  it('IPCA + 2 é soma simples, por definição do produto', () => {
    expect(ipcaMais2(4.64)).toBeCloseTo(6.64, 10)
    expect(ipcaMais2(null)).toBeNull()
  })

  it('escolhe a taxa conforme o índice cadastrado', () => {
    expect(taxaAnual('selic', PARAMS)).toBe(14.72)
    expect(taxaAnual('ipca_2', PARAMS)).toBeCloseTo(6.64, 10)
    expect(taxaAnual('inexistente', PARAMS)).toBeNull()
    expect(taxaAnual('selic', undefined)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('valorProjetado', () => {
  it('operação encerrada devolve o REALIZADO, não uma projeção', () => {
    const p = valorProjetado(
      credito({ data_liquidacao: '2026-05-10', ja_recebido: 41234.56 }),
      PARAMS, HOJE,
    )
    expect(p.realizado).toBe(true)
    expect(p.valor).toBe(41234.56)
    expect(p.atualizadoAte).toBe('2026-05-10')
  })

  it('encerrada sem valor recebido não inventa número', () => {
    const p = valorProjetado(
      credito({ data_liquidacao: '2026-05-10', ja_recebido: null }), PARAMS, HOJE,
    )
    expect(p.valor).toBeNull()
    expect(p.motivo).toBeTruthy()
  })

  it('operação aberta corrige o face por juros SIMPLES até a expectativa', () => {
    // 1 ano exato a 6,64% -> 30.000 × 1,0664
    const p = valorProjetado(
      credito({ data_referencia: '2026-01-01', expectativa_liquidacao: '2027-01-01' }),
      PARAMS, HOJE,
    )
    expect(p.realizado).toBe(false)
    expect(p.valor).toBeCloseTo(31992, 2)
    expect(p.expectativaVencida).toBe(false)
  })

  it('previsão vencida corrige até HOJE, não até a data vencida', () => {
    const vencido = valorProjetado(
      credito({ data_referencia: '2025-08-11', expectativa_liquidacao: '2026-01-01' }),
      PARAMS, HOJE,
    )
    expect(vencido.expectativaVencida).toBe(true)
    expect(vencido.atualizadoAte).toBe(HOJE)
    // 1 ano de correção, não os ~5 meses até a data vencida
    expect(vencido.valor).toBeCloseTo(31992, 2)
  })

  it('prazo negativo não encolhe o valor: o piso é o próprio face', () => {
    const p = valorProjetado(
      credito({ data_referencia: '2027-06-01', expectativa_liquidacao: '2027-01-01' }),
      PARAMS, HOJE,
    )
    expect(p.valor).toBe(30000)
  })

  it('explica a ausência em vez de devolver só null', () => {
    for (const over of [
      { valor_face: null },
      { indice_atualizacao: null },
      { data_referencia: null },
      { expectativa_liquidacao: null },
    ] as Partial<CreditoProjecao>[]) {
      const p = valorProjetado(credito(over), PARAMS, HOJE)
      expect(p.valor).toBeNull()
      expect(p.motivo).toBeTruthy()
    }
  })

  it('sem parâmetro de índice cadastrado, avisa onde preencher', () => {
    const p = valorProjetado(credito(), { selic_aa: null, ipca_12m_aa: null, data_referencia: null }, HOJE)
    expect(p.valor).toBeNull()
    expect(p.motivo).toContain('Parâmetro')
  })
})

// ---------------------------------------------------------------------------
describe('ganho e retorno', () => {
  it('o complementar é RECEBÍVEL, soma ao ganho — nunca custo', () => {
    // Caso real da carteira: capital 7.681,17 / recebido 10.248,89 /
    // complementar 839,81 -> ganho 3.407,53
    const proj = valorProjetado(
      credito({ data_liquidacao: '2026-08-01', ja_recebido: 10248.89 }), PARAMS, HOJE,
    )
    expect(ganhoProjetado(proj, 7681.17, 839.81)).toBeCloseTo(3407.53, 2)
  })

  it('tratar o complementar como custo dobraria o erro', () => {
    const proj = valorProjetado(
      credito({ data_liquidacao: '2026-08-01', ja_recebido: 10248.89 }), PARAMS, HOJE,
    )
    const certo = ganhoProjetado(proj, 7681.17, 839.81)!
    const errado = 10248.89 - 839.81 - 7681.17
    expect(certo - errado).toBeCloseTo(2 * 839.81, 2)
  })

  it('retorno é percentual sobre o capital', () => {
    expect(retorno(3407.53, 7681.17)).toBeCloseTo(44.36, 1)
  })

  it('capital zero ou negativo não gera retorno infinito', () => {
    expect(retorno(1000, 0)).toBeNull()
    expect(retorno(1000, -5)).toBeNull()
    expect(retorno(null, 1000)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('TIR individual', () => {
  it('anualiza de forma composta', () => {
    // dobra o capital em 365 dias -> 100% a.a.
    const proj = valorProjetado(
      credito({ data_liquidacao: '2026-01-01', ja_recebido: 20000 }), PARAMS, HOJE,
    )
    const t = tir(10000, '2025-01-01', proj)
    expect(t.anual).toBeCloseTo(100, 1)
    expect(t.dias).toBe(365)
  })

  it('a taxa mensal é equivalente à anual, não a anual dividida por 12', () => {
    const proj = valorProjetado(
      credito({ data_liquidacao: '2026-01-01', ja_recebido: 20000 }), PARAMS, HOJE,
    )
    const t = tir(10000, '2025-01-01', proj)
    expect(t.mensal).toBeCloseTo(5.95, 1)   // 2^(1/12)-1, não 100/12
    expect(t.mensal).not.toBeCloseTo(8.33, 1)
  })

  it('OUTLIER REAL DA CARTEIRA: 12 dias com 21,8% de ganho vira ~40.000% a.a.', () => {
    // A operação existe e o número está correto para ela. O teste fixa o
    // comportamento para que ninguém "conserte" isso silenciosamente — a
    // defesa correta é a mediana e a TIR agregada, não mexer nesta conta.
    const proj = valorProjetado(
      credito({ data_liquidacao: '2026-08-01', ja_recebido: 10248.89 }), PARAMS, HOJE,
    )
    const t = tir(7681.17, '2026-07-20', proj)
    expect(t.dias).toBe(12)
    expect(t.anual!).toBeGreaterThan(30000)
  })

  it('prazo longo diminui a taxa anualizada para o mesmo ganho', () => {
    const proj = valorProjetado(
      credito({ data_liquidacao: '2028-01-01', ja_recebido: 13000 }), PARAMS, HOJE,
    )
    const longo = tir(10000, '2025-01-01', proj)!
    const projCurto = valorProjetado(
      credito({ data_liquidacao: '2025-11-01', ja_recebido: 13000 }), PARAMS, HOJE,
    )
    const curto = tir(10000, '2025-01-01', projCurto)!
    expect(curto.anual!).toBeGreaterThan(longo.anual!)
  })

  it('recusa prazo nulo em vez de dividir por zero', () => {
    const proj = valorProjetado(
      credito({ data_liquidacao: '2026-01-01', ja_recebido: 20000 }), PARAMS, HOJE,
    )
    expect(tir(10000, '2026-01-01', proj).anual).toBeNull()
  })

  it('recusa capital ausente, capital zero e valor ausente', () => {
    const proj = valorProjetado(
      credito({ data_liquidacao: '2026-01-01', ja_recebido: 20000 }), PARAMS, HOJE,
    )
    expect(tir(null, '2025-01-01', proj).anual).toBeNull()
    expect(tir(0, '2025-01-01', proj).anual).toBeNull()
    expect(tir(10000, null, proj).anual).toBeNull()
    expect(tir(10000, '2025-01-01', { valor: null, realizado: false }).anual).toBeNull()
  })

  it('o prazo vem da data do VALOR, não de hoje', () => {
    // Crédito em aberto com expectativa futura: casar o valor futuro com
    // "dias em carteira" até hoje inflaria a TIR de forma grosseira.
    const proj = valorProjetado(
      credito({ data_referencia: '2026-01-01', expectativa_liquidacao: '2027-01-01' }),
      PARAMS, HOJE,
    )
    const t = tir(25000, '2026-07-12', proj)
    expect(t.ate).toBe('2027-01-01')
    expect(t.dias).toBe(173)
  })
})

// ---------------------------------------------------------------------------
describe('agregados da carteira', () => {
  const item = (capital: number, valor: number, dias: number) => ({ capital, valor, dias })

  it('uma única operação: o agregado é ela mesma', () => {
    const r = tirAgregada([item(10000, 20000, 365)])
    expect(r.considerados).toBe(1)
    expect(r.valor).toBeCloseTo(100, 1)
    expect(r.prazoMedioDias).toBe(365)
  })

  it('NÃO é a média das TIRs: o crédito de 12 dias não domina a carteira', () => {
    const carteira = [
      item(7681.17, 10248.89, 12),      // TIR individual ~40.000%
      item(1000000, 1300000, 365),
      item(1200000, 1560000, 365),
    ]
    const agregada = tirAgregada(carteira).valor!
    expect(agregada).toBeGreaterThan(25)
    expect(agregada).toBeLessThan(60)     // e não centenas de %
  })

  it('grupos de tamanhos muito diferentes: o capital manda no prazo médio', () => {
    const r = tirAgregada([item(1000, 1100, 30), item(999000, 1098900, 365)])
    expect(r.prazoMedioDias!).toBeGreaterThan(360)
  })

  it('valores iguais: o resultado é o retorno de qualquer um deles', () => {
    const iguais = Array.from({ length: 20 }, () => item(20000, 24000, 365))
    expect(tirAgregada(iguais).valor).toBeCloseTo(20, 6)
  })

  it('operação muito pequena e muito grande convivem sem estourar', () => {
    const r = tirAgregada([item(1, 2, 365), item(5_000_000, 6_000_000, 365)])
    expect(Number.isFinite(r.valor!)).toBe(true)
  })

  it('crédito sem dado fica fora das duas somas, não entra como zero', () => {
    const r = tirAgregada([
      item(10000, 20000, 365),
      { capital: null, valor: 5000, dias: 100 },
      { capital: 10000, valor: null, dias: 100 },
      { capital: 10000, valor: 15000, dias: undefined },
      { capital: 0, valor: 5000, dias: 100 },
    ])
    expect(r.considerados).toBe(1)
    expect(r.valor).toBeCloseTo(100, 1)
  })

  it('lista vazia devolve null, não zero', () => {
    const r = tirAgregada([])
    expect(r.valor).toBeNull()
    expect(r.considerados).toBe(0)
  })

  it('retorno da carteira é ponderado pelo capital, não média de percentuais', () => {
    // 50% num crédito de 10 mil e 20% num de 800 mil.
    // Média simples daria 35%; a ponderada fica perto de 20%.
    const r = retornoProjetadoCarteira([
      { ganho: 5000, capital: 10000 },
      { ganho: 160000, capital: 800000 },
    ])
    expect(r.valor).toBeCloseTo(20.37, 1)
    expect(r.considerados).toBe(2)
  })

  it('ganho incalculável não derruba o denominador', () => {
    const r = retornoProjetadoCarteira([
      { ganho: 5000, capital: 10000 },
      { ganho: null, capital: 800000 },
    ])
    expect(r.valor).toBeCloseTo(50, 6)
    expect(r.considerados).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('a receber estimado', () => {
  const proj = (valor: number | null) => ({ valor, realizado: false })

  it('soma projeções em aberto e o complementar de qualquer crédito', () => {
    const r = aReceberEstimado([
      { proj: proj(100000), dataLiquidacao: null, valorComplementar: null },
      { proj: proj(50000), dataLiquidacao: '2026-01-01', valorComplementar: 5000 },
    ])
    // o liquidado entra só com o complementar; o principal já entrou
    expect(r.total).toBe(105000)
    expect(r.emAberto).toBe(1)
    expect(r.complementares).toBe(1)
  })

  it('crédito em aberto sem projeção conta como incalculável, não como zero', () => {
    const r = aReceberEstimado([
      { proj: proj(null), dataLiquidacao: null, valorComplementar: null },
    ])
    expect(r.incalculaveis).toBe(1)
    expect(r.total).toBeNull()
  })

  it('carteira toda liquidada e sem complementar devolve null, não R$ 0,00', () => {
    const r = aReceberEstimado([
      { proj: proj(50000), dataLiquidacao: '2026-01-01', valorComplementar: null },
    ])
    expect(r.total).toBeNull()
  })
})
