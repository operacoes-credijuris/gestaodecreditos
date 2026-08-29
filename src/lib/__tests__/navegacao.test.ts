// Testes do menu e da resolução de rota.
//
// Nasceram de um defeito silencioso: `/inteligencia` é prefixo de
// `/inteligencia/performance`, e `findNavLocation` devolvia o PRIMEIRO item
// que casasse. Como Visão Geral (`/inteligencia`) era o primeiro da seção, o
// cabeçalho e o título da aba diziam "Visão Geral" nas quatro subtelas.
//
// Ninguém percebeu porque nada quebra: a página certa aparece, só o rótulo
// acima dela é que está errado. É o tipo de coisa que teste pega e revisão
// visual não.

import { describe, it, expect } from 'vitest'
import {
  NAVIGATION, NAV_CONFIG, findNavLocation, resolverNav,
  type NavSection,
} from '@/components/layout/navigation'

const TODAS = NAVIGATION.flatMap((s) => s.items)

describe('findNavLocation', () => {
  it('resolve cada item do menu para ele mesmo', () => {
    // O caso que estava quebrado: toda rota tem de encontrar a SUA folha.
    for (const leaf of TODAS) {
      expect(findNavLocation(leaf.to)?.leaf.label).toBe(leaf.label)
    }
  })

  it('a rota-raiz do Quadro Econômico não sequestra as subtelas', () => {
    expect(findNavLocation('/inteligencia')?.leaf.label).toBe('Visão Geral')
    expect(findNavLocation('/inteligencia/performance')?.leaf.label).toBe('Performance')
    expect(findNavLocation('/inteligencia/previsoes')?.leaf.label).toBe('Previsões')
    expect(findNavLocation('/inteligencia/recortes')?.leaf.label).toBe('Recortes')
    expect(findNavLocation('/inteligencia/carteiras')?.leaf.label).toBe('Carteiras de Investimento')
  })

  it('escolhe o mais específico mesmo com a raiz declarada em primeiro', () => {
    // ESTE é o teste que pega o defeito. Um menu montado na pior ordem: a
    // rota-raiz antes das filhas, que era exatamente o arranjo em produção
    // antes da ordenação alfabética. Com a lógica de "primeiro que casa", a
    // raiz vence e este teste falha.
    const hostil: NavSection[] = [{
      title: 'Hostil',
      items: [
        { label: 'Raiz', to: '/inteligencia', icon: NAV_CONFIG.icon },
        { label: 'Filha', to: '/inteligencia/performance', icon: NAV_CONFIG.icon },
        { label: 'Neta', to: '/inteligencia/performance/detalhe', icon: NAV_CONFIG.icon },
      ],
    }]
    expect(resolverNav(hostil, '/inteligencia')?.leaf.label).toBe('Raiz')
    expect(resolverNav(hostil, '/inteligencia/performance')?.leaf.label).toBe('Filha')
    expect(resolverNav(hostil, '/inteligencia/performance/detalhe')?.leaf.label).toBe('Neta')
  })

  it('devolve a seção junto com a página', () => {
    expect(findNavLocation('/inteligencia/recortes')?.section).toBe('Quadro Econômico')
    expect(findNavLocation('/comercial/contratos')?.section).toBe('Comercial')
  })

  it('subrota não cadastrada cai na página mãe', () => {
    expect(findNavLocation('/inteligencia/recortes/qualquer-coisa')?.leaf.label).toBe('Recortes')
  })

  it('configurações resolve fora das seções', () => {
    expect(findNavLocation(NAV_CONFIG.to)?.leaf.label).toBe('Configurações')
  })

  it('rota desconhecida devolve null em vez de chutar', () => {
    expect(findNavLocation('/nao-existe')).toBeNull()
  })
})

describe('menu', () => {
  it('o Quadro Econômico está em ordem alfabética', () => {
    const secao = NAVIGATION.find((s) => s.title === 'Quadro Econômico')!
    const rotulos = secao.items.map((i) => i.label)
    const ordenado = [...rotulos].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    expect(rotulos).toEqual(ordenado)
  })

  it('não há dois itens apontando para a mesma rota', () => {
    const rotas = TODAS.map((i) => i.to)
    expect(new Set(rotas).size).toBe(rotas.length)
  })

  it('a Revisão de Dados saiu do menu', () => {
    expect(TODAS.some((i) => i.to.includes('anomalias'))).toBe(false)
  })
})
