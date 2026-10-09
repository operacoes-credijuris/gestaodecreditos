/**
 * REVISÃO UX GERAL (09/10/2026): os pedaços com regra — a pista das filas que
 * rolam de lado e a contagem com o plural certo.
 */
import { describe, it, expect } from 'vitest'
import { classeDaPista, ladosEscondidos } from '@/lib/rolagemLateral'
import { contar } from '@/lib/format'

describe('a pista das filas que rolam de lado', () => {
  it('no começo da fila, só a borda direita esconde algo', () => {
    expect(ladosEscondidos(0, 300, 500)).toEqual({ antes: false, depois: true })
  })
  it('no meio, os dois lados; no fim, só o esquerdo', () => {
    expect(ladosEscondidos(100, 300, 500)).toEqual({ antes: true, depois: true })
    expect(ladosEscondidos(200, 300, 500)).toEqual({ antes: true, depois: false })
  })
  it('a fila que cabe inteira não tem máscara nenhuma', () => {
    expect(ladosEscondidos(0, 500, 500)).toEqual({ antes: false, depois: false })
    expect(classeDaPista({ antes: false, depois: false })).toBe('')
  })
  it('cada lado escondido esmaece só a sua borda', () => {
    expect(classeDaPista({ antes: false, depois: true })).toContain('to_right,black_calc(100%_-_24px),transparent')
    expect(classeDaPista({ antes: true, depois: false })).toContain('to_left,black_calc(100%_-_24px),transparent')
    expect(classeDaPista({ antes: true, depois: true })).toContain('transparent,black_24px,black_calc(100%_-_24px),transparent')
  })
})

describe('contar: o plural certo, sem "(s)"', () => {
  it('um e muitos', () => {
    expect(contar(1, 'arquivo', 'arquivos')).toBe('1 arquivo')
    expect(contar(3, 'arquivo', 'arquivos')).toBe('3 arquivos')
    expect(contar(0, 'crédito', 'créditos')).toBe('0 créditos')
  })
  it('o número no formato brasileiro', () => {
    expect(contar(1204, 'consulta', 'consultas')).toBe('1.204 consultas')
  })
})
