/**
 * O CARD DE CONCLUSOS (21/10/2026): a conclusão recente não entrava porque a
 * varredura diária só olhava quem teve andamento nos últimos 3 dias (pela data
 * do andamento), o cron diário não existia e a leitura dos andamentos parava em
 * 1000 linhas. Agora: carteira inteira, o hash decide quem vai ao modelo,
 * leituras paginadas e trava de tempo.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const f = readFileSync(join(__dirname, '..', '..', '..', 'supabase/functions/fase-processual/index.ts'), 'utf8')

describe('fase-processual — varredura', () => {
  it('o lote é a carteira inteira, e o hash decide quem vai ao modelo', () => {
    expect(f).toContain('lote = candidatos.map((p) => p.id)')
    expect(f).toContain('if (!forcar && atual?.fonte_hash === fonte) {')
    expect(f).not.toContain('JANELA_RECENTE_DIAS')
  })
  it('as leituras são paginadas (sem o corte de 1000 linhas)', () => {
    expect(f).toContain("await lerTodasAsLinhas<MovRow>((de, ate) =>")
    expect(f).toContain("svc.from('processos').select('id, numero_cnj').in('status', ['ativo', 'complementar']).order('id').range(de, ate)")
  })
  it('para com folga antes do teto do servidor e conta os adiados', () => {
    expect(f).toContain('if (Date.now() - inicio > ORCAMENTO_MS) {')
    expect(f).toMatch(/\badiados,\r?\n/)
  })
})
