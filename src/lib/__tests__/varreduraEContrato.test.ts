/**
 * VARREDURA E (23/10/2026) — contratos, checklist de certidões e a pasta do
 * cedente. As correções vivem dentro do `index.ts` das funções e no módulo de
 * Drive (que importa o SDK do Supabase), então são conferidas pelo código. Cada
 * asserção falharia contra o código de antes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', rel), 'utf8').replace(/\r\n/g, '\n')

describe('_shared/credijuris.ts — Drive', () => {
  const f = ler('_shared/credijuris.ts')

  it('escapa a barra invertida antes do apóstrofo', () => {
    expect(f).toContain(`return s.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'")`)
    // A regra, reproduzida aqui (o módulo não carrega no Node): barra primeiro.
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    expect(esc("D'Ávila \\ Souza")).toBe("D\\'Ávila \\\\ Souza")
    expect(esc('termina em \\')).toBe('termina em \\\\')
  })

  it('driveListFiles segue o nextPageToken, com limite de páginas', () => {
    expect(f).toContain("fields: 'nextPageToken,files(id,name,mimeType,parents)'")
    expect(f).toContain("if (pageToken) params.set('pageToken', pageToken)")
    expect(f).toContain('for (let pagina = 0; pagina < PAGINAS_MAX_DO_DRIVE; pagina++)')
  })
})

describe('gerar-contrato', () => {
  const f = ler('gerar-contrato/index.ts')

  it('a leitura da IA tem teto contado do início, e a recusa não vira "JSON inválido"', () => {
    expect(f).toContain('signal: sinalAteOTeto(inicio, { folgaMs: FOLGA_PARA_O_DRIVE_MS }),')
    expect(f).toContain("if (data?.stop_reason === 'refusal') {")
    expect(f).toContain('if (estourouOTempo(e)) {')
    expect(f).toContain('{ gravado: false },')
  })

  it('os fixos e os extras da apresentação vão juntos ao Opus', () => {
    expect(f).toMatch(/const \[fixos, extrasOut\] = await Promise\.all\(\[/)
    expect(f).not.toContain('const fixos = await callClaude(')
  })

  it('a busca pelo nº do processo lista em lotes e desiste no orçamento', () => {
    expect(f).toContain('const limite = Date.now() + ORCAMENTO_DA_BUSCA_MS;')
    expect(f).toContain('const lote = fila.splice(0, Math.min(LOTE_DA_BUSCA, 200 - visitadas));')
    expect(f).not.toContain('const { pasta, caminho } = fila.shift()!;')
  })

  it('a pasta do originador em B. Processos é achada-ou-criada', () => {
    expect(f).toContain('interId = await driveFindOrCreateFolder(accessToken, originadorNome, driveDebug.categoria_rpv_id);')
    expect(f).not.toContain('await driveCreateFolder(')
  })
})

describe('gerar-checklist-certidoes', () => {
  const f = ler('gerar-checklist-certidoes/index.ts')
  it('falha de leitura do catálogo, das regras e do card para a geração', () => {
    expect(f).toContain('if (erroCat || erroReg) {')
    expect(f).toContain('if (erroLead) return json(')
  })
})

describe('pasta-do-cedente', () => {
  it('falha ao ler o funil não cria pasta no precatório externo', () => {
    const f = ler('pasta-do-cedente/index.ts')
    expect(f).toContain('if (erroCard) return jsonResponse(')
  })
})
