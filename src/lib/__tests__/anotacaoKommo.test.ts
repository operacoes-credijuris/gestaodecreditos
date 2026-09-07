import { describe, it, expect } from 'vitest'
import {
  alertasDaAnotacao,
  anotacoesDaAnalise,
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
  cedente: 'Maria Aparecida da Silva',
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
      'CEDENTE',
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

describe('anotacoesDaAnalise', () => {
  const APROVADA = {
    link: 'https://drive.google.com/x',
    ficha: FICHA_CHEIA,
    avisos: ['⚠️ CARTÓRIO NÃO INCLUÍDO NO PREÇO: some à mão.', 'uma nota qualquer'],
    analista: 'Pedro',
  }

  it('são DUAS anotações: a ficha e depois o veredito', () => {
    const t = anotacoesDaAnalise(APROVADA)
    expect(t).toHaveLength(2)
    expect(t[0]).toBe(
      'TIPO: RPV\n' +
        'PROCESSO: 0001234-56.2023.8.17.0001\n' +
        'TRIBUNAL: TJPE\n' +
        'CEDENTE: Maria Aparecida da Silva\n' +
        'ENTIDADE DEVEDORA: Estado de Pernambuco\n' +
        'PARCELA CEDIDA: Crédito principal + Honorários\n' +
        'VALOR CEDIDO: R$ 45.000,00\n' +
        'HONORÁRIOS C.: 30,00%',
    )
    expect(t[1]).toBe(
      '(Pedro) ✅ APROVADO na análise automática.\n' +
        'Planilha e análise no Drive: https://drive.google.com/x\n' +
        '\n' +
        '⚠️ CARTÓRIO NÃO INCLUÍDO NO PREÇO: some à mão.',
    )
  })

  it('a assinatura vai só no veredito', () => {
    // Quem analisou é atributo do ato, não do crédito: a ficha do mesmo
    // processo é a mesma independentemente de quem rodou.
    const [ficha, veredito] = anotacoesDaAnalise(APROVADA)
    expect(ficha.startsWith('(')).toBe(false)
    expect(veredito.startsWith('(Pedro) ')).toBe(true)
  })

  it('sem analista, o veredito sai sem prefixo — e não com um vazio', () => {
    const [, veredito] = anotacoesDaAnalise({ ...APROVADA, analista: undefined })
    expect(veredito.startsWith('✅')).toBe(true)
  })

  it('sem alerta, o veredito termina no link', () => {
    const t = anotacoesDaAnalise({ link: 'https://x', ficha: { tipo: 'RPV' }, avisos: [] })
    expect(t).toEqual([
      'TIPO: RPV',
      '✅ APROVADO na análise automática.\nPlanilha e análise no Drive: https://x',
    ])
  })

  it('sem link, diz para conferir a pasta em vez de deixar link vazio', () => {
    const [, veredito] = anotacoesDaAnalise({ ficha: { tipo: 'RPV' } })
    expect(veredito).toContain('(Confira a pasta do Drive.)')
  })

  it('ficha vazia não gera anotação em branco', () => {
    // Análise que não achou nada nos autos não deve escrever uma nota muda no
    // card — o veredito sai sozinho.
    const t = anotacoesDaAnalise({ link: 'https://x', ficha: {} })
    expect(t).toHaveLength(1)
    expect(t[0]).toContain('APROVADO')
  })

  it('recusado é UMA anotação só, e é o motivo', () => {
    // Não há ficha de um crédito que não foi precificado: "VALOR CEDIDO" de
    // uma recusa não quer dizer nada.
    const t = anotacoesDaAnalise({
      reprovado: true,
      motivos: ['Valor abaixo de R$ 20 mil (mínimo exigido para RPV).'],
      ficha: FICHA_CHEIA,
      avisos: ['⚠️ nem deveria aparecer'],
      analista: 'Pedro',
    })
    expect(t).toEqual([
      '(Pedro) ❌ RECUSADO na análise automática.\n' +
        'Motivo: Valor abaixo de R$ 20 mil (mínimo exigido para RPV).',
    ])
  })

  it('recusado sem motivo declarado ainda diz alguma coisa', () => {
    expect(anotacoesDaAnalise({ reprovado: true })[0]).toContain('Crédito reprovado na análise.')
  })
})

/**
 * O veredito trocado: a análise jurídica do precatório NÃO aprova.
 *
 * Ela preenche um questionário e para ali — o bloco "Critérios de Aceitação e
 * Recusa" do modelo é régua que uma pessoa aplica, e aprovar ou reprovar é
 * clique de gente. Escrever "APROVADO" no card afirmaria uma decisão que
 * ninguém tomou, e o comercial age sobre o que está escrito ali.
 */
describe('veredito próprio de outro fluxo', () => {
  it('substitui a primeira linha e mantém o resto da forma', () => {
    const t = anotacoesDaAnalise({
      link: 'https://drive.google.com/y',
      ficha: { tipo: 'Precatório', tribunal: 'TJSP' },
      avisos: ['⚠️ um alerta'],
      analista: 'Pedro',
      veredito: '✅ ANÁLISE JURÍDICA CONCLUÍDA.',
    })
    expect(t[0]).toBe('TIPO: Precatório\nTRIBUNAL: TJSP')
    expect(t[1]).toBe(
      '(Pedro) ✅ ANÁLISE JURÍDICA CONCLUÍDA.\n' +
        'Planilha e análise no Drive: https://drive.google.com/y\n' +
        '\n' +
        '⚠️ um alerta',
    )
  })

  it('sem link, o veredito trocado também ganha a ressalva da pasta', () => {
    const [, v] = anotacoesDaAnalise({
      ficha: { tipo: 'Precatório' },
      veredito: '✅ ANÁLISE JURÍDICA CONCLUÍDA.',
    })
    expect(v).toBe('✅ ANÁLISE JURÍDICA CONCLUÍDA. (Confira a pasta do Drive.)')
  })

  it('veredito vazio cai no padrão em vez de deixar a linha em branco', () => {
    const [, v] = anotacoesDaAnalise({ ficha: { tipo: 'RPV' }, veredito: '   ' })
    expect(v.startsWith('✅ APROVADO na análise automática.')).toBe(true)
  })

  it('recusado ignora o veredito trocado — o motivo é o recado', () => {
    const t = anotacoesDaAnalise({
      reprovado: true,
      motivo: 'Valor abaixo do mínimo.',
      veredito: '✅ ANÁLISE JURÍDICA CONCLUÍDA.',
    })
    expect(t).toEqual(['❌ RECUSADO na análise automática.\nMotivo: Valor abaixo do mínimo.'])
  })
})
