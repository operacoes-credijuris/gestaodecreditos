import { describe, it, expect } from 'vitest'
import {
  custoParaPreco,
  type RegraAto,
  type Acrescimo,
} from '../../../supabase/functions/_shared/emolumentos-calculo.ts'

/**
 * O custo de cartório de uma cessão: escritura pública + registro em RTD.
 *
 * O que se guarda por estado é a REGRA DE CÁLCULO, não um valor, porque o custo
 * entra na calibragem do deságio e o motor testa milhares de preços — cada um
 * tem de sair com o emolumento da SUA faixa. Estes testes cobrem as três formas
 * em que as tabelas de emolumentos do país são publicadas, e as duas que
 * faltavam causavam erro de dinheiro:
 *
 *   - percentual "sobre o excedente" tratado como percentual sobre o valor
 *     cheio: R$ 800 no lugar de R$ 550, 45% a mais;
 *   - acréscimo de valor fixo (o selo digital de BA, PB, RN, SE e outros)
 *     descartado em silêncio, porque a validação exigia percentual.
 *
 * `custoParaPreco` é o que a calibragem chama. Só o total interessa aqui, então
 * as regras usam um ato só e o outro fica nulo.
 */
const so = (escritura: RegraAto) => ({ escritura, registro: null })
const custo = (ato: RegraAto, valor: number) => custoParaPreco(so(ato), valor).escritura

/** A TSNR de Pernambuco: 0,2% sobre o valor, com piso, teto, e nunca acima do emolumento. */
const TSNR: Acrescimo = {
  nome: 'TSNR', percentual: 0.002, base: 'valor',
  minimo: 6.59, maximo: 3280.79, teto_emolumento: true,
}

describe('forma (a): valor fixo por faixa', () => {
  it('acha a faixa do valor e devolve o emolumento impresso', () => {
    expect(custo({ faixas: [{ de: 45000.01, ate: 50000, valor: 1773.53 }] }, 48000)).toBeCloseTo(1773.53, 2)
  })

  it('escolhe a faixa certa entre várias, em qualquer ordem de entrada', () => {
    const ato: RegraAto = {
      faixas: [
        { ate: null, valor: 1890 },
        { de: 0, ate: 5000, valor: 210.55 },
        { de: 40000.01, ate: 45000, valor: 1611.88 },
      ],
    }
    expect(custo(ato, 3000)).toBeCloseTo(210.55, 2)
    expect(custo(ato, 44791)).toBeCloseTo(1611.88, 2)
    expect(custo(ato, 900000)).toBeCloseTo(1890, 2)
  })
})

describe('forma (b): percentual sobre o valor', () => {
  const pct: RegraAto = { faixas: [{ ate: null, percentual: 0.008, minimo: 300, maximo: 900 }] }

  it('aplica o percentual quando piso e teto não mordem', () => {
    expect(custo(pct, 100000)).toBeCloseTo(800, 2) // 0,8% de 100.000
  })

  it('respeita o teto', () => {
    expect(custo(pct, 200000)).toBeCloseTo(900, 2) // 1.600 limitado a 900
  })

  it('respeita o piso', () => {
    expect(custo(pct, 1000)).toBeCloseTo(300, 2) // 8 elevado a 300
  })
})

describe('forma (c): parcela fixa mais percentual sobre o excedente', () => {
  // "R$ 500,00 acrescidos de 0,5% sobre o que exceder R$ 50.000,00"
  const excedente: RegraAto = {
    faixas: [{ de: 50000, ate: null, fixo: 500, percentual: 0.005, sobre_excedente: true }],
  }

  it('incide só sobre o que passa do piso da faixa', () => {
    expect(custo(excedente, 60000)).toBeCloseTo(550, 2) // 500 + 0,5% de 10.000
  })

  it('na borda exata, o excedente é zero', () => {
    expect(custo(excedente, 50000)).toBeCloseTo(500, 2)
  })

  it('sem a marca, o percentual incide no valor inteiro — a leitura errada', () => {
    // 45% a mais. Este teste existe para fixar a diferença entre as duas
    // leituras, que é onde o erro real aconteceu.
    const semMarca: RegraAto = { faixas: [{ de: 50000, ate: null, fixo: 500, percentual: 0.005 }] }
    expect(custo(semMarca, 60000)).toBeCloseTo(800, 2)
  })

  it('sem piso declarado, a base volta a ser o valor inteiro', () => {
    // Errar para cima é melhor que inventar um piso que a tabela não tem.
    const semPiso: RegraAto = { faixas: [{ ate: null, fixo: 500, percentual: 0.005, sobre_excedente: true }] }
    expect(custo(semPiso, 60000)).toBeCloseTo(800, 2)
  })
})

describe('acréscimos por cima do emolumento', () => {
  it('percentual sobre o valor do ato', () => {
    expect(custo({ faixas: [{ ate: null, valor: 1000 }], acrescimos: [TSNR] }, 50000))
      .toBeCloseTo(1100, 2) // 1.000 + 0,2% de 50.000
  })

  it('percentual sobre o emolumento, não sobre o valor', () => {
    const fundo: Acrescimo = { nome: 'Fundo estadual', percentual: 0.1, base: 'emolumento' }
    expect(custo({ faixas: [{ ate: null, valor: 1000 }], acrescimos: [fundo] }, 50000))
      .toBeCloseTo(1100, 2) // 10% de 1.000, não de 50.000
  })

  it('valor fixo por ato — o selo digital de vários estados', () => {
    const selo: Acrescimo = { nome: 'Selo digital', valor: 3.5, base: 'valor' }
    expect(custo({ faixas: [{ ate: null, valor: 1000 }], acrescimos: [selo] }, 50000))
      .toBeCloseTo(1003.5, 2)
  })

  it('soma selo fixo e taxa percentual juntos', () => {
    const selo: Acrescimo = { nome: 'Selo digital', valor: 3.5, base: 'valor' }
    expect(custo({ faixas: [{ ate: null, valor: 1000 }], acrescimos: [selo, TSNR] }, 50000))
      .toBeCloseTo(1103.5, 2)
  })

  it('teto_emolumento: a taxa não supera o emolumento do ato', () => {
    // Regra da TSNR em PE. 0,2% de 100.000 seriam 200, mas o emolumento é 50.
    expect(custo({ faixas: [{ ate: null, valor: 50 }], acrescimos: [TSNR] }, 100000))
      .toBeCloseTo(100, 2)
  })

  it('respeita o piso do acréscimo', () => {
    expect(custo({ faixas: [{ ate: null, valor: 500 }], acrescimos: [TSNR] }, 1000))
      .toBeCloseTo(506.59, 2) // 0,2% de 1.000 = 2, elevado ao piso de 6,59
  })
})

describe('quando não há como calcular, devolve nulo em vez de um número', () => {
  it('faixa sem valor e sem percentual', () => {
    expect(custo({ faixas: [{ ate: null }] }, 50000)).toBeNull()
  })

  it('preço acima da última faixa fechada', () => {
    // Nenhuma faixa aberta cobre o valor: não se inventa a extrapolação.
    expect(custo({ faixas: [{ ate: 50000, valor: 100 }] }, 90000)).toBeNull()
  })

  it('regra ausente', () => {
    const r = custoParaPreco(null, 50000)
    expect(r.total).toBeNull()
    expect(r.completo).toBe(false)
  })

  it('meio custo é meio custo, e diz isso', () => {
    // Achou a escritura e não o registro: entra o que se sabe, marcado como
    // incompleto, porque metade com origem clara é útil e o aviso pede a outra.
    const r = custoParaPreco({ escritura: { faixas: [{ ate: null, valor: 800 }] }, registro: null }, 50000)
    expect(r.total).toBeCloseTo(800, 2)
    expect(r.completo).toBe(false)
    expect(r.descricao).toMatch(/registro NÃO ENCONTRADO/)
  })
})
