/**
 * A BASE DO KOMMO PARA O ASSISTENTE (12/11/2026, pedido do dono): os relatórios
 * da análise de crédito saem do espelho que a plataforma já guarda, num arquivo
 * que o assistente lê em código.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  camposDoCard,
  cardDaBase,
  montarBaseDoKommo,
  type EtapaDoEspelho,
  type LinhaDoEspelho,
} from '../../../supabase/functions/_shared/baseDoKommo.ts'

const ETAPAS: EtapaDoEspelho[] = [
  { pipeline_id: 2, status_id: 20, pipeline_nome: 'PRECATÓRIO EXTERNO', nome: 'NEGOCIAÇÃO', ordem: 5 },
  { pipeline_id: 2, status_id: 10, pipeline_nome: 'PRECATÓRIO EXTERNO', nome: 'EM PRECIFICAÇÃO', ordem: 3 },
  { pipeline_id: 1, status_id: 30, pipeline_nome: 'RPV', nome: 'Reprovados', ordem: 9 },
]
const linha = (x: Partial<LinhaDoEspelho>): LinhaDoEspelho => ({
  kommo_lead_id: 1, pipeline_id: 2, status_id: 20, nome: 'Dr. X - Fulano - 0001 - 30%', responsavel_nome: 'Ana',
  processo_cnj: '0001', tags: [], tags_em: {}, criado_em: '2026-10-01T00:00:00Z', atualizado_em: null,
  etapa_em: '2026-10-20T00:00:00Z', sincronizado_em: '2026-11-12T10:00:00Z', raw: {}, notas: [], ...x,
})
const porChave = new Map(ETAPAS.map((e) => [`${e.pipeline_id}:${e.status_id}`, e]))

describe('cardDaBase', () => {
  it('funil e coluna pelo nome, desfechos dos fundos com a data, campos e notas', () => {
    const c = cardDaBase(
      linha({
        tags: ['Reprovado Domus', 'Cotado K &amp; WC Ativos'],
        tags_em: { 'Reprovado Domus': '2026-10-21T00:00:00Z' },
        raw: {
          price: 850000,
          closed_at: 1793000000,
          custom_fields_values: [{ field_name: 'K &amp; WC Ativos', values: [{ value: 'R$ 800.000,00 / R$ 40.000,00' }] }],
        },
        notas: [
          { texto: 'Cedente recusou: achou o deságio alto.', autor: 'Bia', tipo: 'common', criado_em: '2026-10-22T00:00:00Z' },
          { texto: 'Movido para Não fechados por Ana.', tipo: 'service_message', automatica: true },
          { texto: '   ' },
        ],
      }),
      porChave,
    )
    expect(c).toMatchObject({ funil: 'PRECATÓRIO EXTERNO', coluna: 'NEGOCIAÇÃO', valor_do_card: 850000, na_coluna_desde: '2026-10-20T00:00:00Z' })
    expect(c.fechado_em).toBe(new Date(1793000000 * 1000).toISOString())
    expect(c.etiquetas).toEqual([
      { nome: 'Reprovado Domus', desde: '2026-10-21T00:00:00Z' },
      { nome: 'Cotado K & WC Ativos', desde: null },
    ])
    expect(c.campos).toEqual({ 'K & WC Ativos': 'R$ 800.000,00 / R$ 40.000,00' })
    expect(c.notas).toHaveLength(2)
    expect(c.notas[0]).toMatchObject({ autor: 'Bia', do_sistema: false })
    expect(c.notas[1]).toMatchObject({ do_sistema: true })
  })
  it('as colunas de sistema do Kommo (ganho e perdido) têm nome', () => {
    expect(cardDaBase(linha({ status_id: 143 }), porChave).coluna).toBe('Perdido (fechado no Kommo)')
    expect(cardDaBase(linha({ status_id: 142 }), porChave).funil).toBe('PRECATÓRIO EXTERNO')
  })
  it('campos vazios e formas estranhas não quebram', () => {
    expect(camposDoCard(null)).toEqual({})
    expect(camposDoCard({ custom_fields_values: null })).toEqual({})
    expect(camposDoCard({ custom_fields_values: [{ field_name: 'X', values: [] }] })).toEqual({})
  })
})

describe('montarBaseDoKommo', () => {
  it('conta os cards, diz o dado mais antigo e a ordem das colunas de cada funil', () => {
    const b = montarBaseDoKommo(
      [linha({}), linha({ kommo_lead_id: 2, sincronizado_em: '2026-11-12T09:45:00Z' })],
      ETAPAS,
      new Date('2026-11-12T10:05:00Z'),
    )
    expect(b.total_de_cards).toBe(2)
    expect(b.sincronizado_desde).toBe('2026-11-12T09:45:00Z')
    expect(b.colunas_por_funil['PRECATÓRIO EXTERNO']).toEqual(['EM PRECIFICAÇÃO', 'NEGOCIAÇÃO'])
  })
})

describe('o assistente', () => {
  const raiz = join(__dirname, '..', '..', '..')
  it('lê o espelho em páginas, com a sessão de quem pergunta, e manda a base no container', () => {
    const f = readFileSync(join(raiz, 'supabase/functions/assistente/index.ts'), 'utf8')
    expect(f).toContain("{ porPagina: 500, maxPaginas: 40 },")
    expect(f).toContain("const base = await anexarBaseDoKommo(svc, apiKey, sinalAteOTeto(inicio))")
    expect(f).toContain('const comCodigo = skills.length > 0 || comBaseDoKommo')
    expect(f).toContain("...(comBaseDoKommo ? [{ type: 'text' as const, text: SISTEMA_BASE_KOMMO }] : []),")
  })
  it('a tela tem o interruptor e manda o pedido', () => {
    const t = readFileSync(join(raiz, 'src/components/Assistente.tsx'), 'utf8')
    expect(t).toContain('aria-pressed={comBaseDoKommo}')
    expect(t).toContain('...(comBaseDoKommo ? { base_kommo: true } : {}),')
    expect(t).toContain("if (comBaseDoKommo) form.append('base_kommo', 'true')")
  })
})
