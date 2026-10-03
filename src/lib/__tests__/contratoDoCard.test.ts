// "GERAR CONTRATO" A PARTIR DO CARD (onda 4, etapa 11): o originador só é
// escolhido DA LISTA do Drive, pela regra do servidor, e só no retorno dela — um
// nome fora da lista faria o `gerar-contrato` criar uma pasta nova.

import { describe, it, expect } from 'vitest'
import {
  CATEGORIA_RPV,
  cardDoEndereco,
  originadorAAplicar,
  originadorDoCard,
  preenchimentoDoCard,
  type PreenchimentoDoCard,
} from '../contratoDoCard'
import { FUNIL_PRECATORIO_INTERNO, FUNIL_RPV } from '../kommo'

const LISTA = ['AN Soberana Consultoria', 'Credijuris', 'Intermediador - Lima & Barros Advocacia', 'Dr. Alison Souza']

describe('originadorDoCard — o item da lista, pela chave do servidor', () => {
  it('igual sem contar acento, caixa, espaços e pontuação; devolve o item como está na lista', () => {
    expect(originadorDoCard(LISTA, 'an soberana consultoria')).toBe('AN Soberana Consultoria')
    expect(originadorDoCard(LISTA, 'Dr Alison Souza')).toBe('Dr. Alison Souza')
    expect(originadorDoCard(LISTA, 'CREDIJURÍS')).toBe('Credijuris')
  })

  it('o prefixo "Intermediador - " / "Originador - " não conta, dos dois lados', () => {
    expect(originadorDoCard(LISTA, 'Lima & Barros Advocacia')).toBe('Intermediador - Lima & Barros Advocacia')
    expect(originadorDoCard(LISTA, 'Originador - AN Soberana Consultoria')).toBe('AN Soberana Consultoria')
  })

  it('NUNCA "contém": nome parcial não acha ninguém', () => {
    expect(originadorDoCard(LISTA, 'Soberana')).toBeNull()
    expect(originadorDoCard(LISTA, 'Lima')).toBeNull()
    expect(originadorDoCard(['Intermediador - Luiz Guilherme Batista Carvalho'], 'Guilherme')).toBeNull()
  })

  it('sem intermediador, ou com lista vazia: nada', () => {
    expect(originadorDoCard(LISTA, '')).toBeNull()
    expect(originadorDoCard(LISTA, null)).toBeNull()
    expect(originadorDoCard([], 'Credijuris')).toBeNull()
  })
})

describe('cardDoEndereco — só o id', () => {
  it('aceita só número inteiro positivo', () => {
    expect(cardDoEndereco('21843411')).toBe(21843411)
    expect(cardDoEndereco(' 42 ')).toBe(42)
    for (const v of [null, undefined, '', '0', '-3', '12abc', 'Fulano', '1.5', '1e9']) {
      expect(cardDoEndereco(v), String(v)).toBeNull()
    }
  })
})

describe('preenchimentoDoCard — a mesma leitura do cadastro da análise', () => {
  it('o intermediador e o número do título, e o funil', () => {
    const p = preenchimentoDoCard({
      kommo_lead_id: 7,
      pipeline_id: FUNIL_RPV,
      nome: 'Lima & Barros Advocacia - Maria da Silva - 0001234-56.2023.5.05.0001 - principal',
      notas: [],
    })
    expect(p).toEqual({
      id: 7,
      ehRpv: true,
      cedente: 'Maria da Silva',
      intermediador: 'Lima & Barros Advocacia',
      numero: '0001234-56.2023.5.05.0001',
    })
  })

  it('card de outro funil não é RPV', () => {
    expect(preenchimentoDoCard({ kommo_lead_id: 1, pipeline_id: FUNIL_PRECATORIO_INTERNO, nome: 'X - Y' }).ehRpv).toBe(false)
  })
})

describe('originadorAAplicar — só no retorno da lista, e uma vez', () => {
  const card: PreenchimentoDoCard = { id: 7, ehRpv: true, cedente: 'Maria', intermediador: 'Lima & Barros Advocacia', numero: '' }
  const pronto = { card, jaAplicado: false, categoriaDaLista: CATEGORIA_RPV, carregando: false, lista: LISTA }

  it('com a lista do RPV na mão: o item igual', () => {
    expect(originadorAAplicar(pronto)).toBe('Intermediador - Lima & Barros Advocacia')
  })

  it('sem item igual: em branco ("" — a tela pede a escolha), nunca o nome do card', () => {
    expect(originadorAAplicar({ ...pronto, card: { ...card, intermediador: 'Escritório Novo' } })).toBe('')
  })

  it('antes da lista, com a lista de outra categoria ou com a lista em voo: não mexe', () => {
    expect(originadorAAplicar({ ...pronto, categoriaDaLista: null })).toBeUndefined()
    expect(originadorAAplicar({ ...pronto, categoriaDaLista: 'Precatórios' })).toBeUndefined()
    expect(originadorAAplicar({ ...pronto, carregando: true })).toBeUndefined()
  })

  it('já aplicado (escolha à mão, ou a categoria trocada e voltada): não reaplica', () => {
    expect(originadorAAplicar({ ...pronto, jaAplicado: true })).toBeUndefined()
  })

  it('sem card, ou card que não é RPV: não mexe', () => {
    expect(originadorAAplicar({ ...pronto, card: null })).toBeUndefined()
    expect(originadorAAplicar({ ...pronto, card: { ...card, ehRpv: false } })).toBeUndefined()
  })
})
