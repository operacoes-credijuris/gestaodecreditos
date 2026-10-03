// A RESERVA DOS ITENS ANTES DE PEDIR À BULLAI (revisão de 03/10/2026).
//
// Duas abas pagavam as mesmas consultas: a BullAI era chamada antes de os itens
// serem marcados. Agora cada item é reservado por um UPDATE condicional, e só o
// que mudou segue. Estes testes prendem as regras puras em volta da reserva.

import { describe, it, expect } from 'vitest'
import {
  ehReserva,
  itemPedivel,
  pedidoRepetido,
  pedidosSemRegistro,
  portaisDosReservados,
  PREFIXO_RESERVA,
  reservaVencida,
  type ItemDoChecklist,
} from '../../../supabase/functions/_shared/reservaBullai.ts'

describe('itemPedivel — a mesma régua da tela', () => {
  it('pendente, falha e manual não presencial podem ir', () => {
    expect(itemPedivel({ status: 'PENDENTE' })).toBe(true)
    expect(itemPedivel({ status: 'FALHA', erro_classe: 'bullai' })).toBe(true)
    expect(itemPedivel({ status: 'PENDENTE_MANUAL', erro_classe: 'bullai' })).toBe(true)
  })

  it('em emissão, obtida, presencial e dispensada não vão', () => {
    expect(itemPedivel({ status: 'EM_EMISSAO' })).toBe(false)
    expect(itemPedivel({ status: 'OBTIDA' })).toBe(false)
    expect(itemPedivel({ status: 'PENDENTE_MANUAL', erro_classe: 'presencial' })).toBe(false)
    expect(itemPedivel({ status: 'NAO_APLICAVEL' })).toBe(false)
  })
})

describe('portaisDosReservados', () => {
  const pedido = { tj: ['a', 'b'], trf: ['b'], federal: ['c'], extra: [] as string[] }

  it('só os itens desta reserva; portal sem item reservado sai; extra fica', () => {
    expect(portaisDosReservados(pedido, new Set(['b']))).toEqual({ tj: ['b'], trf: ['b'], extra: [] })
  })

  it('tudo reservado: o mapa como veio', () => {
    expect(portaisDosReservados(pedido, new Set(['a', 'b', 'c']))).toEqual(pedido)
  })
})

describe('pedidoRepetido', () => {
  it('itens pedidos e nenhum reservado: é o segundo clique — nada sai, nem os extras', () => {
    expect(pedidoRepetido(3, 0)).toBe(true)
  })
  it('algum reservado, ou pedido só de extras: segue', () => {
    expect(pedidoRepetido(3, 1)).toBe(false)
    expect(pedidoRepetido(0, 0)).toBe(false)
  })
})

describe('reservaVencida', () => {
  const agora = Date.parse('2026-10-03T12:00:00Z')
  const reservado: ItemDoChecklist = {
    id: 'a',
    status: 'EM_EMISSAO',
    bullai_job_id: PREFIXO_RESERVA + 'x',
    atualizado_em: '2026-10-03T11:30:00Z',
  }

  it('token de reserva há mais de 15 min: vencida', () => {
    expect(reservaVencida(reservado, agora)).toBe(true)
  })
  it('reserva recente: o pedido pode estar saindo agora', () => {
    expect(reservaVencida({ ...reservado, atualizado_em: '2026-10-03T11:55:00Z' }, agora)).toBe(false)
  })
  it('item com job de verdade nunca é reserva vencida', () => {
    expect(reservaVencida({ ...reservado, bullai_job_id: 'job_123' }, agora)).toBe(false)
  })
  it('só EM_EMISSAO', () => {
    expect(reservaVencida({ ...reservado, status: 'FALHA' }, agora)).toBe(false)
  })
  it('ehReserva reconhece o token', () => {
    expect(ehReserva(PREFIXO_RESERVA + 'abc')).toBe(true)
    expect(ehReserva('job_1')).toBe(false)
    expect(ehReserva(null)).toBe(false)
  })
})

describe('pedidosSemRegistro — o pedido pago que o insert perdeu', () => {
  const itens: ItemDoChecklist[] = [
    { id: 'a', status: 'EM_EMISSAO', sujeito_id: 's1', bullai_job_id: 'job_1', bullai_portais: ['tj', 'trf'] },
    { id: 'b', status: 'EM_EMISSAO', sujeito_id: 's1', bullai_job_id: 'job_1', bullai_portais: ['tj'] },
    { id: 'c', status: 'EM_EMISSAO', sujeito_id: 's2', bullai_job_id: 'job_2', bullai_portais: ['federal'] },
    { id: 'd', status: 'EM_EMISSAO', sujeito_id: 's1', bullai_job_id: PREFIXO_RESERVA + 'z', bullai_portais: [] },
    { id: 'e', status: 'OBTIDA', sujeito_id: 's1', bullai_job_id: 'job_9', bullai_portais: ['tj'] },
  ]

  it('recompõe portal → itens pelos itens, só para job sem registro', () => {
    expect(pedidosSemRegistro(itens, new Set(['job_2']))).toEqual([
      { jobId: 'job_1', sujeitoId: 's1', portais: { tj: ['a', 'b'], trf: ['a'] } },
    ])
  })

  it('reserva e item fora de emissão nunca viram pedido', () => {
    expect(pedidosSemRegistro(itens, new Set(['job_1', 'job_2']))).toEqual([])
  })
})
