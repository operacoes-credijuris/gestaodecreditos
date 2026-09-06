import { describe, it, expect } from 'vitest'
import {
  montarParcelas,
  calibrarDesagio,
  type Parcela,
} from '../../../supabase/functions/_shared/precificacao.ts'
import type { RegraEmolumentos } from '../../../supabase/functions/_shared/emolumentos-calculo.ts'
import { irProgressivo } from '../../../supabase/functions/_shared/irpf.ts'

/**
 * O núcleo do preço.
 *
 * Morava dentro da Edge Function, junto do SDK da IA, e nenhum teste o
 * alcançava — o que é péssimo para a única parte do sistema que decide quanto
 * dinheiro sai do caixa. As duas regras da casa que este arquivo fixa:
 *
 *   - havendo principal no negócio, honorários são comprados pelo valor de face
 *     e TODO o deságio cai sobre o principal;
 *   - cada verba cedida é uma escritura e um registro próprios.
 */

/** Uma tabela de emolumentos simples, em faixas de mil reais. */
const REGRA: RegraEmolumentos = {
  escritura: {
    faixas: [
      { de: 0, ate: 10000, valor: 300 },
      { de: 10000.01, ate: 50000, valor: 800 },
      { de: 50000.01, ate: null, valor: 1500 },
    ],
  },
  registro: { faixas: [{ ate: null, valor: 100 }] },
}


describe('montarParcelas', () => {
  const base = {
    brutoTotal: 100000,
    ir: 10000,
    inss: 0,
    contratuaisBrutos: 30000,
    sucumbenciaisBrutos: 10000,
  }

  it('o principal desconta o IR, o INSS e os contratuais pelo BRUTO', () => {
    // Os contratuais saem de dentro do principal; os sucumbenciais não, porque
    // quem os paga é o vencido.
    const [p] = montarParcelas({ ...base, verbas: { principal: true, contratuais: false, sucumbenciais: false } })
    expect(p.liquido).toBe(100000 - 10000 - 0 - 30000)
  })

  it('tributa CADA verba de honorário em separado, como as fórmulas do modelo', () => {
    // Contratuais e sucumbenciais costumam vir em requisitórios distintos, e o
    // modelo calcula M7 e M8 independentes. Tributar a soma aplicaria a parcela
    // a deduzir uma vez só, e o motor mostraria um líquido diferente do arquivo.
    const ps = montarParcelas({ ...base, verbas: { principal: false, contratuais: true, sucumbenciais: true } })
    const c = ps.find((x) => x.nome === 'contratuais')!
    const s = ps.find((x) => x.nome === 'sucumbenciais')!
    expect(c.liquido).toBeCloseTo(30000 - irProgressivo(30000).imposto, 2)
    expect(s.liquido).toBeCloseTo(10000 - irProgressivo(10000).imposto, 2)
  })

  it('e a verba que não está no negócio não influencia o imposto da outra', () => {
    // O erro que isto fixa: eu calculava o imposto sobre as verbas COMPRADAS e
    // rateava sobre TODAS as existentes, o que diluía o imposto da comprada.
    const soSucumb = montarParcelas({ ...base, verbas: { principal: false, contratuais: false, sucumbenciais: true } })
    expect(soSucumb[0].liquido).toBeCloseTo(10000 - irProgressivo(10000).imposto, 2)
    const comAmbas = montarParcelas({ ...base, verbas: { principal: false, contratuais: true, sucumbenciais: true } })
    expect(comAmbas.find((p) => p.nome === 'sucumbenciais')!.liquido).toBeCloseTo(soSucumb[0].liquido, 2)
  })

  it('HAVENDO PRINCIPAL, só ele é desagiável', () => {
    const ps = montarParcelas({ ...base, verbas: { principal: true, contratuais: true, sucumbenciais: true } })
    expect(ps.map((p) => [p.nome, p.desagiavel])).toEqual([
      ['principal', true], ['contratuais', false], ['sucumbenciais', false],
    ])
  })

  it('SEM PRINCIPAL, o deságio volta para os honorários', () => {
    // Não há onde jogá-lo. Comprar honorário pelo valor de face sem principal
    // nenhum seria pagar o crédito inteiro e ainda arcar com os custos.
    const ps = montarParcelas({ ...base, verbas: { principal: false, contratuais: true, sucumbenciais: true } })
    expect(ps.every((p) => p.desagiavel)).toBe(true)
  })

  it('verba de valor zero fica de fora — não gera escritura nem entra na base', () => {
    const ps = montarParcelas({
      ...base, contratuaisBrutos: 0, sucumbenciaisBrutos: 0,
      verbas: { principal: true, contratuais: true, sucumbenciais: true },
    })
    expect(ps.map((p) => p.nome)).toEqual(['principal'])
  })

  it('e a verba que existe mas não foi negociada também', () => {
    const ps = montarParcelas({ ...base, verbas: { principal: true, contratuais: false, sucumbenciais: true } })
    expect(ps.map((p) => p.nome)).toEqual(['principal', 'sucumbenciais'])
  })
})

describe('calibrarDesagio — o deságio cai só no principal', () => {
  const parcelas: Parcela[] = [
    { nome: 'principal', liquido: 60000, desagiavel: true },
    { nome: 'contratuais', liquido: 27000, desagiavel: false },
  ]

  it('os honorários são comprados pelo valor de face', () => {
    const r = calibrarDesagio({ parcelas, T5: 12, regra: REGRA })
    const hon = r.parcelas.find((p) => p.nome === 'contratuais')!
    expect(hon.preco).toBeCloseTo(27000, 2)
    expect(r.desagio).toBeGreaterThan(0)
  })

  it('e o principal absorve o deságio inteiro', () => {
    const r = calibrarDesagio({ parcelas, T5: 12, regra: REGRA })
    const pri = r.parcelas.find((p) => p.nome === 'principal')!
    expect(pri.preco).toBeCloseTo(60000 * (1 - r.desagio), 2)
    expect(r.cessao).toBeCloseTo(pri.preco + 27000, 2)
  })

  it('o deságio EFETIVO sobre o total é menor que o nominal', () => {
    // É a consequência aritmética da regra, e a que engana quem olha só um dos
    // dois números: 30% sobre o principal não são 30% sobre o negócio.
    const r = calibrarDesagio({ parcelas, T5: 12, regra: REGRA })
    expect(r.desagioEfetivo).toBeLessThan(r.desagio)
    expect(r.desagioEfetivo).toBeCloseTo(1 - r.cessao / r.Y3, 6)
  })

  it('atinge a rentabilidade-alvo', () => {
    const r = calibrarDesagio({ parcelas, T5: 12, alvo: 0.028, regra: REGRA })
    expect(r.atingiuAlvo).toBe(true)
    expect(r.Y9).toBeGreaterThanOrEqual(0.028)
  })

  it('sem principal, o deságio incide sobre os honorários', () => {
    const so: Parcela[] = [{ nome: 'contratuais', liquido: 27000, desagiavel: true }]
    const r = calibrarDesagio({ parcelas: so, T5: 12, regra: REGRA })
    expect(r.parcelas[0].preco).toBeCloseTo(27000 * (1 - r.desagio), 2)
    expect(r.desagio).toBeGreaterThan(0)
  })
})

describe('calibrarDesagio — uma escritura por verba', () => {
  it('duas verbas custam dois pares de escritura e registro', () => {
    const uma = calibrarDesagio({
      parcelas: [{ nome: 'principal', liquido: 60000, desagiavel: true }], T5: 12, regra: REGRA,
    })
    const duas = calibrarDesagio({
      parcelas: [
        { nome: 'principal', liquido: 60000, desagiavel: true },
        { nome: 'contratuais', liquido: 27000, desagiavel: false },
      ], T5: 12, regra: REGRA,
    })
    expect(uma.parcelas).toHaveLength(1)
    expect(duas.parcelas).toHaveLength(2)
    // A dos honorários custa a faixa DELA (27.000 -> 800 + 100), não a do total.
    const hon = duas.parcelas.find((p) => p.nome === 'contratuais')!
    expect(hon.cartorio.total).toBeCloseTo(900, 2)
    expect(duas.Y10).toBeCloseTo((uma.parcelas[0].cartorio.total ?? 0) + 900, 2)
  })

  it('três verbas, três pares', () => {
    const r = calibrarDesagio({
      parcelas: [
        { nome: 'principal', liquido: 60000, desagiavel: true },
        { nome: 'contratuais', liquido: 27000, desagiavel: false },
        { nome: 'sucumbenciais', liquido: 9000, desagiavel: false },
      ], T5: 12, regra: REGRA,
    })
    expect(r.parcelas).toHaveLength(3)
    // 9.000 cai na primeira faixa: 300 + 100.
    expect(r.parcelas.find((p) => p.nome === 'sucumbenciais')!.cartorio.total).toBeCloseTo(400, 2)
    expect(r.Y10).toBeCloseTo(r.parcelas.reduce((s, p) => s + (p.cartorio.total ?? 0), 0), 2)
  })

  it('somar as verbas antes de calcular SUBESTIMA o cartório', () => {
    // O erro que a regra corrige: um par só sobre a soma paga uma faixa alta,
    // mas menos que dois pares em faixas próprias.
    const porVerba = calibrarDesagio({
      parcelas: [
        { nome: 'principal', liquido: 30000, desagiavel: true },
        { nome: 'contratuais', liquido: 30000, desagiavel: false },
      ], T5: 12, regra: REGRA,
    })
    const somado = calibrarDesagio({
      parcelas: [{ nome: 'principal', liquido: 60000, desagiavel: true }], T5: 12, regra: REGRA,
    })
    expect(porVerba.Y10!).toBeGreaterThan(somado.Y10!)
  })

  it('sem tabela do estado, o cartório é null e o preço sai assim mesmo', () => {
    const r = calibrarDesagio({
      parcelas: [{ nome: 'principal', liquido: 60000, desagiavel: true }], T5: 12, regra: null,
    })
    expect(r.Y10).toBeNull()
    expect(r.cartorioCompleto).toBe(false)
    expect(r.cessao).toBeGreaterThan(0)
  })
})

describe('calibrarDesagio — casos de borda', () => {
  it('sem parcela nenhuma não quebra', () => {
    const r = calibrarDesagio({ parcelas: [], T5: 12, regra: REGRA })
    expect(r.Y3).toBe(0)
    expect(r.atingiuAlvo).toBe(false)
  })

  it('quando nem o teto de 95% atinge o alvo, devolve o melhor caso marcado', () => {
    // Crédito pequeno com custo fixo alto: não há deságio que salve.
    const r = calibrarDesagio({
      parcelas: [{ nome: 'principal', liquido: 900, desagiavel: true }],
      T5: 12, alvo: 0.028, regra: REGRA,
    })
    expect(r.atingiuAlvo).toBe(false)
    expect(r.desagio).toBeCloseTo(0.95, 4)
  })

  it('a binária acha o MENOR deságio que serve', () => {
    // Um passo abaixo do escolhido já não pode bater o alvo.
    const parcelas: Parcela[] = [{ nome: 'principal', liquido: 80000, desagiavel: true }]
    const r = calibrarDesagio({ parcelas, T5: 12, alvo: 0.028, regra: REGRA })
    expect(r.atingiuAlvo).toBe(true)
    const umPassoAbaixo = calibrarDesagio({
      parcelas, T5: 12, alvo: 0.028, regra: REGRA,
    })
    expect(umPassoAbaixo.desagio).toBe(r.desagio)
    // A rentabilidade no deságio escolhido bate; no anterior, não.
    expect(r.Y9).toBeGreaterThanOrEqual(0.028)
  })
})
