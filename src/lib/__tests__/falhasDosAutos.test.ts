/**
 * O QUE É FALHA DE VERDADE NA ROTINA DOS AUTOS.
 *
 * Fixa as regras que a revisão de 02/10/2026 achou invertidas: resposta
 * passageira tratada como definitiva (FALHOU para sempre) e consulta que falhou
 * lida como "não há pedido" (pedido pago no escuro).
 */
import { describe, it, expect } from 'vitest'
import {
  consultaRespondeu,
  ehPdf,
  erroPassageiro,
  falhaPassageira,
  recusaDaConta,
  SEM_RESPOSTA,
  semAcessoAoKommo,
} from '../../../supabase/functions/_shared/falhasDosAutos.ts'

describe('falhaPassageira', () => {
  it('sem resposta, limite de uso e erro do lado deles passam', () => {
    for (const s of [SEM_RESPOSTA, 408, 429, 500, 502, 503, 529]) expect(falhaPassageira(s)).toBe(true)
  })
  it('recusa afirmada não passa', () => {
    for (const s of [400, 401, 403, 404, 422]) expect(falhaPassageira(s)).toBe(false)
  })
})

describe('consultaRespondeu — só se pede com base no que a consulta afirmou', () => {
  it('200, 404 e 422 são respostas', () => {
    for (const s of [200, 404, 422]) expect(consultaRespondeu(s)).toBe(true)
  })
  it('erro, limite e silêncio não dizem nada — e não autorizam pagar um pedido', () => {
    for (const s of [SEM_RESPOSTA, 401, 403, 429, 500, 503]) expect(consultaRespondeu(s)).toBe(false)
  })
})

describe('recusaDaConta', () => {
  it('token recusado e limite de chamadas param a volta, sem encerrar o processo', () => {
    for (const s of [401, 403, 429]) expect(recusaDaConta(s)).toBe(true)
  })
  it('recusa do processo não é da conta', () => {
    for (const s of [400, 404, 422, 500]) expect(recusaDaConta(s)).toBe(false)
  })
})

describe('semAcessoAoKommo — o único motivo que encerra o anexo', () => {
  it('sessão ou anexo recusados com 401/403', () => {
    expect(semAcessoAoKommo('o drive do Kommo recusou a sessão (HTTP 403): forbidden')).toBe(true)
    expect(semAcessoAoKommo('o Kommo recusou o anexo (HTTP 401): unauthorized')).toBe(true)
  })
  it('o resto passa: 5xx, cota, download do Escavador', () => {
    expect(semAcessoAoKommo('o drive do Kommo recusou a sessão (HTTP 503): busy')).toBe(false)
    expect(semAcessoAoKommo('o drive do Kommo recusou uma parte (HTTP 413): too large')).toBe(false)
    expect(semAcessoAoKommo('o Escavador recusou o download (HTTP 403)')).toBe(false)
  })
})

describe('erroPassageiro — quando a tentativa volta para o documento', () => {
  it('5xx, 429, 408 e queda de rede', () => {
    expect(erroPassageiro('o drive do Kommo recusou uma parte (HTTP 502): bad gateway')).toBe(true)
    expect(erroPassageiro('o Kommo recusou o anexo (HTTP 429): too many')).toBe(true)
    expect(erroPassageiro('The signal has been aborted')).toBe(true)
    expect(erroPassageiro('TimeoutError: Signal timed out.')).toBe(true)
    expect(erroPassageiro('error sending request: connection reset')).toBe(true)
  })
  it('recusa que não passa sozinha segue contando', () => {
    expect(erroPassageiro('o drive do Kommo recusou uma parte (HTTP 413): quota')).toBe(false)
    expect(erroPassageiro('o drive do Kommo recusou a sessão (HTTP 400): bad request')).toBe(false)
    expect(erroPassageiro('o Escavador recusou o download (HTTP 404)')).toBe(false)
  })
})

describe('ehPdf', () => {
  const de = (s: string) => new TextEncoder().encode(s)
  it('reconhece o cabeçalho %PDF', () => {
    expect(ehPdf(de('%PDF-1.7\n...'))).toBe(true)
  })
  it('página de erro ou arquivo vazio não é PDF', () => {
    expect(ehPdf(de('<html><body>erro</body></html>'))).toBe(false)
    expect(ehPdf(de('%PD'))).toBe(false)
    expect(ehPdf(new Uint8Array())).toBe(false)
  })
})
