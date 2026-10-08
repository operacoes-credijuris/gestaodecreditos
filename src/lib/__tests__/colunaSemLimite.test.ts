/**
 * A COLUNA MOSTRA TODOS OS CARDS (08/10/2026, pedido do dono): o "Mostrar mais"
 * de 8 em 8 obrigava quem vai e volta entre as colunas a apertar o botão de novo.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('a coluna da Análise de crédito sem limite de cards', () => {
  it('lista todos os filtrados, sem "Mostrar mais"', () => {
    const t = readFileSync(join(__dirname, '..', '..', 'pages/operacional/AnaliseCredito.tsx'), 'utf8')
    expect(t).toContain('{filtrados.map((l) => (')
    expect(t).not.toContain('Mostrar mais {')
    expect(t).not.toMatch(/filtrados\.slice\(0,/)
  })
})
