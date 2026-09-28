/**
 * O QUE A BULLAI DEVOLVE, no checklist da casa.
 *
 * A BullAI responde por portal; o checklist, por item — e o item "TJ cível e
 * criminal" é uma linha da planilha e duas certidões. Estes testes guardam as
 * três regras que mais custam se errarem: o item só é OBTIDO com o PDF em casa
 * (é o que a trava da etapa documental confere); portais que discordam mostram o
 * resultado MAIS GRAVE; e pessoa física sem data de nascimento não gasta chamada.
 */
import { describe, it, expect } from 'vitest'
import {
  corpoDoPedido,
  estadoDoItem,
  piorResultado,
  resultadoDaCategoria,
} from '../../../supabase/functions/_shared/resultadoBullai.ts'

const civel = { portalKey: 'tjba_1grau_civel_pf', portalLabel: 'TJBA - Cível', status: 'completed', errorCategory: 'negative' }
const criminal = { portalKey: 'tjba_1grau_criminal_pf', portalLabel: 'TJBA - Criminal', status: 'completed', errorCategory: 'negative' }
const DOIS = ['tjba_1grau_civel_pf', 'tjba_1grau_criminal_pf']

describe('resultadoDaCategoria', () => {
  it('traduz as categorias que falam de resultado', () => {
    expect(resultadoDaCategoria('negative')).toBe('negativa')
    expect(resultadoDaCategoria('positive')).toBe('positiva')
    expect(resultadoDaCategoria('not_found')).toBe('nada_consta')
    expect(resultadoDaCategoria('indeterminate')).toBe('indeterminada')
  })

  it('falha não é resultado', () => {
    expect(resultadoDaCategoria('portal_inoperable')).toBeNull()
    expect(resultadoDaCategoria('failed')).toBeNull()
  })
})

describe('estadoDoItem', () => {
  it('com todos os PDFs em casa, é OBTIDA', () => {
    const e = estadoDoItem(DOIS, [civel, criminal], new Set(DOIS))
    expect(e.status).toBe('OBTIDA')
    expect(e.resultado).toBe('negativa')
  })

  // O PDF É A PROVA: "a BullAI disse que emitiu" sem arquivo não fecha dossiê.
  it('emitida sem o PDF no Drive ainda não é OBTIDA', () => {
    const e = estadoDoItem(DOIS, [civel, criminal], new Set(['tjba_1grau_civel_pf']))
    expect(e.status).toBe('EM_EMISSAO')
  })

  // UMA POSITIVA TORNA O ITEM POSITIVO — mostrar "negativa" esconderia o que pesa.
  it('portais que discordam mostram o resultado mais grave', () => {
    const e = estadoDoItem(DOIS, [civel, { ...criminal, errorCategory: 'positive' }], new Set(DOIS))
    expect(e.resultado).toBe('positiva')
    expect(piorResultado(['negativa', 'nada_consta', 'positiva'])).toBe('positiva')
  })

  it('aguardando o portal, diz até quando', () => {
    const e = estadoDoItem(
      DOIS,
      [civel, { ...criminal, status: 'awaiting_async', errorCategory: null, expectedBy: '2026-10-02T12:00:00Z' }],
      new Set(['tjba_1grau_civel_pf']),
    )
    expect(e.status).toBe('EM_EMISSAO')
    expect(e.detalhe).toContain('2026-10-02')
  })

  it('portal fora do ar vira FALHA com o motivo', () => {
    const e = estadoDoItem(
      ['sefaz_ba_pf'],
      [{ portalKey: 'sefaz_ba_pf', portalLabel: 'SEFAZ BA', status: 'failed', errorCategory: 'portal_inoperable', message: 'Portal indisponível' }],
      new Set(),
    )
    expect(e.status).toBe('FALHA')
    expect(e.detalhe).toContain('Portal indisponível')
  })

  it('só presencial vira pendência manual', () => {
    const e = estadoDoItem(
      ['cnd_sao_bernardo_do_campo_sp_pf'],
      [{ portalKey: 'cnd_sao_bernardo_do_campo_sp_pf', status: 'completed', errorCategory: 'manual_only' }],
      new Set(),
    )
    expect(e.status).toBe('PENDENTE_MANUAL')
  })

  it('portal ainda sem rodada é emissão em curso', () => {
    expect(estadoDoItem(['tst_pf'], [], new Set()).status).toBe('EM_EMISSAO')
  })
})

describe('corpoDoPedido', () => {
  const pessoa = {
    tipo_pessoa: 'PF' as const,
    nome: 'Iana Kelle Pontes',
    documento: '123.456.789-09',
    data_nascimento: '1985-04-12',
    nome_mae: 'Maria Pontes',
    uf_atual: 'ba',
    municipio_atual: 'Salvador',
  }

  it('monta o pedido de pessoa física com o que a BullAI aceita', () => {
    const r = corpoDoPedido(pessoa, ['tst_pf'])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.corpo).toMatchObject({
        documentType: 'CPF',
        cpf: '12345678909',
        fullName: 'Iana Kelle Pontes',
        birthDate: '1985-04-12',
        motherName: 'Maria Pontes',
        addressState: 'BA',
        requestedPortals: ['tst_pf'],
      })
    }
  })

  // SEM NASCIMENTO NÃO SE PEDE: a BullAI recusaria, e a chamada já teria saído.
  it('pessoa física sem nascimento é barrada antes de gastar a chamada', () => {
    const r = corpoDoPedido({ ...pessoa, data_nascimento: null }, ['tst_pf'])
    expect(r.ok).toBe(false)
    expect(!r.ok && r.falta).toContain('data de nascimento de Iana')
  })

  it('pessoa jurídica vai com CNPJ e razão social', () => {
    const r = corpoDoPedido({ tipo_pessoa: 'PJ', nome: 'Pontes Ltda', documento: '12.345.678/0001-90' }, ['tst_pj'])
    expect(r.ok && r.corpo).toMatchObject({ documentType: 'CNPJ', cnpj: '12345678000190', razaoSocial: 'Pontes Ltda' })
  })
})
