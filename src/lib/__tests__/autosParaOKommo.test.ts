/**
 * OS AUTOS DO ESCAVADOR, anexados ao card do Kommo.
 *
 * Os casos vêm do teste de 28/09/2026 com o processo 8015250-24.2020.8.05.0000
 * (TJBA): 206 documentos, 2.671 páginas, listados pelo Escavador com a data
 * aninhada e títulos que repetem o tipo ("Certidão - Certidão").
 */
import { describe, it, expect } from 'vitest'
import {
  documentosDosAutos,
  emOrdemDosAutos,
  entradasDoOperacional,
  ENTRADA_RPV,
  FUNIL_GERAL,
  FUNIL_RPV,
  fatias,
  nomeDoAnexo,
  notaDosAutos,
} from '../../../supabase/functions/_shared/autosParaOKommo.ts'
import {
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
} from '../../../supabase/functions/_shared/trilhasDoPrecatorio.ts'

const LISTA = {
  items: [
    { key: 'k2', titulo: 'Decisão (Decisão)', data: { date: '2025-09-08 14:35:23', timezone: 'UTC' }, quantidade_paginas: 2, tipo: 'RESTRITO' },
    { key: 'k1', titulo: 'Petição Inicial', data: { date: '2020-06-09 15:54:00' }, quantidade_paginas: 30, tipo: 'RESTRITO' },
    { key: 'k3', titulo: 'Certidão - Certidão', data: { date: '2025-09-02 09:34:00' }, quantidade_paginas: 2, tipo: 'PUBLICO' },
    { titulo: 'sem chave' },
  ],
}

describe('documentosDosAutos', () => {
  it('lê a data aninhada e as páginas, e descarta o que não tem chave', () => {
    const d = documentosDosAutos(LISTA)
    expect(d).toHaveLength(3)
    expect(d[1]).toMatchObject({ chave: 'k1', data: '2020-06-09T15:54:00', paginas: 30 })
  })

  it('põe os autos na ordem do processo, do mais antigo ao mais novo', () => {
    expect(emOrdemDosAutos(documentosDosAutos(LISTA)).map((d) => d.chave)).toEqual(['k1', 'k3', 'k2'])
  })
})

describe('nomeDoAnexo', () => {
  it('numera, data e tira a repetição do tipo', () => {
    expect(nomeDoAnexo(1, 206, { titulo: 'Petição Inicial', data: '2020-06-09T15:54:00' })).toBe(
      'Autos 001 - 09-06-2020 - Petição Inicial.pdf',
    )
    expect(nomeDoAnexo(12, 206, { titulo: 'Certidão - Certidão', data: '2025-09-02T09:34:00' })).toBe(
      'Autos 012 - 02-09-2025 - Certidão.pdf',
    )
    expect(nomeDoAnexo(3, 206, { titulo: 'Decisão (Decisão)', data: null })).toBe('Autos 003 - Decisão.pdf')
  })

  it('não repete o que não é repetição, e tira caractere que o Kommo recusa', () => {
    expect(nomeDoAnexo(4, 10, { titulo: 'Documento Comprobatório - Contracheque/07-2024', data: null })).toBe(
      'Autos 004 - Documento Comprobatório - Contracheque-07-2024.pdf',
    )
  })
})

describe('fatias', () => {
  // O drive do Kommo aceita partes de até 512 KB.
  it('corta o arquivo em partes do tamanho que o drive aceita', () => {
    expect(fatias(1_200_000, 524_288)).toEqual([
      [0, 524288],
      [524288, 1048576],
      [1048576, 1200000],
    ])
    expect(fatias(10, 524_288)).toEqual([[0, 10]])
  })
})

describe('entradasDoOperacional', () => {
  it('RPV pela coluna fixa; precatório pela primeira aba de cada trilha; e a NOVOS do funil geral', () => {
    const etapas = [
      { pipeline_id: FUNIL_PRECATORIO_INTERNO, status_id: 111, nome: 'Análise Jurídica e Econômica' },
      { pipeline_id: FUNIL_PRECATORIO_INTERNO, status_id: 112, nome: 'REVISÃO DA ANÁLISE' },
      { pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: 221, nome: 'QUALIFICAÇÃO PRELIMINAR' },
      { pipeline_id: FUNIL_GERAL, status_id: 331, nome: 'Novos' },
      { pipeline_id: FUNIL_GERAL, status_id: 332, nome: 'QUALIFICADOS' },
    ]
    expect(entradasDoOperacional(etapas)).toEqual([
      { pipeline_id: FUNIL_RPV, status_id: ENTRADA_RPV },
      { pipeline_id: FUNIL_PRECATORIO_INTERNO, status_id: 111 },
      { pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: 221 },
      { pipeline_id: FUNIL_GERAL, status_id: 331 },
    ])
  })

  // A ENTRADA DO EXTERNO É PELO ID: renomeada no Kommo, os autos continuam
  // descendo a partir dela.
  it('a coluna de entrada do Externo vale pelo id, mesmo renomeada', () => {
    const etapas = [{ pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: 111533968, nome: 'TRIAGEM' }]
    expect(entradasDoOperacional(etapas)).toContainEqual({ pipeline_id: FUNIL_PRECATORIO_EXTERNO, status_id: 111533968 })
  })

  it('coluna que o espelho ainda não trouxe fica de fora', () => {
    expect(entradasDoOperacional([])).toEqual([{ pipeline_id: FUNIL_RPV, status_id: ENTRADA_RPV }])
  })
})

describe('notaDosAutos', () => {
  it('diz quanto desceu e de quando a quando', () => {
    const t = notaDosAutos({
      cnj: '8015250-24.2020.8.05.0000',
      anexados: 206,
      total: 206,
      paginas: 2671,
      primeiro: '2020-06-09T15:54:00',
      ultimo: '2025-09-08T14:35:23',
      falhas: [],
    })
    expect(t).toContain('206 de 206')
    expect(t).toContain('2.671 páginas')
    expect(t).toContain('de 09/06/2020 a 08/09/2025')
  })
})
