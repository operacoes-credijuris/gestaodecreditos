/**
 * OS PROCESSOS DE UM CRÉDITO — o que a IA indica, conferido antes de pagar.
 *
 * Cada número pedido ao Escavador custa R$ 1,34. Os testes guardam as travas:
 * dígito verificador, número "do título" que precisa estar no título, o CNJ do
 * título que entra sempre, e a impressão do card que não muda com as notas da
 * própria rotina.
 */
import { describe, it, expect } from 'vitest'
import {
  cnjComDvValido,
  ehAnexoDosAutos,
  faltaPapel,
  impressaoDoCard,
  mesclarProcessos,
  normalizarProcessos,
  rotuloDoProcesso,
} from '../../../supabase/functions/_shared/processosDoCredito.ts'

const TITULO = 'Dr. Fulano - Fabio Felix Ferreira - 80152502420208050000 - Principal'

describe('cnjComDvValido', () => {
  it('aceita números reais e recusa um dígito trocado', () => {
    expect(cnjComDvValido('8015250-24.2020.8.05.0000')).toBe(true)
    expect(cnjComDvValido('1006377-08.2020.4.01.3814')).toBe(true)
    expect(cnjComDvValido('5422898-29.2024.8.09.0149')).toBe(true)
    expect(cnjComDvValido('8015250-25.2020.8.05.0000')).toBe(false)
    expect(cnjComDvValido('123')).toBe(false)
  })
})

describe('normalizarProcessos', () => {
  const fontes = {
    titulo: TITULO,
    anotacoes: 'Cumprimento distribuído sob o nº 5422898-29.2024.8.09.0149.',
    cnjDoTitulo: '8015250-24.2020.8.05.0000',
  }

  it('passa o que tem dígito certo e está onde a IA disse', () => {
    const r = normalizarProcessos(
      {
        processos: [
          { cnj: '8015250-24.2020.8.05.0000', papeis: ['requisitorio'], fonte: 'titulo', evidencia: '80152502420208050000' },
          { cnj: '5422898-29.2024.8.09.0149', papeis: ['cumprimento'], fonte: 'anotacao', evidencia: 'Cumprimento distribuído' },
          { cnj: '1006377-08.2020.4.01.3814', papeis: ['conhecimento'], fonte: 'anexo', evidencia: 'Ofício — autos nº 1006377-08.2020.4.01.3814' },
        ],
      },
      fontes,
    )
    expect(r.processos.map((p) => [p.cnj, p.papeis[0]])).toEqual([
      ['8015250-24.2020.8.05.0000', 'requisitorio'],
      ['5422898-29.2024.8.09.0149', 'cumprimento'],
      ['1006377-08.2020.4.01.3814', 'conhecimento'],
    ])
    expect(r.avisos).toEqual([])
  })

  // O NÚMERO INVENTADO: plausível, com a cara certa, e o dígito não fecha.
  it('descarta número com dígito verificador errado', () => {
    const r = normalizarProcessos({ processos: [{ cnj: '5422898-30.2024.8.09.0149', fonte: 'anexo' }] }, fontes)
    expect(r.processos.map((p) => p.cnj)).toEqual(['8015250-24.2020.8.05.0000'])
    expect(r.avisos[0]).toContain('dígito verificador')
  })

  it('descarta número que a IA diz estar nas anotações e não está', () => {
    const r = normalizarProcessos({ processos: [{ cnj: '1006377-08.2020.4.01.3814', fonte: 'anotacao' }] }, fontes)
    expect(r.processos.some((p) => p.cnj === '1006377-08.2020.4.01.3814')).toBe(false)
  })

  // O CADASTRO DO CARD NÃO SE PERDE: a IA não citou o do título, ele entra igual.
  it('o CNJ do título entra sempre', () => {
    const r = normalizarProcessos({ processos: [] }, fontes)
    expect(r.processos).toHaveLength(1)
    expect(r.processos[0]).toMatchObject({ cnj: '8015250-24.2020.8.05.0000', papeis: [], fonte: 'titulo' })
  })

  it('o mesmo número em duas linhas vira uma, com os dois papéis', () => {
    const r = normalizarProcessos(
      {
        processos: [
          { cnj: '5422898-29.2024.8.09.0149', papeis: ['conhecimento'], fonte: 'anexo' },
          { cnj: '54228982920248090149', papeis: ['cumprimento'], fonte: 'anexo' },
        ],
      },
      { titulo: '', anotacoes: '' },
    )
    expect(r.processos).toHaveLength(1)
    expect(r.processos[0].papeis).toEqual(['conhecimento', 'cumprimento'])
  })
})

describe('mesclar, faltaPapel e rótulo', () => {
  it('a leitura nova acrescenta sem duplicar', () => {
    const antes = [{ cnj: '8015250-24.2020.8.05.0000', papeis: ['conhecimento' as const], fonte: 'titulo', evidencia: '' }]
    const agora = [
      { cnj: '8015250-24.2020.8.05.0000', papeis: ['cumprimento' as const], fonte: 'anexo', evidencia: '' },
      { cnj: '1006377-08.2020.4.01.3814', papeis: ['requisitorio' as const], fonte: 'anexo', evidencia: '' },
    ]
    const m = mesclarProcessos(antes, agora)
    expect(m).toHaveLength(2)
    expect(m[0].papeis).toEqual(['conhecimento', 'cumprimento'])
    expect(faltaPapel(m)).toBe(false)
    expect(faltaPapel(antes)).toBe(true)
  })

  it('o rótulo dos anexos segue o papel, e o requisitório do RPV é RPV', () => {
    expect(rotuloDoProcesso(['requisitorio'], false)).toBe('Precatório')
    expect(rotuloDoProcesso(['requisitorio'], true)).toBe('RPV')
    expect(rotuloDoProcesso(['conhecimento', 'cumprimento'], false)).toBe('Conhecimento e cumprimento')
    expect(rotuloDoProcesso([], false)).toBe('Processo')
  })
})

describe('impressão do card e anexos da rotina', () => {
  it('nota automática não muda a impressão; anotação do comercial muda', () => {
    const base = [{ texto: 'Cedente casado', automatica: false }]
    const a = impressaoDoCard(TITULO, base)
    expect(impressaoDoCard(TITULO, [...base, { texto: '📂 Autos anexados', automatica: true }])).toBe(a)
    expect(impressaoDoCard(TITULO, [...base, { texto: 'Precatório 1006377-08…', automatica: false }])).not.toBe(a)
  })

  // A NOTA DE ANEXO É "AUTOMÁTICA" NO ESPELHO, e o PDF novo do comercial tem de contar.
  it('anexo novo do comercial muda a impressão; o anexo da própria rotina não', () => {
    const base = [{ texto: 'Cedente casado', automatica: false }]
    const a = impressaoDoCard(TITULO, base)
    expect(impressaoDoCard(TITULO, [...base, { texto: 'oficio.pdf', automatica: true, arquivo_uuid: 'u1' }])).not.toBe(a)
    expect(
      impressaoDoCard(TITULO, [...base, { texto: 'Conhecimento 001 - Inicial.pdf', automatica: true, arquivo_uuid: 'u2' }]),
    ).toBe(a)
  })

  it('reconhece o anexo que a própria rotina subiu', () => {
    expect(ehAnexoDosAutos('Conhecimento 001 - 09-06-2020 - Petição Inicial.pdf')).toBe(true)
    expect(ehAnexoDosAutos('Precatório 012 - Ofício.pdf')).toBe(true)
    expect(ehAnexoDosAutos('Ofício requisitório.pdf')).toBe(false)
  })
})
