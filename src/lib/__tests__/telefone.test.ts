import { describe, it, expect } from 'vitest'
import {
  digitosTelefoneBR,
  formatTelefone,
  telefoneIncompleto,
  waLink,
} from '../telefone'

/**
 * Telefone dos Contatos de serventias, como é HOJE.
 *
 * A máscara roda a cada tecla e o que ela devolve é o que o Salvar grava; a
 * completude é o que o Salvar confere. O defeito que a normalização corrigiu —
 * "+55 31 98888-7777" virando "(55) 31988-8877", DDD de outra cidade — passava
 * por todas as etapas sem erro, então é isto que o teste segura.
 */
describe('digitosTelefoneBR — tira +55 e zero de operadora', () => {
  it('+55 colado na frente sai (celular e fixo)', () => {
    expect(digitosTelefoneBR('+55 31 98888-7777')).toBe('31988887777')
    expect(digitosTelefoneBR('55 31 98888-7777')).toBe('31988887777')
    expect(digitosTelefoneBR('+55 31 3222-1234')).toBe('3132221234')
  })

  it('zero de operadora sai, inclusive no caso de 11 dígitos exatos', () => {
    // "031 3222-1234" tem 11 dígitos: a guarda do zero é "> 10", não "> 11".
    expect(digitosTelefoneBR('031 3222-1234')).toBe('3132221234')
    expect(digitosTelefoneBR('(031) 98888-7777')).toBe('31988887777')
  })

  it('o zero sai ANTES do código do país: "00 55" internacional também limpa', () => {
    expect(digitosTelefoneBR('00 55 31 98888-7777')).toBe('31988887777')
  })

  it('DDD 55 legítimo (Pelotas) passa intacto', () => {
    expect(digitosTelefoneBR('(55) 99999-8888')).toBe('55999998888')
    expect(digitosTelefoneBR('(55) 3222-1234')).toBe('5532221234')
    expect(digitosTelefoneBR('+55 55 99999-8888')).toBe('55999998888')
  })

  it('número já canônico não muda', () => {
    expect(digitosTelefoneBR('(31) 98888-7777')).toBe('31988887777')
    expect(digitosTelefoneBR('31988887777')).toBe('31988887777')
    expect(digitosTelefoneBR('3132221234')).toBe('3132221234')
  })

  it('digitação em curso (até 10 dígitos) não é mexida, nem o zero', () => {
    expect(digitosTelefoneBR('0')).toBe('0')
    expect(digitosTelefoneBR('031')).toBe('031')
    expect(digitosTelefoneBR('0313222123')).toBe('0313222123')
    expect(digitosTelefoneBR('55')).toBe('55')
    expect(digitosTelefoneBR('553198888')).toBe('553198888')
  })

  it('sobra à direita é cortada em 11 dígitos', () => {
    expect(digitosTelefoneBR('31 98888-77779999')).toBe('31988887777')
  })

  it('vazio, null e só pontuação viram ""', () => {
    expect(digitosTelefoneBR('')).toBe('')
    expect(digitosTelefoneBR(null)).toBe('')
    expect(digitosTelefoneBR(undefined)).toBe('')
    expect(digitosTelefoneBR('() -')).toBe('')
  })

  it('HOJE: "+55 (0 31)" — zero DEPOIS do 55 — não é limpo', () => {
    // Caracterização de um caso de borda, não aprovação: o zero só sai quando é
    // o primeiro dígito, e aqui ele vem depois do 55. Sai DDD 03. Reportado, não
    // corrigido nesta etapa.
    expect(digitosTelefoneBR('+55 (031) 98888-7777')).toBe('03198888777')
  })
})

describe('formatTelefone — a máscara, que é o que se grava', () => {
  it('cresce conforme a digitação', () => {
    expect(formatTelefone('')).toBe('')
    expect(formatTelefone('3')).toBe('(3')
    expect(formatTelefone('31')).toBe('(31')
    expect(formatTelefone('319')).toBe('(31) 9')
    expect(formatTelefone('319888')).toBe('(31) 9888')
    expect(formatTelefone('3198888')).toBe('(31) 9888-8')
  })

  it('fixo com 8 dígitos e celular com 9', () => {
    expect(formatTelefone('3132221234')).toBe('(31) 3222-1234')
    expect(formatTelefone('31988887777')).toBe('(31) 98888-7777')
  })

  it('colar com +55 ou zero sai no formato certo', () => {
    expect(formatTelefone('+55 31 98888-7777')).toBe('(31) 98888-7777')
    expect(formatTelefone('031 3222-1234')).toBe('(31) 3222-1234')
  })

  it('aplicar duas vezes dá o mesmo (a máscara roda sobre o próprio resultado)', () => {
    for (const v of ['+55 31 98888-7777', '031 3222-1234', '(55) 99999-8888', '319']) {
      const uma = formatTelefone(v)
      expect(formatTelefone(uma), v).toBe(uma)
    }
  })
})

describe('telefoneIncompleto — o que o Salvar barra', () => {
  it('vazio não é incompleto (o campo é opcional)', () => {
    expect(telefoneIncompleto('')).toBe(false)
    expect(telefoneIncompleto(null)).toBe(false)
    expect(telefoneIncompleto(undefined)).toBe(false)
  })

  it('menos de 10 dígitos é incompleto', () => {
    expect(telefoneIncompleto('(31')).toBe(true)
    expect(telefoneIncompleto('(31) 9888-777')).toBe(true)
  })

  it('10 ou 11 dígitos é completo', () => {
    expect(telefoneIncompleto('(31) 3222-1234')).toBe(false)
    expect(telefoneIncompleto('(31) 98888-7777')).toBe(false)
  })

  it('conta os dígitos DEPOIS de tirar +55 e zero', () => {
    // "+55 31 9888" tem 8 dígitos: abaixo de 12, o 55 não sai, e é incompleto.
    expect(telefoneIncompleto('+55 31 9888')).toBe(true)
    expect(telefoneIncompleto('+55 31 3222-1234')).toBe(false)
  })
})

describe('waLink — link do WhatsApp na tabela', () => {
  it('prefixa 55 aos dígitos canônicos', () => {
    expect(waLink('(31) 98888-7777')).toBe('https://wa.me/5531988887777')
  })

  it('contato antigo gravado com +55 não sai com 55 duplicado', () => {
    expect(waLink('+55 31 98888-7777')).toBe('https://wa.me/5531988887777')
  })
})
