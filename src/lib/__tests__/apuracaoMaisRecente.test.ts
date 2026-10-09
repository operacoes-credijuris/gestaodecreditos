// Qual apuração do papel preenche os campos do painel de processos judiciais
// (src/lib/apuracaoMaisRecente.ts).
//
// AUDITORIA DE 09/10/2026: corrigido o titular, a linha antiga fica ao lado da
// nova, e o painel preenchia o CPF com a primeira que o banco devolvesse —
// muitas vezes a do titular errado, sobre quem o "Reapurar" pagava a busca.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apuracaoMaisRecente } from '@/lib/apuracaoMaisRecente'

describe('apuracaoMaisRecente', () => {
  const antiga = { papel: 'CEDENTE', documento: '111', apurado_em: '2026-09-01T10:00:00Z' }
  const nova = { papel: 'CEDENTE', documento: '222', apurado_em: '2026-10-01T10:00:00Z' }
  const adv = { papel: 'ADVOGADO', documento: '333', apurado_em: '2026-10-05T10:00:00Z' }

  it('a apurada por último vale, venha em que ordem vier', () => {
    expect(apuracaoMaisRecente([antiga, nova, adv], 'CEDENTE')).toBe(nova)
    expect(apuracaoMaisRecente([nova, antiga, adv], 'CEDENTE')).toBe(nova)
    expect(apuracaoMaisRecente([antiga, nova, adv], 'ADVOGADO')).toBe(adv)
  })

  it('sem data perde para a datada; entre duas sem data, fica a que veio depois', () => {
    const semData = { papel: 'CEDENTE', documento: '444', apurado_em: null }
    expect(apuracaoMaisRecente([semData, antiga], 'CEDENTE')).toBe(antiga)
    expect(apuracaoMaisRecente([antiga, semData], 'CEDENTE')).toBe(antiga)
    const outra = { papel: 'CEDENTE', documento: '555' }
    expect(apuracaoMaisRecente([semData, outra], 'CEDENTE')).toBe(outra)
    expect(apuracaoMaisRecente([], 'CEDENTE')).toBeUndefined()
  })

  it('o painel preenche os campos por ela', () => {
    const t = readFileSync(join(__dirname, '..', '..', 'components/PainelProcessosJudiciais.tsx'), 'utf8')
    expect(t).toContain("const cedente = apuracaoMaisRecente(apuracoes, 'CEDENTE')")
    expect(t).toContain("const advogado = apuracaoMaisRecente(apuracoes, 'ADVOGADO')")
    expect(t).not.toContain("apuracoes.find((a) => a.papel === 'CEDENTE')")
  })
})
