/**
 * A ABA ARQUIVOS COM MAIS DE 50 (auditoria de 23/10/2026): a documentação do
 * Kommo só fala em `before_id` para esta lista, e a leitura seguia só o `next` —
 * num card com muitos arquivos, os mais antigos podiam ficar de fora sem aviso.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { proximaPaginaDeArquivos } from '../../../supabase/functions/_shared/paginasDeArquivos.ts'

const pagina = (ids: number[], next?: string) => ({
  _embedded: { files: ids.map((id) => ({ id, file_uuid: `u${id}` })) },
  ...(next ? { _links: { next: { href: next } } } : {}),
})
const cheia = (de: number) => Array.from({ length: 50 }, (_, i) => de - i)

describe('proximaPaginaDeArquivos', () => {
  it('o next do Kommo vale primeiro', () => {
    expect(proximaPaginaDeArquivos('/leads/1/files?limit=50', pagina(cheia(100), 'https://x/api/v4/leads/1/files?page=2'), 50))
      .toBe('https://x/api/v4/leads/1/files?page=2')
  })
  it('sem next e página cheia: before_id = o menor id', () => {
    expect(proximaPaginaDeArquivos('/leads/1/files?limit=50', pagina(cheia(100)), 50)).toBe('/leads/1/files?limit=50&before_id=51')
  })
  it('troca o before_id anterior, e não o repete', () => {
    expect(proximaPaginaDeArquivos('/leads/1/files?limit=50&before_id=51', pagina(cheia(50)), 50))
      .toBe('/leads/1/files?limit=50&before_id=1')
    expect(proximaPaginaDeArquivos('/leads/1/files?limit=50&before_id=1', pagina(Array(50).fill(1)), 50)).toBeNull()
  })
  it('página incompleta ou sem id: acabou', () => {
    expect(proximaPaginaDeArquivos('/leads/1/files?limit=50', pagina([3, 2, 1]), 50)).toBeNull()
    expect(proximaPaginaDeArquivos('/a?limit=50', { _embedded: { files: Array(50).fill({ file_uuid: 'x' }) } }, 50)).toBeNull()
    expect(proximaPaginaDeArquivos('/a?limit=50', null, 50)).toBeNull()
  })
  it('as duas leituras usam e param na página sem arquivo novo', () => {
    const raiz = join(__dirname, '..', '..', '..')
    const b = readFileSync(join(raiz, 'supabase/functions/buscar-kommo/index.ts'), 'utf8')
    expect(b).toContain('proxima = novos.length ? proximaPaginaDeArquivos(atual, listJson, 50) : null;')
    const e = readFileSync(join(raiz, 'supabase/functions/escavador-autos-rotina/index.ts'), 'utf8')
    expect(e).toContain('const prox = novos ? proximaPaginaDeArquivos(atual, j, 50) : null')
  })
})
