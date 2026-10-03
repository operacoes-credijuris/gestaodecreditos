/**
 * A MOLDURA NÃO DEIXA NADA VAZAR PARA A PÁGINA (03/10/2026).
 *
 * O defeito: um `sr-only` (texto só para leitor de tela, `position: absolute`)
 * abaixo da dobra, dentro do <main> que rola, não tinha ancestral posicionado. A
 * referência dele virava a PÁGINA, e não o <main>: a página ficava mais alta que
 * a janela, rolava, e a tela inteira subia deixando uma faixa vazia embaixo.
 *
 * A correção é `relative` na moldura (que corta com `overflow-hidden`), no
 * <main> e no menu lateral que rola — as três áreas onde moram os `absolute`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ler = (arq: string) => readFileSync(join(__dirname, '..', '..', arq), 'utf8')

describe('moldura sem vazamento', () => {
  it('a moldura e o <main> são posicionados', () => {
    const layout = ler('components/layout/AppLayout.tsx')
    expect(layout).toMatch(/className="relative flex h-screen overflow-hidden/)
    expect(layout).toMatch(/<main className="relative flex-1 overflow-y-auto/)
  })

  it('o menu lateral que rola é posicionado', () => {
    expect(ler('components/layout/Sidebar.tsx')).toMatch(/<nav className="relative flex-1 [^"]*overflow-y-auto/)
  })
})
