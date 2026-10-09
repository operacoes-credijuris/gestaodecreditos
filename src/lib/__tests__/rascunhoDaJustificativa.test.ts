// O rascunho da justificativa técnica no cache da tela (src/lib/rascunhoDaJustificativa.ts).
//
// AUDITORIA DE 09/10/2026: a edição salva no servidor não entrava no cache.
// Abrindo a janela de outro card e voltando, o campo vinha do cache SEM a
// edição, e o Enviar mandava ao Kommo o texto sem as correções.
import { describe, it, expect } from 'vitest'
import { comRascunhoSalvo } from '@/lib/rascunhoDaJustificativa'
import { textoEmVigor } from '../../../supabase/functions/_shared/justificativaTecnica.ts'

const linha = {
  kommo_lead_id: 7,
  status: 'pronta' as const,
  tentativa: 't1',
  texto: 'gerado pela IA',
  texto_editado: null as string | null,
  rascunho_em: null as string | null,
}

describe('comRascunhoSalvo', () => {
  it('a edição salva passa a ser o texto em vigor da linha do cache', () => {
    const nova = comRascunhoSalvo(linha, { kommo_lead_id: 7, tentativa: 't1', texto: 'corrigido', rascunho_em: '2026-10-09T12:00:00Z' })
    expect(nova?.texto_editado).toBe('corrigido')
    expect(nova?.rascunho_em).toBe('2026-10-09T12:00:00Z')
    expect(textoEmVigor(nova!)).toBe('corrigido')
    // Não muda a linha de entrada (o cache do React Query é imutável).
    expect(linha.texto_editado).toBeNull()
  })

  it('outra geração ou outro card: a linha fica como estava', () => {
    expect(comRascunhoSalvo(linha, { kommo_lead_id: 7, tentativa: 't2', texto: 'x', rascunho_em: 'y' })).toBe(linha)
    expect(comRascunhoSalvo(linha, { kommo_lead_id: 8, tentativa: 't1', texto: 'x', rascunho_em: 'y' })).toBe(linha)
    expect(comRascunhoSalvo(null, { kommo_lead_id: 7, tentativa: 't1', texto: 'x', rascunho_em: 'y' })).toBeNull()
  })
})
