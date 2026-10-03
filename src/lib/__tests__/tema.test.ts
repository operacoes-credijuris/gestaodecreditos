// O tema da plataforma (modo escuro, aprovado em 03/10/2026): a regra de qual
// tema se vê, o botão do topo, a escolha guardada e o script do index.html que
// aplica o tema antes do primeiro desenho.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  alternarTema,
  ATRIBUTO_DO_TEMA,
  CONSULTA_DO_SISTEMA,
  lerPreferenciaDeTema,
  normalizarPreferencia,
  OPCOES_DE_TEMA,
  PREF_TEMA,
  resolverTema,
  type PreferenciaDeTema,
} from '../tema'
import { gravarPreferencia, type Armazenamento } from '../preferencias'

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

describe('qual tema se vê', () => {
  it('claro e escuro valem o que dizem, com o sistema em qualquer estado', () => {
    for (const sistema of [true, false]) {
      expect(resolverTema('claro', sistema)).toBe('claro')
      expect(resolverTema('escuro', sistema)).toBe('escuro')
    }
  })
  it('"Do sistema" acompanha o sistema', () => {
    expect(resolverTema('sistema', true)).toBe('escuro')
    expect(resolverTema('sistema', false)).toBe('claro')
  })
  it('valor desconhecido (velho, lixo, nada) vale o claro — o padrão da equipe', () => {
    for (const v of [null, undefined, '', 'dark', 'light', 42, {}, 'ESCURO']) {
      expect(normalizarPreferencia(v)).toBe('claro')
    }
    expect(normalizarPreferencia('escuro')).toBe('escuro')
    expect(normalizarPreferencia('sistema')).toBe('sistema')
  })
  it('as três opções existem no menu, na ordem Claro, Escuro, Do sistema', () => {
    expect(OPCOES_DE_TEMA.map((o) => o.chave)).toEqual(['claro', 'escuro', 'sistema'])
    expect(OPCOES_DE_TEMA.map((o) => o.rotulo)).toEqual(['Claro', 'Escuro', 'Do sistema'])
  })
})

describe('o botão da lua/sol', () => {
  it('troca o que se vê, e sai do "Do sistema" para uma escolha fixa', () => {
    expect(alternarTema('claro')).toBe('escuro')
    expect(alternarTema('escuro')).toBe('claro')
    // Do sistema, vendo escuro: apertar mostra o claro (e não fica no sistema,
    // senão nada mudaria).
    expect(resolverTema(alternarTema(resolverTema('sistema', true)), true)).toBe('claro')
    expect(resolverTema(alternarTema(resolverTema('sistema', false)), false)).toBe('escuro')
  })
})

describe('a escolha guardada', () => {
  it('sem nada guardado, claro', () => {
    expect(lerPreferenciaDeTema(memoria())).toBe('claro')
  })
  it('lembra o que foi escolhido', () => {
    const a = memoria()
    for (const p of ['escuro', 'sistema', 'claro'] as PreferenciaDeTema[]) {
      gravarPreferencia(PREF_TEMA, p, a)
      expect(lerPreferenciaDeTema(a)).toBe(p)
    }
    expect([...a.dados.keys()]).toEqual(['credijuris.tema'])
  })
  it('armazenamento bloqueado ou ausente não quebra: claro', () => {
    expect(lerPreferenciaDeTema(quebrado)).toBe('claro')
    expect(lerPreferenciaDeTema(null)).toBe('claro')
    expect(() => gravarPreferencia(PREF_TEMA, 'escuro', quebrado)).not.toThrow()
  })
})

describe('o script do index.html (o tema antes do primeiro desenho)', () => {
  const HTML = readFileSync(fileURLToPath(new URL('../../../index.html', import.meta.url)), 'utf-8')
  const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const SCRIPT = scripts.find((s) => s.includes(ATRIBUTO_DO_TEMA)) ?? ''

  /** Roda o script com um navegador de mentira e diz o atributo que ele pôs. */
  function rodar(guardado: string | null | 'quebrado', sistemaEscuro: boolean) {
    const atributos = new Map<string, string>()
    const localStorage = {
      getItem: (k: string) => {
        if (guardado === 'quebrado') throw new Error('bloqueado')
        return k === 'credijuris.' + PREF_TEMA ? guardado : null
      },
    }
    const window = {
      matchMedia: (q: string) => ({ matches: q === CONSULTA_DO_SISTEMA && sistemaEscuro }),
    }
    const document = {
      documentElement: { setAttribute: (k: string, v: string) => void atributos.set(k, v) },
    }
    new Function('localStorage', 'window', 'document', SCRIPT)(localStorage, window, document)
    return atributos.get(ATRIBUTO_DO_TEMA) ?? null
  }

  it('existe, no <head>, antes do script do app', () => {
    expect(SCRIPT).not.toBe('')
    expect(HTML.indexOf(SCRIPT)).toBeLessThan(HTML.indexOf('</head>'))
    expect(HTML.indexOf(SCRIPT)).toBeLessThan(HTML.indexOf('/src/main.tsx'))
  })

  it('segue a mesma regra de resolverTema, na mesma chave', () => {
    for (const p of ['claro', 'escuro', 'sistema'] as PreferenciaDeTema[]) {
      for (const sistema of [true, false]) {
        const esperado = resolverTema(p, sistema) === 'escuro' ? 'escuro' : null
        expect(rodar(JSON.stringify(p), sistema), `${p}, sistema escuro=${sistema}`).toBe(esperado)
      }
    }
  })

  it('sem escolha, com lixo ou sem armazenamento: claro (nenhum atributo), sem erro', () => {
    for (const g of [null, 'nao-e-json{', '"dark"', 'quebrado'] as const) {
      expect(() => rodar(g, true)).not.toThrow()
      expect(rodar(g, true)).toBeNull()
    }
  })
})
