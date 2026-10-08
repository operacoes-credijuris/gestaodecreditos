/**
 * O LIMITE DE TAXA DO KOMMO (08/10/2026): a etiqueta que "às vezes não vai" era
 * a função desistindo no primeiro 429. Agora ela espera e tenta de novo — e só
 * repete depois de 5xx/rede o que é idempotente.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { esperaAntesDaTentativa, kommoFetch } from '../../../supabase/functions/_shared/kommoFetch.ts'

const resposta = (status: number, h: Record<string, string> = {}) => new Response(status === 204 ? null : '{}', { status, headers: h })
function falso(seq: (number | 'rede')[]) {
  const chamadas: string[] = []
  const esperas: number[] = []
  let i = 0
  const f = (async (_u: string, init?: RequestInit) => {
    chamadas.push(init?.method ?? 'GET')
    const s = seq[Math.min(i++, seq.length - 1)]
    if (s === 'rede') throw new TypeError('rede')
    return resposta(s)
  }) as typeof fetch
  return { f, chamadas, esperas, esperar: async (ms: number) => void esperas.push(ms) }
}

describe('kommoFetch', () => {
  it('429 repete, em qualquer método, e devolve a resposta boa', async () => {
    const x = falso([429, 429, 200])
    const r = await kommoFetch('u', { method: 'POST' }, { fetch: x.f, esperar: x.esperar })
    expect(r.status).toBe(200)
    expect(x.chamadas).toEqual(['POST', 'POST', 'POST'])
    expect(x.esperas).toEqual([1000, 2000])
  })

  it('respeita o Retry-After (até 5 s)', () => {
    expect(esperaAntesDaTentativa(1, '2')).toBe(2000)
    expect(esperaAntesDaTentativa(1, '60')).toBe(5000)
    expect(esperaAntesDaTentativa(2, null)).toBe(2000)
  })

  it('5xx: repete o GET e o PATCH idempotente; NÃO repete o POST da nota (pode ter gravado)', async () => {
    const get = falso([502, 200])
    expect((await kommoFetch('u', {}, { fetch: get.f, esperar: get.esperar })).status).toBe(200)
    const patch = falso([503, 200])
    expect((await kommoFetch('u', { method: 'PATCH' }, { idempotente: true, fetch: patch.f, esperar: patch.esperar })).status).toBe(200)
    const post = falso([502, 200])
    expect((await kommoFetch('u', { method: 'POST' }, { fetch: post.f, esperar: post.esperar })).status).toBe(502)
    expect(post.chamadas).toHaveLength(1)
  })

  it('falha de rede: repete o idempotente; lança no POST', async () => {
    const get = falso(['rede', 200])
    expect((await kommoFetch('u', {}, { fetch: get.f, esperar: get.esperar })).status).toBe(200)
    const post = falso(['rede', 200])
    await expect(kommoFetch('u', { method: 'POST' }, { fetch: post.f, esperar: post.esperar })).rejects.toThrow('rede')
  })

  it('no máximo 3 tentativas: devolve o último 429 para a função contar o motivo', async () => {
    const x = falso([429])
    expect((await kommoFetch('u', {}, { fetch: x.f, esperar: x.esperar })).status).toBe(429)
    expect(x.chamadas).toHaveLength(3)
  })

  it('4xx de validação (400) não se repete', async () => {
    const x = falso([400, 200])
    expect((await kommoFetch('u', { method: 'PATCH' }, { idempotente: true, fetch: x.f, esperar: x.esperar })).status).toBe(400)
    expect(x.chamadas).toHaveLength(1)
  })
})

describe('as funções do Kommo usam o kommoFetch', () => {
  const ler = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8')
  it('etiquetar, mover, anotar e anexar não chamam o Kommo com fetch cru', () => {
    for (const f of [
      'supabase/functions/kommo-etiquetar/index.ts',
      'supabase/functions/kommo-mover/index.ts',
      'supabase/functions/_shared/anotarNoKommo.ts',
    ]) {
      expect(ler(f), f).not.toMatch(/await fetch\(`\$\{base\}|await fetch\(`https:\/\/\$\{conta/)
      expect(ler(f), f).toContain('kommoFetch(')
    }
  })

  it('a etiqueta sai pelo id que o Kommo devolve (o "&amp;" não atrapalha)', () => {
    const f = ler('supabase/functions/kommo-etiquetar/index.ts')
    expect(f).toContain('idDaEtiqueta.has(name) ? { id: idDaEtiqueta.get(name)! } : { name }')
  })
})
