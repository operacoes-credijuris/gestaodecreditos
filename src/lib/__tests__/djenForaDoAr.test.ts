/**
 * O DJEN FORA DO AR (09/10/2026): de 08/10 em diante o CNJ respondeu 503
 * "Sistema em manutencao" a toda consulta; nada novo chegava e a tela só soltava
 * um aviso que sumia. Agora a função diz o motivo e a tela mostra uma faixa fixa.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ler = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8')

describe('DJEN fora do ar', () => {
  it('a função reconhece a manutenção e a devolve no diagnóstico', () => {
    const f = ler('supabase/functions/djen-publicacoes/index.ts')
    expect(f).toContain('if (/manuten/i.test(corpo)) throw new Error(`DJEN em manutenção (HTTP ${res.status})`)')
    expect(f).toContain('djen_em_manutencao: falhas.some((f) => /manuten/i.test(f.erro)),')
  })
  it('a tela mostra a faixa fixa (manutenção, ou todas as OABs falharam) com a última captura', () => {
    const t = ler('src/pages/operacional/execucao/PublicacoesMovimentacoes.tsx')
    expect(t).toContain('return !!d.djen_em_manutencao || (oabs > 0 && d.buscas_falharam >= oabs)')
    // A faixa lê a última resposta do DJEN no cache das mutações, e não só a desta
    // montagem (revisão UX, 09/10/2026): com uma sincronização de outra montagem
    // em curso, esta não dispara outra, e o sync.data dela fica vazio.
    expect(t).toContain("filters: { mutationKey: [...SYNC_DJEN], status: 'success' },")
    expect(t).toContain('const djenFora = djenForaDoAr(diagnosticoDoDjen)')
    expect(t).toContain('{djenFora && (')
    expect(t).toContain('Última captura:')
    expect(t).toContain('if (djenForaDoAr(d)) return')
  })
})
