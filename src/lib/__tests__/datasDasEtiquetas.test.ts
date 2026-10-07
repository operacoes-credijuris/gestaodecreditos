/**
 * DESDE QUANDO CADA ETIQUETA ESTÁ NO CARD — é o "há 3 dias" do seletor e do
 * card, que diz há quanto tempo um fundo não responde.
 */
import { describe, it, expect } from 'vitest'
import {
  datasDasEtiquetas,
  desdeQuandoAEtiqueta,
  faltaDataDeEtiqueta,
} from '../../../supabase/functions/_shared/etiquetasDoFundo.ts'

const ev = (nome: string, quando: string) => ({
  entity_id: 1,
  created_at: Date.parse(quando) / 1000,
  value_after: [{ tag: { name: nome } }],
})

describe('datasDasEtiquetas', () => {
  it('a data é a do evento mais recente da etiqueta', () => {
    const d = datasDasEtiquetas({
      tags: ['Cotado PJus'],
      eventos: [ev('Cotado PJus', '2026-09-20T10:00:00Z'), ev('cotado pjus', '2026-09-26T10:00:00Z')],
    })
    expect(d).toEqual({ 'Cotado PJus': '2026-09-26T10:00:00.000Z' })
  })

  it('sem evento novo, fica a data que já se sabia; etiqueta que saiu some', () => {
    const d = datasDasEtiquetas({
      tags: ['Enviado Carbon'],
      antes: { 'Enviado Carbon': '2026-09-10T00:00:00.000Z', 'Cotado BTG': '2026-09-01T00:00:00.000Z' },
    })
    expect(d).toEqual({ 'Enviado Carbon': '2026-09-10T00:00:00.000Z' })
  })

  // PERGUNTADO E SEM EVENTO: null, e não ausente — senão cada sincronização
  // perguntaria de novo pela data que o Kommo não guarda.
  it('perguntado e sem evento fica null; não perguntado fica de fora', () => {
    expect(datasDasEtiquetas({ tags: ['Cotado Precatur'], perguntado: true })).toEqual({ 'Cotado Precatur': null })
    expect(datasDasEtiquetas({ tags: ['Cotado Precatur'] })).toEqual({})
  })

  it('só as etiquetas da casa', () => {
    expect(datasDasEtiquetas({ tags: ['urgente', 'Pendente Luiz'], perguntado: true })).toEqual({})
  })
})

describe('faltaDataDeEtiqueta e desdeQuandoAEtiqueta', () => {
  it('pergunta só por etiqueta da casa sem data', () => {
    expect(faltaDataDeEtiqueta(['Cotado PJus', 'urgente'], { 'Cotado PJus': null })).toBe(false)
    expect(faltaDataDeEtiqueta(['Cotado PJus', 'Enviado Carbon'], { 'Cotado PJus': null })).toBe(true)
    expect(faltaDataDeEtiqueta(['urgente'], {})).toBe(false)
  })

  it('acha a data tolerando caixa e acento', () => {
    const datas = { 'Enviado Invest Precatórios': '2026-09-27T00:00:00.000Z' }
    expect(desdeQuandoAEtiqueta(datas, 'enviado invest precatorios')).toBe('2026-09-27T00:00:00.000Z')
    expect(desdeQuandoAEtiqueta(datas, 'Cotado PJus')).toBeNull()
    expect(desdeQuandoAEtiqueta(null, 'Cotado PJus')).toBeNull()
  })
})

// O "ENVIADO BTG" (07/10/2026, o crédito de atacado) tem data como os outros
// "Enviado": é o "há 9 dias" que diz que o BTG ainda não respondeu o e-mail.
describe('o "Enviado BTG" tem data, como os outros "Enviado"', () => {
  it('entra no mapa, e desdeQuandoAEtiqueta a acha', () => {
    const d = datasDasEtiquetas({
      tags: ['Enviado BTG', 'Enviado PJus'],
      eventos: [ev('Enviado BTG', '2026-10-07T12:00:00Z'), ev('Enviado PJus', '2026-10-01T12:00:00Z')],
    })
    expect(d).toEqual({ 'Enviado BTG': '2026-10-07T12:00:00.000Z', 'Enviado PJus': '2026-10-01T12:00:00.000Z' })
    expect(desdeQuandoAEtiqueta(d, 'enviado btg')).toBe('2026-10-07T12:00:00.000Z')
    expect(faltaDataDeEtiqueta(['Enviado BTG'], {})).toBe(true)
  })
})
