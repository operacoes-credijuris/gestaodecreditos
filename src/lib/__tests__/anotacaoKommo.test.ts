import { describe, it, expect } from 'vitest'
import {
  alertasDaAnotacao,
  anotacaoDaAnalise,
  linhasDaFicha,
  MAX_ALERTAS,
} from '../anotacaoKommo'

/**
 * A anotação que a análise escreve no card do Kommo.
 *
 * Testada porque é O ÚNICO PEDAÇO DA ANÁLISE QUE O COMERCIAL LÊ: ele não abre a
 * planilha nem a janela, vê o card. Rótulo trocado, linha vazia ou parede de
 * texto aqui não dá erro em lugar nenhum — só faz a informação não chegar.
 */

const FICHA_CHEIA = {
  tipo: 'RPV',
  processo: '0001234-56.2023.8.17.0001',
  tribunal: 'TJPE',
  entidade_devedora: 'Estado de Pernambuco',
  parcela_cedida: 'Crédito principal + Honorários',
  valor_cedido: 45000,
  honorarios_pct: 30,
}

describe('linhasDaFicha', () => {
  it('usa os rótulos do cadastro do comercial, na ordem dele', () => {
    expect(linhasDaFicha(FICHA_CHEIA).map((l) => l.split(':')[0])).toEqual([
      'TIPO',
      'PROCESSO',
      'TRIBUNAL',
      'ENTIDADE DEVEDORA',
      'PARCELA CEDIDA',
      'VALOR CEDIDO',
      'HONORÁRIOS C.',
    ])
  })

  it('formata dinheiro e porcentagem em pt-BR', () => {
    const l = linhasDaFicha(FICHA_CHEIA)
    //   é o espaço fixo que o Intl põe depois de "R$".
    expect(l).toContain('VALOR CEDIDO: R$ 45.000,00')
    expect(l).toContain('HONORÁRIOS C.: 30,00%')
  })

  it('omite a linha do campo que a análise não achou', () => {
    // Rótulo com "—" ocupa a linha inteira e não informa nada; a ausência é o
    // próprio recado.
    const l = linhasDaFicha({ tipo: 'RPV', tribunal: '', entidade_devedora: '   ' })
    expect(l).toEqual(['TIPO: RPV'])
  })

  it('honorário ausente e honorário zero são coisas diferentes', () => {
    expect(linhasDaFicha({ honorarios_pct: null })).toEqual([])
    expect(linhasDaFicha({ honorarios_pct: 0 })).toEqual(['HONORÁRIOS C.: 0,00%'])
  })

  it('ficha inexistente não quebra', () => {
    expect(linhasDaFicha(undefined)).toEqual([])
  })
})

describe('alertasDaAnotacao', () => {
  const AVISOS = [
    '⚠️ ATENÇÃO — TETO DA RPV: o valor bruto excede o teto.',
    'Tabela de emolumentos de PE/2025 levantada agora. Fonte: provimento.',
    '⚠️ CARTÓRIO NÃO INCLUÍDO NO PREÇO: some à mão.',
    'Auditoria: conta conferida contra o título e fiel.',
  ]

  it('leva o alerta e deixa a nota de fora', () => {
    expect(alertasDaAnotacao(AVISOS)).toEqual([AVISOS[0], AVISOS[2]])
  })

  it('tem teto: o card é feed, não relatório', () => {
    const muitos = Array.from({ length: 9 }, (_, i) => `⚠️ alerta ${i}`)
    expect(alertasDaAnotacao(muitos)).toHaveLength(MAX_ALERTAS)
  })

  it('sem alerta nenhum, devolve vazio', () => {
    expect(alertasDaAnotacao(['nota solta', 'outra nota'])).toEqual([])
    expect(alertasDaAnotacao(undefined)).toEqual([])
    expect(alertasDaAnotacao('não é lista')).toEqual([])
  })
})

describe('anotacaoDaAnalise', () => {
  it('monta os três blocos, separados por linha em branco', () => {
    const t = anotacaoDaAnalise({
      link: 'https://drive.google.com/x',
      ficha: FICHA_CHEIA,
      avisos: ['⚠️ CARTÓRIO NÃO INCLUÍDO NO PREÇO: some à mão.', 'uma nota qualquer'],
    })
    expect(t).toBe(
      '✅ APROVADO na análise automática.\n' +
        'Planilha e análise no Drive: https://drive.google.com/x\n' +
        '\n' +
        'TIPO: RPV\n' +
        'PROCESSO: 0001234-56.2023.8.17.0001\n' +
        'TRIBUNAL: TJPE\n' +
        'ENTIDADE DEVEDORA: Estado de Pernambuco\n' +
        'PARCELA CEDIDA: Crédito principal + Honorários\n' +
        'VALOR CEDIDO: R$ 45.000,00\n' +
        'HONORÁRIOS C.: 30,00%\n' +
        '\n' +
        '⚠️ CARTÓRIO NÃO INCLUÍDO NO PREÇO: some à mão.',
    )
  })

  it('sem alerta, não sobra linha em branco no fim', () => {
    const t = anotacaoDaAnalise({ link: 'https://x', ficha: { tipo: 'RPV' }, avisos: [] })
    expect(t).toBe(
      '✅ APROVADO na análise automática.\nPlanilha e análise no Drive: https://x\n\nTIPO: RPV',
    )
    expect(t.endsWith('\n')).toBe(false)
  })

  it('sem link, diz para conferir a pasta em vez de deixar link vazio', () => {
    expect(anotacaoDaAnalise({ ficha: { tipo: 'RPV' } })).toContain('(Confira a pasta do Drive.)')
  })

  it('reprovado é só o motivo — não tem ficha nem alerta', () => {
    const t = anotacaoDaAnalise({
      reprovado: true,
      motivos: ['Valor abaixo de R$ 20 mil (mínimo exigido para RPV).'],
      ficha: FICHA_CHEIA,
      avisos: ['⚠️ nem deveria aparecer'],
    })
    expect(t).toBe(
      '❌ RECUSADO na análise automática.\n' +
        'Motivo: Valor abaixo de R$ 20 mil (mínimo exigido para RPV).',
    )
  })

  it('reprovado sem motivo declarado ainda diz alguma coisa', () => {
    expect(anotacaoDaAnalise({ reprovado: true })).toContain('Crédito reprovado na análise.')
  })
})
