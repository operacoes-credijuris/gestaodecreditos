// Consulta as publicações no DJEN (Comunica PJe — endpoint público) conforme
// os parâmetros configurados (OABs, números de processo, tribunais, janela)
// e grava os novos registros em public.publicacoes.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, serviceClient } from '../_shared/auth.ts'

const DJEN_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'

interface DjenItem {
  id?: number | string
  data_disponibilizacao?: string
  siglaTribunal?: string
  texto?: string
  numero_processo?: string
  numeroprocessocommascara?: string
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function buscar(params: Record<string, string>): Promise<DjenItem[]> {
  const qs = new URLSearchParams(params)
  const res = await fetch(`${DJEN_BASE}?${qs.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return []
  const json = await res.json().catch(() => null)
  return (json?.items ?? json?.content ?? []) as DjenItem[]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCaller(req)
    if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

    const { data: integ } = await svc
      .from('integracoes')
      .select('config')
      .eq('servico', 'djen')
      .maybeSingle()
    const cfg = (integ?.config ?? {}) as {
      oabs?: string[]
      numeros_processo?: string[]
      tribunais?: string[]
      dias_retroativos?: number
    }

    const dias = Number(cfg.dias_retroativos ?? 7)
    const fim = new Date()
    const inicio = new Date()
    inicio.setDate(inicio.getDate() - dias)
    const periodo = {
      dataDisponibilizacaoInicio: ymd(inicio),
      dataDisponibilizacaoFim: ymd(fim),
      itensPorPagina: '100',
      pagina: '1',
    }

    const oabs = cfg.oabs ?? []
    const numeros = cfg.numeros_processo ?? []
    if (oabs.length === 0 && numeros.length === 0) {
      return jsonResponse({
        ok: true,
        inseridos: 0,
        mensagem:
          'Configure ao menos uma OAB ou número de processo para o DJEN em Configurações.',
      })
    }

    const coletados: DjenItem[] = []

    // Consulta por OAB (formato "12345/SP").
    for (const oab of oabs) {
      const m = oab.match(/(\d+)\s*\/?\s*([A-Za-z]{2})?/)
      if (!m) continue
      const params: Record<string, string> = { ...periodo, numeroOab: m[1] }
      if (m[2]) params.ufOab = m[2].toUpperCase()
      coletados.push(...(await buscar(params)))
    }

    // Consulta por número de processo.
    for (const np of numeros) {
      const digits = np.replace(/\D/g, '')
      if (!digits) continue
      coletados.push(...(await buscar({ ...periodo, numeroProcesso: digits })))
    }

    // Filtra por tribunal (se configurado) e deduplica por id.
    const tribunais = (cfg.tribunais ?? []).map((t) => t.toUpperCase())
    const porId = new Map<string, DjenItem>()
    for (const it of coletados) {
      if (it.id == null) continue
      if (tribunais.length && it.siglaTribunal && !tribunais.includes(it.siglaTribunal.toUpperCase()))
        continue
      porId.set(String(it.id), it)
    }

    const items = [...porId.values()]
    if (items.length === 0) {
      return jsonResponse({ ok: true, inseridos: 0, mensagem: 'Nenhuma publicação no período.' })
    }

    // Remove os que já existem (dedup por fonte+external_id).
    const ids = items.map((i) => String(i.id))
    const { data: existentes } = await svc
      .from('publicacoes')
      .select('external_id')
      .eq('fonte', 'djen')
      .in('external_id', ids)
    const jaExiste = new Set((existentes ?? []).map((e: { external_id: string }) => e.external_id))

    const novos = items
      .filter((i) => !jaExiste.has(String(i.id)))
      .map((i) => ({
        fonte: 'djen',
        tipo: 'publicacao',
        external_id: String(i.id),
        numero_processo: i.numeroprocessocommascara ?? i.numero_processo ?? null,
        tribunal: i.siglaTribunal ?? null,
        data_publicacao: i.data_disponibilizacao ?? null,
        conteudo: i.texto ?? null,
        lida: false,
        tratada: false,
      }))

    if (novos.length > 0) {
      const { error } = await svc
        .from('publicacoes')
        .upsert(novos, { onConflict: 'fonte,external_id', ignoreDuplicates: true })
      if (error) return jsonResponse({ error: error.message }, 400)
    }

    return jsonResponse({
      ok: true,
      inseridos: novos.length,
      mensagem: `DJEN: ${novos.length} nova(s) publicação(ões) de ${items.length} encontrada(s).`,
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
