import { describe, it, expect } from 'vitest'
import {
  cnjDoCard,
  cnjsNoTexto,
  digitosDoCnj,
  mascaraCnj,
  primeiroCnj,
} from '../../../supabase/functions/_shared/nucleo/cnj.ts'
import { lerTituloCard } from '../kommo'

/**
 * O NÚMERO DO PROCESSO, lido de um texto qualquer.
 *
 * TRÊS IMPLEMENTAÇÕES DISSO EXISTIAM, e uma delas custou uma análise. O
 * kommo-sync procurava só o formato PONTUADO, e o título que o comercial digita
 * costuma trazer os VINTE DÍGITOS CRUS — "Dr. Alex Dornelas Loures -
 * 10063770820204013814". Não achando o número no título, o sync seguia para as
 * ANOTAÇÕES e gravava no espelho o primeiro CNJ pontuado que houvesse ali: um
 * processo CITADO numa nota, das dívidas que a diligência apurou sobre o
 * titular. O card passava a se chamar por um processo que não é o dele.
 */
const CRU = '10063770820204013814'
const PONTUADO = '1006377-08.2020.4.01.3814'
const DE_OUTRO = '5000256-12.2024.8.13.0313'

describe('cnjsNoTexto', () => {
  // AS TRÊS FORMAS DE ESCREVER O MESMO NÚMERO. A cru é a que o comercial digita;
  // a com espaços aparece em texto extraído de PDF.
  it('reconhece pontuado, cru e com espaços', () => {
    for (const forma of [PONTUADO, CRU, '1006377 08 2020 4 01 3814', '1006377.08.2020.4.01.3814']) {
      expect(cnjsNoTexto(forma)).toEqual(new Set([CRU]))
    }
  })

  it('acha dentro de uma frase', () => {
    expect(cnjsNoTexto(`Autos nº ${PONTUADO}, em trâmite.`)).toEqual(new Set([CRU]))
    expect(cnjsNoTexto(`Dr. Alex Dornelas Loures - ${CRU}`)).toEqual(new Set([CRU]))
  })

  it('acha vários e não repete', () => {
    const s = cnjsNoTexto(`autos ${PONTUADO}, apenso ${DE_OUTRO}, e de novo ${CRU}`)
    expect(s.size).toBe(2)
  })

  it('o que não é CNJ não entra', () => {
    expect(cnjsNoTexto('1006377-08.2020').size).toBe(0)
    expect(cnjsNoTexto('CPF 123.456.789-00').size).toBe(0)
    expect(cnjsNoTexto('valor R$ 1.006.377,08').size).toBe(0)
    for (const v of ['', null, undefined, 42]) expect(cnjsNoTexto(v).size).toBe(0)
  })
})

describe('mascaraCnj e digitosDoCnj', () => {
  it('vai e volta entre as duas formas', () => {
    expect(mascaraCnj(CRU)).toBe(PONTUADO)
    expect(mascaraCnj(PONTUADO)).toBe(PONTUADO)
    expect(digitosDoCnj(PONTUADO)).toBe(CRU)
  })

  it('o que não tem vinte dígitos volta como veio', () => {
    expect(mascaraCnj('123')).toBe('123')
    expect(mascaraCnj('')).toBe('')
  })
})

describe('primeiroCnj', () => {
  it('devolve pontuado, sempre', () => {
    expect(primeiroCnj(`título - ${CRU}`)).toBe(PONTUADO)
    expect(primeiroCnj(`título - ${PONTUADO}`)).toBe(PONTUADO)
  })

  it('sem CNJ, string vazia', () => {
    expect(primeiroCnj('CBR Ativos - Fulano de Tal')).toBe('')
    expect(primeiroCnj(null)).toBe('')
  })

  // A TELA LÊ O MESMO NÚMERO. `lerTituloCard` delega para cá: as duas leituras
  // do título não podem divergir, ou a mensagem de erro contradiz o cabeçalho
  // que o operador está olhando.
  it('a leitura do título usa esta mesma regra', () => {
    expect(lerTituloCard(`Dr. Alex Dornelas Loures - ${CRU}`).numero).toBe(PONTUADO)
    expect(lerTituloCard(`CBR Ativos - Fulano - ${PONTUADO} - principal - 30%`).numero).toBe(PONTUADO)
  })
})

describe('cnjDoCard', () => {
  // A ORDEM É A REGRA. O título é o cadastro do card — é o que o operador
  // controla e vê. As anotações são texto livre onde o comercial cita processo
  // conexo, "ver também" e as dívidas do titular em outras ações.
  it('o título vence as anotações', () => {
    const nota = `Reprovado: titular tem dívida no processo ${DE_OUTRO}.`
    expect(cnjDoCard(`Dr. Alex Dornelas Loures - ${CRU}`, nota)).toBe(PONTUADO)
  })

  // O DEFEITO EXATO QUE ISTO TRAVA: com o título em dígitos crus, a busca
  // antiga não o reconhecia e caía na nota — gravando no espelho o processo da
  // dívida do titular como se fosse o do card.
  it('título em dígitos crus não deixa a nota vencer', () => {
    const nota = `Execução fiscal ${DE_OUTRO} contra o cedente.`
    const achado = cnjDoCard(`Dr. Alex Dornelas Loures - ${CRU}`, nota)
    expect(achado).toBe(PONTUADO)
    expect(achado).not.toBe(DE_OUTRO)
  })

  // AS RESERVAS CONTINUAM VALENDO, para o card antigo que não tem número no
  // título — tirá-las deixaria esses cards sem número nenhum.
  it('sem número no título, a reserva responde', () => {
    expect(cnjDoCard('CBR Ativos - Fulano de Tal', `PROCESSO: ${DE_OUTRO}`)).toBe(DE_OUTRO)
  })

  it('a ordem das reservas é respeitada', () => {
    expect(cnjDoCard('sem número', '', `nota antiga ${PONTUADO}`, `nota nova ${DE_OUTRO}`))
      .toBe(PONTUADO)
  })

  it('sem número em lugar nenhum, string vazia', () => {
    expect(cnjDoCard('CBR Ativos - Fulano', 'nada aqui', null, undefined)).toBe('')
    expect(cnjDoCard(null)).toBe('')
  })
})
