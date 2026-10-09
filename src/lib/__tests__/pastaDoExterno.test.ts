/**
 * NO PRECATÓRIO EXTERNO NÃO SE CRIA PASTA NO "EXECUTAR ANÁLISE" (decisão do dono,
 * 06/10/2026). A pasta do Externo só nasce quando a BullAI emite certidão. A
 * guarda vale nas duas pontas: na tela e na `pasta-do-cedente`, que é chamada
 * também por abas abertas antes da mudança.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ehCardExterno, FUNIL_PRECATORIO_EXTERNO, FUNIL_PRECATORIO_INTERNO, FUNIL_RPV } from '../kommo'

const raiz = join(__dirname, '..', '..', '..')
const ler = (arq: string) => readFileSync(join(raiz, arq), 'utf8')

describe('pasta do Drive no Precatório Externo', () => {
  it('a tela não pede a pasta para card do Externo', () => {
    const tela = ler('src/pages/operacional/AnaliseCredito.tsx')
    const corpo = tela.slice(tela.indexOf('async function criarPastaDoCard'), tela.indexOf("invokeFunction<{ pasta_id?: string }>('pasta-do-cedente'"))
    expect(corpo).toMatch(/if \(ehCardExterno\(Number\(lead\.pipeline_id\)\)\) return/)
  })

  it('a função recusa o Externo com resposta neutra, antes de criar qualquer pasta', () => {
    const f = ler('supabase/functions/pasta-do-cedente/index.ts')
    const guarda = f.indexOf("ignorado: 'precatorio-externo'")
    expect(guarda).toBeGreaterThan(0)
    // A criação passou a ser pela pasta do card (auditoria de bugs, 09/10/2026).
    expect(guarda).toBeLessThan(f.indexOf('await pastaDaAnaliseDoCard('))
    expect(f).toContain(String(FUNIL_PRECATORIO_EXTERNO))
  })

  it('só o funil Externo é Externo', () => {
    expect(ehCardExterno(FUNIL_PRECATORIO_EXTERNO)).toBe(true)
    expect(ehCardExterno(FUNIL_PRECATORIO_INTERNO)).toBe(false)
    expect(ehCardExterno(FUNIL_RPV)).toBe(false)
  })
})
