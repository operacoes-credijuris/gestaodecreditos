// Sincroniza as MOVIMENTAÇÕES (andamentos) do ADVBOX para o cache
// public.advbox_movimentacoes (deploy automático via GitHub Actions). Passos:
//  1. Compila os números dos processos cadastrados em Créditos (numero_cnj),
//     Requerimentos (numero_protocolo) e Apensos (numero).
//  2. Casa esses números com os processos do ADVBOX (/lawsuits) por
//     process_number/protocol_number → obtém os lawsuits_id.
//  3. Para cada processo casado, busca GET /movements/{lawsuit_id} PAGINADO
//     (fetchAll segue offset/totalCount — uma chamada única pegaria só a
//     primeira página e truncaria o histórico de processos antigos sem nenhum
//     aviso) e grava o HISTÓRICO INTEIRO. O endpoint não tem parâmetro de
//     data; até 2026-07 só se gravava a janela de 20 dias e o resto era
//     descartado.
//  4. Upsert no cache; a poda remove apenas movimentações de processos que
//     saíram do cadastro, nunca por idade.
// Quem consome: a ficha de cada processo (Créditos/Requerimentos) mostra o
// histórico dele; a aba Movimentações filtra os últimos 20 dias NA CONSULTA.
// A página lê do banco; esta função roda em 2º plano (ao abrir a aba) e também
// por cron (pg_cron), autenticada por JWT do usuário OU por x-cron-secret.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCallerAtivo, serviceClient } from '../_shared/auth.ts'
// Cliente compartilhado (throttle + retry/backoff contra o rate limit do
// Cloudflare na frente da API do ADVBOX).
import {
  configurarThrottle,
  fetchAll,
  getAdvboxCtx,
  type AdvboxCtx,
} from '../_shared/advbox.ts'

// Esta função varre dezenas de processos em paralelo — precisa de espaçamento
// maior que o padrão sequencial do módulo compartilhado.
configurarThrottle(350)

const MIN_DIGITS = 6 // casa números com >= 6 dígitos (igual à aba de Tarefas)
const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
const str = (v: unknown): string | null => (v == null ? null : String(v))

// Hash estável (djb2) em base36 — usado para gerar um id determinístico quando
// a movimentação do ADVBOX não traz um id próprio.
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

// Busca TODAS as movimentações de um processo (com retry/backoff). fetchAll
// segue a paginação padrão do ADVBOX (offset/limit/totalCount); se o endpoint
// devolver tudo de uma vez, ela faz uma única requisição e para — seguro nos
// dois casos. Duplicatas de uma paginação mal-comportada colapsam no id
// determinístico + upsert.
async function fetchMovements(
  ctx: AdvboxCtx,
  lawsuitId: string,
): Promise<Record<string, unknown>[]> {
  return fetchAll(ctx, `/movements/${lawsuitId}`)
}

// Map com concorrência limitada que devolve UM resultado por item (1:1),
// preservando a ordem. Erros de `fn` propagam (rejeitam o Promise.all) — o
// chamador trata falhas com try/catch dentro do próprio `fn`.
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// Conjunto de números de processo cadastrados (Créditos, Requerimentos, Apensos).
async function numerosCadastrados(): Promise<Set<string>> {
  const svc = serviceClient()
  const [proc, ap, req] = await Promise.all([
    svc.from('processos').select('numero_cnj'),
    svc.from('apensos').select('numero'),
    svc.from('requerimentos').select('numero_protocolo'),
  ])
  const set = new Set<string>()
  const add = (v: unknown) => {
    const d = onlyDigits(v)
    if (d.length >= MIN_DIGITS) set.add(d)
  }
  for (const r of proc.data ?? []) add((r as { numero_cnj?: string }).numero_cnj)
  for (const r of ap.data ?? []) add((r as { numero?: string }).numero)
  for (const r of req.data ?? [])
    add((r as { numero_protocolo?: string }).numero_protocolo)
  return set
}

// Processos do ADVBOX que casam com os nossos números.
// Retorna mapa lawsuits_id -> número de processo exibível.
async function processosCasaveis(ctx: AdvboxCtx): Promise<Map<string, string>> {
  const nums = await numerosCadastrados()
  const lawsuits = await fetchAll(ctx, '/lawsuits')
  const map = new Map<string, string>()
  for (const l of lawsuits) {
    const pn = onlyDigits(l.process_number)
    const prot = onlyDigits(l.protocol_number)
    if ((pn && nums.has(pn)) || (prot && nums.has(prot))) {
      map.set(String(l.id), String(l.process_number || l.protocol_number || l.id))
    }
  }
  return map
}

// Extrai a data de um andamento (defensivo: vários nomes possíveis).
function extrairData(m: Record<string, unknown>): string | null {
  const cands = [m.date, m.created_at, m.data, m.movement_date, m.datetime, m.updated_at]
  for (const c of cands) {
    if (c == null || c === '') continue
    const d = new Date(String(c))
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

// Data (YYYY-MM-DD) da última movimentação entre todos os andamentos de um
// processo (independente da janela). null = nenhum andamento com data válida.
function ultimaData(movs: Record<string, unknown>[]): string | null {
  let max: string | null = null
  for (const m of movs) {
    const iso = extrairData(m)
    if (!iso) continue
    const dia = iso.slice(0, 10)
    if (!max || dia > max) max = dia
  }
  return max
}

// Extrai o texto de um andamento (defensivo).
function extrairConteudo(m: Record<string, unknown>): string | null {
  const cands = [m.description, m.text, m.movement, m.content, m.title, m.name, m.description_movement]
  for (const c of cands) {
    if (c != null && String(c).trim()) return String(c).trim()
  }
  return null
}

// Processos por invocação. Pequeno o bastante para caber no limite de recursos
// do edge function mesmo com o rate limit do ADVBOX; o restante é encadeado.
const BATCH = 12

// Dispara a próxima fatia numa invocação SEPARADA (fire-and-forget), autenticada
// pelo segredo de cron. Assim nenhuma execução isolada passa do limite.
function dispararProximo(fila: { lid: string; numero: string }[]): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/advbox-movimentacoes`
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const p = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ fila }),
  }).catch(() => {})
  const rt = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
  }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Autorização: JWT de usuário (chamada do app) OU segredo de cron.
    const cronSecret = Deno.env.get('CRON_SECRET')
    const headerSecret = req.headers.get('x-cron-secret')
    const autorizadoPorCron = !!cronSecret && headerSecret === cronSecret
    if (!autorizadoPorCron) {
      const caller = await getCallerAtivo(req, serviceClient())
      if (!caller) return jsonResponse({ error: 'Acesso não autorizado. Faça login novamente; se o problema persistir, o acesso pode ter sido desativado.' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const ctx = await getAdvboxCtx()
    const svc = serviceClient()

    // Lista de trabalho: vem no corpo (fatia encadeada) ou é computada na 1ª
    // chamada da cadeia. O processamento é feito em lotes pequenos que se
    // auto-encadeiam, para não estourar o limite de recursos do edge function.
    const primeira = !Array.isArray((body as { fila?: unknown }).fila)
    let fila: { lid: string; numero: string }[]
    if (primeira) {
      const casaveis = await processosCasaveis(ctx)
      fila = [...casaveis.entries()].map(([lid, numero]) => ({ lid, numero }))
      // Poda SÓ o que saiu do cadastro (histórico não expira por idade).
      // Movimentações: por lawsuit_id, que é estável; o número exibível pode
      // mudar de formato entre syncs. Só na primeira chamada da cadeia.
      const lids = [...casaveis.keys()]
      const lidsLst = lids.length ? lids : ['__none__']
      const lidsStr =
        '(' + lidsLst.map((n) => `"${String(n).replace(/["\\]/g, '')}"`).join(',') + ')'
      await svc.from('advbox_movimentacoes').delete().not('advbox_lawsuit_id', 'in', lidsStr)
      // Status: a tabela é chaveada pelo número exibível.
      const numeros = [...casaveis.values()]
      const lst = numeros.length ? numeros : ['__none__']
      const inStr = '(' + lst.map((n) => `"${String(n).replace(/["\\]/g, '')}"`).join(',') + ')'
      await svc.from('advbox_processo_status').delete().not('numero_processo', 'in', inStr)
    } else {
      fila = (body as { fila: { lid: string; numero: string }[] }).fila
    }
    const lote = fila.slice(0, BATCH)
    const resto = fila.slice(BATCH)

    // Busca as movimentações do lote (concorrência baixa + throttle + retry).
    const resultados = await mapPool(lote, 3, async ({ lid, numero }) => {
      try {
        return {
          lid,
          numero,
          movs: await fetchMovements(ctx, lid),
          erro: null as string | null,
        }
      } catch (e) {
        return {
          lid,
          numero,
          movs: [] as Record<string, unknown>[],
          erro: (e as Error).message,
        }
      }
    })

    // Monta as linhas do lote — HISTÓRICO INTEIRO, sem janela. Andamento sem
    // data ou sem conteúdo continua fora: não ordena nem informa nada.
    const agora = new Date().toISOString()
    const vistos = new Set<string>()
    const rows = resultados
      .flatMap((r) =>
        r.movs.map((m) => {
          const dataIso = extrairData(m)
          const conteudo = extrairConteudo(m)
          const dataDia = dataIso ? dataIso.slice(0, 10) : null
          // Número DO ANDAMENTO, não do lawsuit: o ADVBOX manda
          // process_number/protocol_number em cada movimentação, e é isso que
          // distingue o andamento de um agravo dentro do feed do principal.
          // Carimbar tudo com o número do lawsuit (comportamento antigo)
          // misturava os autos e o apenso ficava indistinguível na ficha.
          // Fallback para o número do lawsuit quando o campo vier vazio/lixo.
          const numeroMov =
            str(m.process_number)?.trim() || str(m.protocol_number)?.trim() || ''
          const usarProprio = onlyDigits(numeroMov).length >= MIN_DIGITS
          const numeroFinal = usarProprio ? numeroMov : r.numero
          const digitsFinal = onlyDigits(numeroFinal)
          // id estável baseado no NÚMERO do andamento (não no lawsuit): o mesmo
          // andamento pode chegar por dois lawsuits (principal e apenso) e
          // precisa colapsar numa linha só — id por lawsuit gerava a MESMA
          // movimentação duplicada na ficha combinada.
          const id =
            str(m.id) ??
            `${digitsFinal}-${dataDia ?? 'sd'}-${hash(`${dataIso ?? ''}|${conteudo ?? ''}`)}`
          return {
            id,
            advbox_lawsuit_id: r.lid,
            numero_processo: numeroFinal,
            // Forma normalizada — é por ela que a ficha do processo busca.
            numero_digits: digitsFinal,
            data: dataDia,
            data_ts: dataIso,
            conteudo,
            raw: m,
            sincronizado_em: agora,
          }
        }),
      )
      .filter((r) => r.data && r.conteudo)
      .filter((r) => {
        if (vistos.has(r.id)) return false
        vistos.add(r.id)
        return true
      })

    let gravados = 0
    if (rows.length) {
      const { error } = await svc
        .from('advbox_movimentacoes')
        .upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(error.message)
      gravados = rows.length
    }

    // Status por processo (última movimentação de todo o histórico). Só grava
    // para processos buscados com sucesso, para não sobrescrever com null.
    const statusRows = resultados
      .filter((r) => r.erro == null)
      .map((r) => ({
        numero_processo: r.numero,
        advbox_lawsuit_id: r.lid,
        ultima_movimentacao: ultimaData(r.movs),
        sincronizado_em: agora,
      }))
    if (statusRows.length) {
      const { error } = await svc
        .from('advbox_processo_status')
        .upsert(statusRows, { onConflict: 'numero_processo' })
      if (error) throw new Error(error.message)
    }

    const errosNoLote = resultados.filter((r) => r.erro).length

    // Encadeia a próxima fatia, se houver.
    if (resto.length) dispararProximo(resto)

    return jsonResponse({
      ok: true,
      primeira,
      lote: lote.length,
      restante: resto.length,
      gravados,
      erros_no_lote: errosNoLote,
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
