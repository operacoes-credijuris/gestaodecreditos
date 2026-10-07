/** OS LINKS NO HISTÓRICO DO CARD (07/10/2026, pedido do dono): clicáveis, em azul. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pedacosComLinks } from '../linksNoTexto'

const links = (t: string) => pedacosComLinks(t).filter((p) => p.tipo === 'link').map((p) => p.texto)

describe('pedacosComLinks', () => {
  it('acha http, https e www, e o resto continua texto', () => {
    const p = pedacosComLinks('Ofício em https://esaj.tjsp.jus.br/abc?x=1 e planilha www.exemplo.com.br/p')
    expect(p.map((x) => x.texto).join('')).toBe('Ofício em https://esaj.tjsp.jus.br/abc?x=1 e planilha www.exemplo.com.br/p')
    expect(links('a http://x.gov.br b')).toEqual(['http://x.gov.br'])
    const www = pedacosComLinks('ver www.exemplo.com').find((x) => x.tipo === 'link')
    expect(www).toEqual({ tipo: 'link', texto: 'www.exemplo.com', href: 'https://www.exemplo.com' })
  })

  it('a pontuação do fim da frase fica de fora', () => {
    expect(links('Veja https://x.gov.br/doc.')).toEqual(['https://x.gov.br/doc'])
    expect(links('(https://x.gov.br/doc), depois')).toEqual(['https://x.gov.br/doc'])
    expect(links('https://pt.wikipedia.org/wiki/Precat%C3%B3rio_(direito)')).toEqual([
      'https://pt.wikipedia.org/wiki/Precat%C3%B3rio_(direito)',
    ])
  })

  it('várias linhas e vários links; texto sem link fica inteiro', () => {
    expect(links('1) https://a.com\n2) https://b.com/x')).toEqual(['https://a.com', 'https://b.com/x'])
    expect(pedacosComLinks('sem link nenhum.')).toEqual([{ tipo: 'texto', texto: 'sem link nenhum.' }])
    expect(pedacosComLinks('')).toEqual([])
  })

  it('o histórico do card usa a regra, e o link abre em outra aba', () => {
    const t = readFileSync(join(__dirname, '..', '..', 'pages/operacional/AnaliseCredito.tsx'), 'utf8')
    expect(t).toContain('{pedacosComLinks(texto).map((p, i) =>')
    // No histórico aberto E na linha da última anotação (com uma nota só, ela é o histórico).
    expect(t).toContain('<TextoComLinks texto={corpo} />')
    expect(t).toContain('<TextoComLinks texto={texto} />')
    expect(t).toContain('rel="noopener noreferrer"')
  })
})
