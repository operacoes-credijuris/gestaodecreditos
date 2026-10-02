/**
 * A PASTA DO ORIGINADOR, pelo nome igual.
 *
 * Os nomes são os de B. Processos no Drive real (02/10/2026): todas as pastas
 * com o prefixo "Intermediador - ", uma sem prefixo ("PitchYes") e uma com
 * espaço sobrando no fim ("Intermediador - CBR Ativos ").
 */
import { describe, it, expect } from 'vitest'
import {
  chaveDoOriginador,
  ehPastaCredijuris,
  pastaDoOriginador,
} from '../../../supabase/functions/_shared/pastaDoOriginador.ts'

const RPV = [
  'Intermediador - CBR Ativos ',
  'Intermediador - Lys Andrea Insuela Garcia de Rezende',
  'PitchYes',
  'Intermediador - CMR Advogados',
  'Intermediador - Hebert Rogério Arantes Mateus',
  'Intermediador - Guilherme',
  'Intermediador - Fernando',
].map((name, i) => ({ id: `rpv${i}`, name }))

const PRECATORIOS = [
  'Intermediador - Dr. Alison',
  'Intermediador - Luiz Guilherme Batista Carvalho',
  'Intermediador - CMR Advogados',
].map((name, i) => ({ id: `prec${i}`, name }))

describe('pastaDoOriginador', () => {
  it('o nome do card é a pasta com o prefixo antigo', () => {
    expect(pastaDoOriginador(RPV, 'Fernando')?.name).toBe('Intermediador - Fernando')
    expect(pastaDoOriginador(PRECATORIOS, 'Dr. Alison')?.name).toBe('Intermediador - Dr. Alison')
  })

  it('NÃO aceita pasta que só contém o nome — o contrato iria para outra pessoa', () => {
    expect(pastaDoOriginador(PRECATORIOS, 'Guilherme')).toBeNull()
    expect(pastaDoOriginador(PRECATORIOS, 'Luiz Guilherme')).toBeNull()
    expect(pastaDoOriginador(RPV, 'CMR')).toBeNull()
  })

  it('no RPV, onde existe a pasta "Guilherme", ela é achada', () => {
    expect(pastaDoOriginador(RPV, 'Guilherme')?.name).toBe('Intermediador - Guilherme')
  })

  it('acento, maiúsculas, espaços e pontuação não contam', () => {
    expect(pastaDoOriginador(RPV, 'hebert rogerio arantes mateus')?.name).toBe(
      'Intermediador - Hebert Rogério Arantes Mateus',
    )
    expect(pastaDoOriginador(RPV, 'CBR Ativos')?.name).toBe('Intermediador - CBR Ativos ')
    expect(pastaDoOriginador(PRECATORIOS, 'Dr Alison')?.name).toBe('Intermediador - Dr. Alison')
  })

  it('pasta sem prefixo casa pelo nome', () => {
    expect(pastaDoOriginador(RPV, 'PitchYes')?.name).toBe('PitchYes')
  })

  it('o prefixo também pode vir do lado do card', () => {
    expect(pastaDoOriginador(RPV, 'Originador - Fernando')?.name).toBe('Intermediador - Fernando')
  })

  it('nome vazio não casa com nada', () => {
    expect(pastaDoOriginador(RPV, '')).toBeNull()
    expect(pastaDoOriginador(RPV, '   ')).toBeNull()
  })
})

describe('chaveDoOriginador', () => {
  it('o prefixo sai do nome cru, antes de normalizar', () => {
    // Normalizado primeiro, "Originadora Brasil" viraria "originadorabrasil" e
    // perderia o "originador" do começo como se fosse prefixo.
    expect(chaveDoOriginador('Originadora Brasil')).toBe('originadorabrasil')
    expect(chaveDoOriginador('Intermediador - Fernando')).toBe('fernando')
  })
})

describe('ehPastaCredijuris', () => {
  it('reconhece as grafias da casa', () => {
    expect(ehPastaCredijuris('Credijuris')).toBe(true)
    expect(ehPastaCredijuris('Originador - Credijuris')).toBe(true)
    expect(ehPastaCredijuris('Intermediador - CREDIJURIS')).toBe(true)
  })

  it('não toma por Credijuris uma pasta que só contém o nome', () => {
    expect(ehPastaCredijuris('Credijuris Parceiros')).toBe(false)
    expect(ehPastaCredijuris('Ex-cliente Credijuris')).toBe(false)
  })
})
