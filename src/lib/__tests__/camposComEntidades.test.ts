/**
 * O "&" QUE O KOMMO DEVOLVE COMO "&amp;" (07/10/2026): na consulta aos cards da
 * Produção de proposta e da Negociação, o campo da K & WC veio como
 * "K &amp; WC Ativos" — e a proposta dela não aparecia no botão das propostas.
 * Os nomes e valores abaixo são os que a consulta devolveu.
 */
import { describe, it, expect } from 'vitest'
import { cotacoesDoCard, chaveDoNome } from '../../../supabase/functions/_shared/cotacaoDoFundo.ts'
import { mesmaEtiqueta, semEntidadesHtml } from '../../../supabase/functions/_shared/etiquetasDoFundo.ts'
import { propostasCadastradas } from '../propostasDoCard'

const campo = (field_name: string, value: string) => ({ field_id: 1, field_name, field_type: 'text', values: [{ value }] })

describe('nomes com entidades HTML', () => {
  it('desfaz &amp; e companhia', () => {
    expect(semEntidadesHtml('K &amp; WC Ativos')).toBe('K & WC Ativos')
    expect(semEntidadesHtml('A &lt;b&gt; &quot;c&quot; &#39;d&#39; &#x26;')).toBe('A <b> "c" \'d\' &')
    expect(semEntidadesHtml('sem nada')).toBe('sem nada')
  })

  it('o campo "K &amp; WC Ativos" é o da K & WC Ativos', () => {
    expect(chaveDoNome('K &amp; WC Ativos')).toBe(chaveDoNome('K & WC Ativos'))
    expect(mesmaEtiqueta('Cotado K &amp; WC Ativos', 'Cotado K & WC Ativos')).toBe(true)
  })

  it('o card com os campos da consulta mostra as 6 propostas', () => {
    const card = {
      tags: [],
      tags_em: {},
      raw: {
        custom_fields_values: [
          campo('Numero do processo', '0000179-28.2024.5.05.0001'),
          campo('BTG', 'R$ 150.306,33 / R$ 18.949,76'),
          campo('PJUS', 'R$ 249.000,00 / R$ 9.960,00'),
          campo('Invest Precatórios', 'R$ 35.000,00 / R$ 15.000,00'),
          campo('Precatur', 'R$ 280.084,19 / R$ 53.862,34 (Spread 10%)'),
          campo('PX Ativos', 'R$ 385.351,41 / R$ 39.648,59'),
          campo('K &amp; WC Ativos', 'R$ 195.122,52 / R$ 15.000,00'),
          campo('SDR', 'Letícia'),
        ],
      },
    }
    const p = propostasCadastradas(card as never)
    expect(p.map((l) => l.fundo)).toEqual(['PJus', 'BTG', 'PX Ativos', 'Invest Precatórios', 'K & WC Ativos', 'Precatur'])
    expect(p.every((l) => l.cotacao?.proposta !== null)).toBe(true)
    expect(cotacoesDoCard(card.raw.custom_fields_values)['K & WC Ativos']?.proposta).not.toBeNull()
  })

  it('o texto à mão com "&amp;" aparece com "&"', () => {
    const c = cotacoesDoCard([campo('Carbon', 'Aguardando comitê &amp; diretoria')])
    expect(JSON.stringify(c.Carbon)).toContain('comitê & diretoria')
  })
})
