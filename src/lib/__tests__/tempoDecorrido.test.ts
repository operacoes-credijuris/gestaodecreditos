import { describe, it, expect } from 'vitest'
import { mesAno, tempoDecorrido } from '../format'

/**
 * O TEMPO DECORRIDO, do jeito que se lê numa fila de trabalho.
 *
 * Ele acompanha a data de entrada na coluna, no canto do card da Análise de
 * Crédito. A data sozinha obriga quem opera a fazer a conta de cabeça — e é a
 * conta que decide qual card puxar primeiro numa coluna de trinta.
 */
const agora = new Date('2026-09-15T08:00:00')

describe('tempoDecorrido', () => {
  /**
   * POR DIA CIVIL, E NÃO POR 24 HORAS — é a decisão que este arquivo guarda.
   *
   * Um card movido ontem às 23h, olhado às 8h da manhã seguinte, está a nove
   * horas de distância. "Há 9 horas" é verdade e não é o que se pergunta: quem
   * varre a coluna quer saber se aquilo entrou ontem ou hoje.
   */
  it('conta dias de calendário, não horas', () => {
    expect(tempoDecorrido('2026-09-14T23:30:00', agora)).toBe('ontem')
    expect(tempoDecorrido('2026-09-15T00:10:00', agora)).toBe('hoje')
  })

  it('diz hoje, ontem e depois os dias', () => {
    expect(tempoDecorrido('2026-09-15T07:00:00', agora)).toBe('hoje')
    expect(tempoDecorrido('2026-09-14T09:00:00', agora)).toBe('ontem')
    expect(tempoDecorrido('2026-09-12T09:00:00', agora)).toBe('há 3 dias')
    expect(tempoDecorrido('2026-08-25T09:00:00', agora)).toBe('há 21 dias')
  })

  it('passa a meses e a anos quando a conta em dias deixa de dizer algo', () => {
    expect(tempoDecorrido('2026-08-01T09:00:00', agora)).toBe('há 1 mês')
    expect(tempoDecorrido('2026-03-15T09:00:00', agora)).toBe('há 6 meses')
    expect(tempoDecorrido('2025-03-15T09:00:00', agora)).toBe('há 1 ano')
    expect(tempoDecorrido('2023-09-15T09:00:00', agora)).toBe('há 3 anos')
  })

  /**
   * FUTURO VOLTA VAZIO, e não "há -2 dias".
   *
   * Relógio de servidor adiantado e fuso horário produzem diferenças de algumas
   * horas; uma data à frente de agora é sinal de defeito, não informação para a
   * tela. Vazio some do card, que é o comportamento certo para o que não se sabe.
   */
  it('não inventa tempo negativo', () => {
    expect(tempoDecorrido('2026-09-16T09:00:00', agora)).toBe('')
    expect(tempoDecorrido('2027-01-01T09:00:00', agora)).toBe('')
  })

  it('sem data, ou com data que não é data, não escreve nada', () => {
    expect(tempoDecorrido(null, agora)).toBe('')
    expect(tempoDecorrido(undefined, agora)).toBe('')
    expect(tempoDecorrido('', agora)).toBe('')
    expect(tempoDecorrido('ontem de manhã', agora)).toBe('')
  })

  // Data pura (sem hora) é lida no fuso local, e não em UTC: `new Date('2026-09-14')`
  // é meia-noite UTC, que no Brasil ainda é dia 13 — e o card diria "há 2 dias"
  // onde se lê "ontem" no Kommo.
  it('data sem hora não escorrega um dia para trás', () => {
    expect(tempoDecorrido('2026-09-14', agora)).toBe('ontem')
    expect(tempoDecorrido('2026-09-15', agora)).toBe('hoje')
  })
})

/**
 * "agosto/2026" — a data cuja precisão do dia não decide nada.
 *
 * É como a última movimentação de um processo aparece na due diligence: a
 * pergunta é "isto ainda anda?", e a resposta se lê na distância. O dia exato
 * ocuparia largura numa tabela apertada sem mudar o juízo de ninguém.
 */
describe('mesAno', () => {
  it('escreve o mês por extenso e o ano em números', () => {
    expect(mesAno('2026-08-14')).toBe('agosto/2026')
    expect(mesAno('2021-01-02')).toBe('janeiro/2021')
    expect(mesAno('2026-12-31T23:59:00Z')).toBe('dezembro/2026')
  })

  // Data pura é lida no fuso LOCAL: `new Date('2026-08-01')` é meia-noite UTC,
  // que no Brasil ainda é 31 de julho — e o mês sairia errado na virada.
  it('o primeiro dia do mês não escorrega para o mês anterior', () => {
    expect(mesAno('2026-08-01')).toBe('agosto/2026')
    expect(mesAno('2026-03-01')).toBe('março/2026')
  })

  it('sem data, um traço', () => {
    expect(mesAno(null)).toBe('—')
    expect(mesAno(undefined)).toBe('—')
    expect(mesAno('')).toBe('—')
    expect(mesAno('não sei')).toBe('—')
  })
})
