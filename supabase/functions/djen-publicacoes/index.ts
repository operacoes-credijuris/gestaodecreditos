// Sincroniza as INTIMAÇÕES do DJEN para o cache public.djen_publicacoes.
// Critério (interseção): publicações dos PROCESSOS CADASTRADOS
// (Créditos/Requerimentos/Apensos) que foram expedidas EM NOME das OAB(s)
// cadastradas em integracoes.djen. Janela: últimos `dias` (default 30).
// A página lê do banco; esta função roda em 2º plano.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, serviceClient } from '../_shared/auth.ts'

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
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
        /* ignora falha pontual de um processo */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// A publicação está em nome de alguma OAB cadastrada?
function temOabCadastrada(it: Record<string, unknown>, oabSet: Set<string>): boolean {
  if (oabSet.size === 0) return true // sem OAB cadastrada: não filtra por OAB
  const advs = it.destinatarioadvogados
  if (!Array.isArray(advs)) return false
  for (const a of advs) {
    const adv = (a as { advogado?: { numero_oab?: string; uf_oab?: string } })?.advogado
    if (!adv) continue
    const num = onlyDigits(adv.numero_oab)
    const uf = String(adv.uf_oab ?? '').toUpperCase()
    if (num && oabSet.has(`${num}/${uf}`)) return true
  }
  return false
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const caller = await getCaller(req)
    if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

    const svc = serviceClient()
    const [proc, ap, reqs, integ] = await Promise.all([
      svc.from('processos').select('numero_cnj'),
      svc.from('apensos').select('numero'),
      svc.from('requerimentos').select('numero_protocolo'),
      svc.from('integracoes').select('config').eq('servico', 'djen').maybeSingle(),
    ])

    const numeros = new Set<string>()
    for (const r of proc.data ?? []) {
      const d = onlyDigits((r as { numero_cnj?: string }).numero_cnj)
      if (d.length >= 15) numeros.add(d)
    }
    for (const r of ap.data ?? []) {
      const d = onlyDigits((r as { numero?: string }).numero)
      if (d.length >= 15) numeros.add(d)
    }
    for (const r of reqs.data ?? []) {
      const d = onlyDigits((r as { numero_protocolo?: string }).numero_protocolo)
      if (d.length >= 15) numeros.add(d)
    }

    const cfg = (integ.data?.config ?? {}) as {
      oabs?: string[]
      dias_retroativos?: number
    }
    // Conjunto de OABs cadastradas, normalizado como "numero/UF".
    const oabSet = new Set<string>()
    for (const o of cfg.oabs ?? []) {
      const m = String(o).match(/(\d+)\s*\/?\s*([A-Za-z]{2})/)
      if (m) oabSet.add(`${onlyDigits(m[1])}/${m[2].toUpperCase()}`)
    }
    const dias = Number(cfg.dias_retroativos ?? 30)
    const fim = new Date().toISOString().slice(0, 10)
    const ini = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
    const janela = `&dataDisponibilizacaoInicio=${ini}&dataDisponibilizacaoFim=${fim}`

    // Busca por número de processo (dos cadastros).
    const porId = new Map<string, Record<string, unknown>>()
    const fetched = await pmap([...numeros], 6, (n) =>
      fetchItems(`${DJEN}?numeroProcesso=${n}${janela}&itensPorPagina=200&pagina=1`),
    )
    for (const it of fetched) if (it?.id != null) porId.set(String(it.id), it)

    // Filtro: só intimações E em nome de uma OAB cadastrada.
    const items = [...porId.values()].filter(
      (it) =>
        String(it.tipoComunicacao ?? '')
          .toLowerCase()
          .includes('intima') && temOabCadastrada(it, oabSet),
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

    // Remove do cache o que saiu da janela de 30 dias.
    await svc.from('djen_publicacoes').delete().lt('data_disponibilizacao', ini)

    return jsonResponse({ ok: true, total: items.length, gravados })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
