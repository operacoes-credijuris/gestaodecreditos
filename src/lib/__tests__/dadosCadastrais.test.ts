import { describe, it, expect } from 'vitest'
import { casaBuscaDaFicha, iniciaisDoNome, semAcento } from '../dadosCadastrais'

/**
 * A busca e o avatar da lista de Dados cadastrais (item "Novo" da amostra).
 * Só tela: nada aqui muda o que o Salvar grava (isso é fichaPessoa.test.ts).
 */

describe('casaBuscaDaFicha', () => {
  const linha = ['José da Silva', '529.982.247-25', null]

  it('busca em branco casa com tudo', () => {
    expect(casaBuscaDaFicha(linha, '')).toBe(true)
    expect(casaBuscaDaFicha(linha, '   ')).toBe(true)
  })

  it('casa pelo nome sem acento e sem caixa', () => {
    expect(casaBuscaDaFicha(linha, 'jose')).toBe(true)
    expect(casaBuscaDaFicha(linha, 'SILVA')).toBe(true)
    expect(casaBuscaDaFicha(linha, 'Joséa')).toBe(false)
  })

  it('casa pelo documento como foi gravado, com a máscara', () => {
    expect(casaBuscaDaFicha(linha, '529.982')).toBe(true)
  })

  it('casa pelo documento colado só com dígitos, a partir de 4', () => {
    expect(casaBuscaDaFicha(linha, '52998224725')).toBe(true)
    // "2998" só existe nos dígitos (no texto há um ponto no meio: "529.982").
    expect(casaBuscaDaFicha(linha, '2998')).toBe(true)
    // Com 3 dígitos, não: quase todo CPF da lista casaria e a busca não filtraria.
    expect(casaBuscaDaFicha(linha, '299')).toBe(false)
    // Mas o texto continua valendo com qualquer tamanho: "982" está em "529.982".
    expect(casaBuscaDaFicha(linha, '982')).toBe(true)
  })

  it('casa pelo representante legal', () => {
    expect(casaBuscaDaFicha(['Atlas Capital Ltda.', '', 'Fernanda Lobo'], 'fernanda')).toBe(true)
  })

  it('campos nulos não quebram', () => {
    expect(casaBuscaDaFicha([null, undefined], 'x')).toBe(false)
  })
})

describe('iniciaisDoNome', () => {
  it('as duas primeiras palavras com mais de duas letras', () => {
    expect(iniciaisDoNome('Francisco das Chagas Lima')).toBe('FC')
    expect(iniciaisDoNome('Atlas Capital Ltda.')).toBe('AC')
  })
  it('nome de uma palavra: uma letra', () => {
    expect(iniciaisDoNome('Credijuris')).toBe('C')
  })
  it('nome só de palavras curtas não sai vazio', () => {
    expect(iniciaisDoNome('Li Bo')).toBe('L')
  })
  it('espaços sobrando não contam', () => {
    expect(iniciaisDoNome('  ana   lúcia ferraz ')).toBe('AL')
  })
})

describe('semAcento', () => {
  it('tira acento e caixa', () => {
    expect(semAcento('Ângela MÁRCIA')).toBe('angela marcia')
    expect(semAcento(null)).toBe('')
  })
})
