// Testes da agregação, forecast, anomalias e insights.
//
// A carteira sintética abaixo reproduz a forma da carteira real de 11/08/2026:
// concentração num tribunal só, 32 operações em realização parcial, previsões
// vencidas e um crédito de 12 dias com TIR absurda. Não são os dados reais —
// são o formato deles, para que os testes cubram os casos que existem de fato.

import { describe, it, expect } from 'vitest'
import type { OperacaoAnalitica } from '../../../supabase/functions/_shared/nucleo/tipos.ts'
import { elegivelPerformance, populacaoDe } from '../../../supabase/functions/_shared/nucleo/tipos.ts'
import {
  resumoGrupo, agruparPor, faixasPorQuartil, curvasDeSafra, aderenciaPrevisao,
} from '../../../supabase/functions/_shared/nucleo/agregacao.ts'
import {
  forecastNominal, ajusteHistorico, desviosObservados,
} from '../../../supabase/functions/_shared/nucleo/forecast.ts'
import { detectarAnomalias } from '../../../supabase/functions/_shared/nucleo/anomalias.ts'
import { gerarInsights } from '../../../supabase/functions/_shared/nucleo/insights.ts'
import { concentracao } from '../../../supabase/functions/_shared/nucleo/amostra.ts'
import { normalizarNome } from '../../../supabase/functions/_shared/nucleo/texto.ts'

const HOJE = '2026-08-11'

function op(over: Partial<OperacaoAnalitica> = {}): OperacaoAnalitica {
  return {
    ref: Math.random().toString(36).slice(2, 10),
    numeroCnj: '0000000-00.2025.8.09.0001',
    tribunal: 'TJGO',
    ente: 'Estado de Goiás',
    investidor: 'Fulano de Tal',
    status: 'encerrado',
    dataAquisicao: '2025-01-10',
    dataReferencia: '2024-05-01',
    expectativaLiquidacao: '2025-10-31',
    dataLiquidacao: '2025-11-15',
    capitalInvestido: 20000,
    valorFace: 25000,
    jaRecebido: 27000,
    valorComplementar: null,
    indice: 'ipca_2',
    valor: 27000,
    valorAte: '2025-11-15',
    motivoSemValor: null,
    ganho: 7000,
    retorno: 0.35,
    tirAnual: 0.42,
    prazoDias: 309,
    previsaoVencida: false,
    diasVencida: null,
    ...over,
  }
}

/** Carteira com a forma da real: concentrada, com parciais e vencidas. */
function carteiraSintetica(): OperacaoAnalitica[] {
  const encerradas = Array.from({ length: 20 }, (_, i) =>
    op({ ref: `enc${i}`, retorno: 0.14 + i * 0.02, tirAnual: 0.18 + i * 0.03, prazoDias: 100 + i * 18 }))
  // O crédito de 12 dias: ganho normal, TIR absurda. Existe na carteira real.
  const relampago = op({
    ref: 'relampago', dataAquisicao: '2026-07-20', dataLiquidacao: '2026-08-01',
    capitalInvestido: 7681.17, jaRecebido: 10248.89, valor: 10248.89,
    ganho: 2567.72, retorno: 0.218, tirAnual: 404.26, prazoDias: 12,
  })
  const parciais = Array.from({ length: 32 }, (_, i) =>
    op({
      ref: `par${i}`, status: 'complementar', jaRecebido: 22000, valor: 22000,
      valorComplementar: 3000, ganho: 5000, retorno: 0.25,
    }))
  const abertas = Array.from({ length: 8 }, (_, i) =>
    op({
      ref: `ab${i}`, status: 'ativo', dataLiquidacao: null, jaRecebido: null,
      expectativaLiquidacao: `2026-1${i % 2}-15`, valor: 26000, ganho: null,
      retorno: null, tirAnual: null, prazoDias: null,
    }))
  const vencidas = Array.from({ length: 6 }, (_, i) =>
    op({
      ref: `venc${i}`, status: 'ativo', dataLiquidacao: null, jaRecebido: null,
      expectativaLiquidacao: '2025-12-31', valor: 30000, ganho: null,
      retorno: null, tirAnual: null, prazoDias: null,
      previsaoVencida: true, diasVencida: 223,
    }))
  const outrosTribunais = [
    op({ ref: 'trf1', tribunal: 'TRF-1', ente: 'INSS' }),
    op({ ref: 'tjrj', tribunal: 'TJRJ', ente: 'Estado do Rio de Janeiro' }),
    op({ ref: 'trf6', tribunal: 'TRF-6', ente: 'União' }),
  ]
  return [...encerradas, relampago, ...parciais, ...abertas, ...vencidas, ...outrosTribunais]
}

describe('populações', () => {
  it('separa encerrada, parcial e aberta', () => {
    expect(populacaoDe(op({ status: 'encerrado' }))).toBe('encerrada')
    expect(populacaoDe(op({ status: 'complementar' }))).toBe('parcial')
    expect(populacaoDe(op({ status: 'ativo' }))).toBe('aberta')
  })

  it('complementar NÃO é elegível para performance, mesmo com data e valor', () => {
    const parcial = op({ status: 'complementar', dataLiquidacao: '2026-01-01', jaRecebido: 30000 })
    expect(elegivelPerformance(parcial)).toBe(false)
  })

  it('encerrada sem um dos quatro dados fica de fora', () => {
    expect(elegivelPerformance(op({ capitalInvestido: null }))).toBe(false)
    expect(elegivelPerformance(op({ capitalInvestido: 0 }))).toBe(false)
    expect(elegivelPerformance(op({ jaRecebido: null }))).toBe(false)
    expect(elegivelPerformance(op({ dataLiquidacao: null }))).toBe(false)
    expect(elegivelPerformance(op({ dataAquisicao: null }))).toBe(false)
    expect(elegivelPerformance(op())).toBe(true)
  })
})

describe('resumoGrupo', () => {
  const carteira = carteiraSintetica()

  it('só conta as encerradas na performance', () => {
    const r = resumoGrupo('Carteira', carteira)
    expect(r.total).toBe(carteira.length)
    expect(r.n).toBe(carteira.filter(elegivelPerformance).length)
    expect(r.n).toBeLessThan(r.total)
  })

  it('misturar as parciais derrubaria a rentabilidade — e é por isso que não se mistura', () => {
    const soEncerradas = resumoGrupo('E', carteira.filter((o) => o.status === 'encerrado'))
    const misturado = resumoGrupo('M', carteira.map((o) =>
      o.status === 'complementar' ? { ...o, status: 'encerrado' } : o))
    expect(misturado.retornoPonderado!).toBeLessThan(soEncerradas.retornoPonderado!)
  })

  it('marca o crédito de 12 dias como extremo, sem removê-lo', () => {
    const r = resumoGrupo('Carteira', carteira)
    expect(r.extremosTir).toContain('relampago')
    expect(r.tir.n).toBe(r.n)          // continua dentro da distribuição
    expect(r.tir.maximo).toBeGreaterThan(100)
  })

  it('conta as encerradas descartadas por falta de dado', () => {
    const r = resumoGrupo('X', [op(), op({ capitalInvestido: null }), op({ jaRecebido: null })])
    expect(r.n).toBe(1)
    expect(r.excluidas).toBe(2)
  })

  it('publica o IC da mediana quando há base, e null quando não há', () => {
    expect(resumoGrupo('grande', Array.from({ length: 20 }, (_, i) =>
      op({ ref: `g${i}`, retorno: i / 100 }))).retornoIC).not.toBeNull()
    expect(resumoGrupo('pequeno', [op(), op()]).retornoIC).toBeNull()
  })

  it('os três totais do grupo contam TODAS as operações, não só as elegíveis', () => {
    // Uma encerrada, uma em aberto e uma em complementar. As duas últimas
    // ficam fora da performance, mas o dinheiro delas é do investidor do mesmo
    // jeito — é isso que "já investiu / já recebeu / falta receber" responde.
    const r = resumoGrupo('X', [
      op({ status: 'encerrado', capitalInvestido: 10000, jaRecebido: 13000, dataLiquidacao: '2025-11-15' }),
      op({
        status: 'ativo', capitalInvestido: 5000, jaRecebido: null,
        dataLiquidacao: null, valor: 6500, valorComplementar: null,
      }),
      op({
        status: 'complementar', capitalInvestido: 4000, jaRecebido: 4200,
        dataLiquidacao: '2026-01-20', valorComplementar: 900,
      }),
    ])

    expect(r.capitalTotal).toBe(19000)    // 10.000 + 5.000 + 4.000
    expect(r.recebidoTotal).toBe(17200)   // 13.000 + 4.200
    expect(r.aReceber).toBe(7400)         // 6.500 projetados + 900 complementar

    // O denominador da performance segue sendo só o da encerrada.
    expect(r.n).toBe(1)
    expect(r.capitalInvestido).toBe(10000)
  })

  it('em aberto sem valor projetável não vira zero no a receber', () => {
    // Entrar com zero afirmaria "não há nada a receber" onde o que falta é
    // cadastro de índice. Ela sai do total em vez de rebaixá-lo.
    const r = resumoGrupo('X', [
      op({ status: 'ativo', capitalInvestido: 5000, jaRecebido: null, dataLiquidacao: null, valor: 6000 }),
      op({
        status: 'ativo', capitalInvestido: 5000, jaRecebido: null,
        dataLiquidacao: null, valor: null, motivoSemValor: 'sem índice',
      }),
    ])
    expect(r.aReceber).toBe(6000)
    expect(r.capitalTotal).toBe(10000)
  })

  it('grupo vazio não quebra e devolve nulos, não zeros', () => {
    const r = resumoGrupo('vazio', [])
    expect(r.n).toBe(0)
    expect(r.retornoPonderado).toBeNull()
    expect(r.retorno.mediana).toBeNull()
    expect(r.representatividade.classe).toBe('insuficiente')
  })
})

describe('agrupamento', () => {
  it('une grafias separadas por espaço invisível — o caso real da tabulação', () => {
    const grupos = agruparPor(
      [op({ ente: 'Município de Goiânia' }), op({ ente: 'Município de Goiânia\t' })],
      (o) => o.ente,
    )
    expect(grupos).toHaveLength(1)
    expect(grupos[0].total).toBe(2)
  })

  it('exibe a grafia original mesmo agrupando pela chave normalizada', () => {
    // O caso real: a chave de investidor passa por normalizarNome, que tira
    // acento e baixa a caixa. Sem `rotulo`, a tela mostrava "ercilio martins".
    const grupos = agruparPor(
      [op({ investidor: 'Ercílio Martins' }), op({ investidor: 'ercilio  martins' })],
      (o) => (o.investidor ? normalizarNome(o.investidor) : null),
      '(sem investidor)',
      (o) => o.investidor,
    )
    expect(grupos).toHaveLength(1)
    expect(grupos[0].nome).toBe('ercilio martins')
    expect(grupos[0].rotulo).toBe('Ercílio Martins')
  })

  it('sem resolvedor de rótulo, o rótulo é a própria chave', () => {
    const grupos = agruparPor([op({ tribunal: 'TJGO' })], (o) => o.tribunal)
    expect(grupos[0].rotulo).toBe('TJGO')
  })

  it('rotula o vazio em vez de descartar a operação', () => {
    const grupos = agruparPor([op({ tribunal: null }), op({ tribunal: '  ' })], (o) => o.tribunal, '(sem tribunal)')
    expect(grupos[0].nome).toBe('(sem tribunal)')
    expect(grupos[0].total).toBe(2)
  })

  it('detecta a concentração monotribunal', () => {
    const grupos = agruparPor(carteiraSintetica(), (o) => o.tribunal)
    const c = concentracao(grupos.map((g) => ({ nome: g.nome, n: g.total, capital: g.capitalInvestido })))!
    expect(c.maior).toBe('TJGO')
    expect(c.concentrada).toBe(true)
  })

  it('grupos minúsculos não passam no portão de comparação', () => {
    const grupos = agruparPor(carteiraSintetica(), (o) => o.tribunal)
    const pequenos = grupos.filter((g) => g.nome !== 'TJGO')
    expect(pequenos.every((g) => !g.representatividade.permiteComparacao)).toBe(true)
  })
})

describe('faixas por quartil', () => {
  it('deriva os cortes dos dados, não de valores fixos', () => {
    const ops = [10000, 20000, 30000, 40000, 50000].map((c, i) =>
      op({ ref: `f${i}`, capitalInvestido: c }))
    const f = faixasPorQuartil(ops)
    expect(f.cortes.q1).toBe(20000)
    expect(f.cortes.mediana).toBe(30000)
    expect(f.cortes.q3).toBe(40000)
  })

  it('avisa quando a carteira é homogênea demais para o recorte significar algo', () => {
    const homogenea = Array.from({ length: 20 }, (_, i) =>
      op({ ref: `h${i}`, capitalInvestido: 20000 + i * 500 }))
    expect(faixasPorQuartil(homogenea).homogenea).toBe(true)

    const dispersa = Array.from({ length: 20 }, (_, i) =>
      op({ ref: `d${i}`, capitalInvestido: 1000 * Math.pow(1.5, i) }))
    expect(faixasPorQuartil(dispersa).homogenea).toBe(false)
  })
})

describe('curva de safra', () => {
  const ops = [
    // 2025: madura, devolveu cedo
    ...Array.from({ length: 10 }, (_, i) => op({
      ref: `a${i}`, dataAquisicao: '2025-01-15', dataLiquidacao: '2025-05-15',
      capitalInvestido: 10000, jaRecebido: 13000,
    })),
    // 2026: recente, só duas encerradas
    ...Array.from({ length: 10 }, (_, i) => op({
      ref: `b${i}`, dataAquisicao: '2026-02-15',
      dataLiquidacao: i < 2 ? '2026-04-15' : null,
      jaRecebido: i < 2 ? 13000 : null, capitalInvestido: 10000,
      status: i < 2 ? 'encerrado' : 'ativo',
    })),
  ]

  it('trunca a comparação na idade da safra mais nova', () => {
    const c = curvasDeSafra(ops, HOJE)
    expect(c.curvas.map((x) => x.safra)).toEqual(['2025', '2026'])
    expect(c.tetoComparavel).toBeLessThan(Math.max(...c.curvas.map((x) => x.idadeMaxima)))
  })

  it('a taxa de encerramento expõe a diferença de maturidade', () => {
    const c = curvasDeSafra(ops, HOJE)
    const s2025 = c.curvas.find((x) => x.safra === '2025')!
    const s2026 = c.curvas.find((x) => x.safra === '2026')!
    expect(s2025.taxaEncerramento).toBe(1)
    expect(s2026.taxaEncerramento).toBeCloseTo(0.2, 2)
  })

  it('na mesma idade, conta só quem teve tempo de chegar lá', () => {
    const c = curvasDeSafra(ops, HOJE)
    for (const curva of c.curvas) {
      for (const p of curva.pontos) {
        expect(p.nDisponivel).toBeGreaterThan(0)
        expect(p.fracaoDevolvida).toBeGreaterThanOrEqual(0)
        expect(p.fracaoDevolvida).toBeLessThanOrEqual(1.5)
      }
    }
  })

  it('carteira sem data de aquisição não quebra a curva', () => {
    const c = curvasDeSafra([op({ dataAquisicao: null })], HOJE)
    expect(c.curvas).toHaveLength(0)
    expect(c.tetoComparavel).toBe(0)
  })
})

describe('forecast', () => {
  const carteira = carteiraSintetica()
  const f = forecastNominal(carteira, HOJE)

  it('previsão vencida vira bloco próprio, nunca mês futuro', () => {
    const bloco = f.blocos.find((b) => b.rotulo === 'Previsão vencida')!
    expect(bloco.operacoes).toBe(6)
    expect(f.meses.every((m) => m.mes >= HOJE.slice(0, 7))).toBe(true)
  })

  it('o complementar entra como bloco sem data', () => {
    const bloco = f.blocos.find((b) => b.rotulo === 'Complementar a receber')!
    expect(bloco.operacoes).toBe(32)
    expect(bloco.valor).toBe(32 * 3000)
  })

  it('a fração vencida é calculada sobre o total geral', () => {
    expect(f.fracaoVencida).toBeGreaterThan(0)
    expect(f.fracaoVencida).toBeLessThan(1)
  })

  it('operação aberta sem valor calculável conta em incalculáveis, não em zero', () => {
    const g = forecastNominal(
      [op({ status: 'ativo', dataLiquidacao: null, valor: null, expectativaLiquidacao: '2027-01-01' })],
      HOJE,
    )
    expect(g.incalculaveis).toBe(1)
    expect(g.totalFuturo).toBe(0)
    expect(g.meses).toHaveLength(0)
  })

  it('cada mês guarda as refs, para chegar da soma até as linhas', () => {
    for (const m of f.meses) expect(m.refs).toHaveLength(m.operacoes)
  })

  it('carteira toda encerrada devolve forecast vazio, sem erro', () => {
    const g = forecastNominal([op()], HOJE)
    expect(g.meses).toHaveLength(0)
    expect(g.totalGeral).toBe(0)
    expect(g.fracaoVencida).toBe(0)
  })
})

describe('ajuste histórico do forecast', () => {
  it('fica BLOQUEADO com poucas observações, e diz quantas faltam', () => {
    const a = ajusteHistorico([10, 20, 30, 40, 50], [], HOJE)
    expect(a.disponivel).toBe(false)
    if (!a.disponivel) {
      expect(a.observacoes).toBe(5)
      expect(a.necessarias).toBe(30)
      expect(a.mensagem).toContain('Histórico insuficiente')
    }
  })

  it('a carteira real de hoje, com 13 observações, continua bloqueada', () => {
    const treze = [-138, -40, -12, 5, 12, 28, 31, 44, 90, 180, 240, 320, 366]
    expect(ajusteHistorico(treze, [], HOJE).disponivel).toBe(false)
  })

  it('libera a partir de 30 e produz dois cenários, nunca um ponto só', () => {
    const trinta = Array.from({ length: 30 }, (_, i) => i * 3)
    const abertas = [op({
      status: 'ativo', dataLiquidacao: null, expectativaLiquidacao: '2026-12-15', valor: 50000,
    })]
    const a = ajusteHistorico(trinta, abertas, HOJE)
    expect(a.disponivel).toBe(true)
    if (a.disponivel) {
      expect(a.cenarioMediano.length).toBeGreaterThan(0)
      expect(a.cenarioConservador.length).toBeGreaterThan(0)
      expect(a.desvioP75).toBeGreaterThanOrEqual(a.desvioMediano)
      expect(a.metodologia).toContain('conservador')
    }
  })

  it('extrai os desvios só de quem tem previsão E pagamento', () => {
    const d = desviosObservados([
      op({ expectativaLiquidacao: '2025-11-01', dataLiquidacao: '2025-11-15' }),
      op({ expectativaLiquidacao: null }),
      op({ dataLiquidacao: null, status: 'ativo' }),
    ])
    expect(d).toEqual([14])
  })
})

describe('aderência das previsões', () => {
  it('conta separadamente as pagas sem previsão registrada', () => {
    const a = aderenciaPrevisao([
      op({ expectativaLiquidacao: '2025-11-01', dataLiquidacao: '2025-11-15' }),
      op({ expectativaLiquidacao: null, dataLiquidacao: '2025-11-15' }),
    ])
    expect(a.n).toBe(1)
    expect(a.semPrevisao).toBe(1)
  })

  it('separa pagas no prazo das pagas depois', () => {
    const a = aderenciaPrevisao([
      op({ expectativaLiquidacao: '2025-12-01', dataLiquidacao: '2025-11-15' }),
      op({ expectativaLiquidacao: '2025-11-01', dataLiquidacao: '2025-11-15' }),
    ])
    expect(a.pagasAteAPrevisao).toBe(1)
    expect(a.pagasDepois).toBe(1)
  })
})

describe('anomalias', () => {
  it('acha contradição lógica e a classifica como impossibilidade', () => {
    const r = detectarAnomalias([op({ status: 'encerrado', dataLiquidacao: null })], HOJE)
    const a = r.achados.find((x) => x.regra === 'encerrado_sem_data')!
    expect(a.natureza).toBe('impossibilidade')
    expect(a.gravidade).toBe('alta')
  })

  it('NÃO acusa data-base anterior à aquisição — isso é o normal do negócio', () => {
    const r = detectarAnomalias([op({ dataReferencia: '2023-01-01', dataAquisicao: '2025-01-10' })], HOJE)
    expect(r.achados.some((a) => a.regra.includes('referencia_antes'))).toBe(false)
  })

  it('acusa data-base no futuro, que é impossível de verdade', () => {
    const r = detectarAnomalias([op({ dataReferencia: '2027-01-01' })], HOJE)
    expect(r.achados.some((a) => a.regra === 'referencia_no_futuro')).toBe(true)
  })

  it('detecta o espaço invisível no nome do ente', () => {
    const r = detectarAnomalias([op({ ente: 'Município de Goiânia\t' })], HOJE)
    expect(r.achados.some((a) => a.regra === 'texto_com_espaco')).toBe(true)
  })

  it('CNJ repetido é SINAL, não erro — pode ser aquisição complementar', () => {
    const r = detectarAnomalias([op({ numeroCnj: 'X' }), op({ numeroCnj: 'X' })], HOJE)
    const a = r.achados.find((x) => x.regra === 'cnj_duplicado')!
    expect(a.natureza).toBe('sinal')
    expect(a.refs).toHaveLength(2)
  })

  it('extremo de TIR é sinal de gravidade baixa, e o texto diz que nada foi excluído', () => {
    const r = detectarAnomalias(carteiraSintetica(), HOJE)
    const a = r.achados.find((x) => x.regra === 'tir_extrema')
    expect(a?.natureza).toBe('sinal')
    expect(a?.orientacao).toContain('Não foi excluído')
  })

  it('carteira limpa devolve lista vazia e o aviso mesmo assim', () => {
    const r = detectarAnomalias([op()], HOJE)
    expect(r.achados).toHaveLength(0)
    expect(r.aviso).toContain('requer revisão')
  })

  it('ordena por gravidade: alta primeiro', () => {
    const r = detectarAnomalias(carteiraSintetica(), HOJE)
    const g = r.achados.map((a) => a.gravidade)
    expect(g).toEqual([...g].sort((x, y) =>
      ({ alta: 0, media: 1, baixa: 2 })[x] - ({ alta: 0, media: 1, baixa: 2 })[y]))
  })
})

describe('insights', () => {
  function montar(ops: OperacaoAnalitica[]) {
    const carteira = resumoGrupo('Carteira', ops)
    const porTribunal = agruparPor(ops, (o) => o.tribunal)
    const porEnte = agruparPor(ops, (o) => o.ente)
    return gerarInsights({
      operacoes: ops,
      carteira,
      porTribunal,
      porEnte,
      safras: curvasDeSafra(ops, HOJE),
      aderencia: aderenciaPrevisao(ops),
      forecast: forecastNominal(ops, HOJE),
      anomalias: detectarAnomalias(ops, HOJE),
    })
  }

  it('todo insight traz a base junto do texto', () => {
    for (const i of montar(carteiraSintetica())) {
      expect(i.texto.length).toBeGreaterThan(20)
      expect(i.base.length).toBeGreaterThan(10)
    }
  })

  it('a previsão vencida vem em primeiro lugar', () => {
    const is = montar(carteiraSintetica())
    expect(is[0].chave).toBe('previsao_vencida')
  })

  it('avisa da concentração monotribunal', () => {
    expect(montar(carteiraSintetica()).some((i) => i.chave === 'concentracao')).toBe(true)
  })

  it('explica por que as parciais ficam fora', () => {
    const i = montar(carteiraSintetica()).find((x) => x.chave === 'complementar')!
    expect(i.texto).toContain('subestimando')
  })

  it('NÃO gera insight de aderência com amostra insuficiente', () => {
    const poucas = [
      op({ expectativaLiquidacao: '2025-11-01', dataLiquidacao: '2025-11-15' }),
      op({ expectativaLiquidacao: '2025-11-01', dataLiquidacao: '2025-12-15' }),
    ]
    expect(montar(poucas).some((i) => i.chave === 'aderencia')).toBe(false)
  })

  it('carteira vazia não gera insight nenhum, em vez de gerar frase vazia', () => {
    expect(montar([])).toHaveLength(0)
  })

  it('sai ordenado por prioridade', () => {
    const p = montar(carteiraSintetica()).map((i) => i.prioridade)
    expect(p).toEqual([...p].sort((a, b) => a - b))
  })
})
