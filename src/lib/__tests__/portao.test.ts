import { describe, it, expect } from 'vitest'
import {
  avaliarQualificacao,
  ehEstadoDeGoias,
  ehSim,
  parseDataBR,
  parseNumeroFlex,
  PISO_NEGOCIO,
} from '../../../supabase/functions/_shared/portao.ts'

/**
 * O PORTÃO 1 — a árvore que decide se um crédito é analisado.
 *
 * Vivia dentro da Edge Function e não tinha um teste, embora o comentário do
 * campo de valor registre um defeito que já voltou uma vez: valor escrito como
 * "R$ 124.500,00" onde o esquema pede número puro fazia `Number()` devolver
 * NaN, o portão concluía "valor não identificado", PULAVA a verificação de piso
 * e deixava passar com um aviso brando. Ausência de dado saindo como aprovação.
 */
const APROVAVEL = {
  valor_credito: 124_500,
  tipo_requisitorio: 'RPV',
  requisitorio_expedido: 'NÃO',
  reserva_financeira: 'NÃO HÁ MENÇÃO',
  prazo_pagamento_vencido: 'NÃO',
  credor_menor_ou_curatelado: 'NÃO',
  ente_devedor: 'Estado de São Paulo',
}

describe('avaliarQualificacao', () => {
  it('o caso bom passa sem motivo nenhum', () => {
    const r = avaliarQualificacao(APROVAVEL)
    expect(r.aprovado).toBe(true)
    expect(r.motivos).toEqual([])
  })

  // O DEFEITO QUE JÁ VOLTOU UMA VEZ: valor formatado virava NaN, o piso não era
  // verificado, e o crédito passava com um aviso brando.
  it('valor formatado em real continua sendo valor', () => {
    const r = avaliarQualificacao({ ...APROVAVEL, valor_credito: 'R$ 12.500,00' })
    expect(r.aprovado).toBe(false)
    expect(r.motivos.join(' ')).toMatch(/abaixo do mínimo/)
  })

  it('valor abaixo do piso reprova, em número ou em texto', () => {
    for (const v of [12_500, '12500', '12.500,00', 'R$ 12.500,00']) {
      expect(avaliarQualificacao({ ...APROVAVEL, valor_credito: v }).aprovado).toBe(false)
    }
    expect(avaliarQualificacao({ ...APROVAVEL, valor_credito: PISO_NEGOCIO }).aprovado).toBe(true)
  })

  // SEM VALOR É AVISO, e não reprovação: o crédito pode ser bom e o número
  // estar numa peça que a triagem não alcançou.
  it('valor ausente avisa, não reprova', () => {
    const r = avaliarQualificacao({ ...APROVAVEL, valor_credito: 'NÃO LOCALIZADO' })
    expect(r.aprovado).toBe(true)
    expect(r.avisos.join(' ')).toMatch(/não identificado/)
  })

  it('precatório tem piso próprio, de R$ 100 mil', () => {
    const base = { ...APROVAVEL, tipo_requisitorio: 'Precatório' }
    expect(avaliarQualificacao({ ...base, valor_credito: 100_000 }).aprovado).toBe(false)
    expect(avaliarQualificacao({ ...base, valor_credito: 100_001 }).aprovado).toBe(true)
    // E o piso de RPV não se aplica a ele: R$ 50 mil reprova pelo de precatório.
    const r = avaliarQualificacao({ ...base, valor_credito: 50_000 })
    expect(r.motivos.join(' ')).toMatch(/R\$ 100 mil/)
  })

  // DINHEIRO JÁ DESIGNADO NÃO SE COMPRA: o valor cai na conta do credor.
  it('reserva financeira e prazo vencido reprovam', () => {
    expect(avaliarQualificacao({ ...APROVAVEL, reserva_financeira: 'SIM' }).aprovado).toBe(false)
    expect(avaliarQualificacao({ ...APROVAVEL, prazo_pagamento_vencido: 'SIM' }).aprovado).toBe(false)
  })

  it('"NÃO HÁ MENÇÃO" não é sim', () => {
    expect(avaliarQualificacao({ ...APROVAVEL, reserva_financeira: 'NÃO HÁ MENÇÃO' }).aprovado).toBe(true)
  })

  // PRAZO APENAS INICIADO É ALERTA FORTE, na frente da lista, e não reprovação:
  // pode haver tempo de habilitar a cessão antes do pagamento.
  it('prazo iniciado avisa em primeiro lugar sem reprovar', () => {
    const r = avaliarQualificacao({
      ...APROVAVEL,
      prazo_pagamento_iniciado: 'SIM',
      prazo_pagamento_iniciado_localizacao: 'fls. 220',
    })
    expect(r.aprovado).toBe(true)
    expect(r.avisos[0]).toMatch(/JÁ EM FASE DE PAGAMENTO/)
    expect(r.avisos[0]).toContain('fls. 220')
  })

  it('reserva vence o aviso de prazo iniciado', () => {
    const r = avaliarQualificacao({
      ...APROVAVEL, reserva_financeira: 'SIM', prazo_pagamento_iniciado: 'SIM',
    })
    expect(r.aprovado).toBe(false)
    expect(r.avisos.join(' ')).not.toMatch(/JÁ EM FASE DE PAGAMENTO/)
  })

  it('credor menor ou curatelado reprova', () => {
    expect(avaliarQualificacao({ ...APROVAVEL, credor_menor_ou_curatelado: 'SIM' }).aprovado).toBe(false)
  })

  // A REGRA GOIANA É ESTADUAL, e chegou a ser aplicada a todo ente — reprovando
  // crédito paulista e federal por lei que não vale lá.
  describe('o teto de 10 salários mínimos de Goiás', () => {
    const goiano = {
      ...APROVAVEL,
      requisitorio_expedido: 'SIM',
      tipo_requisitorio: 'RPV',
      ente_devedor: 'Estado de Goiás',
    }

    it('trânsito depois de 15/11/2025 reprova', () => {
      expect(avaliarQualificacao({ ...goiano, transito_conhecimento_data: '16/11/2025' }).aprovado).toBe(false)
    })

    it('trânsito antes do corte passa', () => {
      expect(avaliarQualificacao({ ...goiano, transito_conhecimento_data: '14/11/2025' }).aprovado).toBe(true)
    })

    it('data ausente avisa em vez de reprovar', () => {
      const r = avaliarQualificacao({ ...goiano, transito_conhecimento_data: 'NÃO LOCALIZADO' })
      expect(r.aprovado).toBe(true)
      expect(r.avisos.join(' ')).toMatch(/confira manualmente/)
    })

    it('ente de outro estado não sofre a regra', () => {
      const r = avaliarQualificacao({
        ...goiano, ente_devedor: 'Estado de São Paulo', transito_conhecimento_data: '16/11/2025',
      })
      expect(r.aprovado).toBe(true)
    })

    it('a regra só vale para RPV já expedida', () => {
      expect(avaliarQualificacao({
        ...goiano, requisitorio_expedido: 'NÃO', transito_conhecimento_data: '16/11/2025',
      }).aprovado).toBe(true)
      expect(avaliarQualificacao({
        ...goiano, tipo_requisitorio: 'Precatório', valor_credito: 500_000, transito_conhecimento_data: '16/11/2025',
      }).aprovado).toBe(true)
    })
  })

  it('acumula os motivos em vez de parar no primeiro', () => {
    const r = avaliarQualificacao({
      ...APROVAVEL,
      reserva_financeira: 'SIM',
      credor_menor_ou_curatelado: 'SIM',
      valor_credito: 5_000,
    })
    expect(r.motivos.length).toBe(3)
  })
})

describe('as leituras de que o portão depende', () => {
  it('parseNumeroFlex entende os dois padrões', () => {
    expect(parseNumeroFlex('1.234,56')).toBeCloseTo(1234.56, 6)
    expect(parseNumeroFlex('1,234.56')).toBeCloseTo(1234.56, 6)
    expect(parseNumeroFlex('1234,56')).toBeCloseTo(1234.56, 6)
    expect(parseNumeroFlex('1234.56')).toBeCloseTo(1234.56, 6)
    expect(parseNumeroFlex('84.320')).toBe(84320)
    expect(parseNumeroFlex('sem número')).toBe(null)
    expect(parseNumeroFlex('')).toBe(null)
  })

  it('parseDataBR devolve null, e não Invalid Date', () => {
    expect(parseDataBR('15/11/2025')?.getFullYear()).toBe(2025)
    expect(parseDataBR('NÃO LOCALIZADO')).toBe(null)
    expect(parseDataBR(null)).toBe(null)
    expect(parseDataBR(42)).toBe(null)
  })

  // DATA QUE "ROLA" NÃO É DATA. O construtor de Date aceita 31/02 e devolve
  // 02/03; aceita 99/99 e devolve uma data anos à frente. As duas passavam em
  // `isNaN(getTime())` e alimentavam o corte goiano de 15/11/2025 e as datas do
  // prazo — data impossível nos autos virando data plausível na conta.
  it('data impossível é null, e não a data para onde ela rolaria', () => {
    expect(parseDataBR('31/02/2025')).toBe(null)
    expect(parseDataBR('30/02/2024')).toBe(null)
    expect(parseDataBR('99/99/2024')).toBe(null)
    expect(parseDataBR('00/01/2025')).toBe(null)
    // E o dia 29 de fevereiro de ano bissexto continua valendo.
    expect(parseDataBR('29/02/2024')?.getMonth()).toBe(1)
  })

  it('ehSim só aceita texto começando por SIM', () => {
    expect(ehSim('SIM')).toBe(true)
    expect(ehSim('sim, fls. 30')).toBe(true)
    expect(ehSim('NÃO')).toBe(false)
    expect(ehSim('NÃO HÁ MENÇÃO')).toBe(false)
    expect(ehSim(true)).toBe(false)
    expect(ehSim(null)).toBe(false)
  })

  // O ESTADO, SUAS AUTARQUIAS E FUNDAÇÕES — e não o município, que legisla o
  // próprio teto.
  it('ehEstadoDeGoias alcança as autarquias estaduais', () => {
    for (const ente of [
      'Estado de Goiás', 'FAZENDA PUBLICA DO ESTADO DE GOIAS', 'GOIASPREV',
      'IPASGO', 'DETRAN-GO', 'UEG', 'PGE-GO', 'Agrodefesa',
    ]) {
      expect(ehEstadoDeGoias(ente)).toBe(true)
    }
  })

  // "GO" OU "GOIAS": a fronteira depois de "go" recusava a forma por extenso,
  // que é como a autarquia aparece em metade dos requisitórios.
  it('DETRAN escrito por extenso também é o Estado', () => {
    expect(ehEstadoDeGoias('DETRAN GOIÁS')).toBe(true)
    expect(ehEstadoDeGoias('Detran Goias')).toBe(true)
    expect(ehEstadoDeGoias('DETRAN/GO')).toBe(true)
    expect(ehEstadoDeGoias('Departamento Estadual de Trânsito de Goiás')).toBe(true)
  })

  it('município goiano fica fora', () => {
    expect(ehEstadoDeGoias('Município de Goiânia')).toBe(false)
    expect(ehEstadoDeGoias('Prefeitura de Anápolis - Goiás')).toBe(false)
    expect(ehEstadoDeGoias('Estado de São Paulo')).toBe(false)
    expect(ehEstadoDeGoias(null, undefined, '')).toBe(false)
  })

  it('basta um candidato casar', () => {
    expect(ehEstadoDeGoias('', null, 'Estado de Goiás')).toBe(true)
  })
})
