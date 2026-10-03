// Os grupos de colunas da carteira (aba Carteiras): só a tela muda. Este teste
// prende as duas promessas da decisão do dono — os grupos abrem TODOS ligados, e
// o liga/desliga nunca alcança o Excel nem o relatório do investidor.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  GRUPOS_DA_CARTEIRA,
  TOTAL_DE_COLUNAS,
  alternarGrupo,
  colunasNaTela,
  gruposVisiveis,
  todosLigados,
} from '@/lib/gruposDaCarteira'

const ler = (relativo: string) =>
  readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), 'utf-8')

describe('grupos de colunas da carteira', () => {
  it('são as 25 colunas do Excel, em 7 grupos', () => {
    expect(GRUPOS_DA_CARTEIRA).toHaveLength(7)
    expect(TOTAL_DE_COLUNAS).toBe(25)
    expect(GRUPOS_DA_CARTEIRA.map((g) => g.colunas.length)).toEqual([5, 2, 3, 3, 1, 4, 7])
  })

  it('as colunas têm os mesmos títulos, na mesma ordem, que o Excel escreve', () => {
    // O Excel não exporta a lista; os títulos dele são lidos do próprio fonte.
    const excel = ler('../exportarCarteira.ts')
    const titulos = GRUPOS_DA_CARTEIRA.flatMap((g) => g.colunas.map((c) => c.titulo))
    let desde = excel.indexOf('const COLUNAS')
    expect(desde).toBeGreaterThan(-1)
    for (const t of titulos) {
      const achou = excel.indexOf(`titulo: '${t}'`, desde)
      expect(achou, `coluna "${t}" fora da ordem do Excel`).toBeGreaterThan(-1)
      desde = achou
    }
  })

  it('abrem todos ligados, com as 25 na tela', () => {
    const l = todosLigados()
    expect(Object.values(l).every(Boolean)).toBe(true)
    expect(colunasNaTela(l)).toBe(25)
  })

  it('desligar um grupo tira só as colunas dele, e religar devolve', () => {
    const sem = alternarGrupo(todosLigados(), 'calc')
    expect(colunasNaTela(sem)).toBe(18)
    expect(gruposVisiveis(sem).map((g) => g.chave)).toEqual(['ide', 'tir', 'cre', 'rec', 'compl', 'viv'])
    expect(colunasNaTela(alternarGrupo(sem, 'calc'))).toBe(25)
  })

  it('o Excel, o relatório e a mensagem não leem a escolha da tela', () => {
    for (const arquivo of ['../exportarCarteira.ts', '../relatorioCarteira.ts', '../carteiraInvestidor.ts']) {
      expect(ler(arquivo), arquivo).not.toMatch(/gruposDaCarteira|GruposLigados|colunasNaTela/)
    }
  })
})
