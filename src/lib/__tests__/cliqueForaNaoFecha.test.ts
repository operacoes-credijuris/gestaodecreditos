/**
 * CLIQUE FORA NÃO FECHA JANELA (pedido do dono, 07/10/2026): um clique sem
 * querer no fundo fechava a janela e levava o que estava digitado. Janelas e
 * gavetas fecham só pelo X, pelo Fechar/Cancelar ou pelo Esc; as caixas do card
 * em que se digita (Anotar, "Fechado!") também não fecham com clique fora.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ler = (arq: string) => readFileSync(join(__dirname, '..', '..', arq), 'utf8')

describe('clique fora não fecha', () => {
  it('a janela (Modal) não fecha pelo fundo', () => {
    const m = ler('components/ui/Modal.tsx')
    expect(m).not.toMatch(/e\.target === e\.currentTarget\) requestClose\(\)/)
  })

  it('a gaveta (Drawer) não fecha pelo fundo', () => {
    const d = ler('components/ui/Drawer.tsx')
    const fundo = d.slice(d.indexOf("'absolute inset-0 bg-veu/40"), d.indexOf('/>', d.indexOf("'absolute inset-0 bg-veu/40")))
    expect(fundo).not.toMatch(/onClick=/)
  })

  it('as caixas em que se digita (Anotar e "Fechado!") não fecham com clique fora', () => {
    const t = ler('pages/operacional/AnaliseCredito.tsx')
    for (const nome of ['function BotaoDeAnotacao', 'function BotaoFechado']) {
      const corpo = t.slice(t.indexOf(nome), t.indexOf('\n}\n', t.indexOf(nome)))
      expect(corpo, nome).toMatch(/useFecharFora\(aberto, fechar, caixa, \{ foraFecha: false \}\)/)
    }
  })

  it('a caixa do Anotar tem um Fechar à vista', () => {
    const t = ler('pages/operacional/AnaliseCredito.tsx')
    const linha = t.split('\n').find((l) => l.includes('<CaixaDeAnotacao')) ?? ''
    expect(linha).toContain('onFechar={fechar}')
  })
})
