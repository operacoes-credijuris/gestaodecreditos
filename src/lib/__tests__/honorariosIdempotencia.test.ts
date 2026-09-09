import { describe, it, expect } from 'vitest'
import { decidirHonorarios, escolherModelo } from '../../../supabase/functions/_shared/precificacao.ts'

/**
 * O HONORÁRIO CONTRATUAL, RODADO DUAS VEZES.
 *
 * A análise passa pelo mesmo bloco de contas várias vezes num único uso —
 * 'analisar', cada mensagem do chat, 'reprecificar', 'salvar' — e o objeto
 * `dados` viaja inteiro entre elas, pelo navegador. A conta do honorário morava
 * solta no handler lendo `dados.honorarios` e gravando de volta no MESMO campo:
 * na passada seguinte, o "quanto a contadoria destacou" que ela lia já era o
 * número que ela mesma havia calculado do percentual do card.
 *
 * O efeito não era acadêmico. A tela mostra SEMPRE a segunda passada (a
 * consolidação), então o que mudava sozinho entre as duas era exatamente o que
 * nunca chegava a quem confere: o bloco da planilha, a base do percentual e o
 * aviso "HONORÁRIOS CONTRATUAIS DIVERGENTES".
 *
 * O contrato que estes testes fixam é um só: passar o valor LIDO em
 * `honorariosLido` faz f(f(x)) == f(x).
 */
describe('decidirHonorarios', () => {
  // O caso exato do achado: card 30%, contadoria destacou 20% do bruto, e o
  // processo sem percentual escrito. Antes, a segunda passada trocava o bloco 2
  // pelo 1, a base do líquido pela do bruto, e o aviso da divergência sumia.
  const LIDO = {
    honorariosLido: 8_000,
    destacados: undefined,
    bruto: 40_000,
    ir: 0,
    inss: 0,
    pctCard: 30,
    pctAutosLido: null,
  }

  it('a segunda passada dá o mesmo que a primeira', () => {
    const um = decidirHonorarios(LIDO)
    // O que o handler faz: grava o calculado em dados.honorarios e segue. A
    // linha de base é o que impede o calculado de voltar como se fosse lido.
    const dois = decidirHonorarios({ ...LIDO, honorariosLido: LIDO.honorariosLido })
    expect(dois).toEqual(um)
    expect(um.modelo).toBe(1)
    expect(um.honorariosCalc).toBeCloseTo(12_000, 6)
  })

  // EFEITO (a) DO ACHADO: o bloco da planilha trocava de azul para verde, e
  // com ele a base do percentual (líquido → bruto). Honorário maior,
  // principal líquido menor, outro documento — sem ninguém ter mexido em nada.
  it('sem a linha de base, o bloco trocava entre as passadas', () => {
    const semDestaque = { ...LIDO, honorariosLido: 0, ir: 5_000, inss: 1_000 }
    const um = decidirHonorarios(semDestaque)
    expect(um.modelo).toBe(2)
    expect(um.honorariosCalc).toBeCloseTo(10_200, 6)
    // Como era antes: o valor CALCULADO voltando no lugar do lido. Fica
    // registrado o tamanho do estrago, não o comportamento certo.
    const errado = decidirHonorarios({ ...semDestaque, honorariosLido: um.honorariosCalc })
    expect(errado.modelo).toBe(1)
    expect(errado.honorariosCalc).toBeCloseTo(12_000, 6)
    // E com a linha de base, a segunda passada repete a primeira.
    expect(decidirHonorarios(semDestaque)).toEqual(um)
  })

  // EFEITO (b): a divergência "card 30% × autos 20%" desaparecia, porque o
  // percentual dos autos passava a ser derivado do nosso proprio numero. O
  // aviso que existe para ser visto era o que não chegava à tela.
  it('sem a linha de base, a divergência do percentual sumia', () => {
    const um = decidirHonorarios(LIDO)
    const errado = decidirHonorarios({ ...LIDO, honorariosLido: um.honorariosCalc })
    expect(errado.pctAutos).toBeCloseTo(30, 6)
    expect(Math.abs((LIDO.pctCard ?? 0) - (errado.pctAutos ?? 0))).toBeLessThan(1)
  })

  it('o percentual dos autos não passa a ser o do card', () => {
    const um = decidirHonorarios(LIDO)
    expect(um.pctAutos).toBeCloseTo(20, 6)
    expect(um.pctDoProcesso).toBe(false)
    // É esta diferença que dispara o aviso de divergência na tela.
    expect(Math.abs((LIDO.pctCard ?? 0) - (um.pctAutos ?? 0))).toBeGreaterThan(1)
  })

  it('percentual escrito nos autos vence a divisão', () => {
    const r = decidirHonorarios({ ...LIDO, pctAutosLido: 25 })
    expect(r.pctAutos).toBe(25)
    expect(r.pctDoProcesso).toBe(true)
  })

  // A BASE ACOMPANHA O BLOCO: verde sobre o bruto, azul sobre o líquido. Com
  // destaque afirmado nos autos, o honorário do card incide sobre o bruto cheio.
  it('destaque afirmado põe a base no bruto', () => {
    const r = decidirHonorarios({ ...LIDO, destacados: true, ir: 5_000, inss: 1_000 })
    expect(r.modelo).toBe(1)
    expect(r.honBase).toBe(40_000)
    expect(r.honorariosCalc).toBeCloseTo(12_000, 6)
  })

  it('destaque negado põe a base no líquido', () => {
    const r = decidirHonorarios({ ...LIDO, destacados: false, ir: 5_000, inss: 1_000 })
    expect(r.modelo).toBe(2)
    expect(r.honBase).toBe(34_000)
    expect(r.honorariosCalc).toBeCloseTo(10_200, 6)
  })

  // SEM PERCENTUAL NO CARD, vale o que a contadoria destacou — e ele atravessa
  // as passadas sem se mover.
  it('sem percentual no card, o destacado passa direto', () => {
    const r = decidirHonorarios({ ...LIDO, pctCard: null })
    expect(r.honorariosCalc).toBe(8_000)
    expect(decidirHonorarios({ ...LIDO, pctCard: null, honorariosLido: r.honorariosCalc })).toEqual(r)
  })

  // O caso "só sucumbenciais, negócio no principal": na primeira conta o bruto
  // ainda está vazio, porque o remanejamento vem depois. É por isso que o
  // handler chama de novo com o bruto final — e é o que este teste descreve.
  it('bruto vazio dá honorário zero; com o bruto remanejado, o número aparece', () => {
    const antes = decidirHonorarios({ ...LIDO, honorariosLido: 0, bruto: 0 })
    expect(antes.honorariosCalc).toBe(0)
    const depois = decidirHonorarios({ ...LIDO, honorariosLido: 0, bruto: 16_778.83 })
    expect(depois.honorariosCalc).toBeCloseTo(5_033.649, 3)
  })

  it('número inválido não vira NaN no preço', () => {
    const r = decidirHonorarios({
      honorariosLido: NaN,
      destacados: undefined,
      bruto: NaN,
      ir: NaN,
      inss: NaN,
      pctCard: 30,
      pctAutosLido: null,
    })
    expect(r.honorariosCalc).toBe(0)
    expect(r.pctAutos).toBe(null)
    expect(r.modelo).toBe(2)
  })
})

describe('escolherModelo', () => {
  // A PERGUNTA É SOBRE OS AUTOS, não sobre o negócio: o campo afirmado manda,
  // e o valor destacado só decide quando a leitura não afirmou nada.
  it('o campo afirmado manda sobre o valor', () => {
    expect(escolherModelo(true, 0)).toBe(1)
    expect(escolherModelo(false, 9_000)).toBe(2)
  })

  it('sem o campo, decide o valor destacado', () => {
    expect(escolherModelo(undefined, 9_000)).toBe(1)
    expect(escolherModelo(null, 0)).toBe(2)
  })
})
