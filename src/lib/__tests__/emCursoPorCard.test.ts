// O que está em curso em cada card da Análise de crédito (src/lib/emCursoPorCard.ts).
//
// MOVER CARD NO KOMMO NÃO SE DESFAZ. A trava da tela era UMA VAGA para a página
// inteira: agir no card B apagava a trava do card A ainda no ar (e o segundo
// clique em A movia de novo), e terminar A soltava a de B. Estes testes prendem
// a trava POR CARD, o descarte do cache que poupa as DUAS janelas abertas e a
// recusa de mover para outra coluna com a nota de um movimento ainda pendente.
import { describe, it, expect } from 'vitest'
import {
  chaveDoMovimento,
  comecarNoCard,
  ehNotaNaoSubiu,
  esquecerAgoraOuDepois,
  movimentoRecusado,
  NotaNaoSubiu,
  soDosAbertos,
  terminarNoCard,
  type PorCard,
} from '@/lib/emCursoPorCard'

const A = 101
const B = 202

describe('comecarNoCard / terminarNoCard — a trava é de cada card', () => {
  it('começar em B não apaga a trava de A', () => {
    let m: PorCard<number> = {}
    m = comecarNoCard(m, A, 1)
    m = comecarNoCard(m, B, 2)
    expect(m[A]).toBe(1)
    expect(m[B]).toBe(2)
  })

  it('terminar em A não solta B, que continua no ar', () => {
    let m: PorCard<number> = {}
    m = comecarNoCard(m, A, 1)
    m = comecarNoCard(m, B, 2)
    m = terminarNoCard(m, A)
    expect(m[A]).toBeUndefined()
    expect(m[B]).toBe(2)
  })

  it('terminar um card sem nada em curso devolve o mesmo objeto (nada a redesenhar)', () => {
    const m: PorCard<number> = comecarNoCard({}, A, 1)
    expect(terminarNoCard(m, B)).toBe(m)
  })

  it('não muta o registro de antes', () => {
    const antes: PorCard<string> = comecarNoCard({}, A, 'Cotado BTG')
    const depois = terminarNoCard(comecarNoCard(antes, B, 'Enviado PJus'), A)
    expect(antes).toEqual({ [A]: 'Cotado BTG' })
    expect(depois).toEqual({ [B]: 'Enviado PJus' })
  })
})

describe('soDosAbertos — o sync poupa o cache das janelas abertas', () => {
  const cache = { [A]: 'pdf de A', [B]: 'pdf de B', 303: 'pdf de outro' }

  it('poupa a due diligence E as certidões (antes, só a due diligence)', () => {
    expect(soDosAbertos(cache, [A, B])).toEqual({ [A]: 'pdf de A', [B]: 'pdf de B' })
  })

  it('sem janela aberta, descarta tudo', () => {
    expect(soDosAbertos(cache, [undefined, null])).toEqual({})
  })

  it('janela aberta de card sem nada no cache não inventa entrada', () => {
    expect(soDosAbertos(cache, [999])).toEqual({})
  })
})

describe('movimentoRecusado — com a nota pendente, não move para outra coluna', () => {
  const REPROVADOS = 9001
  const DILIGENCIA = 9002

  it('sem movimento pendente, move', () => {
    expect(movimentoRecusado(new Set(), A, DILIGENCIA)).toBeNull()
  })

  it('a MESMA coluna do movimento pendente segue valendo (é o retry que só anota)', () => {
    const ja = new Set([chaveDoMovimento(A, REPROVADOS)])
    expect(movimentoRecusado(ja, A, REPROVADOS)).toBeNull()
  })

  it('OUTRA coluna, com o card já movido nesta janela: recusa, e diz o que fazer', () => {
    const ja = new Set([chaveDoMovimento(A, REPROVADOS)])
    const recusa = movimentoRecusado(ja, A, DILIGENCIA)
    expect(recusa).toMatch(/já foi movido/)
    expect(recusa).toMatch(/feche a janela/)
  })

  it('o pendente de OUTRO card não trava este — nem o de id que começa igual', () => {
    const ja = new Set([chaveDoMovimento(12, REPROVADOS), chaveDoMovimento(B, REPROVADOS)])
    expect(movimentoRecusado(ja, 123, DILIGENCIA)).toBeNull()
    expect(movimentoRecusado(ja, A, DILIGENCIA)).toBeNull()
  })
})

// AUDITORIA DE 09/10/2026: a caixa do "Fechado!" e a do "Escolher proposta"
// moram no card, e o card sai da lista entre o movimento e a nota. A falha da
// nota sumia junto com a caixa, e a memória "já movido" ficava presa ao card.
describe('NotaNaoSubiu — a falha da nota tem tipo próprio', () => {
  it('é reconhecida pelo tipo, e não pela memória de movimentos', () => {
    const e = new NotaNaoSubiu('O card foi movido, mas a nota com a mensagem não subiu (x).')
    expect(ehNotaNaoSubiu(e)).toBe(true)
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toMatch(/O card foi movido/)
    expect(ehNotaNaoSubiu(new Error('HTTP 500'))).toBe(false)
    expect(ehNotaNaoSubiu('texto')).toBe(false)
  })
})

describe('esquecerAgoraOuDepois — esquecer o "já movido" só com o card parado', () => {
  it('card livre: esquece já, e tira o pedido adiado', () => {
    const adiados = new Set([A])
    expect(esquecerAgoraOuDepois(new Set(), adiados, A)).toBe(true)
    expect(adiados.has(A)).toBe(false)
  })

  it('card travado (movimento ou nota no ar): adia — esquecer no meio moveria de novo', () => {
    const adiados = new Set<number>()
    expect(esquecerAgoraOuDepois(new Set([A]), adiados, A)).toBe(false)
    expect(adiados.has(A)).toBe(true)
    // Outro card travado não segura este.
    expect(esquecerAgoraOuDepois(new Set([B]), adiados, A)).toBe(true)
  })
})
