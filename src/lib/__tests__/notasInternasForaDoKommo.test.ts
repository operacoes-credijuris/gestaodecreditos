/**
 * AS NOTAS INTERNAS DA JUSTIFICATIVA NÃO VÃO AO KOMMO (decisão do dono,
 * 07/10/2026). O texto depois de `###NOTAS###` fica só na plataforma (no
 * `texto_enviado`); a nota do card leva o parágrafo e a lista de fontes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  dividirNota,
  juntarNotas,
  separarNotas,
} from '../../../supabase/functions/_shared/justificativaTecnica.ts'

describe('notas internas fora do Kommo', () => {
  it('o que vai ao card é só o corpo (parágrafo + fontes)', () => {
    const texto = juntarNotas('Justificativa técnica: o crédito… [1]\n\nFontes:\n[1] https://exemplo.gov.br', 'Não confirmei a LOA.')
    const partes = dividirNota(separarNotas(texto).corpo)
    const junto = partes.join('\n')
    expect(junto).toContain('Justificativa técnica:')
    expect(junto).toContain('[1] https://exemplo.gov.br')
    expect(junto).not.toContain('###NOTAS###')
    expect(junto).not.toContain('Não confirmei a LOA.')
  })

  it('a função de envio manda ao Kommo só o corpo, e grava o texto inteiro na plataforma', () => {
    const f = readFileSync(join(__dirname, '..', '..', '..', 'supabase/functions/justificativa-tecnica/index.ts'), 'utf8')
    expect(f).toMatch(/const partes = dividirNota\(separarNotas\(texto\)\.corpo\)/)
    expect(f).toMatch(/texto_enviado: texto,/)
  })
})
