// Guarda contra um bug que já aconteceu de verdade.
//
// Em 25/08/2026, ao reaplicar as ferramentas do Quadro Econômico sobre uma
// versão nova do assistente, os dois `case` do executor se perderam no rebase.
// As ferramentas continuaram DECLARADAS ao modelo, `montarPainel` continuou
// importado, e nada mais. O modelo chamava `panorama_economico` e recebia
// "Ferramenta desconhecida".
//
// Nada pegou: `deno check`, `tsc` e os 142 testes passavam, porque import não
// usado e `case` faltando são TypeScript perfeitamente válido. O que faltava
// era alguém comparar as duas listas.
//
// É um teste estático — lê o arquivo como texto. Importar a Edge Function
// aqui não é possível: ela usa APIs de Deno e especificadores npm: que o
// vitest não resolve. Ler o fonte cobre exatamente o risco que importa.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FONTE = fileURLToPath(
  new URL('../../../supabase/functions/assistente/index.ts', import.meta.url),
)
const src = readFileSync(FONTE, 'utf-8')

/** `name: 'x',` sozinho na linha — a forma como as ferramentas se declaram. */
const declaradas = [...src.matchAll(/^\s*name: '([a-z_]+)',\s*$/gm)].map((m) => m[1])
/** `case 'x': {` — a forma como o executor as atende. */
const executadas = [...src.matchAll(/^\s*case '([a-z_]+)': \{/gm)].map((m) => m[1])

describe('assistente: ferramentas declaradas × executadas', () => {
  it('encontra as duas listas no fonte (senão o teste não está testando nada)', () => {
    expect(declaradas.length).toBeGreaterThan(10)
    expect(executadas.length).toBeGreaterThan(10)
  })

  it('toda ferramenta declarada ao modelo tem executor', () => {
    const semExecutor = declaradas.filter((n) => !executadas.includes(n))
    expect(semExecutor).toEqual([])
  })

  it('todo executor corresponde a uma ferramenta declarada', () => {
    // O contrário também é defeito: código morto que ninguém consegue chamar.
    const semDeclaracao = executadas.filter((n) => !declaradas.includes(n))
    expect(semDeclaracao).toEqual([])
  })

  it('nenhuma ferramenta é declarada duas vezes', () => {
    expect(new Set(declaradas).size).toBe(declaradas.length)
  })

  it('as ferramentas do Quadro Econômico estão inteiras', () => {
    for (const t of ['panorama_economico', 'recorte_economico']) {
      expect(declaradas).toContain(t)
      expect(executadas).toContain(t)
    }
  })

  it('o assistente CHAMA montarPainel, não apenas o importa', () => {
    // O sintoma exato do bug de 25/08: import presente, chamada ausente.
    expect(src).toMatch(/montarPainel\(/)
  })

  it('não oferece ao modelo dimensões que saíram do produto', () => {
    // Faixa de valor e safra foram removidas da tela em 28/08. Ferramenta que
    // ainda as oferecesse faria o assistente falar de algo que não existe.
    const enumDimensao = /enum: \[([^\]]*)\],\s*\n\s*description: 'Como agrupar/.exec(src)
    expect(enumDimensao).not.toBeNull()
    expect(enumDimensao![1]).not.toMatch(/faixa_valor|safra/)
  })
})
