// Data-base que o Salvar dos Parâmetros de atualização grava.
//
// A busca no Banco Central já GRAVA os índices, com a data-base no último mês que
// os dois fecharam. O Salvar logo em seguida, sem mexer em nada, trocava essa
// data pela de hoje — e a data passava a prometer um fechamento que os índices
// ainda não têm.

import { describe, it, expect } from 'vitest'
import { dataBaseAoSalvar } from '@/components/ParametrosAtualizacao'

const HOJE = '2026-10-02'
const BUSCA = { selic: 14.9, ipca: 5.13, data: '2026-08-31' }

describe('dataBaseAoSalvar', () => {
  it('sem busca, é hoje — o Salvar manual de sempre', () => {
    expect(dataBaseAoSalvar({ selic: 14.9, ipca: 5.13 }, null, HOJE)).toBe(HOJE)
  })

  it('logo depois da busca, com os números intocados, mantém a data gravada pela busca', () => {
    expect(dataBaseAoSalvar({ selic: 14.9, ipca: 5.13 }, BUSCA, HOJE)).toBe('2026-08-31')
  })

  it('mexeu em qualquer número, volta a ser hoje', () => {
    expect(dataBaseAoSalvar({ selic: 15, ipca: 5.13 }, BUSCA, HOJE)).toBe(HOJE)
    expect(dataBaseAoSalvar({ selic: 14.9, ipca: null }, BUSCA, HOJE)).toBe(HOJE)
  })

  it('índice que a busca não trouxe conta como intocado se continua o mesmo', () => {
    const parcial = { selic: 14.9, ipca: null, data: '2026-08-31' }
    expect(dataBaseAoSalvar({ selic: 14.9, ipca: null }, parcial, HOJE)).toBe('2026-08-31')
  })
})
