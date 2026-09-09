import { describe, it, expect } from 'vitest'
import {
  cnjsNoTexto,
  confrontarAnexoComCard,
  mascaraCnj,
} from '../../../supabase/functions/_shared/confrontoDoAnexo.ts'

/**
 * O ANEXO É DESTE PROCESSO?
 *
 * A conferência existe porque anexo trocado de card produzia a análise COMPLETA
 * do processo errado — com o número certo no nome do arquivo, porque o número do
 * card sobrepõe o lido. Nada na tela denunciava.
 *
 * E ela QUEBROU EM PRODUÇÃO ao comparar o card com o número que a LEITURA
 * devolveu: a leitura recebe, no mesmo turno, as anotações do Kommo, que citam
 * outros processos do titular — é ali que a equipe registra as dívidas apuradas
 * na diligência. O modelo tomou um desses números como "o processo destes autos"
 * e a análise morreu acusando anexo trocado sobre um anexo certo.
 */
const DO_CARD = '5000256-12.2024.8.13.0313'
const DE_OUTRO = '1006377-08.2020.4.01.3814'

/** O que a equipe escreve numa anotação de reprovação — e que não é anexo. */
const ANOTACOES =
  'Reprovado: o titular tem dívidas em outros processos. ' +
  `Execução fiscal ${DE_OUTRO} e ação de cobrança 0001234-56.2019.8.13.0313.`

describe('confrontarAnexoComCard', () => {
  it('o número do card nos anexos: passa', () => {
    const r = confrontarAnexoComCard({
      numeroDoCard: DO_CARD,
      textoDosAnexos: `Autos nº ${DO_CARD}. Sentença de procedência.`,
    })
    expect(r.desfecho).toBe('ok')
  })

  // O CASO QUE MOTIVOU A CORREÇÃO. O anexo é o certo; o número de OUTRO processo
  // veio das anotações, que não entram nesta conta.
  it('número de outro processo nas anotações não acusa nada', () => {
    const r = confrontarAnexoComCard({
      numeroDoCard: DO_CARD,
      // Os ANEXOS, e só eles. As anotações não chegam aqui por construção.
      textoDosAnexos: `Processo ${DO_CARD} — cumprimento de sentença.`,
      // A leitura devolveu o número que estava nas anotações.
      numeroLidoPelaLeitura: DE_OUTRO,
    })
    expect(r.desfecho).toBe('ok')
  })

  // ANEXO TROCADO DE VERDADE: os arquivos têm número de processo e nenhum é o
  // do card. Aí a análise para antes de custar as leituras.
  it('anexo de outro processo é recusado, com os dois números', () => {
    const r = confrontarAnexoComCard({
      numeroDoCard: DO_CARD,
      textoDosAnexos: `Autos nº ${DE_OUTRO}. Execução fiscal.`,
    })
    expect(r.desfecho).toBe('trocado')
    expect(r.desfecho === 'trocado' && r.motivo).toContain(DO_CARD)
    expect(r.desfecho === 'trocado' && r.motivo).toContain(DE_OUTRO)
  })

  // O CONJUNTO, E NÃO O PAR: um card com os autos MAIS uma certidão de outro
  // processo batia no número errado na comparação par a par.
  it('anexo com vários processos passa se um deles é o do card', () => {
    const r = confrontarAnexoComCard({
      numeroDoCard: DO_CARD,
      textoDosAnexos:
        `Certidão do processo ${DE_OUTRO}.\n===== ARQUIVO: autos.pdf =====\nProcesso ${DO_CARD}.`,
    })
    expect(r.desfecho).toBe('ok')
  })

  // SEM CNJ NO TEXTO NÃO SE AFIRMA NADA: processo digitalizado tem o número só
  // na imagem, e é justamente nele que o texto vem vazio. A análise segue.
  it('texto sem CNJ legível avisa, e não bloqueia', () => {
    const r = confrontarAnexoComCard({
      numeroDoCard: DO_CARD,
      textoDosAnexos: 'Documento assinado digitalmente conforme MP 2.200-2.',
      numeroLidoPelaLeitura: DE_OUTRO,
    })
    expect(r.desfecho).toBe('nao_confere')
    // E o aviso diz de onde o número da leitura pode ter vindo.
    expect(r.desfecho === 'nao_confere' && r.aviso).toContain('anotações do card')
    expect(r.desfecho === 'nao_confere' && r.aviso).toContain(DE_OUTRO)
  })

  it('texto vazio (processo todo escaneado) também só avisa', () => {
    for (const texto of ['', '   ', null, undefined]) {
      expect(confrontarAnexoComCard({ numeroDoCard: DO_CARD, textoDosAnexos: texto }).desfecho)
        .toBe('nao_confere')
    }
  })

  it('a leitura confirmando o card não vira ressalva sobre anotação', () => {
    const r = confrontarAnexoComCard({
      numeroDoCard: DO_CARD,
      textoDosAnexos: 'sem número legível',
      numeroLidoPelaLeitura: DO_CARD,
    })
    expect(r.desfecho === 'nao_confere' && r.aviso).not.toContain('anotações do card')
  })

  // CARD SEM NÚMERO não tem o que conferir, e já tem aviso próprio na lista.
  it('card sem número CNJ completo passa sem dizer nada', () => {
    for (const n of ['', 'NÃO LOCALIZADO', '5000256', null, undefined]) {
      expect(confrontarAnexoComCard({ numeroDoCard: n, textoDosAnexos: `Processo ${DE_OUTRO}.` }).desfecho)
        .toBe('ok')
    }
  })

  // E O TESTE QUE FIXA A REGRA: passar as anotações como se fossem anexo é
  // exatamente o defeito, então o comportamento nesse caso fica registrado —
  // quem chamar errado bloqueia um card bom, e é isso que não pode voltar.
  it('as anotações, se entrassem aqui, bloqueariam um card bom', () => {
    const errado = confrontarAnexoComCard({ numeroDoCard: DO_CARD, textoDosAnexos: ANOTACOES })
    expect(errado.desfecho).toBe('trocado')
    const certo = confrontarAnexoComCard({
      numeroDoCard: DO_CARD, textoDosAnexos: `Processo ${DO_CARD}.`,
    })
    expect(certo.desfecho).toBe('ok')
  })
})

describe('cnjsNoTexto', () => {
  it('acha o número com máscara, sem máscara e com espaços', () => {
    expect(cnjsNoTexto('1006377-08.2020.4.01.3814')).toEqual(new Set(['10063770820204013814']))
    expect(cnjsNoTexto('10063770820204013814')).toEqual(new Set(['10063770820204013814']))
    expect(cnjsNoTexto('1006377 08 2020 4 01 3814')).toEqual(new Set(['10063770820204013814']))
  })

  it('acha vários e não repete', () => {
    const s = cnjsNoTexto(
      'autos 1006377-08.2020.4.01.3814, apenso 5000256-12.2024.8.13.0313, ' +
      'e de novo 1006377-08.2020.4.01.3814',
    )
    expect(s.size).toBe(2)
  })

  it('número curto ou longo não é CNJ', () => {
    expect(cnjsNoTexto('1006377-08.2020').size).toBe(0)
    expect(cnjsNoTexto('CPF 123.456.789-00').size).toBe(0)
    expect(cnjsNoTexto('valor R$ 1.006.377,08').size).toBe(0)
  })

  it('sem texto, conjunto vazio', () => {
    for (const v of ['', null, undefined, 42]) expect(cnjsNoTexto(v).size).toBe(0)
  })
})

describe('mascaraCnj', () => {
  it('devolve o número na forma que se lê', () => {
    expect(mascaraCnj('10063770820204013814')).toBe('1006377-08.2020.4.01.3814')
  })

  it('o que não tem vinte dígitos volta como veio', () => {
    expect(mascaraCnj('123')).toBe('123')
  })
})
