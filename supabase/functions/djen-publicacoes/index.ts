// Sincroniza as INTIMAÇÕES do DJEN (Comunica PJe) para o cache
// public.djen_publicacoes. Fonte ÚNICA: as OAB(s) cadastradas em
// integracoes.djen (cada uma como "numero/UF"). Janela: últimos `dias`
// (default 30). A página lê do banco; esta função roda em 2º plano.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, serviceClient } from '../_shared/auth.ts'

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchItems(url: string, tries = 3): Promise<Record<string, unknown>[]> {
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) return []
      const j = await res.json()
      return (j?.items ?? []) as Record<string, unknown>[]
    } catch (e) {
      if (a === tries) throw e
      await sleep(600 * a)
    }
  }
  return []
}

async function pmap<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<Record<string, unknown>[]>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      try {
        out.push(...(await fn(items[idx])))
      } catch {
        /* ignora falha pontual */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const caller = await getCaller(req)
    if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

    const svc = serviceClient()
    const { data: integ } = await svc
      .from('integracoes')
      .select('config')
      .eq('servico', 'djen')
      .maybeSingle()

    const cfg = (integ?.config ?? {}) as {
      oabs?: string[]
      dias_retroativos?: number
    }
    const oabs = (cfg.oabs ?? []).filter(Boolean)
    const dias = Number(cfg.dias_retroativos ?? 30)
    const fim = new Date().toISOString().slice(0, 10)
    const ini = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)

    const porId = new Map<string, Record<string, unknown>>()
    const add = (items: Record<string, unknown>[]) => {
      for (const it of items) if (it?.id != null) porId.set(String(it.id), it)
    }

    // Por OAB (paginado, mais recentes primeiro). Cap de páginas p/ não estourar.
    const MAX_PAGINAS = 12
    add(
      await pmap(oabs, 3, async (oab) => {
        const m = String(oab).match(/(\d+)\s*\/?\s*([A-Za-z]{2})?/)
        if (!m) return []
        const numero = m[1]
        const uf = m[2] ? `&ufOab=${m[2].toUpperCase()}` : ''
        const acc: Record<string, unknown>[] = []
        for (let pg = 1; pg <= MAX_PAGINAS; pg++) {
          const url =
            `${DJEN}?numeroOab=${numero}${uf}` +
            `&dataDisponibilizacaoInicio=${ini}&dataDisponibilizacaoFim=${fim}` +
            `&itensPorPagina=200&pagina=${pg}`
          const items = await fetchItems(url)
          acc.push(...items)
          if (items.length < 200) break
        }
        return acc
      }),
    )

    // Apenas intimações.
    const items = [...porId.values()].filter((it) =>
      String(it.tipoComunicacao ?? '')
        .toLowerCase()
        .includes('intima'),
    )

    const agora = new Date().toISOString()
    const rows = items
      .filter((it) => it.id != null)
      .map((it) => ({
        id: Number(it.id),
        data_disponibilizacao: (it.data_disponibilizacao as string) ?? null,
        numero_processo:
          (it.numeroprocessocommascara as string) ??
          (it.numero_processo as string) ??
          null,
        sigla_tribunal: (it.siglaTribunal as string) ?? null,
        tipo_comunicacao: (it.tipoComunicacao as string) ?? null,
        raw: it,
        sincronizado_em: agora,
      }))

    let gravados = 0
    const chunk = 500
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk)
      const { error } = await svc
        .from('djen_publicacoes')
        .upsert(slice, { onConflict: 'id' })
      if (error) throw new Error(error.message)
      gravados += slice.length
    }

    // Mantém o cache só com a janela atual (remove anteriores a `ini`).
    await svc.from('djen_publicacoes').delete().lt('data_disponibilizacao', ini)

    return jsonResponse({ ok: true, total: items.length, gravados })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
