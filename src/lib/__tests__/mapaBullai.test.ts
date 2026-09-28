/**
 * DO CHECKLIST DA CASA ÀS CERTIDÕES DA BULLAI.
 *
 * A metodologia é a da planilha: as regras da casa decidem o que pedir, e aqui
 * só se traduz cada item para as chaves do catálogo da BullAI. O catálogo usado
 * nestes testes é uma AMOSTRA do real, copiado da plataforma em 28/09/2026 —
 * inclusive os buracos dele (Curitiba não tem CND municipal; há três Bom Jesus).
 */
import { describe, it, expect } from 'vitest'
import {
  lerCidade,
  slugDaCidade,
  traduzirParaBullai,
} from '../../../supabase/functions/_shared/mapaBullai.ts'

const CATALOGO = new Set([
  'receita_federal_pf', 'receita_federal_pj',
  'tst_pf', 'tst_pj',
  'cjf_unificada_civel_pf', 'cjf_unificada_criminal_pf', 'cjf_unificada_eleitoral_pf',
  'trf1_unificada_civel_pf', 'trf1_unificada_criminal_pf',
  'trf3_civel_pf', 'trf3_criminal_pf',
  'fgts_crf_pf', 'fgts_crf_pj',
  'cgu_transparencia_sancoes_pf',
  'sefaz_ba_pf', 'sefaz_sp_pf', 'pge_sp_pf', 'sefaz_df_pf',
  'tjba_1grau_civel_pf', 'tjba_1grau_criminal_pf',
  'tjce_unificada_civel_pf', 'tjce_unificada_criminal_pf',
  'tjap_civel_pf', 'tjap_criminal_pf',
  'tjpr_2grau_civel_pf', 'tjpr_2grau_criminal_pf',
  'tjdft_unificada_civel_pf', 'tjdft_unificada_criminal_pf',
  'tjsp_1grau_civel_pf', 'tjsp_1grau_criminal_pf', 'tjsp_2grau_civel_pf',
  'cnd_salvador_ba_pf', 'cnd_sao_jose_do_rio_preto_sp_pf',
  'cnd_curitibanos_sc_pf',
  'cnd_bom_jesus_pi_pf', 'cnd_bom_jesus_rs_pf', 'cnd_bom_jesus_sc_pf',
])

const pf = (codigo: string, parametros: Record<string, unknown> = {}, ufsDoSujeito?: string[]) =>
  traduzirParaBullai({ codigo, parametros, tipoPessoa: 'PF', ufsDoSujeito }, CATALOGO)

describe('as certidões nacionais', () => {
  it('CND Federal e CNDT, com o sufixo do tipo de pessoa', () => {
    expect(pf('FED.CND_RFB_PGFN').chaves).toEqual(['receita_federal_pf'])
    expect(traduzirParaBullai({ codigo: 'TRAB.CNDT', parametros: {}, tipoPessoa: 'PJ' }, CATALOGO).chaves)
      .toEqual(['tst_pj'])
  })

  // A UNIFICADA DA PLANILHA É A DE DISTRIBUIÇÃO: cível e criminal, sem a eleitoral.
  it('a unificada da Justiça Federal traz cível e criminal, e não a eleitoral', () => {
    expect(pf('FED.CJF_UNIFICADA').chaves).toEqual(['cjf_unificada_civel_pf', 'cjf_unificada_criminal_pf'])
  })

  it('cada TRF traz as suas, qualquer que seja o formato da chave', () => {
    expect(pf('FED.TRF1').chaves).toEqual(['trf1_unificada_civel_pf', 'trf1_unificada_criminal_pf'])
    expect(pf('FED.TRF3').chaves).toEqual(['trf3_civel_pf', 'trf3_criminal_pf'])
  })

  it('TRF que o catálogo não tem vira pendência, com o motivo', () => {
    const r = pf('FED.TRF2')
    expect(r.chaves).toEqual([])
    expect(r.semBullai).toContain('TRF2')
  })
})

describe('as certidões por estado', () => {
  it('débitos estaduais: a SEFAZ do estado', () => {
    expect(pf('EST.CDT', { uf: 'BA' }).chaves).toEqual(['sefaz_ba_pf'])
  })

  // SÃO PAULO SE DIVIDE EM DOIS: SEFAZ (não inscritos) e PGE (dívida ativa).
  it('em São Paulo, SEFAZ e PGE', () => {
    expect(pf('EST.CDT', { uf: 'SP' }).chaves).toEqual(['sefaz_sp_pf', 'pge_sp_pf'])
  })

  it('TJ cível e criminal, de 1º grau onde houver', () => {
    expect(pf('EST.TJ_CIVEL_CRIMINAL', { uf: 'BA' }).chaves)
      .toEqual(['tjba_1grau_civel_pf', 'tjba_1grau_criminal_pf'])
    // Onde há os dois graus, fica o 1º: é a distribuição que pega execução.
    expect(pf('EST.TJ_CIVEL_CRIMINAL', { uf: 'SP' }).chaves)
      .toEqual(['tjsp_1grau_civel_pf', 'tjsp_1grau_criminal_pf'])
  })

  it('os outros formatos de chave do TJ: unificada, sem grau, só 2º grau, DF', () => {
    expect(pf('EST.TJ_CIVEL_CRIMINAL', { uf: 'CE' }).chaves)
      .toEqual(['tjce_unificada_civel_pf', 'tjce_unificada_criminal_pf'])
    expect(pf('EST.TJ_CIVEL_CRIMINAL', { uf: 'AP' }).chaves).toEqual(['tjap_civel_pf', 'tjap_criminal_pf'])
    expect(pf('EST.TJ_CIVEL_CRIMINAL', { uf: 'PR' }).chaves)
      .toEqual(['tjpr_2grau_civel_pf', 'tjpr_2grau_criminal_pf'])
    expect(pf('EST.TJ_CIVEL_CRIMINAL', { uf: 'DF' }).chaves)
      .toEqual(['tjdft_unificada_civel_pf', 'tjdft_unificada_criminal_pf'])
  })

  it('item sem estado não é pedido — é pendência', () => {
    expect(pf('EST.CDT', {}).semBullai).toContain('defina a UF')
  })
})

describe('a CND municipal', () => {
  it('pela cidade, com acento e espaço', () => {
    expect(pf('MUN.CND', { municipio: 'Salvador' }).chaves).toEqual(['cnd_salvador_ba_pf'])
    expect(pf('MUN.CND', { municipio: 'São José do Rio Preto' }).chaves)
      .toEqual(['cnd_sao_jose_do_rio_preto_sp_pf'])
  })

  // COMPARAÇÃO EXATA, e não por começo: Curitiba não está no catálogo, e
  // "Curitibanos" é outra cidade.
  it('cidade que a BullAI não cobre não casa com outra de nome parecido', () => {
    const r = pf('MUN.CND', { municipio: 'Curitiba' })
    expect(r.chaves).toEqual([])
    expect(r.semBullai).toContain('Curitiba')
  })

  // TRÊS BOM JESUS: sem estado, não há como escolher sozinho.
  it('cidades de mesmo nome se desempatam pelos estados da pessoa', () => {
    expect(pf('MUN.CND', { municipio: 'Bom Jesus' }, ['PI']).chaves).toEqual(['cnd_bom_jesus_pi_pf'])
    expect(pf('MUN.CND', { municipio: 'Bom Jesus' }, ['BA']).semBullai).toContain('3 cidades')
  })

  it('o estado escrito junto da cidade manda, e exige casar exato', () => {
    expect(pf('MUN.CND', { municipio: 'Bom Jesus/RS' }).chaves).toEqual(['cnd_bom_jesus_rs_pf'])
    // Salvador/SP não é Salvador da Bahia, mesmo sendo a única Salvador do catálogo.
    expect(pf('MUN.CND', { municipio: 'Salvador/SP' }).chaves).toEqual([])
  })
})

describe('o que a BullAI não emite', () => {
  it('protesto, situação do CNPJ, interdição e caderno processual ficam de fora, com o motivo', () => {
    for (const codigo of ['EXTRA.PROTESTO_CENPROT', 'PJ.CNPJ_SITUACAO', 'PROP.INTERDICAO', 'PREC.CADERNO_PROCESSUAL']) {
      const r = pf(codigo)
      expect(r.chaves, codigo).toEqual([])
      expect(r.semBullai, codigo).toBeTruthy()
    }
  })

  it('código desconhecido não é pedido', () => {
    expect(pf('XYZ.NOVA').chaves).toEqual([])
  })
})

describe('as leituras de cidade', () => {
  it('separa cidade e estado nos formatos comuns', () => {
    expect(lerCidade('Salvador/BA')).toEqual({ cidade: 'Salvador', uf: 'BA' })
    expect(lerCidade('Salvador - BA')).toEqual({ cidade: 'Salvador', uf: 'BA' })
    expect(lerCidade('Salvador (BA)')).toEqual({ cidade: 'Salvador', uf: 'BA' })
    expect(lerCidade('São José do Rio Preto')).toEqual({ cidade: 'São José do Rio Preto', uf: null })
  })

  it('o nome vira a chave da BullAI', () => {
    expect(slugDaCidade('São José do Rio Preto')).toBe('sao_jose_do_rio_preto')
    expect(slugDaCidade("Santa Bárbara d'Oeste")).toBe('santa_barbara_doeste')
  })
})
