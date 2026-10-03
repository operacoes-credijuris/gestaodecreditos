// A NOTA DOS DESFECHOS DA ONDA 4 (ver src/lib/desfechoDoCard.ts): o resumo da
// oportunidade só entra ao aprovar, e as notas do "Fechado!" e do "Não fechou".

import { describe, it, expect } from 'vitest'
import {
  comSugestao,
  MOTIVOS_NAO_FECHOU,
  montarNotaDoDesfecho,
  motivoSuficiente,
  NOTA_DO_FECHADO,
  notaDoFechado,
  notaDoNaoFechou,
} from '../desfechoDoCard'

describe('montarNotaDoDesfecho — o resumo só entra ao aprovar', () => {
  const resumo = '  Oportunidade Credijuris — RPV\nCessão: 100% do principal  '

  it('aprovar com a caixa: o resumo como ficou na caixa, depois a mensagem', () => {
    expect(montarNotaDoDesfecho({ papel: 'aprovar', mensagem: ' Segue para proposta. ', resumo })).toBe(
      'Oportunidade Credijuris — RPV\nCessão: 100% do principal\n\nSegue para proposta.',
    )
  })

  it('aprovar com a caixa e sem mensagem: só o resumo', () => {
    expect(montarNotaDoDesfecho({ papel: 'aprovar', mensagem: '', resumo })).toBe(
      'Oportunidade Credijuris — RPV\nCessão: 100% do principal',
    )
  })

  it('diligência e reprovação: NUNCA o resumo — só a razão escrita', () => {
    for (const papel of ['diligenciar', 'reprovar', 'validar', 'fechar'] as const) {
      expect(montarNotaDoDesfecho({ papel, mensagem: 'Falta a conta da contadoria.', resumo }), papel).toBe(
        'Falta a conta da contadoria.',
      )
    }
  })

  it('sem caixa de resumo (null): a mensagem, como sempre foi — inclusive ao aprovar', () => {
    expect(montarNotaDoDesfecho({ papel: 'aprovar', mensagem: ' texto ', resumo: null })).toBe('texto')
  })

  it('tudo vazio: nota vazia (e sem texto não há nota)', () => {
    expect(montarNotaDoDesfecho({ papel: 'aprovar', mensagem: '  ', resumo: '   ' })).toBe('')
    expect(montarNotaDoDesfecho({ papel: 'reprovar', mensagem: '', resumo: null })).toBe('')
  })
})

describe('a nota do "Fechado!" e do "Não fechou"', () => {
  it('Fechado!: a linha fixa, e a anotação opcional depois de uma linha em branco', () => {
    expect(notaDoFechado('')).toBe(NOTA_DO_FECHADO)
    expect(notaDoFechado('  ')).toBe('Proposta aceita pelo cedente.')
    expect(notaDoFechado(' aceitou por telefone ')).toBe('Proposta aceita pelo cedente.\n\naceitou por telefone')
  })

  it('Não fechou: o começo diz qual dos dois', () => {
    expect(notaDoNaoFechou('recusou', ' Achou o deságio alto. ')).toBe('Não fechou: Achou o deságio alto.')
    expect(notaDoNaoFechou('sumiu', 'Não responde no WhatsApp.')).toBe('Sem resposta do cedente: Não responde no WhatsApp.')
  })

  it('o motivo precisa de 10 caracteres, sem contar as pontas', () => {
    expect(motivoSuficiente('curto')).toBe(false)
    expect(motivoSuficiente('   123456789   ')).toBe(false)
    expect(motivoSuficiente('1234567890')).toBe(true)
  })

  it('o motivo de um clique entra como frase no fim do texto', () => {
    expect(comSugestao('', 'Achou o deságio alto')).toBe('Achou o deságio alto.')
    expect(comSugestao('Ligou ontem. ', 'Desistiu de vender')).toBe('Ligou ontem. Desistiu de vender.')
  })

  it('cada jeito de não fechar tem rótulo, exemplo e motivos de um clique', () => {
    for (const m of Object.values(MOTIVOS_NAO_FECHOU)) {
      expect(m.rotulo).toBeTruthy()
      expect(m.exemplo).toBeTruthy()
      expect(m.sugestoes.length).toBeGreaterThan(0)
      // TODA SUGESTÃO SOZINHA JÁ PASSA DA RÉGUA: um clique basta.
      for (const s of m.sugestoes) expect(motivoSuficiente(comSugestao('', s)), s).toBe(true)
    }
  })
})
