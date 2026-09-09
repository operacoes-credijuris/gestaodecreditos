import { describe, it, expect } from 'vitest'
import {
  cnjsNoTexto,
  confrontarAnexoComCard,
  mascaraCnj,
} from '../../../supabase/functions/_shared/confrontoDoAnexo.ts'
import { lerTituloCard } from '../kommo'

/**
 * O ANEXO É DESTE PROCESSO?
 *
 * A conferência existe porque anexo trocado de card produzia a análise COMPLETA
 * do processo errado — com o número certo no nome do arquivo, porque o número do
 * card sobrepõe o lido. Nada na tela denunciava.
 *
 * E ELA QUEBROU DUAS VEZES EM PRODUÇÃO, pelo mesmo motivo: leu um número que
 * tinha passado por uma ANOTAÇÃO do Kommo. Primeiro o número que a LEITURA
 * devolveu (a leitura recebe as anotações no mesmo turno, e elas citam as
 * dívidas do titular em outros processos); depois o `numero_processo` do
 * cadastro, cuja cadeia de reservas termina na linha "PROCESSO:" de uma nota.
 *
 * Agora são DUAS FONTES, e só duas: o TÍTULO do card e os ARQUIVOS anexados.
 */
const DO_CARD = '5000256-12.2024.8.13.0313'
const DE_OUTRO = '1006377-08.2020.4.01.3814'
const TITULO = `CBR Ativos - Fulano de Tal - ${DO_CARD}`

describe('confrontarAnexoComCard', () => {
  it('o número do título nos anexos: passa', () => {
    const r = confrontarAnexoComCard({
      tituloDoCard: TITULO,
      textoDosAnexos: `Autos nº ${DO_CARD}. Sentença de procedência.`,
    })
    expect(r.desfecho).toBe('ok')
  })

  // O CASO REAL: título do card com o CNJ SEM MÁSCARA, que é como o comercial
  // digita. Foi este card que morreu acusando anexo trocado — o cadastro tinha
  // caído numa anotação, e o número que chegou ao servidor era de outro processo.
  it('título com o CNJ sem máscara é reconhecido', () => {
    const semMascara = 'Dr. Alex Dornelas Loures - 10063770820204013814'
    // O mesmo número que `lerTituloCard` extrai na tela, para as duas leituras
    // do título não divergirem.
    expect(lerTituloCard(semMascara).numero).toBe(DE_OUTRO)
    const r = confrontarAnexoComCard({
      tituloDoCard: semMascara,
      textoDosAnexos: `Processo ${DE_OUTRO} — execução de honorários.`,
    })
    expect(r.desfecho).toBe('ok')
    expect(r.desfecho === 'ok' && mascaraCnj(r.cnjDoCard)).toBe(DE_OUTRO)
  })

  // A REGRESSÃO INTEIRA, num caso: o título aponta o processo dos anexos, e o
  // número do cadastro — vindo de uma nota — aponta outro. Antes, bloqueava.
  it('número de outro processo no cadastro não bloqueia mais nada', () => {
    const r = confrontarAnexoComCard({
      tituloDoCard: 'Dr. Alex Dornelas Loures - 10063770820204013814',
      textoDosAnexos: `Processo ${DE_OUTRO}. Certidão de honorários.`,
      // O que a leitura devolveu, tirado das anotações do card.
      numeroLidoPelaLeitura: DO_CARD,
    })
    expect(r.desfecho).toBe('ok')
  })

  // ANEXO TROCADO DE VERDADE: os arquivos têm número de processo e nenhum é o
  // do título. Aí a análise para antes de custar as leituras.
  it('anexo de outro processo é recusado, com os dois lados', () => {
    const r = confrontarAnexoComCard({
      tituloDoCard: TITULO,
      textoDosAnexos: `Autos nº ${DE_OUTRO}. Execução fiscal.`,
    })
    expect(r.desfecho).toBe('trocado')
    expect(r.desfecho === 'trocado' && r.motivo).toContain(DO_CARD)
    expect(r.desfecho === 'trocado' && r.motivo).toContain(DE_OUTRO)
    // E admite a outra hipótese: pode ser o título que está errado.
    expect(r.desfecho === 'trocado' && r.motivo).toMatch(/número errado no título/)
  })

  // O CONJUNTO, E NÃO O PAR: um card com os autos MAIS uma certidão de outro
  // processo batia no número errado na comparação par a par.
  it('anexo com vários processos passa se um deles é o do título', () => {
    const r = confrontarAnexoComCard({
      tituloDoCard: TITULO,
      textoDosAnexos:
        `Certidão do processo ${DE_OUTRO}.\n===== ARQUIVO: autos.pdf =====\nProcesso ${DO_CARD}.`,
    })
    expect(r.desfecho).toBe('ok')
  })

  // SEM NÚMERO NO TÍTULO NÃO SE INVENTA FONTE. A reserva óbvia seria a linha
  // "PROCESSO:" da anotação — e é exatamente ela que fez isto barrar um card bom.
  it('título sem número avisa, e nunca bloqueia', () => {
    for (const t of ['CBR Ativos - Fulano de Tal', '', null, undefined, 'Card 12345']) {
      const r = confrontarAnexoComCard({
        tituloDoCard: t,
        textoDosAnexos: `Autos nº ${DE_OUTRO}.`,
      })
      expect(r.desfecho).toBe('nao_confere')
      expect(r.desfecho === 'nao_confere' && r.aviso).toMatch(/título do card não traz o número/)
    }
  })

  // SEM CNJ NOS ANEXOS NÃO SE AFIRMA NADA: processo digitalizado tem o número só
  // na imagem, e é justamente nele que o texto vem vazio. A análise segue.
  it('texto sem CNJ legível avisa, e não bloqueia', () => {
    const r = confrontarAnexoComCard({
      tituloDoCard: TITULO,
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
      expect(confrontarAnexoComCard({ tituloDoCard: TITULO, textoDosAnexos: texto }).desfecho)
        .toBe('nao_confere')
    }
  })

  it('a leitura confirmando o título não vira ressalva sobre anotação', () => {
    const r = confrontarAnexoComCard({
      tituloDoCard: TITULO,
      textoDosAnexos: 'sem número legível',
      numeroLidoPelaLeitura: DO_CARD,
    })
    expect(r.desfecho === 'nao_confere' && r.aviso).not.toContain('anotações do card')
  })

  // E O TESTE QUE FIXA A REGRA PELO AVESSO: uma anotação, se entrasse aqui como
  // se fosse anexo, bloquearia um card bom. É isso que não pode voltar.
  it('as anotações, se entrassem aqui, bloqueariam um card bom', () => {
    const anotacao =
      'Reprovado: o titular tem dívidas em outros processos. ' +
      `Execução fiscal ${DE_OUTRO} e cobrança 0001234-56.2019.8.13.0313.`
    expect(confrontarAnexoComCard({ tituloDoCard: TITULO, textoDosAnexos: anotacao }).desfecho)
      .toBe('trocado')
    expect(confrontarAnexoComCard({ tituloDoCard: TITULO, textoDosAnexos: `Processo ${DO_CARD}.` }).desfecho)
      .toBe('ok')
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
