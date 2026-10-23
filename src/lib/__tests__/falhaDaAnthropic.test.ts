/**
 * A FALHA DA ANTHROPIC EM PORTUGUÊS (19/10/2026): com a conta sem créditos, a
 * análise de RPV mostrou o JSON cru em inglês. O tradutor diz o que é e o que fazer.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { falhaDaAnthropic, traduzirFalhaDaAnthropic } from '../../../supabase/functions/_shared/falhaDaAnthropic.ts'

// A MENSAGEM REAL da análise de RPV de 19/10/2026.
const SEM_CREDITO =
  'Falha ao gerar análise: Claude API (qualificação) 400: {"type":"error","error":{"type":"invalid_request_error",' +
  '"message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade ' +
  'or purchase credits."},"request_id":"req_011CgBiSkpM44p576TSUSy2Q"} (HTTP 500)'

describe('falhaDaAnthropic', () => {
  it('sem créditos: diz que é saldo e onde recarregar', () => {
    const f = falhaDaAnthropic(SEM_CREDITO)
    expect(f?.tipo).toBe('sem-credito')
    expect(f?.mensagem).toContain('sem créditos')
    expect(f?.mensagem).toContain('console.anthropic.com')
  })
  it('chave recusada, limite e sobrecarga', () => {
    expect(falhaDaAnthropic('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')?.tipo).toBe('chave')
    expect(falhaDaAnthropic('429 {"error":{"type":"rate_limit_error"}}')?.tipo).toBe('limite')
    expect(falhaDaAnthropic('529 {"error":{"type":"overloaded_error","message":"Overloaded"}}')?.tipo).toBe('sobrecarga')
  })
  it('o que não é da Anthropic fica como veio', () => {
    expect(falhaDaAnthropic('Kommo recusou a etiqueta (HTTP 400)')).toBeNull()
    expect(traduzirFalhaDaAnthropic('PDF ilegível')).toBe('PDF ilegível')
    expect(falhaDaAnthropic('')).toBeNull()
  })
  it('o limite e a recusa de OUTRO serviço não viram da Anthropic (23/10/2026)', () => {
    expect(falhaDaAnthropic('/movements/123 → cloudflare rate limit (após 6 tentativas)')).toBeNull()
    expect(falhaDaAnthropic('Server overloaded, try later')).toBeNull()
    expect(falhaDaAnthropic('BullAI: invalid api key')).toBeNull()
    expect(falhaDaAnthropic('Escavador: insufficient credits')).toBeNull()
  })
  it('o navegador e a justificativa usam o tradutor', () => {
    const fn = readFileSync(join(__dirname, '..', 'functions.ts'), 'utf8')
    expect(fn).toContain('const daAnthropic = falhaDaAnthropic(detalhe || error.message)')
    const jt = readFileSync(join(__dirname, '..', '..', '..', 'supabase/functions/justificativa-tecnica/index.ts'), 'utf8')
    expect(jt).toContain('const conhecida = falhaDaAnthropic((e as Error)?.message ?? String(e))')
  })
})

describe('a rotina dos autos e a conta sem créditos', () => {
  it('falha da conta é passageira e não gasta leitura do card', () => {
    const r = readFileSync(join(__dirname, '..', '..', '..', 'supabase/functions/escavador-autos-rotina/index.ts'), 'utf8')
    expect(r).toContain("if (falhaDaAnthropic(`${j?.error?.type ?? ''} ${j?.error?.message ?? ''}`)) {")
    expect(r).toContain('if (e instanceof FalhaDaLeitura && e.daConta) leituras = linha?.leituras ?? 0')
  })
})
