// MOVER PARA ONDE O CARD JÁ ESTÁ NÃO É MOVER (revisão de 03/10/2026).
//
// A `kommo-mover` repetia o PATCH para a coluna atual: nota "Movido de X para X"
// e automações do funil rodando de novo. Agora o espelho levanta a suspeita, uma
// leitura do Kommo confirma, e só então a resposta é "já estava".

import { describe, it, expect } from 'vitest'
import {
  lerLeituraDoKommo,
  passoDoMovimento,
} from '../../../supabase/functions/_shared/movimentoIdempotente.ts'

describe('passoDoMovimento', () => {
  it('espelho em outra coluna: move sem ler o Kommo (nenhuma chamada a mais)', () => {
    expect(passoDoMovimento(200, 100)).toBe('MOVER')
  })

  it('card fora do espelho: move, como sempre', () => {
    expect(passoDoMovimento(200, null)).toBe('MOVER')
    expect(passoDoMovimento(200, undefined)).toBe('MOVER')
  })

  it('espelho já no destino: confere no Kommo antes de decidir', () => {
    expect(passoDoMovimento(200, 200)).toBe('CONFERIR_NO_KOMMO')
  })

  it('o Kommo confirma o destino: já está, nada se move', () => {
    expect(passoDoMovimento(200, 200, { statusId: 200 })).toBe('JA_ESTA')
  })

  it('espelho defasado (o Kommo diz outra coluna): move', () => {
    expect(passoDoMovimento(200, 200, { statusId: 100 })).toBe('MOVER')
  })

  it('a leitura falhou: move — é o comportamento de antes, não pior', () => {
    expect(passoDoMovimento(200, 200, null)).toBe('MOVER')
  })

  it('compara como número (o espelho pode vir como texto do banco)', () => {
    expect(passoDoMovimento(200, '200' as unknown as number)).toBe('CONFERIR_NO_KOMMO')
  })
})

describe('lerLeituraDoKommo', () => {
  it('lê status e funil do GET /leads/{id}', () => {
    expect(lerLeituraDoKommo({ id: 1, status_id: 142, pipeline_id: 9 })).toEqual({ statusId: 142, pipelineId: 9 })
  })

  it('sem status_id válido não há leitura, e o movimento segue', () => {
    expect(lerLeituraDoKommo(null)).toBeNull()
    expect(lerLeituraDoKommo({})).toBeNull()
    expect(lerLeituraDoKommo({ status_id: 'x' })).toBeNull()
  })

  it('funil ausente vira null, sem derrubar a leitura', () => {
    expect(lerLeituraDoKommo({ status_id: 5 })).toEqual({ statusId: 5, pipelineId: null })
  })
})
