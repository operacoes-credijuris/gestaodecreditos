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
import { COLUNAS } from '@/pages/inteligencia/Recortes'

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
