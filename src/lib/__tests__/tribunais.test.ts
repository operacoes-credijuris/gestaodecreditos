import { describe, it, expect } from 'vitest'
import { resolverUf, lerNumeroCnj } from '../../../supabase/functions/_shared/tribunais.ts'

/**
 * De que estado é o crédito.
 *
 * Testado porque a resposta escolhe a TABELA DE EMOLUMENTOS que entra no preço
 * e o TETO DE RPV com que o valor bruto é comparado — e errar o estado não
 * levanta erro nenhum, só produz um custo de cartório de outro estado dentro
 * do deságio. É uma falha silenciosa em dinheiro, a pior espécie.
 */
describe('lerNumeroCnj', () => {
  it('lê o segmento do dígito J', () => {
    expect(lerNumeroCnj('0800123-45.2024.4.05.8300')?.segmento).toBe('federal')
    expect(lerNumeroCnj('0000123-45.2023.5.06.0011')?.segmento).toBe('trabalho')
    expect(lerNumeroCnj('1000123-45.2024.8.26.0100')?.segmento).toBe('estadual')
  })

  it('lê a região do campo TR', () => {
    expect(lerNumeroCnj('0000123-45.2023.5.18.0001')?.tribunal).toBe(18)
    expect(lerNumeroCnj('1000123-45.2024.4.06.3800')?.tribunal).toBe(6)
  })

  it('aceita o número sem pontuação', () => {
    expect(lerNumeroCnj('00001234520235060011')).toEqual({ segmento: 'trabalho', tribunal: 6 })
  })

  it('devolve null para o que não é número CNJ', () => {
    // 'NÃO LOCALIZADO' é resposta que a extração dá quando não acha o número.
    expect(lerNumeroCnj('NÃO LOCALIZADO')).toBeNull()
    expect(lerNumeroCnj('123')).toBeNull()
    expect(lerNumeroCnj(null)).toBeNull()
  })
})

describe('resolverUf', () => {
  it('resolve o TRT pela região do número, sem depender da IA', () => {
    // A sigla é a IA transcrevendo; o número é o número. Vinte das vinte e
    // quatro regiões trabalhistas cobrem um estado só.
    expect(resolverUf({ numero_processo: '0000123-45.2023.5.06.0011' })).toEqual({ uf: 'PE', fonte: 'regiao' })
    expect(resolverUf({ numero_processo: '0000123-45.2023.5.18.0001' })).toEqual({ uf: 'GO', fonte: 'regiao' })
    // As duas regiões de São Paulo, capital e interior, dão o mesmo estado.
    expect(resolverUf({ numero_processo: '1000123-45.2024.5.02.0033' }).uf).toBe('SP')
    expect(resolverUf({ numero_processo: '1000123-45.2024.5.15.0044' }).uf).toBe('SP')
  })

  it('resolve o TRF6, único de um estado só', () => {
    expect(resolverUf({ numero_processo: '1000123-45.2024.4.06.3800' })).toEqual({ uf: 'MG', fonte: 'regiao' })
  })

  it('NÃO CHUTA quando a região cobre vários estados', () => {
    // O TRF1 cobre treze unidades. Um chute aqui escolheria a tabela de
    // emolumentos errada sem que nada na tela indicasse.
    const trf1 = resolverUf({ numero_processo: '1000123-45.2024.4.01.3400' })
    expect(trf1.uf).toBeNull()
    expect(trf1.candidatas).toContain('BA')
    expect(trf1.aviso).toMatch(/TRF1/)

    const trt8 = resolverUf({ numero_processo: '0000123-45.2023.5.08.0001' })
    expect(trt8.uf).toBeNull()
    expect(trt8.candidatas).toEqual(['PA', 'AP'])
  })

  it('a seção judiciária lida dos autos desempata o TRF', () => {
    expect(resolverUf({ numero_processo: '0800123-45.2024.4.05.8300', uf_tramitacao: 'PE' }))
      .toEqual({ uf: 'PE', fonte: 'autos' })
    expect(resolverUf({ numero_processo: '1000123-45.2024.4.01.3300', uf_tramitacao: 'ba' }).uf).toBe('BA')
  })

  it('avisa quando a UF lida contradiz a região, em vez de escolher em silêncio', () => {
    // Uma das duas está errada e daqui não dá para saber qual. Usa a dos autos,
    // que é o documento, e põe a contradição na frente do operador.
    const r = resolverUf({ numero_processo: '0800123-45.2024.4.05.8300', uf_tramitacao: 'SP' })
    expect(r.uf).toBe('SP')
    expect(r.aviso).toMatch(/não fica na jurisdição do TRF5/)
  })

  it('na Justiça Estadual a sigla resolve', () => {
    expect(resolverUf({ tribunal: 'TJGO' })).toEqual({ uf: 'GO', fonte: 'sigla' })
    // O número estadual não é usado para a UF (ver o comentário em
    // tribunais.ts: a tabela de códigos dos TJs não foi confirmada).
    expect(resolverUf({ tribunal: 'TJSP', numero_processo: '1000123-45.2024.8.26.0100' }).uf).toBe('SP')
  })

  it('o cabeçalho dos autos vence a sigla', () => {
    expect(resolverUf({ tribunal: 'TJGO', uf_tramitacao: 'MG' })).toEqual({ uf: 'MG', fonte: 'autos' })
  })

  it('cai na sigla do TRT/TRF quando não há número', () => {
    expect(resolverUf({ tribunal: 'TRT18' })).toEqual({ uf: 'GO', fonte: 'regiao' })
    expect(resolverUf({ tribunal: 'TRF6' })).toEqual({ uf: 'MG', fonte: 'regiao' })
    expect(resolverUf({ tribunal: 'TRF1' }).uf).toBeNull()
  })

  it('sem nada reconhecível, devolve null em vez de inventar', () => {
    expect(resolverUf({})).toEqual({ uf: null, fonte: 'nenhuma' })
    expect(resolverUf({ numero_processo: 'NÃO LOCALIZADO' }).uf).toBeNull()
    // Número truncado não pode virar região: cai na sigla.
    expect(resolverUf({ numero_processo: '123', tribunal: 'TJPE' })).toEqual({ uf: 'PE', fonte: 'sigla' })
  })
})
