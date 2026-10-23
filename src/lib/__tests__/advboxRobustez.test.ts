/**
 * ROBUSTEZ DAS SINCRONIZAÇÕES DO ADVBOX (23/10/2026).
 *
 * Quatro defeitos que derrubavam a cadeia ou apagavam histórico real:
 *   1. status com o mesmo número duas vezes no lote → upsert recusado inteiro,
 *      a função lançava antes de encadear e a cadeia morria em toda passada;
 *   2. 4xx definitivo (400/401/404) repetido 6 vezes pelo getJson — ~15 s por
 *      chamada, comendo o teto de 150 s da Edge Function;
 *   3. cadastro lido sem paginar (corte de 1000 linhas do PostgREST) e a poda
 *      apagando o histórico de quem ficou de fora;
 *   4. poda com `not in (lista inteira)` numa URL só — passadas algumas centenas
 *      de ids, 500 e a sincronização morria antes de começar.
 * Mais: advbox-processos dizendo "ok" com o vínculo não gravado.
 *
 * A lógica pura (podaSegura.ts) é exercitada; o que mora no `index.ts` (Deno,
 * `npm:`) é conferido pelo código. Cada asserção falharia contra o de antes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  apagarEmFatias,
  colunaDaLeitura,
  idsAApagar,
  lerCadastro,
  POR_FATIA_DA_PODA,
  statusUnicoPorNumero,
} from '../../../supabase/functions/advbox-movimentacoes/podaSegura'

const ler = (rel: string) =>
  readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'functions', rel), 'utf8').replace(
    /\r\n/g,
    '\n',
  )

describe('status por número: uma linha por chave antes do upsert', () => {
  const st = (numero: string, lid: string, data: string | null) => ({
    numero_processo: numero,
    advbox_lawsuit_id: lid,
    ultima_movimentacao: data,
    sincronizado_em: '2026-10-23T00:00:00Z',
  })

  it('dois lawsuits com o mesmo número viram UMA linha, a de data mais recente', () => {
    const r = statusUnicoPorNumero([
      st('0001', 'A', '2026-09-01'),
      st('0002', 'B', '2026-08-01'),
      st('0001', 'C', '2026-10-01'),
    ])
    expect(r).toHaveLength(2)
    expect(r.find((x) => x.numero_processo === '0001')?.advbox_lawsuit_id).toBe('C')
  })

  it('a mais recente vence mesmo quando vem primeiro', () => {
    const r = statusUnicoPorNumero([st('1', 'A', '2026-10-01'), st('1', 'B', '2026-09-01')])
    expect(r).toEqual([st('1', 'A', '2026-10-01')])
  })

  it('com data vence sem data, em qualquer ordem', () => {
    expect(statusUnicoPorNumero([st('1', 'A', null), st('1', 'B', '2026-01-01')])[0].advbox_lawsuit_id).toBe('B')
    expect(statusUnicoPorNumero([st('1', 'A', '2026-01-01'), st('1', 'B', null)])[0].advbox_lawsuit_id).toBe('A')
  })

  it('empate (mesma data, ou as duas sem data): fica a última lida', () => {
    expect(statusUnicoPorNumero([st('1', 'A', '2026-01-01'), st('1', 'B', '2026-01-01')])[0].advbox_lawsuit_id).toBe('B')
    expect(statusUnicoPorNumero([st('1', 'A', null), st('1', 'B', null)])[0].advbox_lawsuit_id).toBe('B')
  })

  it('a função usa a deduplicação antes do upsert do status', () => {
    const f = ler('advbox-movimentacoes/index.ts')
    expect(f).toContain('const statusRows = statusUnicoPorNumero(')
    expect(f.indexOf('const statusRows = statusUnicoPorNumero(')).toBeLessThan(
      f.indexOf(".upsert(statusRows, { onConflict: 'numero_processo' })"),
    )
  })
})

describe('cadastro lido inteiro, e a poda só com ele inteiro', () => {
  /** Uma tabela falsa paginada pelo `range` (de/ate inclusivos, como o PostgREST). */
  const tabela = (linhas: Record<string, unknown>[]) => (de: number, ate: number) =>
    Promise.resolve({ data: linhas.slice(de, ate + 1), error: null })

  const numeros = (n: number, prefixo: string) =>
    Array.from({ length: n }, (_, i) => `${prefixo}${String(i).padStart(14, '0')}`)

  it('lê além das 1000 linhas do corte do PostgREST, nas três tabelas', async () => {
    const proc = numeros(2500, '1').map((numero_cnj) => ({ numero_cnj }))
    const ap = numeros(1200, '2').map((numero) => ({ numero }))
    const req = numeros(3, '3').map((numero_protocolo) => ({ numero_protocolo }))
    const fontes: Record<string, (de: number, ate: number) => Promise<{ data: Record<string, unknown>[]; error: null }>> = {
      processos: tabela(proc),
      apensos: tabela(ap),
      requerimentos: tabela(req),
    }
    const c = await lerCadastro((t, _coluna, de, ate) => fontes[t](de, ate))
    expect(c.numeros.size).toBe(2500 + 1200 + 3)
    expect(c.completo).toBe(true)
    expect(c.motivo).toBeNull()
  })

  it('ignora número curto e normaliza para dígitos', async () => {
    const c = await lerCadastro((t, coluna, de, ate) =>
      tabela(t === 'processos' ? [{ [coluna]: '0001234-56.2020.8.26.0100' }, { [coluna]: '123' }] : [])(de, ate),
    )
    expect([...c.numeros]).toEqual(['00012345620208260100'])
  })

  it('erro de leitura LANÇA (não vira conjunto vazio que apagaria tudo)', async () => {
    await expect(
      lerCadastro((t, _c, de, ate) =>
        t === 'apensos'
          ? Promise.resolve({ data: null, error: { message: 'statement timeout' } })
          : tabela([])(de, ate),
      ),
    ).rejects.toThrow(/cadastro \(apensos\): statement timeout/)
  })

  it('leitura CORTADA no teto de páginas: segue, mas marca incompleto', async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => ({ numero_cnj: `9${String(i).padStart(14, '0')}` }))
    const c = await lerCadastro((t, _c, de, ate) =>
      t === 'processos' ? Promise.resolve({ data: cheia, error: null }) : tabela([])(de, ate),
    )
    expect(c.completo).toBe(false)
    expect(c.motivo).toMatch(/processos/)
  })

  it('as duas funções leem o cadastro paginado, com ordem estável, e não podam com ele incompleto', () => {
    for (const fn of ['advbox-movimentacoes/index.ts', 'advbox-tarefas/index.ts']) {
      const f = ler(fn)
      expect(f).toContain('return await lerCadastro((tabela, coluna, de, ate) =>')
      expect(f).toContain(".order('id').range(de, ate)")
      expect(f).not.toContain("svc.from('processos').select('numero_cnj'),")
      expect(f).toContain('!cadastro.completo')
    }
  })
})

describe('o que a poda apaga é calculado em código', () => {
  const leitura = (linhas: (string | null)[], extra: { erro?: string; cortada?: boolean } = {}) => ({
    linhas,
    erro: extra.erro ?? null,
    cortada: extra.cortada ?? false,
  })

  it('apaga só o que está no cache e saiu do conjunto, uma vez cada', () => {
    expect(idsAApagar(leitura(['1', '2', '2', '3', '4']), new Set(['1', '3']))).toEqual(['2', '4'])
  })

  it('nulo e vazio nunca são apagados (como no NOT IN de antes)', () => {
    expect(idsAApagar(leitura([null, '', '9']), new Set(['1']))).toEqual(['9'])
  })

  it('leitura do cache com erro ou cortada → nada a apagar', () => {
    expect(idsAApagar(leitura(['2'], { erro: 'timeout' }), new Set(['1']))).toEqual([])
    expect(idsAApagar(leitura(['2'], { cortada: true }), new Set(['1']))).toEqual([])
  })

  it('conjunto a manter vazio → nada a apagar (vazio é defeito de leitura)', () => {
    expect(idsAApagar(leitura(['1', '2']), new Set())).toEqual([])
  })

  it('colunaDaLeitura preserva erro e corte', () => {
    const r = colunaDaLeitura({ linhas: [{ a: 1 }, { a: null }], erro: 'x', cortada: true }, 'a')
    expect(r).toEqual({ linhas: ['1', null], erro: 'x', cortada: true })
  })
})

describe('DELETE em fatias', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `L${i}`)

  it(`fatias de no máximo ${POR_FATIA_DA_PODA}, cobrindo todos os ids`, async () => {
    const fatias: string[][] = []
    const r = await apagarEmFatias(ids, (f) => {
      fatias.push(f)
      return Promise.resolve({ error: null })
    })
    expect(POR_FATIA_DA_PODA).toBe(150)
    expect(fatias.map((f) => f.length)).toEqual([150, 150, 100])
    expect(fatias.flat()).toEqual(ids)
    expect(r).toEqual({ apagados: 400, erro: null })
  })

  it('para no primeiro erro e o devolve', async () => {
    let chamadas = 0
    const r = await apagarEmFatias(ids, () => {
      chamadas++
      return Promise.resolve({ error: chamadas === 2 ? { message: 'URI too long' } : null })
    })
    expect(chamadas).toBe(2)
    expect(r).toEqual({ apagados: 150, erro: 'URI too long' })
  })

  it('nada a apagar → nenhuma chamada', async () => {
    let chamadas = 0
    await apagarEmFatias([], () => {
      chamadas++
      return Promise.resolve({ error: null })
    })
    expect(chamadas).toBe(0)
  })

  it('advbox-movimentacoes: sem `not in` de lista inteira; `in` positivo em fatias', () => {
    const f = ler('advbox-movimentacoes/index.ts')
    expect(f).not.toContain(".not('advbox_lawsuit_id', 'in'")
    expect(f).not.toContain(".not('numero_processo', 'in'")
    expect(f).toContain("svc.from('advbox_movimentacoes').delete().in('advbox_lawsuit_id', fatia)")
    expect(f).toContain("svc.from('advbox_processo_status').delete().in('numero_processo', fatia)")
  })

  it('advbox-tarefas: poda global em fatias, e erro de poda não derruba a sincronização', () => {
    const f = ler('advbox-tarefas/index.ts')
    expect(f).not.toContain(".not('advbox_lawsuit_id', 'in', listaIn(fila.map((f) => f.lid)))")
    expect(f).toContain("svc.from('advbox_tarefas').delete().in('advbox_lawsuit_id', fatia)")
    expect(f).toContain("if (erro) console.error('falha ao podar advbox_tarefas:', erro)")
  })
})

describe('getJson: 4xx definitivo não é repetido', () => {
  const f = ler('_shared/advbox.ts')
  const corpo = f.slice(f.indexOf('export async function getJson('), f.indexOf('export async function enviarJson('))

  it('só 429/403/408/5xx são temporários', () => {
    expect(f).toContain(
      'return status === 429 || status === 403 || status === 408 || status >= 500',
    )
    expect(corpo).toContain('if (falhaTemporaria(res.status)) {')
  })

  it('o throw do status não-OK fica FORA do try (o catch de rede não o repete)', () => {
    // O antigo: `if (!res.ok) throw new Error(`HTTP ${res.status}`)` dentro do try.
    expect(corpo).not.toContain('if (!res.ok) throw new Error(`HTTP ${res.status}`)')
    const fimDoTryDeRede = corpo.indexOf('} catch (e) {')
    const naoOk = corpo.indexOf('if (!res.ok) {')
    expect(fimDoTryDeRede).toBeGreaterThan(0)
    expect(naoOk).toBeGreaterThan(fimDoTryDeRede)
    // E a mensagem leva o status e um trecho do corpo.
    expect(corpo).toContain("throw new Error(`${path} → HTTP ${res.status}${trecho ? ` — ${trecho}` : ''}`)")
  })

  it('a paginação continua pelo paginarAdvbox', () => {
    expect(f).toContain('return paginarAdvbox(')
  })
})

describe('advbox-processos: vínculo com processo já existente', () => {
  it('erro ao gravar o vínculo é lançado, não respondido como ok', () => {
    const f = ler('advbox-processos/index.ts')
    expect(f).toContain('const { error: erroVinculo } = await svc')
    expect(f).toContain('if (erroVinculo) {')
    expect(f.indexOf('if (erroVinculo) {')).toBeLessThan(
      f.indexOf('return jsonResponse({ ok: true, ja_existia: true, lawsuit_id: existente.id })'),
    )
  })
})
