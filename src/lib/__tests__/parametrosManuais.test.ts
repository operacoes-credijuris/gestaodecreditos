import { describe, it, expect } from 'vitest'
import {
  aplicarParametrosManuais,
  parametrosParaCalibragem,
} from '../../../supabase/functions/_shared/revisao.ts'

/**
 * Os parâmetros do negócio ditados no chat: deságio, meta, comissão,
 * diligência, verbas e prazo.
 *
 * Testados porque ESTAVAM SENDO GRAVADOS E NUNCA LIDOS: o chat respondia
 * "Aplicado: deságio ditado: 30,00%" e o motor calibrava no automático. E o
 * caminho de volta não existia — `Number(null)` é zero, então "volta ao
 * automático" fixaria o deságio em 0%. Cada teste aqui é uma frase que o
 * operador diz no chat e o que tem de acontecer com o preço.
 */
describe('aplicarParametrosManuais', () => {
  it('"fecha a 30%" fixa o deságio', () => {
    const r = aplicarParametrosManuais({}, { parametros: { desagio: 0.3 } })
    expect(r.dados._desagio_manual).toBe(0.3)
    expect(r.mudancas).toEqual(['deságio ditado: 30.00%'])
    expect(r.avisos).toEqual([])
  })

  it('"volta o deságio ao automático" APAGA o campo — não o zera', () => {
    // Era o defeito: Number(null) === 0 passava por "zero pedido".
    const r = aplicarParametrosManuais({ _desagio_manual: 0.3 }, { parametros: { desagio: null } })
    expect('_desagio_manual' in r.dados).toBe(false)
    expect(r.mudancas).toEqual(['deságio: de volta ao automático'])
  })

  it('"auto" também volta ao automático', () => {
    const r = aplicarParametrosManuais({ _comissao_manual: 0.05 }, { parametros: { comissao_pct: 'auto' } })
    expect('_comissao_manual' in r.dados).toBe(false)
  })

  it('voltar ao automático o que nunca foi fixado não inventa mudança', () => {
    const r = aplicarParametrosManuais({}, { parametros: { desagio: null } })
    expect(r.mudancas).toEqual([])
    expect(r.avisos).toEqual([])
  })

  it('chave ausente não mexe em nada', () => {
    const r = aplicarParametrosManuais({ _desagio_manual: 0.3 }, { parametros: { comissao_pct: 0.05 } })
    expect(r.dados._desagio_manual).toBe(0.3)
    expect(r.dados._comissao_manual).toBe(0.05)
  })

  it('fora de faixa é ignorado E dito — deságio de 300% é erro de digitação', () => {
    const r = aplicarParametrosManuais({}, { parametros: { desagio: 3, alvo_mensal: 0, diligencia: 9_000_000 } })
    expect('_desagio_manual' in r.dados).toBe(false)
    expect('_alvo_manual' in r.dados).toBe(false)
    expect('_diligencia_manual' in r.dados).toBe(false)
    expect(r.avisos).toHaveLength(3)
    expect(r.avisos[0]).toMatch(/deságio.*fora de faixa/)
  })

  it('zero é um pedido legítimo para deságio, comissão e diligência', () => {
    const r = aplicarParametrosManuais({}, { parametros: { desagio: 0, comissao_pct: 0, diligencia: 0 } })
    expect(r.dados._desagio_manual).toBe(0)
    expect(r.dados._comissao_manual).toBe(0)
    expect(r.dados._diligencia_manual).toBe(0)
  })

  it('número escrito como texto com vírgula é aceito', () => {
    const r = aplicarParametrosManuais({}, { parametros: { desagio: '0,25' } })
    expect(r.dados._desagio_manual).toBe(0.25)
  })

  it('texto vazio não vira zero', () => {
    // Number('') === 0. Sem a guarda, "" fixaria o deságio em 0%.
    const r = aplicarParametrosManuais({}, { parametros: { desagio: '' } })
    expect('_desagio_manual' in r.dados).toBe(false)
    expect(r.avisos).toHaveLength(1)
  })

  it('"tira os sucumbenciais" grava as verbas ditadas', () => {
    const r = aplicarParametrosManuais({}, { verbas: { principal: true, contratuais: true, sucumbenciais: false } })
    expect(r.dados._verbas_manuais).toEqual({ principal: true, contratuais: true, sucumbenciais: false })
    expect(r.mudancas).toEqual(['verbas negociadas: principal + contratuais'])
  })

  it('verbas todas falsas não mexem — um negócio precisa de pelo menos uma', () => {
    const r = aplicarParametrosManuais({ _verbas_manuais: { principal: true, contratuais: false, sucumbenciais: false } }, {
      verbas: { principal: false, contratuais: false, sucumbenciais: false },
    })
    expect(r.dados._verbas_manuais).toEqual({ principal: true, contratuais: false, sucumbenciais: false })
    expect(r.avisos).toHaveLength(1)
  })

  it('verbas null voltam ao que o card diz', () => {
    const r = aplicarParametrosManuais({ _verbas_manuais: { principal: true, contratuais: false, sucumbenciais: false } }, { verbas: null })
    expect('_verbas_manuais' in r.dados).toBe(false)
  })

  it('"o prazo é 10 meses" fixa; "auto" e 0 voltam ao calculado; null não mexe', () => {
    expect(aplicarParametrosManuais({}, { prazo_meses_manual: 10 }).dados._prazo_manual).toBe(10)
    expect('_prazo_manual' in aplicarParametrosManuais({ _prazo_manual: 10 }, { prazo_meses_manual: 'auto' }).dados).toBe(false)
    expect('_prazo_manual' in aplicarParametrosManuais({ _prazo_manual: 10 }, { prazo_meses_manual: 0 }).dados).toBe(false)
    expect(aplicarParametrosManuais({ _prazo_manual: 10 }, { prazo_meses_manual: null }).dados._prazo_manual).toBe(10)
  })

  it('prazo absurdo é ignorado e dito', () => {
    const r = aplicarParametrosManuais({}, { prazo_meses_manual: 500 })
    expect('_prazo_manual' in r.dados).toBe(false)
    expect(r.avisos[0]).toMatch(/prazo/)
  })

  it('não altera o objeto de entrada', () => {
    const atual = { _desagio_manual: 0.3 }
    aplicarParametrosManuais(atual, { parametros: { desagio: null } })
    expect(atual._desagio_manual).toBe(0.3)
  })
})

describe('parametrosParaCalibragem', () => {
  it('sem nada ditado, tudo automático', () => {
    const p = parametrosParaCalibragem({})
    expect(p).toEqual({
      desagioFixo: null, alvo: undefined, comissaoPct: undefined, diligencia: undefined, verbas: null, descricao: [],
    })
  })

  it('lê o que foi ditado e descreve para a tela', () => {
    const p = parametrosParaCalibragem({
      _desagio_manual: 0.3, _alvo_manual: 0.02, _comissao_manual: 0.05, _diligencia_manual: 100,
      _verbas_manuais: { principal: true, contratuais: false, sucumbenciais: false },
    })
    expect(p.desagioFixo).toBe(0.3)
    expect(p.alvo).toBe(0.02)
    expect(p.comissaoPct).toBe(0.05)
    expect(p.diligencia).toBe(100)
    expect(p.verbas).toEqual({ principal: true, contratuais: false, sucumbenciais: false })
    expect(p.descricao).toHaveLength(5)
    expect(p.descricao[0]).toBe('deságio ditado no chat: 30.00%')
  })

  it('campo corrompido volta ao automático em vez de virar zero', () => {
    // Análise gravada com lixo ("abc", null, objeto) não pode fixar 0%.
    const p = parametrosParaCalibragem({ _desagio_manual: 'abc', _alvo_manual: null, _comissao_manual: {} })
    expect(p.desagioFixo).toBeNull()
    expect(p.alvo).toBeUndefined()
    expect(p.comissaoPct).toBeUndefined()
  })

  it('verbas ditadas todas falsas não valem', () => {
    const p = parametrosParaCalibragem({ _verbas_manuais: { principal: false, contratuais: false, sucumbenciais: false } })
    expect(p.verbas).toBeNull()
  })
})
