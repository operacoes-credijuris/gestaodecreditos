// Guarda semântica dos rótulos de Recortes.
//
// Nasceu de um erro de leitura que o cliente pegou: as colunas diziam "já
// investiu" e "já recebeu" nas três abas. Faz sentido para o investidor, que é
// dono do dinheiro. Não faz sentido nenhum para tribunal e ente devedor —
// ninguém investe num tribunal. O capital apenas está aplicado em créditos que
// tramitam lá, ou que aquele ente deve.
//
// É um teste de texto, não de conta, e existe porque o defeito era de texto:
// o número estava certo e a palavra em cima dele estava errada. Nenhum
// type-check pega isso.

import { describe, it, expect } from 'vitest'
import { COLUNAS, nomeProprio } from '@/pages/inteligencia/Recortes'

/** Verbos que atribuem a ação de investir a quem não investe. */
const VOZ_DE_INVESTIDOR = /investiu|recebeu/i

describe('rótulos das colunas de dinheiro em Recortes', () => {
  it('só o investidor fala na voz de quem investe', () => {
    expect(COLUNAS.investidor.investido).toMatch(VOZ_DE_INVESTIDOR)
    expect(COLUNAS.investidor.recebido).toMatch(VOZ_DE_INVESTIDOR)
  })

  it('tribunal e ente NÃO investem nem recebem', () => {
    for (const aba of ['tribunal', 'ente'] as const) {
      const c = COLUNAS[aba]
      expect(c.investido, `${aba}.investido`).not.toMatch(VOZ_DE_INVESTIDOR)
      expect(c.recebido, `${aba}.recebido`).not.toMatch(VOZ_DE_INVESTIDOR)
      expect(c.aReceber, `${aba}.aReceber`).not.toMatch(VOZ_DE_INVESTIDOR)
    }
  })

  it('a explicação do tribunal diz explicitamente que ele não recebe investimento', () => {
    // Sem isso, o número continua ambíguo mesmo com o rótulo corrigido.
    expect(COLUNAS.tribunal.expInvestido).toMatch(/não recebe investimento/i)
    expect(COLUNAS.ente.expInvestido).toMatch(/não recebe investimento/i)
  })

  it('o ente devedor fala como devedor, que é o que ele é', () => {
    expect(COLUNAS.ente.recebido).toMatch(/pagou/i)
    expect(COLUNAS.ente.aReceber).toMatch(/deve/i)
  })

  it('as três abas têm os seis textos preenchidos', () => {
    for (const aba of ['tribunal', 'ente', 'investidor'] as const) {
      const c = COLUNAS[aba]
      for (const [chave, texto] of Object.entries(c)) {
        expect(texto.trim().length, `${aba}.${chave} vazio`).toBeGreaterThan(0)
      }
    }
  })
})

// O ajuste de caixa dos nomes transformava "TJGO" em "Tjgo": texto todo em
// maiúsculas não separa sigla de palavra, e a regra tratava tudo como palavra.
describe('nomeProprio — siglas ficam em maiúsculas', () => {
  it('tribunais', () => {
    expect(nomeProprio('TJGO')).toBe('TJGO')
    expect(nomeProprio('TJDFT')).toBe('TJDFT')
    expect(nomeProprio('TRF1')).toBe('TRF1')
    expect(nomeProprio('TRF-1')).toBe('TRF-1')
    expect(nomeProprio('TRT18')).toBe('TRT18')
    expect(nomeProprio('STJ')).toBe('STJ')
    expect(nomeProprio('tjgo')).toBe('TJGO')
  })

  it('UF e ente com sigla dentro do nome', () => {
    expect(nomeProprio('MUNICÍPIO DE GOIÂNIA - GO')).toBe('Município de Goiânia - GO')
    expect(nomeProprio('MUNICÍPIO DE GOIÂNIA/GO')).toBe('Município de Goiânia/GO')
    expect(nomeProprio('INSS')).toBe('INSS')
    expect(nomeProprio('IPASGO')).toBe('IPASGO')
  })

  it('o que não é sigla continua como antes', () => {
    expect(nomeProprio('ESTADO DE GOIÁS')).toBe('Estado de Goiás')
    expect(nomeProprio('ERCÍLIO MARTINS DA COSTA JUNIOR')).toBe(
      'Ercílio Martins da Costa Junior',
    )
    expect(nomeProprio('(sem investidor)')).toBe('(Sem Investidor)')
    expect(nomeProprio('UNIÃO FEDERAL')).toBe('União Federal')
  })

  it('caixa mista vem de propósito e não é tocada', () => {
    expect(nomeProprio('TJGO - Goiânia')).toBe('TJGO - Goiânia')
    expect(nomeProprio('Maria da Silva')).toBe('Maria da Silva')
  })
})
