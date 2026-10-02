import { describe, it, expect } from 'vitest'
import {
  CREDITO_VAZIO,
  emLiquidacao,
  errosDoCredito,
  payloadDoCredito,
} from '../regrasDoCredito'
import type { Processo } from '../types'

/**
 * O Salvar do crédito (Operacional → Créditos), como ele é HOJE.
 *
 * Teste de caracterização: prende o que a tela confere e grava para o redesenho
 * do formulário não mudar nada sem querer. As regras de liquidação decidem em
 * que card da carteira o dinheiro aparece, e o payload decide o que um campo
 * escondido deixa no banco — nenhuma das duas coisas dá erro na tela quando sai
 * errada.
 */

/** Um crédito já gravado, com tudo preenchido. */
const GRAVADO: Processo = {
  id: 'p-1',
  numero_cnj: '5001234-56.2020.8.13.0001',
  tribunal: 'TJMG',
  comarca: 'Belo Horizonte',
  vara: '1ª Vara da Fazenda',
  cedente: 'Maria da Silva',
  numero_processo_administrativo: '1234567-89.2021.8.13.0000',
  cedente_advogado: 'Dr. Fulano',
  cessionario: 'Investidor A',
  originador: 'Originador B',
  entidade_devedora: 'Estado de Minas Gerais',
  data_aquisicao: '2024-03-10',
  expectativa_liquidacao: '2026-12-31',
  instrumento: 'registro_publico',
  numero_rtdpj: '123456/2025',
  status: 'complementar',
  data_liquidacao: '2025-06-01',
  especie_requisitorio: 'precatorio',
  tipo_credito: ['principal'],
  capital_investido: 100000,
  valor_face: 250000,
  data_referencia: '2024-01-01',
  indice_atualizacao: 'selic',
  ja_recebido: 150000,
  valor_estimado_complementar: 80000,
  advbox_lawsuit_id: 'adv-99',
  drive_pasta_id: 'pasta-77',
  created_at: '2024-03-10T12:00:00Z',
  updated_at: '2025-06-02T12:00:00Z',
}

const valido = (p: Partial<Processo>): Partial<Processo> => ({
  ...CREDITO_VAZIO,
  numero_cnj: '5001234-56.2020.8.13.0001',
  ...p,
})

describe('CREDITO_VAZIO — o formulário de crédito novo', () => {
  it('o índice de atualização padrão é "Não informado" (null)', () => {
    expect(CREDITO_VAZIO.indice_atualizacao).toBeNull()
  })

  it('nasce Ativo, sem tipo marcado, sem valores e sem escolhas', () => {
    expect(CREDITO_VAZIO.status).toBe('ativo')
    expect(CREDITO_VAZIO.tipo_credito).toEqual([])
    expect(CREDITO_VAZIO.instrumento).toBeNull()
    expect(CREDITO_VAZIO.especie_requisitorio).toBeNull()
    expect(CREDITO_VAZIO.capital_investido).toBeNull()
    expect(CREDITO_VAZIO.valor_face).toBeNull()
    expect(CREDITO_VAZIO.ja_recebido).toBeNull()
    expect(CREDITO_VAZIO.valor_estimado_complementar).toBeNull()
  })

  it('o formulário inteiro, campo a campo', () => {
    expect(CREDITO_VAZIO).toEqual({
      numero_cnj: '',
      tribunal: '',
      comarca: '',
      vara: '',
      cedente: '',
      numero_processo_administrativo: '',
      cedente_advogado: '',
      cessionario: '',
      originador: '',
      entidade_devedora: '',
      data_aquisicao: '',
      expectativa_liquidacao: '',
      instrumento: null,
      numero_rtdpj: '',
      status: 'ativo',
      data_liquidacao: '',
      especie_requisitorio: null,
      tipo_credito: [],
      capital_investido: null,
      valor_face: null,
      data_referencia: '',
      indice_atualizacao: null,
      ja_recebido: null,
      valor_estimado_complementar: null,
    })
  })

  it('o formulário vazio é inválido só pelo número do processo', () => {
    expect(errosDoCredito({ ...CREDITO_VAZIO })).toEqual({
      numero_cnj: 'Informe o número do processo',
    })
  })
})

describe('emLiquidacao — quando data de liquidação e valores recebidos aparecem', () => {
  it('Complementar e Encerrado mostram; Ativo e sem status, não', () => {
    expect(emLiquidacao('complementar')).toBe(true)
    expect(emLiquidacao('encerrado')).toBe(true)
    expect(emLiquidacao('ativo')).toBe(false)
    expect(emLiquidacao(undefined)).toBe(false)
  })
})

describe('errosDoCredito — número do processo', () => {
  it('em branco ou só espaço barra', () => {
    expect(errosDoCredito(valido({ numero_cnj: '' })).numero_cnj).toBe(
      'Informe o número do processo',
    )
    expect(errosDoCredito(valido({ numero_cnj: '   ' })).numero_cnj).toBe(
      'Informe o número do processo',
    )
    expect(errosDoCredito(valido({ numero_cnj: undefined })).numero_cnj).toBe(
      'Informe o número do processo',
    )
  })

  it('o formato não é conferido: qualquer texto passa', () => {
    expect(errosDoCredito(valido({ numero_cnj: 'abc' }))).toEqual({})
  })

  it('o crédito gravado completo passa sem erro', () => {
    expect(errosDoCredito(GRAVADO)).toEqual({})
  })
})

describe('errosDoCredito — valor recebido exige data de liquidação', () => {
  it('Complementar com já recebido e sem data barra', () => {
    expect(
      errosDoCredito(
        valido({ status: 'complementar', ja_recebido: 1000, data_liquidacao: '' }),
      ),
    ).toEqual({ data_liquidacao: 'Informe a data de liquidação do valor já recebido' })
  })

  it('Complementar com valor estimado complementar e sem data barra', () => {
    expect(
      errosDoCredito(
        valido({ status: 'complementar', valor_estimado_complementar: 500 }),
      ).data_liquidacao,
    ).toBe('Informe a data de liquidação do valor já recebido')
  })

  it('R$ 0,00 conta como valor informado (só null é "não informado")', () => {
    expect(
      errosDoCredito(valido({ status: 'complementar', ja_recebido: 0 })).data_liquidacao,
    ).toBe('Informe a data de liquidação do valor já recebido')
  })

  it('data só com espaço conta como sem data', () => {
    expect(
      errosDoCredito(
        valido({ status: 'complementar', ja_recebido: 1000, data_liquidacao: '  ' }),
      ).data_liquidacao,
    ).toBe('Informe a data de liquidação do valor já recebido')
  })

  it('data null ou ausente conta como sem data', () => {
    expect(
      errosDoCredito(
        valido({ status: 'complementar', ja_recebido: 1000, data_liquidacao: null }),
      ).data_liquidacao,
    ).toBe('Informe a data de liquidação do valor já recebido')
    expect(
      errosDoCredito(
        valido({ status: 'complementar', ja_recebido: 1000, data_liquidacao: undefined }),
      ).data_liquidacao,
    ).toBe('Informe a data de liquidação do valor já recebido')
  })

  it('Complementar sem valor recebido e sem data passa', () => {
    expect(errosDoCredito(valido({ status: 'complementar' }))).toEqual({})
  })

  it('Complementar com valor e com data passa', () => {
    expect(
      errosDoCredito(
        valido({
          status: 'complementar',
          ja_recebido: 1000,
          data_liquidacao: '2025-01-01',
        }),
      ),
    ).toEqual({})
  })

  it('em Ativo os valores escondidos não exigem data', () => {
    // O campo nem aparece em Ativo, e o payload zera os três.
    expect(errosDoCredito(valido({ status: 'ativo', ja_recebido: 1000 }))).toEqual({})
  })
})

describe('errosDoCredito — Encerrado exige data de liquidação', () => {
  it('Encerrado sem data barra, mesmo sem valor recebido', () => {
    expect(errosDoCredito(valido({ status: 'encerrado' }))).toEqual({
      data_liquidacao: 'Crédito encerrado precisa da data efetiva de liquidação',
    })
  })

  it('Encerrado sem data E com valor: vale a mensagem do encerrado', () => {
    // As duas regras escrevem no mesmo campo, e a do encerrado vem depois.
    expect(
      errosDoCredito(valido({ status: 'encerrado', ja_recebido: 1000 })).data_liquidacao,
    ).toBe('Crédito encerrado precisa da data efetiva de liquidação')
  })

  it('Encerrado com data passa', () => {
    expect(
      errosDoCredito(valido({ status: 'encerrado', data_liquidacao: '2025-01-01' })),
    ).toEqual({})
  })
})

describe('errosDoCredito — nenhuma data antes da aquisição', () => {
  it('liquidação anterior à aquisição barra (Complementar e Encerrado)', () => {
    for (const status of ['complementar', 'encerrado'] as const) {
      expect(
        errosDoCredito(
          valido({ status, data_aquisicao: '2024-03-10', data_liquidacao: '2024-03-09' }),
        ),
        status,
      ).toEqual({ data_liquidacao: 'A liquidação não pode ser anterior à cessão' })
    }
  })

  it('liquidação no MESMO dia da aquisição passa', () => {
    expect(
      errosDoCredito(
        valido({
          status: 'encerrado',
          data_aquisicao: '2024-03-10',
          data_liquidacao: '2024-03-10',
        }),
      ),
    ).toEqual({})
  })

  it('a liquidação SÓ é conferida quando o status mostra o campo', () => {
    // Em Ativo o campo fica escondido e o Salvar o apaga: um valor antigo fora de
    // ordem não pode travar o botão com erro num campo que ninguém vê.
    expect(
      errosDoCredito(
        valido({ status: 'ativo', data_aquisicao: '2024-03-10', data_liquidacao: '2020-01-01' }),
      ),
    ).toEqual({})
  })

  it('expectativa anterior à aquisição barra, em qualquer status', () => {
    for (const status of ['ativo', 'complementar', 'encerrado'] as const) {
      expect(
        errosDoCredito(
          valido({
            status,
            data_aquisicao: '2024-03-10',
            expectativa_liquidacao: '2023-12-31',
            data_liquidacao: '2025-01-01',
          }),
        ),
        status,
      ).toEqual({ expectativa_liquidacao: 'A expectativa não pode ser anterior à cessão' })
    }
  })

  it('expectativa no mesmo dia da aquisição passa', () => {
    expect(
      errosDoCredito(
        valido({ data_aquisicao: '2024-03-10', expectativa_liquidacao: '2024-03-10' }),
      ),
    ).toEqual({})
  })

  it('sem data de aquisição nada é comparado', () => {
    expect(
      errosDoCredito(
        valido({
          status: 'encerrado',
          data_aquisicao: '',
          data_liquidacao: '1990-01-01',
          expectativa_liquidacao: '1990-01-01',
        }),
      ),
    ).toEqual({})
  })

  it('liquidação e expectativa fora de ordem: os dois erros juntos', () => {
    expect(
      errosDoCredito(
        valido({
          status: 'complementar',
          data_aquisicao: '2024-03-10',
          data_liquidacao: '2024-01-01',
          expectativa_liquidacao: '2024-01-01',
        }),
      ),
    ).toEqual({
      data_liquidacao: 'A liquidação não pode ser anterior à cessão',
      expectativa_liquidacao: 'A expectativa não pode ser anterior à cessão',
    })
  })

  it('número em branco soma com os erros de data', () => {
    expect(
      errosDoCredito({
        ...CREDITO_VAZIO,
        status: 'encerrado',
      }),
    ).toEqual({
      numero_cnj: 'Informe o número do processo',
      data_liquidacao: 'Crédito encerrado precisa da data efetiva de liquidação',
    })
  })
})

describe('payloadDoCredito — o que vai para o banco', () => {
  it('o id sai à parte, e decide entre atualizar e criar', () => {
    expect(payloadDoCredito(GRAVADO).id).toBe('p-1')
    expect(payloadDoCredito(valido({})).id).toBeUndefined()
  })

  it('id, datas de sistema, id da ADVBOX e cache da pasta ficam FORA do payload', () => {
    const { payload } = payloadDoCredito(GRAVADO)
    for (const k of [
      'id',
      'created_at',
      'updated_at',
      'advbox_lawsuit_id',
      'drive_pasta_id',
    ]) {
      expect(k in payload, k).toBe(false)
    }
  })

  it('crédito completo em liquidação: tudo o mais passa como está', () => {
    const { payload } = payloadDoCredito(GRAVADO)
    expect(payload).toEqual({
      numero_cnj: '5001234-56.2020.8.13.0001',
      tribunal: 'TJMG',
      comarca: 'Belo Horizonte',
      vara: '1ª Vara da Fazenda',
      cedente: 'Maria da Silva',
      numero_processo_administrativo: '1234567-89.2021.8.13.0000',
      cedente_advogado: 'Dr. Fulano',
      cessionario: 'Investidor A',
      originador: 'Originador B',
      entidade_devedora: 'Estado de Minas Gerais',
      data_aquisicao: '2024-03-10',
      expectativa_liquidacao: '2026-12-31',
      instrumento: 'registro_publico',
      numero_rtdpj: '123456/2025',
      status: 'complementar',
      data_liquidacao: '2025-06-01',
      especie_requisitorio: 'precatorio',
      tipo_credito: ['principal'],
      capital_investido: 100000,
      valor_face: 250000,
      data_referencia: '2024-01-01',
      indice_atualizacao: 'selic',
      ja_recebido: 150000,
      valor_estimado_complementar: 80000,
    })
  })

  it('o índice de atualização passa como está, inclusive null (sem padrão imposto)', () => {
    expect(payloadDoCredito(valido({})).payload.indice_atualizacao).toBeNull()
    expect(
      payloadDoCredito(valido({ indice_atualizacao: 'ipca_2' })).payload.indice_atualizacao,
    ).toBe('ipca_2')
  })

  it('em Ativo, liquidação, já recebido e valor complementar (escondidos) são zerados', () => {
    const { payload } = payloadDoCredito({ ...GRAVADO, status: 'ativo' })
    expect(payload.data_liquidacao).toBeNull()
    expect(payload.ja_recebido).toBeNull()
    expect(payload.valor_estimado_complementar).toBeNull()
    // O resto do financeiro fica.
    expect(payload.capital_investido).toBe(100000)
    expect(payload.valor_face).toBe(250000)
  })

  it('em Encerrado os três ficam', () => {
    const { payload } = payloadDoCredito({ ...GRAVADO, status: 'encerrado' })
    expect(payload.data_liquidacao).toBe('2025-06-01')
    expect(payload.ja_recebido).toBe(150000)
    expect(payload.valor_estimado_complementar).toBe(80000)
  })

  it('nº RTDPJ só fica em registro público; fora dele é zerado (escondido)', () => {
    expect(
      payloadDoCredito({ ...GRAVADO, instrumento: null }).payload.numero_rtdpj,
    ).toBeNull()
    for (const instrumento of ['particular', 'escritura_publica'] as const) {
      expect(
        payloadDoCredito({ ...GRAVADO, instrumento }).payload.numero_rtdpj,
        instrumento,
      ).toBeNull()
    }
  })

  it('nº RTDPJ em registro público: sem espaço nas pontas; em branco vira null', () => {
    expect(
      payloadDoCredito({ ...GRAVADO, numero_rtdpj: ' 123 e 456 ' }).payload.numero_rtdpj,
    ).toBe('123 e 456')
    expect(payloadDoCredito({ ...GRAVADO, numero_rtdpj: '  ' }).payload.numero_rtdpj).toBeNull()
  })

  it('nº do processo administrativo NÃO é zerado quando a espécie deixa de ser precatório', () => {
    expect(
      payloadDoCredito({ ...GRAVADO, especie_requisitorio: 'rpv' }).payload
        .numero_processo_administrativo,
    ).toBe('1234567-89.2021.8.13.0000')
    expect(
      payloadDoCredito({ ...GRAVADO, especie_requisitorio: null }).payload
        .numero_processo_administrativo,
    ).toBe('1234567-89.2021.8.13.0000')
  })

  it('nº do processo administrativo em branco vira null', () => {
    expect(
      payloadDoCredito(valido({ numero_processo_administrativo: '  ' })).payload
        .numero_processo_administrativo,
    ).toBeNull()
  })

  it('originador em branco vira null; com texto, sem espaço nas pontas', () => {
    expect(payloadDoCredito(valido({ originador: '' })).payload.originador).toBeNull()
    expect(payloadDoCredito(valido({ originador: '  ' })).payload.originador).toBeNull()
    expect(payloadDoCredito(valido({ originador: ' Fulano ' })).payload.originador).toBe(
      'Fulano',
    )
  })

  it('o CESSIONÁRIO não passa pela mesma limpeza: vazio continua "", espaço fica', () => {
    // Decisão registrada na tela: mudar afetaria filtros e comparações.
    expect(payloadDoCredito(valido({ cessionario: '' })).payload.cessionario).toBe('')
    expect(payloadDoCredito(valido({ cessionario: ' Fulano ' })).payload.cessionario).toBe(
      ' Fulano ',
    )
  })

  it('os demais textos (número, tribunal, comarca, vara, cedente, advogado, devedora) vão como digitados', () => {
    const { payload } = payloadDoCredito(
      valido({
        numero_cnj: ' 5001234 ',
        tribunal: '',
        comarca: ' BH ',
        vara: '',
        cedente: '  ',
        cedente_advogado: '',
        entidade_devedora: ' Estado ',
      }),
    )
    expect(payload.numero_cnj).toBe(' 5001234 ')
    expect(payload.tribunal).toBe('')
    expect(payload.comarca).toBe(' BH ')
    expect(payload.vara).toBe('')
    expect(payload.cedente).toBe('  ')
    expect(payload.cedente_advogado).toBe('')
    expect(payload.entidade_devedora).toBe(' Estado ')
  })

  it('as quatro datas em branco viram null', () => {
    const { payload } = payloadDoCredito(
      valido({
        status: 'encerrado',
        data_aquisicao: '',
        expectativa_liquidacao: '  ',
        data_liquidacao: '',
        data_referencia: '',
      }),
    )
    expect(payload.data_aquisicao).toBeNull()
    expect(payload.expectativa_liquidacao).toBeNull()
    expect(payload.data_liquidacao).toBeNull()
    expect(payload.data_referencia).toBeNull()
  })

  it('tipo de crédito ausente ou null vira lista vazia (coluna NOT NULL)', () => {
    expect(
      payloadDoCredito(valido({ tipo_credito: undefined })).payload.tipo_credito,
    ).toEqual([])
    expect(
      payloadDoCredito(
        valido({ tipo_credito: null as unknown as Processo['tipo_credito'] }),
      ).payload.tipo_credito,
    ).toEqual([])
  })

  it('o formulário vazio vira este payload', () => {
    expect(payloadDoCredito({ ...CREDITO_VAZIO }).payload).toEqual({
      numero_cnj: '',
      tribunal: '',
      comarca: '',
      vara: '',
      cedente: '',
      numero_processo_administrativo: null,
      cedente_advogado: '',
      cessionario: '',
      originador: null,
      entidade_devedora: '',
      data_aquisicao: null,
      expectativa_liquidacao: null,
      instrumento: null,
      numero_rtdpj: null,
      status: 'ativo',
      data_liquidacao: null,
      especie_requisitorio: null,
      tipo_credito: [],
      capital_investido: null,
      valor_face: null,
      data_referencia: null,
      indice_atualizacao: null,
      ja_recebido: null,
      valor_estimado_complementar: null,
    })
  })

  it('o formulário não é alterado', () => {
    const form = { ...GRAVADO, status: 'ativo' as const, originador: '  ' }
    const copia = structuredClone(form)
    payloadDoCredito(form)
    expect(form).toEqual(copia)
  })
})
