// O ponto do menu das Configurações repete o selo de cada cartão. Se a regra de
// um deles mudar sozinha, o menu passa a contradizer o cartão — este teste prende
// a regra do lado do menu.

import { describe, it, expect } from 'vitest'
import {
  GRUPOS_DO_MENU,
  SECAO_INICIAL,
  ehPacoteZip,
  extraDoMenu,
  pontoDaIntegracao,
  pontoDoKommo,
  tamanhoEmKB,
  textoDoPlanoBullai,
} from '@/lib/menuDasConfiguracoes'

describe('menu das Configurações', () => {
  it('tem as nove seções, nos três grupos, e começa no ADVBOX', () => {
    expect(GRUPOS_DO_MENU.map((g) => g.titulo)).toEqual(['Integrações', 'Assistente', 'Equipe'])
    expect(GRUPOS_DO_MENU.flatMap((g) => g.itens.map((i) => i.id))).toEqual([
      'advbox', 'kommo', 'anthropic', 'escavador', 'bullai', 'djen', 'skills', 'roteiro', 'justificativa', 'usuarios',
    ])
    expect(SECAO_INICIAL).toBe('advbox')
  })

  it('o ponto da integração: erro de leitura vence "configurada" e "não configurada"', () => {
    expect(pontoDaIntegracao(new Error('x'), true).tom).toBe('aviso')
    expect(pontoDaIntegracao(new Error('x'), false).tom).toBe('aviso')
    expect(pontoDaIntegracao(null, true)).toEqual({ tom: 'ok', rotulo: 'Configurada' })
    expect(pontoDaIntegracao(null, false)).toEqual({ tom: 'off', rotulo: 'Não configurada' })
  })

  it('o ponto do Kommo: salvo sem conexão é âmbar, não verde', () => {
    expect(pontoDoKommo(new Error('x'), true, true).rotulo).toBe('Estado não carregado')
    expect(pontoDoKommo(null, false, true).tom).toBe('off')
    expect(pontoDoKommo(null, true, false)).toEqual({ tom: 'aviso', rotulo: 'Salvo, sem conexão' })
    expect(pontoDoKommo(null, true, true).tom).toBe('ok')
  })

  it('o saldo no menu: nada sem configurar, nada enquanto carrega, "indisponível" na falha', () => {
    const t = (n: number) => `R$ ${n}`
    expect(extraDoMenu(false, 10, null, t, 'Saldo')).toBeNull()
    expect(extraDoMenu(true, undefined, null, t, 'Saldo')).toBeNull()
    expect(extraDoMenu(true, 10, null, t, 'Saldo')).toEqual({ texto: 'R$ 10', aviso: false, title: 'Saldo' })
    const falha = extraDoMenu(true, 10, new Error('401'), t, 'Saldo')
    expect(falha?.texto).toBe('indisponível')
    expect(falha?.aviso).toBe(true)
    expect(falha?.title).toContain('401')
  })

  it('o plano da BullAI', () => {
    expect(textoDoPlanoBullai(null)).toBe('ilimitado')
    expect(textoDoPlanoBullai(1200)).toBe('1.200 consulta(s)')
  })

  it('o pacote da Skill só é aceito como .zip, e o tamanho nunca é 0 KB', () => {
    expect(ehPacoteZip('minuta.zip')).toBe(true)
    expect(ehPacoteZip('MINUTA.ZIP')).toBe(true)
    expect(ehPacoteZip('minuta.zip.pdf')).toBe(false)
    expect(ehPacoteZip('minuta.rar')).toBe(false)
    expect(tamanhoEmKB(10)).toBe(1)
    expect(tamanhoEmKB(18 * 1024)).toBe(18)
  })
})
