/**
 * O MENU LATERAL DA AUDITORIA VISUAL (03/10/2026): o recolhido por padrão
 * abaixo de 1366px (AP3, aprovado pelo dono), o atalho "[" e os rótulos curtos
 * (aprovados). As regras são de lib/; o desenho fica em layout/Sidebar.tsx.
 */
import { describe, it, expect } from 'vitest'
import {
  LARGURA_DO_MENU_ABERTO_POR_PADRAO,
  PREF_MENU_RECOLHIDO,
  lerMenuRecolhido,
  menuComecaRecolhido,
  type Armazenamento,
} from '../preferencias'
import {
  decidirAtalho,
  LISTA_DE_ATALHOS,
  NAVEGACAO_POR_LETRA,
  qualAtalho,
  TECLA_DO_MENU,
} from '../atalhos'
import {
  caminhoNoTopo,
  ITENS_DO_MENU,
  NAVIGATION,
  tituloDaAba,
} from '@/components/layout/navigation'

const tecla = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
})

/** Um armazenamento de mentira com o valor guardado (como o JSON do navegador). */
const guardado = (valor: string | null, quebrado = false): Armazenamento => ({
  getItem: (k) => {
    if (quebrado) throw new Error('bloqueado')
    return k === `credijuris.${PREF_MENU_RECOLHIDO}` ? valor : null
  },
  setItem: () => {},
  removeItem: () => {},
})

describe('o menu começa recolhido abaixo de 1366px (AP3)', () => {
  // largura × preferência guardada → recolhido?
  it.each([
    [1280, null, true],
    [1365, null, true],
    [1366, null, false],
    [1440, null, false],
    [1920, null, false],
    // A ESCOLHA DA PESSOA VENCE em qualquer largura.
    [1280, false, false],
    [1280, true, true],
    [1440, true, true],
    [1440, false, false],
  ] as const)('a %ipx com %s guardado: recolhido = %s', (largura, escolha, esperado) => {
    expect(menuComecaRecolhido(largura, escolha)).toBe(esperado)
  })

  it('o limite é 1366px', () => {
    expect(LARGURA_DO_MENU_ABERTO_POR_PADRAO).toBe(1366)
  })

  it('valor guardado que não é sim/não não conta como escolha', () => {
    expect(menuComecaRecolhido(1280, 'true')).toBe(true)
    expect(menuComecaRecolhido(1440, 1)).toBe(false)
    expect(menuComecaRecolhido(1440, undefined)).toBe(false)
  })

  it('lê a escolha guardada no navegador; sem ela, ou com o armazenamento quebrado, a largura', () => {
    expect(lerMenuRecolhido(1280, guardado(null))).toBe(true)
    expect(lerMenuRecolhido(1440, guardado(null))).toBe(false)
    expect(lerMenuRecolhido(1280, guardado('false'))).toBe(false)
    expect(lerMenuRecolhido(1920, guardado('true'))).toBe(true)
    expect(lerMenuRecolhido(1280, guardado('{lixo'))).toBe(true)
    expect(lerMenuRecolhido(1280, guardado(null, true))).toBe(true)
    expect(lerMenuRecolhido(1440, null)).toBe(false)
  })
})

describe('o "[" recolhe e abre o menu', () => {
  it('é o atalho do menu, sem modificador', () => {
    expect(TECLA_DO_MENU).toBe('[')
    expect(qualAtalho(tecla('['))).toBe('menu')
    expect(qualAtalho(tecla('[', { ctrlKey: true }))).toBeNull()
    expect(qualAtalho(tecla('[', { altKey: true }))).toBeNull()
  })

  it('não age digitando nem com uma janela aberta', () => {
    expect(decidirAtalho('menu', { tagName: 'INPUT' }, false)).toBe('ignorar')
    expect(decidirAtalho('menu', { tagName: 'TEXTAREA' }, false)).toBe('ignorar')
    expect(decidirAtalho('menu', { isContentEditable: true }, false)).toBe('ignorar')
    expect(decidirAtalho('menu', { tagName: 'BODY' }, true)).toBe('ignorar')
    expect(decidirAtalho('menu', { tagName: 'BODY' }, false)).toBe('agir')
  })

  it('não colide com os outros atalhos', () => {
    for (const k of ['/', '?', 'k', 'j', 'g']) expect(qualAtalho(tecla(k))).not.toBe('menu')
    expect(qualAtalho(tecla('k', { ctrlKey: true }))).toBe('busca')
    expect(NAVEGACAO_POR_LETRA.some((n) => n.letra === TECLA_DO_MENU)).toBe(false)
  })

  it('está na lista do "?"', () => {
    const linha = LISTA_DE_ATALHOS.find((a) => a.teclas.includes(TECLA_DO_MENU))
    expect(linha?.descricao).toMatch(/menu lateral/)
  })
})

describe('os rótulos curtos do menu (aprovados em 03/10/2026)', () => {
  const item = (to: string) => ITENS_DO_MENU.find((i) => i.to === to)!

  it('"Publicações" e "Requerimentos" no menu; os outros sem rótulo curto', () => {
    expect(item('/operacional/execucao/publicacoes').rotuloCurto).toBe('Publicações')
    expect(item('/operacional/execucao/requerimentos').rotuloCurto).toBe('Requerimentos')
    expect(ITENS_DO_MENU.filter((i) => i.rotuloCurto).map((i) => i.to)).toHaveLength(2)
  })

  it('o nome inteiro continua no caminho do topo e na aba do navegador', () => {
    expect(caminhoNoTopo('/operacional/execucao/publicacoes')).toEqual(['Operacional', 'Publicações e movimentações'])
    expect(tituloDaAba('/operacional/execucao/requerimentos')).toBe('Requerimentos administrativos — Credijuris')
  })

  it('em Operacional, os grupos rotina › consulta › leitura, separados por respiro', () => {
    const operacional = NAVIGATION.find((s) => s.title === 'Operacional')!
    const grupos: string[][] = []
    for (const i of operacional.items) {
      if (i.respiro || grupos.length === 0) grupos.push([])
      grupos[grupos.length - 1].push(i.rotuloCurto ?? i.label)
    }
    expect(grupos).toEqual([
      ['Publicações', 'Tarefas'],
      ['Créditos', 'Requerimentos', 'Contatos'],
      ['Quadro econômico'],
    ])
  })
})
