// A NOTA DOS DESFECHOS DA ONDA 4 (ver src/lib/desfechoDoCard.ts): o resumo da
// oportunidade só entra ao aprovar, e as notas do "Fechado!" e do "Não fechou".

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  comSugestao,
  MOTIVOS_NAO_FECHOU,
  motivoSuficiente,
  NOTA_DO_FECHADO,
  notaDoFechado,
  notaDoNaoFechou,
  notasDoDesfecho,
} from '../desfechoDoCard'

describe('notasDoDesfecho — o resumo só entra ao aprovar, numa nota própria', () => {
  const resumo = '  Oportunidade Credijuris — RPV\nCessão: 100% do principal  '

  // DUAS NOTAS (07/10/2026, pedido do dono): o resumo (roteiro, link do Drive,
  // canhoto) numa, e o comentário de quem aprovou na seguinte — juntos, a nota
  // ficava grande demais para o comercial achar o comentário.
  it('aprovar com a caixa: o resumo numa nota, a mensagem na seguinte', () => {
    expect(notasDoDesfecho({ papel: 'aprovar', mensagem: ' Segue para proposta. ', resumo })).toEqual([
      'Oportunidade Credijuris — RPV\nCessão: 100% do principal',
      'Segue para proposta.',
    ])
  })

  it('aprovar com a caixa e sem mensagem: só o resumo', () => {
    expect(notasDoDesfecho({ papel: 'aprovar', mensagem: '', resumo })).toEqual([
      'Oportunidade Credijuris — RPV\nCessão: 100% do principal',
    ])
  })

  it('diligência e reprovação: NUNCA o resumo — só a razão escrita', () => {
    for (const papel of ['diligenciar', 'reprovar', 'validar', 'fechar'] as const) {
      expect(notasDoDesfecho({ papel, mensagem: 'Falta a conta da contadoria.', resumo }), papel).toEqual([
        'Falta a conta da contadoria.',
      ])
    }
  })

  it('sem caixa de resumo (null): a mensagem, como sempre foi — inclusive ao aprovar', () => {
    expect(notasDoDesfecho({ papel: 'aprovar', mensagem: ' texto ', resumo: null })).toEqual(['texto'])
  })

  it('tudo vazio: nenhuma nota', () => {
    expect(notasDoDesfecho({ papel: 'aprovar', mensagem: '  ', resumo: '   ' })).toEqual([])
    expect(notasDoDesfecho({ papel: 'reprovar', mensagem: '', resumo: null })).toEqual([])
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
    // SEM PONTO NO FIM, ganha um: antes saía "achou caro Desistiu de vender.".
    expect(comSugestao('achou caro', 'Desistiu de vender')).toBe('achou caro. Desistiu de vender.')
    expect(comSugestao('Achou caro!', 'Desistiu de vender')).toBe('Achou caro! Desistiu de vender.')
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

describe('o Aprovar da Revisão do RPV manda as notas uma a uma', () => {
  it('a janela entrega a lista, e moverComNota anota cada uma, retomando da que faltou', () => {
    const t = readFileSync(join(__dirname, '..', '..', 'pages/operacional/AnaliseCredito.tsx'), 'utf8')
    expect(t).toContain('await onConfirmar(acao, notasDe(acao))')
    expect(t).toContain('async function moverComNota(')
    expect(t).toContain('mensagem: string | string[],')
    expect(t).toContain('for (let i = notasEnviadas.current.get(chave) ?? 0; i < textos.length; i++) {')
  })
})
