/**
 * O "HOJE" DAS EDGE FUNCTIONS EM BRASÍLIA (auditoria de bugs, 09/10/2026).
 *
 * `new Date().toISOString().slice(0, 10)` é o dia em UTC: das 21h às 24h de
 * Brasília ele já é amanhã. A fase reclassificada às 22h entrava com a data do
 * dia seguinte, a certidão obtida à noite nascia emitida amanhã e vencia um dia
 * depois, e a regra de certidão que começa amanhã já valia hoje à noite.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diaEmBrasilia, hojeEmBrasilia, somarDiasAoDia } from '../../../supabase/functions/_shared/dataDeBrasilia'

const ler = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8')

describe('dataDeBrasilia', () => {
  it('às 22h de Brasília (01h UTC do dia seguinte) o dia ainda é o de Brasília', () => {
    const noite = new Date('2026-10-10T01:00:00Z') // 09/10, 22h em Brasília
    expect(noite.toISOString().slice(0, 10)).toBe('2026-10-10') // o defeito
    expect(hojeEmBrasilia(noite)).toBe('2026-10-09')
    expect(diaEmBrasilia(noite.getTime())).toBe('2026-10-09')
  })
  it('de dia, UTC e Brasília concordam', () => {
    expect(hojeEmBrasilia(new Date('2026-10-09T15:00:00Z'))).toBe('2026-10-09')
  })
  it('a validade soma dias de calendário a partir do dia de Brasília', () => {
    expect(somarDiasAoDia('2026-10-09', 30)).toBe('2026-11-08')
    expect(somarDiasAoDia('2026-12-31', 1)).toBe('2027-01-01')
    expect(somarDiasAoDia('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('as funções que gravam o "hoje" de negócio não usam mais o dia em UTC', () => {
    for (const f of [
      'supabase/functions/fase-processual/index.ts',
      'supabase/functions/gerar-checklist-certidoes/index.ts',
      'supabase/functions/bullai-certidoes/index.ts',
      'supabase/functions/assistente/index.ts',
    ]) {
      const src = ler(f)
      expect(src, f).not.toContain('new Date().toISOString().slice(0, 10)')
      expect(src, f).toContain('hojeEmBrasilia()')
    }
  })
})
