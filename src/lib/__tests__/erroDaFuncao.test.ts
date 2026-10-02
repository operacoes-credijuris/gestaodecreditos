// Tradução do erro de Edge Function para a mensagem da tela.
//
// Nasceu do "Buscar no Banco Central" com o BCB fora do ar: a parametros-bcb
// responde 502 com a lista do que falhou em `avisos`, sem campo de erro, e a tela
// mostrava o JSON cru. A regra nova só entra na FALTA dos campos de sempre — e
// como esta função atende TODAS as chamadas de função da plataforma, metade deste
// arquivo prova que o que já funcionava continua igual.

import { describe, it, expect } from 'vitest'
import { codigoDoErro, erroDaFuncao } from '@/lib/functions'

const GENERICA = 'Edge Function returned a non-2xx status code'

function falha(corpo: string, status = 500) {
  return { message: GENERICA, context: new Response(corpo, { status }) }
}

describe('erroDaFuncao — avisos sem campo de erro', () => {
  it('falha total do Banco Central vira texto legível, não JSON', async () => {
    const corpo = JSON.stringify({
      ok: false,
      avisos: ['SELIC: série 4390 → HTTP 503', 'IPCA: série 13522 → HTTP 503'],
      gravado: false,
    })
    const e = await erroDaFuncao(falha(corpo, 502))
    expect(e.message).toBe(
      'SELIC: série 4390 → HTTP 503 · IPCA: série 13522 → HTTP 503 (HTTP 502)',
    )
    expect(e.message).not.toMatch(/[{}"]|gravado/)
  })

  it('aviso que não é texto, ou em branco, fica de fora', async () => {
    const corpo = JSON.stringify({ avisos: ['  IPCA: série vazia — não gravei. ', '', 7, null] })
    const e = await erroDaFuncao(falha(corpo, 502))
    expect(e.message).toBe('IPCA: série vazia — não gravei. (HTTP 502)')
  })

  it('lista de avisos vazia não esconde o corpo', async () => {
    const corpo = JSON.stringify({ ok: false, avisos: [] })
    const e = await erroDaFuncao(falha(corpo, 502))
    expect(e.message).toBe(`${corpo} (HTTP 502)`)
  })
})

describe('erroDaFuncao — o que já funcionava segue igual', () => {
  it('`error` vence `avisos`', async () => {
    const corpo = JSON.stringify({ error: 'Acesso negado.', avisos: ['outra coisa'] })
    const e = await erroDaFuncao(falha(corpo, 401))
    expect(e.message).toBe('Acesso negado. (HTTP 401)')
  })

  it('`erro`, `message` e `msg` continuam lidos', async () => {
    for (const chave of ['erro', 'message', 'msg']) {
      const e = await erroDaFuncao(falha(JSON.stringify({ [chave]: 'Falhou.' }), 500))
      expect(e.message, chave).toBe('Falhou. (HTTP 500)')
    }
  })

  it('`detalhe` e `codigo` continuam chegando', async () => {
    const corpo = JSON.stringify({
      error: 'Kommo recusou a anotação',
      detalhe: 'token expirado',
      codigo: 'kommo_token',
    })
    const e = await erroDaFuncao(falha(corpo, 502))
    expect(e.message).toBe('Kommo recusou a anotação — token expirado (HTTP 502)')
    expect(codigoDoErro(e)).toBe('kommo_token')
  })

  it('JSON sem campo conhecido continua mostrando o corpo', async () => {
    const corpo = JSON.stringify({ ok: false, motivo: 'incompleto' })
    const e = await erroDaFuncao(falha(corpo, 500))
    expect(e.message).toBe(`${corpo} (HTTP 500)`)
  })

  it('corpo que não é JSON aparece como veio', async () => {
    const e = await erroDaFuncao(falha('<html>Gateway Timeout</html>', 504))
    expect(e.message).toBe('<html>Gateway Timeout</html> (HTTP 504)')
  })

  it('sem corpo, sobra a mensagem do supabase-js', async () => {
    const e = await erroDaFuncao({ message: GENERICA })
    expect(e.message).toBe(GENERICA)
  })
})
