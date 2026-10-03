// A lógica das novidades globais da onda 3 do redesenho: atalhos, contadores do
// menu, ajuda por tela, glossário, preferências e o "Descartar alterações?".
import { describe, it, expect, vi, afterEach } from 'vitest'
import { decidirAtalho, estaDigitando, qualAtalho } from '../atalhos'
import {
  CONTADOR_DO_ITEM,
  isoDiasAtras,
  mostraContador,
  numeroDoContador,
  rotuloDoItemRecolhido,
  textoDoContador,
} from '../contadoresDoMenu'
import { AJUDA_DAS_TELAS, ajudaDaRota, filtrarGlossario, GLOSSARIO } from '../ajudaDaPlataforma'
import { ITENS_DO_MENU } from '@/components/layout/navigation'
import {
  armazenamentoDisponivel,
  gravarPreferencia,
  lerPreferencia,
  type Armazenamento,
} from '../preferencias'
import { perguntarDescarte, registrarJanelaDeDescarte, responderDescarte } from '../descarte'

const tecla = (key: string, mod: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mod,
})

describe('atalhos de teclado', () => {
  it('Ctrl+K e Cmd+K abrem a busca; Ctrl+Alt+K (AltGr) não', () => {
    expect(qualAtalho(tecla('k', { ctrlKey: true }))).toBe('busca')
    expect(qualAtalho(tecla('K', { metaKey: true }))).toBe('busca')
    expect(qualAtalho(tecla('k', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(qualAtalho(tecla('k'))).toBeNull()
  })
  it('"/" vai ao filtro e "?" aos atalhos, sem modificador', () => {
    expect(qualAtalho(tecla('/'))).toBe('filtro')
    expect(qualAtalho(tecla('?'))).toBe('atalhos')
    expect(qualAtalho(tecla('/', { ctrlKey: true }))).toBeNull()
  })
  it('digitando num campo, numa caixa de texto (a do Assistente) ou num editável: nada', () => {
    expect(estaDigitando({ tagName: 'INPUT' })).toBe(true)
    expect(estaDigitando({ tagName: 'TEXTAREA' })).toBe(true)
    expect(estaDigitando({ tagName: 'SELECT' })).toBe(true)
    expect(estaDigitando({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(estaDigitando({ tagName: 'BUTTON', closest: () => null })).toBe(false)
    for (const a of ['busca', 'filtro', 'atalhos'] as const) {
      expect(decidirAtalho(a, { tagName: 'TEXTAREA' }, false)).toBe('ignorar')
    }
  })
  it('com janela aberta: a busca avisa, o filtro não age, os atalhos abrem por cima', () => {
    const botao = { tagName: 'BUTTON' }
    expect(decidirAtalho('busca', botao, true)).toBe('avisar')
    expect(decidirAtalho('filtro', botao, true)).toBe('ignorar')
    expect(decidirAtalho('atalhos', botao, true)).toBe('agir')
    expect(decidirAtalho('busca', botao, false)).toBe('agir')
    expect(decidirAtalho('filtro', botao, false)).toBe('agir')
  })
})

describe('contadores do menu', () => {
  it('a janela das publicações é a da tela: 30 dias, data local', () => {
    expect(isoDiasAtras(30, new Date(2026, 9, 2, 10))).toBe('2026-09-02')
  })
  it('texto por extenso, no singular e no plural', () => {
    expect(textoDoContador('publicacoes', 5)).toBe('5 publicações novas')
    expect(textoDoContador('publicacoes', 1)).toBe('1 publicação nova')
    expect(textoDoContador('tarefas', 2)).toBe('2 tarefas vencidas')
    expect(textoDoContador('tarefas', 1)).toBe('1 tarefa vencida')
  })
  it('zero, erro e carregando não mostram pílula; acima de 99, "99+"', () => {
    expect(mostraContador(0)).toBe(false)
    expect(mostraContador(undefined)).toBe(false)
    expect(mostraContador(null)).toBe(false)
    expect(mostraContador(3)).toBe(true)
    expect(numeroDoContador(150)).toBe('99+')
    expect(numeroDoContador(7)).toBe('7')
  })
  it('menu recolhido: o nome leva o contador', () => {
    expect(rotuloDoItemRecolhido('Tarefas', '2 tarefas vencidas')).toBe('Tarefas · 2 tarefas vencidas')
    expect(rotuloDoItemRecolhido('Créditos', null)).toBe('Créditos')
  })
  it('os contadores ficam em itens que existem no menu', () => {
    for (const to of Object.keys(CONTADOR_DO_ITEM)) {
      expect(ITENS_DO_MENU.some((i) => i.to === to)).toBe(true)
    }
  })
})

describe('ajuda por tela e glossário', () => {
  it('todo item do menu tem a sua ajuda, em três frases', () => {
    for (const item of ITENS_DO_MENU) {
      expect(AJUDA_DAS_TELAS[item.to], item.to).toHaveLength(3)
    }
  })
  it('a ajuda do Quadro vale nas cinco abas; endereço sem tela não tem ajuda', () => {
    expect(ajudaDaRota('/inteligencia/recortes')).toBe(AJUDA_DAS_TELAS['/inteligencia'])
    expect(ajudaDaRota('/Operacional/Analise/')).toBe(AJUDA_DAS_TELAS['/operacional/analise'])
    expect(ajudaDaRota('/nao-existe')).toBeNull()
  })
  it('o glossário filtra sem acento, pelo termo ou pela definição', () => {
    expect(filtrarGlossario('diligencia').map((t) => t.termo)).toContain('Diligência')
    expect(filtrarGlossario('CRM').map((t) => t.termo)).toEqual(['Kommo'])
    expect(filtrarGlossario('')).toHaveLength(GLOSSARIO.length)
  })
})

describe('preferências no navegador', () => {
  const memoria = (): Armazenamento & { dados: Map<string, string> } => {
    const dados = new Map<string, string>()
    return {
      dados,
      getItem: (k) => dados.get(k) ?? null,
      setItem: (k, v) => void dados.set(k, v),
      removeItem: (k) => void dados.delete(k),
    }
  }
  const quebrado: Armazenamento = {
    getItem: () => {
      throw new Error('bloqueado')
    },
    setItem: () => {
      throw new Error('bloqueado')
    },
    removeItem: () => {
      throw new Error('bloqueado')
    },
  }

  it('grava e lê de volta', () => {
    const a = memoria()
    gravarPreferencia('menu.recolhido', true, a)
    expect(lerPreferencia('menu.recolhido', false, a)).toBe(true)
    expect(armazenamentoDisponivel(a)).toBe(true)
  })
  it('sem armazenamento (anônima, bloqueado): o padrão, e nenhum erro', () => {
    expect(() => gravarPreferencia('x', 1, quebrado)).not.toThrow()
    expect(lerPreferencia('x', 'padrao', quebrado)).toBe('padrao')
    expect(lerPreferencia('x', 'padrao', null)).toBe('padrao')
    expect(armazenamentoDisponivel(quebrado)).toBe(false)
  })
  it('valor ilegível vira o padrão', () => {
    const a = memoria()
    a.dados.set('credijuris.x', '{quebrado')
    expect(lerPreferencia('x', 42, a)).toBe(42)
  })
})

describe('"Descartar alterações?" na janela da plataforma', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a resposta volta para quem perguntou', async () => {
    const aberta: boolean[] = []
    const sair = registrarJanelaDeDescarte((v) => aberta.push(v))
    const p = perguntarDescarte()
    expect(aberta).toEqual([true])
    responderDescarte(true)
    await expect(p).resolves.toBe(true)
    expect(aberta).toEqual([true, false])

    const q = perguntarDescarte()
    responderDescarte(false)
    await expect(q).resolves.toBe(false)
    sair()
  })

  it('dois pedidos seguidos recebem a MESMA pergunta', async () => {
    let vezes = 0
    const sair = registrarJanelaDeDescarte((v) => {
      if (v) vezes++
    })
    const a = perguntarDescarte()
    const b = perguntarDescarte()
    expect(a).toBe(b)
    expect(vezes).toBe(1)
    responderDescarte(true)
    await expect(b).resolves.toBe(true)
    sair()
  })

  it('a janela que sai com a pergunta aberta responde "continuar editando"', async () => {
    const sair = registrarJanelaDeDescarte(() => {})
    const p = perguntarDescarte()
    sair()
    await expect(p).resolves.toBe(false)
  })
})
