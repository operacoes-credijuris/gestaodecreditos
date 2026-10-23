/**
 * VARREDURA E (23/10/2026) — gerar-analise-rpv e o levantamento de emolumentos.
 *
 * Correções que vivem dentro de módulos com `npm:` e rede (Anthropic, Storage),
 * conferidas pelo código, como em auditoriaServidorCodigo.test.ts. Cada
 * asserção falharia contra o código de antes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { estourouOTempo, tempoAteOTeto } from '../../../supabase/functions/_shared/relogioDaInvocacao'

const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', rel), 'utf8').replace(/\r\n/g, '\n')

describe('gerar-analise-rpv: as leituras da IA têm teto de tempo', () => {
  const f = ler('gerar-analise-rpv/index.ts')

  it('a chamada leva o sinal contado do começo da invocação', () => {
    expect(f).toContain('signal: sinalAteOTeto(o.inicio, { folgaMs: 12_000 }),')
    expect(f).toContain('inicio: number;')
  })

  it('as quatro leituras recebem o _t0 do handler', () => {
    expect(f).toContain('await extrairDocumento(cfg.anthropic_api_key, contentBlocks, _t0)')
    expect(f).toContain("await extrairQualificacao(cfg.anthropic_api_key, contentBlocks, _t0, String(body.cedente ?? ''))")
    expect(f).toContain('await extrairPreco(cfg.anthropic_api_key, contentBlocks, _t0)')
    expect(f).toContain('await extrairValoresDeResgate(cfg.anthropic_api_key, contentBlocks, _t0)')
    // Nenhuma chamada sobrou sem o relógio.
    expect(f).not.toMatch(/extrair(Preco|Documento|ValoresDeResgate)\(cfg\.anthropic_api_key, contentBlocks\)/)
  })

  it('o estouro vira mensagem dita, e o retry não repete um sinal vencido', () => {
    expect(f).toContain('não terminou dentro do tempo da função (cerca de 150 s) e foi interrompida')
    expect(f).toMatch(/catch \(e\) \{\n\s+\/\/ O TETO DA INVOCAÇÃO NÃO SE REPETE[\s\S]{0,200}if \(estourouOTempo\(e\)\) throw e;/)
  })

  it('o teto deixa folga para o catch limpar as páginas subidas', () => {
    // Leitura que começa aos 100 s: sobram 38 s até a folga de 12 s.
    expect(tempoAteOTeto(0, 100_000, { folgaMs: 12_000 })).toBe(38_000)
    // Já passou da folga: o mínimo de 5 s, e não um número negativo.
    expect(tempoAteOTeto(0, 145_000, { folgaMs: 12_000 })).toBe(5_000)
    expect(estourouOTempo({ name: 'TimeoutError' })).toBe(true)
    expect(estourouOTempo(new Error('Claude API 500'))).toBe(false)
  })
})

describe('emolumentos: resposta cortada ou recusada não vira tabela', () => {
  const f = ler('_shared/emolumentos.ts')

  it('max_tokens e refusal devolvem só a observação, antes de ler o tool_use', () => {
    const corte = f.indexOf("resposta.stop_reason === 'max_tokens'")
    const leitura = f.indexOf("const uso = resposta.content.find((c) => c.type === 'tool_use' && c.name === ferramenta.name)")
    expect(corte).toBeGreaterThan(0)
    expect(leitura).toBeGreaterThan(corte)
    expect(f).toContain("resposta.stop_reason === 'refusal'")
    expect(f).toContain('if (motivoDaParada) return { observacao: motivoDaParada }')
  })
})
