import { describe, expect, it } from 'vitest'
import type { Armazenamento } from '@/lib/preferencias'
import {
  apagarRascunho,
  chaveDoRascunho,
  guardarRascunho,
  lerRascunho,
  PRAZO_DO_RASCUNHO_DIAS,
  rascunhoGuardado,
  textoDoRascunho,
} from '@/lib/rascunhoDoCard'

/**
 * O RASCUNHO POR CARD: o texto começado e não enviado volta ao campo, e só
 * texto — nada aqui envia, anota ou move card.
 */
function memoria(): Armazenamento & { dados: Map<string, string> } {
  const dados = new Map<string, string>()
  return {
    dados,
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => void dados.set(k, v),
    removeItem: (k) => void dados.delete(k),
  }
}

/** O navegador que lança erro em todo acesso (janela anônima, armazenamento bloqueado). */
const bloqueado: Armazenamento = {
  getItem: () => {
    throw new Error('bloqueado')
  },
  setItem: () => {
    throw new Error('bloqueado')
  },
  removeItem: () => {
    throw new Error('bloqueado')
  },
}

const DIA = 86_400_000

describe('rascunho por card', () => {
  it('guarda e devolve o texto do mesmo card e do mesmo lugar', () => {
    const m = memoria()
    guardarRascunho(10, 'anotacao', 'Cedente enviou o RG', m)
    expect(rascunhoGuardado(10, 'anotacao', m)?.texto).toBe('Cedente enviou o RG')
    // Outro card, ou outro lugar do mesmo card, não vê.
    expect(rascunhoGuardado(11, 'anotacao', m)).toBeNull()
    expect(rascunhoGuardado(10, 'naofechou', m)).toBeNull()
  })

  it('a mensagem de uma saída não aparece na janela de outra', () => {
    const m = memoria()
    guardarRascunho(10, 'mensagem.1-2', 'motivo da reprovação', m)
    expect(rascunhoGuardado(10, 'mensagem.3', m)).toBeNull()
    expect(chaveDoRascunho(10, 'mensagem.1-2')).not.toBe(chaveDoRascunho(10, 'mensagem.3'))
  })

  it('texto vazio ou só espaço apaga, em vez de guardar', () => {
    const m = memoria()
    guardarRascunho(10, 'anotacao', 'algo', m)
    guardarRascunho(10, 'anotacao', '   \n', m)
    expect(m.dados.size).toBe(0)
    expect(textoDoRascunho('  ')).toBeNull()
  })

  it('apagar tira só o daquele lugar', () => {
    const m = memoria()
    guardarRascunho(10, 'anotacao', 'a', m)
    guardarRascunho(10, 'naofechou', 'b', m)
    apagarRascunho(10, 'anotacao', m)
    expect(rascunhoGuardado(10, 'anotacao', m)).toBeNull()
    expect(rascunhoGuardado(10, 'naofechou', m)?.texto).toBe('b')
  })

  it('o vencido não volta, e sai do navegador ao ser lido', () => {
    const agora = Date.now()
    const velho = textoDoRascunho('texto antigo', agora - (PRAZO_DO_RASCUNHO_DIAS + 1) * DIA)!
    expect(lerRascunho(velho, agora)).toBeNull()
    const quase = textoDoRascunho('texto recente', agora - (PRAZO_DO_RASCUNHO_DIAS - 1) * DIA)!
    expect(lerRascunho(quase, agora)?.texto).toBe('texto recente')

    const m = memoria()
    m.setItem(chaveDoRascunho(10, 'anotacao'), velho)
    expect(rascunhoGuardado(10, 'anotacao', m)).toBeNull()
    expect(m.dados.size).toBe(0)
  })

  it('o que não se reconhece é nada', () => {
    for (const cru of [null, '', '{quebrado', 'null', '"texto"', '{"texto":1,"em":1}', '{"texto":"x"}', '{"texto":" ","em":1}']) {
      expect(lerRascunho(cru)).toBeNull()
    }
  })

  it('sem armazenamento, nada quebra: só não lembra', () => {
    expect(() => guardarRascunho(10, 'anotacao', 'x', bloqueado)).not.toThrow()
    expect(rascunhoGuardado(10, 'anotacao', bloqueado)).toBeNull()
    expect(() => apagarRascunho(10, 'anotacao', bloqueado)).not.toThrow()
    expect(rascunhoGuardado(10, 'anotacao', null)).toBeNull()
  })
})
