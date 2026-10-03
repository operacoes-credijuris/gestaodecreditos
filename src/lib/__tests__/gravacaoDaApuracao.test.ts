// COMO A APURAÇÃO PAGA DO ESCAVADOR ENTRA NO BANCO (revisão de 03/10/2026).
//
// Depois de pago, o consumo é sempre registrado e o resultado é salvo de forma
// que reabrir não pague de novo. Estes testes prendem as três regras que a
// `dd-processos` usa para isso: a liberação sai na reapuração, a falha não
// derruba uma apuração boa, e a linha existente é achada sem filtro de texto.

import { describe, it, expect } from 'vitest'
import {
  chaveDoAlvo,
  destinoDaApuracao,
  ehConflitoDeUnicidade,
  faltaColunaDaLiberacao,
  historicoDoAlvo,
  observacaoDaFalhaMantida,
  observacaoDaGravacaoFalha,
  type LinhaDoHistorico,
} from '../../../supabase/functions/_shared/gravacaoDaApuracao.ts'

describe('chaveDoAlvo — a do índice dd_historico_alvo_uk', () => {
  it('coalesce(documento, oab, nome), nesta ordem', () => {
    expect(chaveDoAlvo({ documento: '12345678901', oab: 'GO 1', nome: 'A' })).toBe('12345678901')
    expect(chaveDoAlvo({ documento: null, oab: 'GO 1', nome: 'A' })).toBe('GO 1')
    expect(chaveDoAlvo({ documento: null, oab: null, nome: 'A' })).toBe('A')
  })

  it('como no Postgres, só NULL cai para o próximo', () => {
    expect(chaveDoAlvo({ documento: '', oab: 'GO 1', nome: 'A' })).toBe('')
  })
})

describe('historicoDoAlvo', () => {
  const linhas: LinhaDoHistorico[] = [
    { id: 'oab', documento: null, oab: 'GO 12345', nome: 'Fulano' },
    { id: 'nome', documento: null, oab: null, nome: 'Silva, João (espólio)' },
    { id: 'cpf', documento: '12345678901', oab: null, nome: 'Beltrano' },
  ]

  it('nome com vírgula e parêntese não vira sintaxe: acha a linha', () => {
    expect(historicoDoAlvo(linhas, { nome: 'Silva, João (espólio)' })?.id).toBe('nome')
  })

  it('a linha da MESMA CHAVE do índice vence — é ela que o insert acertaria', () => {
    // O alvo casa com "oab" pela OAB e com "cpf" pelo documento; a chave dele é
    // o CPF, então é "cpf" que tem de ser atualizada.
    expect(historicoDoAlvo(linhas, { documento: '12345678901', oab: 'GO 12345', nome: 'X' })?.id).toBe('cpf')
  })

  it('apuração feita só pela OAB liga-se à de agora, que já tem o CPF', () => {
    expect(historicoDoAlvo(linhas, { documento: '99999999999', oab: 'GO 12345', nome: 'Fulano' })?.id).toBe('oab')
  })

  it('nenhuma linha casa: null (insere)', () => {
    expect(historicoDoAlvo(linhas, { documento: '11111111111', nome: 'Outro' })).toBeNull()
  })

  it('vazio casa só como CHAVE do índice (é o que o índice compara); fora dela, vazio não liga linhas', () => {
    expect(historicoDoAlvo([{ id: 'v', documento: null, oab: '', nome: 'Z' }], { oab: '', nome: 'Y' })?.id).toBe('v')
    expect(
      historicoDoAlvo([{ id: 'v', documento: '11111111111', oab: '', nome: 'Z' }], {
        documento: '22222222222',
        oab: '',
        nome: 'Y',
      }),
    ).toBeNull()
  })
})

describe('destinoDaApuracao', () => {
  const apurada: LinhaDoHistorico = { id: '1', status: 'APURADO', apurado_em: '2026-09-30T15:00:00Z' }

  it('refazer depois de "Seguir": grava e TIRA a liberação — processo novo não nasce liberado', () => {
    expect(destinoDaApuracao(apurada, 'APURADO')).toEqual({ tipo: 'GRAVAR', limparLiberacao: true })
  })

  it('falha sobre apuração boa (liberada ou recusada): mantém a anterior — o check da 0062/0063 não estoura', () => {
    expect(destinoDaApuracao(apurada, 'FALHA')).toEqual({ tipo: 'MANTER_ANTERIOR' })
  })

  it('falha sem apuração boa antes: grava a FALHA (a lacuna tem de aparecer)', () => {
    expect(destinoDaApuracao(null, 'FALHA')).toEqual({ tipo: 'GRAVAR', limparLiberacao: false })
    expect(destinoDaApuracao({ id: '1', status: 'FALHA' }, 'FALHA').tipo).toBe('GRAVAR')
    expect(destinoDaApuracao({ id: '1', status: 'PENDENTE' }, 'FALHA').tipo).toBe('GRAVAR')
  })

  it('primeira apuração: insere, sem liberação a tirar', () => {
    expect(destinoDaApuracao(null, 'APURADO')).toEqual({ tipo: 'GRAVAR', limparLiberacao: false })
  })
})

describe('erros do banco', () => {
  it('reconhece a corrida no índice único', () => {
    expect(ehConflitoDeUnicidade({ code: '23505', message: '' })).toBe(true)
    expect(ehConflitoDeUnicidade({ message: 'duplicate key value violates unique constraint "dd_historico_alvo_uk"' })).toBe(true)
    expect(ehConflitoDeUnicidade({ code: '23514', message: 'violates check constraint' })).toBe(false)
    expect(ehConflitoDeUnicidade(null)).toBe(false)
  })

  it('reconhece a 0062 pendente', () => {
    expect(faltaColunaDaLiberacao({ message: "Could not find the 'liberado_em' column of 'dd_historico'" })).toBe(true)
    expect(faltaColunaDaLiberacao({ message: 'outra coisa' })).toBe(false)
  })
})

describe('o que a tela lê', () => {
  it('falha com a anterior mantida: diz a falha e a data da foto que ficou', () => {
    const t = observacaoDaFalhaMantida('O Escavador respondeu HTTP 500.', '2026-09-30T15:00:00Z')
    expect(t).toContain('O Escavador respondeu HTTP 500')
    expect(t).toContain('30/09/2026')
    expect(t).toContain('continua valendo')
  })

  it('gravação recusada depois de pagar: diz quanto custou e que o consumo ficou', () => {
    const t = observacaoDaGravacaoFalha('dd_historico: timeout', 134)
    expect(t).toContain('R$ 1,34')
    expect(t).toContain('não foi salvo')
    expect(t).toContain('consumo ficou registrado')
  })
})
