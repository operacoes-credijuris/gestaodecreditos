/**
 * UF anterior escrita por extenso era DESCARTADA SEM AVISO: o estado sumia do
 * cadastro e a certidão estadual dele, do checklist.
 */
import { describe, it, expect } from 'vitest'
import { lerUfsDigitadas } from '../ufsDigitadas'

describe('lerUfsDigitadas', () => {
  it('aceita sigla e nome por extenso, com ou sem acento', () => {
    expect(lerUfsDigitadas('MG, São Paulo; bahia, sp')).toEqual({ ufs: ['MG', 'SP', 'BA'], naoReconhecidas: [] })
    expect(lerUfsDigitadas('Mato Grosso do Sul / Para').ufs).toEqual(['MS', 'PA'])
  })

  it('o que não é estado volta como não reconhecido, em vez de sumir', () => {
    expect(lerUfsDigitadas('MG, XX, Minas')).toEqual({ ufs: ['MG'], naoReconhecidas: ['XX', 'Minas'] })
  })

  it('vazio é vazio', () => {
    expect(lerUfsDigitadas('  ')).toEqual({ ufs: [], naoReconhecidas: [] })
  })
})
