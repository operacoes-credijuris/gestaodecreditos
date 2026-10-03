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
 *
 * A MESMA FAMÍLIA, na revisão pós-virada (o bloco "outras caixas que rolam"):
 * toda caixa que rola e tem `sr-only` dentro precisa ser posicionada, senão o
 * `sr-only` se mede por fora dela — na rolagem DE LADO (tabela larga, abas,
 * fileira de seções das Configurações no celular) alargava o <main>, e a tela
 * inteira rolava de lado; no corpo da janela (Modal), fazia o fundo escurecido
 * rolar e a janela subir.
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

  it('a moldura tem a altura da janela VISÍVEL no celular (dvh), com o 100vh de reserva', () => {
    const layout = ler('components/layout/AppLayout.tsx')
    expect(layout).toMatch(/className="relative flex h-screen [^"]*supports-\[height:100dvh\]:h-dvh/)
  })
})

describe('moldura sem vazamento: outras caixas que rolam', () => {
  it('a caixa da tabela (rola de lado) é posicionada', () => {
    expect(ler('components/ui/Table.tsx')).toMatch(/'relative overflow-x-auto rounded-cartao/)
  })

  it('a régua de abas (rola de lado) é posicionada', () => {
    expect(ler('components/ui/Tabs.tsx')).toMatch(/className="relative flex min-w-0 gap-1 overflow-x-auto/)
  })

  it('a fileira de seções das Configurações é posicionada e usa a barra fina', () => {
    const cfg = ler('pages/configuracoes/Configuracoes.tsx')
    const nav = /className="([^"]*overflow-x-auto[^"]*)"/.exec(cfg)?.[1] ?? ''
    expect(nav).toMatch(/(^| )relative( |$)/)
    // A barra NATIVA do Windows (com setinhas) aparecia embaixo das seções.
    expect(nav).toMatch(/(^| )scrollbar-thin( |$)/)
  })

  it('o corpo da janela (Modal), que rola, é posicionado', () => {
    expect(ler('components/ui/Modal.tsx')).toMatch(/className="relative max-h-\[70vh\] overflow-y-auto/)
  })
})
