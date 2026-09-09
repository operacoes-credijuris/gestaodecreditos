import { describe, it, expect } from 'vitest'
import { LISTAS_M2, normalizarM2, SIM_NAO } from '../../../supabase/functions/_shared/m2.ts'

/**
 * AS LISTAS SUSPENSAS DA ABA JURÍDICA.
 *
 * POR QUE ISTO IMPORTA. Texto fora da lista o Excel ACEITA: o arquivo sai
 * "preenchido", a validação só reclama quando alguém edita a célula, e a cor
 * condicional não pinta. O prompt promete que a resposta inválida é "marcada
 * como inválida" — esta função é o que marca.
 *
 * Ela era pura e ainda assim inalcançável: `normalizar` morava em credijuris.ts,
 * que importa o SDK do Supabase.
 */
const so = (linha: string, resposta: unknown) => normalizarM2({ [linha]: { resposta } })

describe('normalizarM2', () => {
  it('sim e não, em qualquer grafia', () => {
    for (const bruta of ['sim', 'SIM', 'Sim', ' sim ']) {
      expect(so('10', bruta).m2['10'].resposta).toBe('Sim')
    }
    for (const bruta of ['nao', 'NÃO', 'Não', 'não']) {
      expect(so('10', bruta).m2['10'].resposta).toBe('Não')
    }
    expect(SIM_NAO).toEqual(['Sim', 'Não'])
  })

  // A RESPOSTA VEM COM CAUDA: "Sim, em 12/03/2026" é o que o modelo escreve
  // quando a pergunta pede a data no complemento.
  it('sim com cauda continua sendo Sim', () => {
    expect(so('10', 'Sim, em 12/03/2026').m2['10'].resposta).toBe('Sim')
    expect(so('11', 'Não há menção nos autos').m2['11'].resposta).toBe('Não')
  })

  // A OPÇÃO MAIS LONGA PRIMEIRO: "Procedência parcial" contém "Procedência", e
  // casar pela curta rebaixaria a resposta.
  it('procedência parcial não vira procedência', () => {
    expect(so('19', 'procedencia parcial').m2['19'].resposta).toBe('Procedência parcial')
    expect(so('19', 'Procedência').m2['19'].resposta).toBe('Procedência')
    expect(so('19', 'sentença de procedência parcial (fls. 210)').m2['19'].resposta)
      .toBe('Procedência parcial')
  })

  it('a opção mais longa contida vence, com localização na cauda', () => {
    expect(so('26', 'Executado apresentou valores (fls. 300)').m2['26'].resposta)
      .toBe('Executado apresentou valores')
  })

  // A LISTA DO MODELO MANDA, inclusive na grafia errada dela: "Iliquída" é o que
  // está na validação da célula, e corrigir aqui produziria célula inválida.
  it('a grafia da lista do modelo é respeitada', () => {
    expect(LISTAS_M2['20']).toEqual(['Líquida', 'Iliquída'])
    expect(so('20', 'iliquida').m2['20'].resposta).toBe('Iliquída')
    expect(so('20', 'líquida').m2['20'].resposta).toBe('Líquida')
  })

  // O QUE NÃO CASA FICA COMO VEIO, E É DEVOLVIDO: a célula sai com o texto
  // original (que alguém vai conferir) e a linha entra na lista de avisos.
  it('resposta fora da lista é relatada, e o texto original fica', () => {
    const r = so('19', 'extinção sem julgamento do mérito')
    expect(r.m2['19'].resposta).toBe('extinção sem julgamento do mérito')
    expect(r.foraDaLista[0]).toMatch(/linha 19/)
    expect(r.foraDaLista[0]).toContain('extinção sem julgamento')
  })

  it('a citação do que não casou é cortada, para o aviso não virar parágrafo', () => {
    const r = so('19', 'x'.repeat(200))
    expect(r.foraDaLista[0]).toContain('x'.repeat(60))
    expect(r.foraDaLista[0]).not.toContain('x'.repeat(61))
  })

  // LINHA SEM LISTA PASSA INTACTA: a maioria das 29 linhas é texto livre, e
  // normalizar o que não tem lista seria inventar uma restrição.
  it('linha sem lista suspensa passa como veio', () => {
    const r = so('12', 'qualquer texto que a leitura escreveu')
    expect(r.m2['12'].resposta).toBe('qualquer texto que a leitura escreveu')
    expect(r.foraDaLista).toEqual([])
  })

  it('resposta vazia ou que não é texto passa sem virar aviso', () => {
    for (const v of [undefined, null, '', '   ', 42, { a: 1 }]) {
      const r = so('10', v)
      expect(r.foraDaLista).toEqual([])
    }
  })

  it('o complemento da linha sobrevive à normalização', () => {
    const r = normalizarM2({ '10': { resposta: 'sim', complemento: 'nos autos: processo 123' } })
    expect(r.m2['10']).toEqual({ resposta: 'Sim', complemento: 'nos autos: processo 123' })
  })

  it('m2 que não é objeto devolve vazio em vez de estourar', () => {
    for (const v of [null, undefined, 'x', 42]) {
      expect(normalizarM2(v)).toEqual({ m2: {}, foraDaLista: [] })
    }
  })

  it('normaliza todas as linhas de uma vez, e só relata as que não casam', () => {
    const r = normalizarM2({
      '10': { resposta: 'sim' },
      '19': { resposta: 'improcedencia' },
      '20': { resposta: 'outra coisa' },
      '38': { resposta: 'rpv' },
    })
    expect(r.m2['10'].resposta).toBe('Sim')
    expect(r.m2['19'].resposta).toBe('Improcedência')
    expect(r.m2['38'].resposta).toBe('RPV')
    expect(r.foraDaLista.length).toBe(1)
    expect(r.foraDaLista[0]).toMatch(/linha 20/)
  })

  // TODA LINHA COM LISTA TEM SUAS OPÇÕES REDONDAS: uma opção que não passa pela
  // própria normalização nunca casaria com nada.
  it('cada opção de cada lista casa consigo mesma', () => {
    for (const [linha, lista] of Object.entries(LISTAS_M2)) {
      for (const opcao of lista) {
        expect(so(linha, opcao).m2[linha].resposta).toBe(opcao)
      }
    }
  })
})
