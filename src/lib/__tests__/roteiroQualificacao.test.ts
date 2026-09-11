import { describe, it, expect } from 'vitest'
import { ROTEIRO_QUALIFICACAO } from '../../../supabase/functions/_shared/roteiroQualificacao.ts'

/**
 * O ROTEIRO É DA OPERAÇÃO, E CHEGA INTEIRO OU NÃO CHEGA.
 *
 * Ele foi transcrito de um .txt para dentro de um template literal, e esse é o
 * tipo de passagem em que um pedaço se perde sem nada acusar: uma crase mal
 * escapada corta o resto do arquivo, e o que sobra continua sendo um prompt
 * plausível — só que sem os eixos, ou sem as regras de rigor. A análise sairia
 * completa e errada, que é a pior forma de errar aqui.
 *
 * Estes testes são a cerca: cada um afirma a presença de uma peça que a
 * qualificação não pode perder.
 */
describe('ROTEIRO_QUALIFICACAO', () => {
  it('é o prompt da casa, com a versão que a operação escreveu', () => {
    expect(ROTEIRO_QUALIFICACAO).toContain(
      '# PROMPT — Qualificação Jurídica Preliminar de Crédito (Precatório / RPV) — v2.1',
    )
  })

  // AS CINCO FASES, na ordem. Faltando uma, a análise pula uma etapa inteira.
  it('traz as cinco fases', () => {
    for (const fase of [
      'FASE 1 — FICHA DE IDENTIFICAÇÃO',
      'FASE 2 — CHECKLIST DE EIXOS',
      'FASE 3 — FICHAS DE RISCO',
      'FASE 4 — PENDÊNCIAS DOCUMENTAIS',
      'FASE 5 — CONCLUSÃO GERAL',
    ]) {
      expect(ROTEIRO_QUALIFICACAO, fase).toContain(fase)
    }
  })

  it('traz os doze eixos, um a um', () => {
    for (let n = 1; n <= 12; n++) {
      expect(ROTEIRO_QUALIFICACAO, `Eixo ${n}`).toContain(`**Eixo ${n} —`)
    }
  })

  // OS DOIS EIXOS DE VARREDURA UNIVERSAL são a diferença entre olhar o cedente e
  // olhar o processo: cessão alheia e levantamento alheio consomem o crédito-alvo
  // sem nunca mencioná-lo.
  it('mantém a varredura universal dos eixos 2 e 7', () => {
    expect(ROTEIRO_QUALIFICACAO).toContain('Cessão anterior — VARREDURA UNIVERSAL')
    expect(ROTEIRO_QUALIFICACAO).toContain(
      'Pagamentos, levantamentos e saldo — VARREDURA UNIVERSAL',
    )
  })

  it('mantém os quatro vereditos e as quatro classificações de risco', () => {
    for (const v of [
      '`APTO`',
      '`APTO COM RESSALVA`',
      '`NÃO APTO`',
      '`INCONCLUSIVO POR INSUFICIÊNCIA DOCUMENTAL`',
    ]) {
      expect(ROTEIRO_QUALIFICACAO, v).toContain(v)
    }
    for (const c of [
      'Impeditivo relevante',
      'Risco jurídico elevado',
      'Risco moderado',
      'Ponto de atenção',
    ]) {
      expect(ROTEIRO_QUALIFICACAO, c).toContain(c)
    }
  })

  // A REGRA DE ANCORAGEM é o que separa esta análise de uma redação convincente.
  it('mantém as regras de rigor e a autoverificação final', () => {
    expect(ROTEIRO_QUALIFICACAO).toContain('REGRAS DE RIGOR')
    expect(ROTEIRO_QUALIFICACAO).toContain('Ancoragem obrigatória')
    expect(ROTEIRO_QUALIFICACAO).toContain('NÃO CONSTA NOS AUTOS')
    expect(ROTEIRO_QUALIFICACAO).toContain('Checagem: Ficha 18/18 · Eixos 12/12')
  })

  /**
   * A ÚNICA ALTERAÇÃO PERMITIDA no texto da operação: as duas linhas de "Uso"
   * descreviam o fluxo antigo — colar o prompt no chat e anexar os documentos à
   * mão. Agora os autos vêm no mesmo resultado de ferramenta, e o roteiro
   * precisa dizer isso, senão manda esperar um anexo que não vem.
   */
  it('o cabeçalho aponta para os autos que vêm no próprio resultado', () => {
    expect(ROTEIRO_QUALIFICACAO).toContain('neste mesmo resultado de ferramenta')
    expect(ROTEIRO_QUALIFICACAO).toContain('DADOS DO CARD')
    expect(ROTEIRO_QUALIFICACAO).not.toContain('colar este prompt no chat')
  })

  // Um corte no meio da transcrição deixaria um prompt plausível e curto.
  it('tem o tamanho de um roteiro inteiro', () => {
    expect(ROTEIRO_QUALIFICACAO.length).toBeGreaterThan(15_000)
  })
})
