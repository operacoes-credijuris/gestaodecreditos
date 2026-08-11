// Integração de Tarefas com o ADVBOX (fonte única das tarefas).
// Ações:
//  - 'list'    : tarefas do ADVBOX ligadas aos processos cadastrados em
//                Créditos (numero_cnj), Requerimentos (numero_protocolo) e
//                Apensos (numero), casados por process_number/protocol_number.
//  - 'options' : catálogos para o formulário (usuários, tipos de tarefa) e os
//                processos casáveis (para o campo lawsuits_id).
//  - 'create'  : cria a tarefa no ADVBOX (POST /posts).
//  - 'sync'    : grava as tarefas no cache public.advbox_tarefas, que alimenta
//                a aba "Tarefas" da ficha de cada processo. Roda por cron e ao
//                abrir a aba. Aceita JWT do usuário OU x-cron-secret.
//
// Por que o sync é global (e não por processo): /posts não filtra por processo,
// então descobrir as tarefas de UM processo exige baixar todas e casar por
// lawsuits_id. Uma passada alimenta a ficha de todos os processos de uma vez.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, getCallerAtivo, isAdmin, serviceClient } from '../_shared/auth.ts'
// Cliente compartilhado com throttle + retry/backoff: a API do ADVBOX responde
// 429/503 sob carga e sem retry isso vira erro na tela do usuário.
import {
  fetchAll,
  getAdvboxCtx,
  getJson,
  type AdvboxCtx,
} from '../_shared/advbox.ts'

const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

// Piso para considerar um número de processo válido (igual às outras funções).
const MIN_DIGITS = 6

/**
 * Normaliza um nome para comparação: sem acento, sem caixa, sem espaço
 * sobrando. O vínculo entre o perfil e o usuário do ADVBOX é feito pelo NOME
 * (não existe id do ADVBOX em profiles), então a comparação precisa tolerar
 * divergência de digitação.
 */
function normNome(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Id do usuário do ADVBOX que corresponde a quem chamou, ou null.
 *
 * Mesmo casamento por nome que a listagem usa (não existe id do ADVBOX em
 * profiles). Serve para a criação de tarefa ser assinada SEMPRE por quem clicou:
 * antes, o `from` vinha do cliente e podia ser o id de qualquer pessoa.
 */
async function usuarioAdvboxDoCaller(
  ctx: AdvboxCtx,
  caller: { id: string },
): Promise<number | null> {
  const { data: perfil } = await serviceClient()
    .from('profiles')
    .select('nome')
    .eq('id', caller.id)
    .maybeSingle()
  const nome = normNome(perfil?.nome)
  if (!nome) return null
  const settings = (await getJson(ctx, '/settings')) as {
    users?: { id?: unknown; name?: unknown }[]
  }
  const achado = (settings.users ?? []).find((u) => normNome(u.name) === nome)
  const id = Number(achado?.id)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Normaliza uma data do ADVBOX para YYYY-MM-DD (coluna `date` do Postgres).
 * Defensivo: o campo chega ora ISO, ora só a data, ora em dd/mm/aaaa.
 */
function dataDia(v: unknown): string | null {
  if (v == null || v === '') return null
  const s = String(v).trim()
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  // "2026-02-15 10:00:00" (formato do /history) não é ISO: o espaço faz o
  // parser tratar como hora local. Normaliza para ISO com Z antes de converter.
  const iso = s.length <= 10 ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

// Hash estável (djb2) em base36 — o /history não devolve id por tarefa, então
// a chave do cache é derivada do conteúdo (mesma solução de advbox-movimentacoes).
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

/** Formata uma lista para o filtro `in` do PostgREST: ("a","b"). */
function listaIn(valores: string[]): string {
  const lst = valores.length ? valores : ['__none__']
  return '(' + lst.map((v) => `"${String(v).replace(/["\\]/g, '')}"`).join(',') + ')'
}

/** Um processo na fila de sincronização. */
interface FilaItem {
  lid: string
  numero: string
  /** Números cadastrados (só dígitos) que casaram com este lawsuit. */
  digits: string[]
}

// Processos por invocação. O /history é 2 chamadas por processo; lotes pequenos
// que se auto-encadeiam cabem no limite de recursos do edge function.
const BATCH = 10

/**
 * Dispara a próxima fatia numa invocação SEPARADA (fire-and-forget),
 * autenticada pelo segredo de cron — mesmo padrão de advbox-movimentacoes.
 */
function dispararProximo(fila: FilaItem[]): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/advbox-tarefas`
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const p = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ action: 'sync', fila }),
  }).catch(() => {})
  const rt = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
  }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

/** Campos derivados de um post do ADVBOX, comuns a 'list' e 'sync'. */
function extrairTarefa(p: Record<string, unknown>, numero: string) {
  const users = (p.users ?? []) as Array<Record<string, unknown>>
  return {
    tipo: (p.task ?? null) as string | null,
    processo: numero,
    start_date: (p.date ?? null) as string | null,
    date_deadline: (p.date_deadline ?? null) as string | null,
    notes: (p.notes ?? null) as string | null,
    responsaveis: users.map((u) => u.name).filter(Boolean) as string[],
    important: users.some((u) => Number(u.important) === 1),
    urgent: users.some((u) => Number(u.urgent) === 1),
    // Sem responsável não há como afirmar conclusão — `every` em lista vazia
    // seria true e marcaria a tarefa como feita sem ninguém tê-la feito.
    concluida: users.length > 0 && users.every((u) => u.completed),
  }
}

// Conjunto de números de processo cadastrados no nosso sistema (só dígitos).
async function numerosCadastrados(): Promise<Set<string>> {
  const svc = serviceClient()
  const [proc, ap, req] = await Promise.all([
    svc.from('processos').select('numero_cnj'),
    svc.from('apensos').select('numero'),
    svc.from('requerimentos').select('numero_protocolo'),
  ])
  // Falhar alto: um erro engolido aqui devolveria conjunto vazio, o que faria
  // a varredura concluir que NENHUM processo está cadastrado.
  for (const r of [proc, ap, req]) {
    if (r.error) throw new Error(`cadastro: ${r.error.message}`)
  }
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

// Processos do ADVBOX que casam com os nossos números (por process_number ou
// protocol_number). Retorna mapa lawsuits_id -> info do processo.
async function processosCasaveis(ctx: AdvboxCtx) {
  const nums = await numerosCadastrados()
  const lawsuits = await fetchAll(ctx, '/lawsuits')
  const map = new Map<number, Record<string, unknown>>()
  for (const l of lawsuits) {
    const pn = onlyDigits(l.process_number)
    const prot = onlyDigits(l.protocol_number)
    if ((pn && nums.has(pn)) || (prot && nums.has(prot))) {
      map.set(Number(l.id), l)
    }
  }
  return map
}

/**
 * Como processosCasaveis, mas devolve QUAIS dos nossos números casaram.
 *
 * Por que isso importa: o casamento aceita process_number OU protocol_number,
 * mas o número exibível é `process_number || protocol_number`. Quando o lawsuit
 * entra pelo protocolo e TAMBÉM tem um process_number diferente, gravar o
 * process_number faz a tarefa ser arquivada sob um número que nenhuma ficha
 * consulta (a leitura é por numero_digits do número cadastrado) — a tarefa
 * some do sistema. Aqui a tarefa é carimbada com o número que de fato casou.
 */
async function casaveisComDigits(
  ctx: AdvboxCtx,
): Promise<Map<string, { numero: string; digits: string[] }>> {
  const nums = await numerosCadastrados()
  const lawsuits = await fetchAll(ctx, '/lawsuits')
  const map = new Map<string, { numero: string; digits: string[] }>()
  for (const l of lawsuits) {
    const pn = onlyDigits(l.process_number)
    const prot = onlyDigits(l.protocol_number)
    const digits: string[] = []
    if (pn && nums.has(pn)) digits.push(pn)
    if (prot && prot !== pn && nums.has(prot)) digits.push(prot)
    if (!digits.length) continue
    // Número exibível: prefere o que casou, não o primeiro que existir.
    const exibivel =
      digits[0] === pn
        ? String(l.process_number)
        : String(l.protocol_number || l.process_number || l.id)
    map.set(String(l.id), { numero: exibivel, digits })
  }
  return map
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const action = body.action ?? 'list'

    // Autorização: JWT do usuário (chamada do app) OU segredo de cron — o
    // agendamento do 'sync' não tem usuário para autenticar.
    const cronSecret = Deno.env.get('CRON_SECRET')
    const headerSecret = req.headers.get('x-cron-secret')
    const autorizadoPorCron = !!cronSecret && headerSecret === cronSecret
    let caller: Awaited<ReturnType<typeof getCaller>> = null
    if (!autorizadoPorCron) {
      caller = await getCallerAtivo(req, serviceClient())
      if (!caller) return jsonResponse({ error: 'Acesso não autorizado. Faça login novamente; se o problema persistir, o acesso pode ter sido desativado.' }, 401)
    }

    const ctx = await getAdvboxCtx()

    if (action === 'options') {
      const settings = (await getJson(ctx, '/settings')) as {
        users?: { id?: unknown; name?: unknown }[]
        tasks?: { id?: unknown; task?: unknown }[]
      }
      const users = (settings.users ?? []).map((u) => ({
        id: u.id,
        name: String(u.name ?? ''),
      }))
      const tasks = (settings.tasks ?? [])
        .map((t) => ({ id: t.id, name: String(t.task ?? '') }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      const map = await processosCasaveis(ctx)
      const lawsuits = [...map.values()]
        .map((l) => ({
          id: l.id,
          numero: l.process_number || l.protocol_number || '(sem número)',
          folder: l.folder ?? null,
          cliente:
            Array.isArray(l.customers) && l.customers.length
              ? (l.customers[0] as { name?: string }).name ?? null
              : null,
        }))
        .sort((a, b) => String(a.numero).localeCompare(String(b.numero)))
      return jsonResponse({ users, tasks, lawsuits })
    }

    if (action === 'create') {
      // VALIDAÇÃO NO SERVIDOR. Os campos vinham crus do cliente, então qualquer
      // autenticado podia montar a requisição à mão e criar tarefa no ADVBOX da
      // firma COMO SE FOSSE OUTRA PESSOA (`from` com o id do sócio) e escalar
      // para quem quisesse (`guests`). Quem recebe a notificação não tem como
      // saber que não foi o sócio que atribuiu.
      //
      // O ADMIN CONTINUA PODENDO escolher o remetente: criar tarefa em nome de
      // outra pessoa é função dele, e a tela já mostra o campo só para ele. Para
      // usuário comum, `from` é IGNORADO e resolvido no servidor pelo mesmo
      // casamento de nome que a listagem usa. Sem correspondência, recusa com
      // motivo — melhor não criar do que criar assinado por outro.
      if (!caller) {
        return jsonResponse({ error: 'Sessão inválida.' }, 401)
      }
      const ehAdmin = await isAdmin(caller, serviceClient())
      let remetente: number | null
      if (ehAdmin) {
        remetente = Number(body.from)
        if (!Number.isInteger(remetente) || remetente <= 0) {
          return jsonResponse({ error: 'Informe o remetente.' }, 400)
        }
      } else {
        remetente = await usuarioAdvboxDoCaller(ctx, caller)
        if (!remetente) {
          return jsonResponse(
            {
              error:
                'Seu nome no cadastro não corresponde a nenhum usuário do ADVBOX, então a tarefa não pode ser criada em seu nome. Ajuste o nome em Configurações.',
            },
            409,
          )
        }
      }
      const inteiro = (v: unknown): number | null => {
        const n = Number(v)
        return Number.isInteger(n) && n > 0 ? n : null
      }
      const lawsuitsId = inteiro(body.lawsuits_id)
      const tasksId = inteiro(body.tasks_id)
      if (!lawsuitsId || !tasksId) {
        return jsonResponse({ error: 'Informe o processo e o tipo de tarefa.' }, 400)
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.start_date ?? ''))) {
        return jsonResponse({ error: 'Informe a data de início (AAAA-MM-DD).' }, 400)
      }
      const payload = {
        lawsuits_id: lawsuitsId,
        tasks_id: tasksId,
        start_date: body.start_date,
        from: remetente,
        guests: Array.isArray(body.guests)
          ? (body.guests as unknown[]).map(inteiro).filter((n): n is number => n !== null)
          : [],
        date_deadline: body.date_deadline || undefined,
        comments: body.comments || undefined,
        important: body.important ? 1 : 0,
        urgent: body.urgent ? 1 : 0,
      }
      const res = await fetch(`${ctx.base}/posts`, {
        method: 'POST',
        headers: { ...ctx.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          data?.message ||
          (data?.errors ? Object.values(data.errors).flat().join(' ') : '') ||
          `HTTP ${res.status}`
        return jsonResponse({ error: `ADVBOX: ${msg}` }, 400)
      }
      return jsonResponse({ ok: true, data })
    }

    if (action === 'sync') {
      const svc = serviceClient()
      const agora = new Date().toISOString()

      // Alvo opcional: a ficha manda o número do processo que está aberto e
      // sincroniza só ele (2 chamadas ao /history) em vez da varredura inteira.
      // Sem alvo (cron), a fila é computada na 1ª chamada e as fatias seguintes
      // vêm no corpo — lotes pequenos que se auto-encadeiam cabem no limite de
      // recursos do edge function.
      const alvo = onlyDigits((body as { numero?: unknown }).numero)
      const primeira = !Array.isArray((body as { fila?: unknown }).fila)

      // AS DUAS ENTRADAS PRIVILEGIADAS EXIGEM CRON.
      //
      // A fila é detalhe do auto-encadeamento e NUNCA vem do app. Aceitando-a de
      // qualquer autenticado, dava para mandar {fila:[{lid: <lawsuit do crédito
      // A>, digits:[<dígitos do crédito B>]}]}: a função buscava o histórico de A
      // e gravava as tarefas dele carimbadas com o número de B, e a poda em
      // seguida apagava as linhas verdadeiras de B. Ficha de crédito exibindo
      // tarefa de outro processo é erro que ninguém percebe olhando.
      //
      // A varredura COMPLETA (sem alvo) também é só do cron: a chamada da ficha
      // sempre manda `numero`, e a varredura inteira custa dezenas de chamadas ao
      // ADVBOX, que tem limite de requisições.
      if (!primeira && !autorizadoPorCron) {
        return jsonResponse(
          { error: 'Fila interna: apenas o encadeamento por cron.' },
          403,
        )
      }
      if (primeira && alvo.length < MIN_DIGITS && !autorizadoPorCron) {
        return jsonResponse(
          { error: 'Varredura completa: apenas por cron. Informe o número do processo.' },
          403,
        )
      }

      let fila: FilaItem[]
      if (primeira) {
        const casaveis = await casaveisComDigits(ctx)
        fila = [...casaveis.entries()].map(([lid, v]) => ({
          lid,
          numero: v.numero,
          digits: v.digits,
        }))
        if (alvo.length >= MIN_DIGITS) {
          fila = fila.filter((f) => f.digits.includes(alvo))
          if (!fila.length) {
            // Processo sem correspondência no ADVBOX: não há o que sincronizar,
            // e dizer isso é melhor do que devolver um ok mudo.
            return jsonResponse({ ok: true, alvo, sem_correspondencia: true })
          }
        } else if (fila.length) {
          // Poda processos que saíram do cadastro (ou do ADVBOX) — por CONJUNTO
          // de lawsuits, não por carimbo de tempo: dois syncs concorrentes
          // derivam o mesmo conjunto, então apagar duas vezes é inofensivo.
          // Só na varredura completa: com alvo, a fila é parcial de propósito.
          //
          // A guarda `fila.length` é ESSENCIAL: com a fila vazia, listaIn([])
          // vira ("__none__") e o filtro `not in` casa TODAS as linhas —
          // apagaria a tabela inteira por um soluço em /lawsuits ou no cadastro.
          const { error } = await svc
            .from('advbox_tarefas')
            .delete()
            .not('advbox_lawsuit_id', 'in', listaIn(fila.map((f) => f.lid)))
          if (error) throw new Error(error.message)
        }
      } else {
        fila = (body as { fila: FilaItem[] }).fila
      }

      const lote = fila.slice(0, BATCH)
      const resto = fila.slice(BATCH)
      let gravadas = 0
      let podadas = 0
      let erros = 0
      // Respostas vazias (sem erro). Alto demais = suspeita de envelope
      // inesperado ou instabilidade — não é "processo sem tarefas".
      let vazios = 0

      for (const item of lote) {
        try {
          // Duas chamadas por processo: o /history só informa a situação pelo
          // filtro, então é ele que define concluida (o item em si não diz).
          // Cada situação é tratada como um CONJUNTO PRÓPRIO — ver a poda.
          for (const st of ['pending', 'completed'] as const) {
            // fetchAll em vez de getJson: a doc diz que /history ignora
            // limit/offset e devolve tudo, mas se um dia paginar, uma chamada
            // única traria só a 1ª página e a poda apagaria o resto.
            const itens = await fetchAll(ctx, `/history/${item.lid}?status=${st}`)
            const rows = itens.flatMap((h) => {
              const assinatura = [h.task, h.start, h.date_deadline, h.comments, h.responsible]
                .map((v) => String(v ?? ''))
                .join('|')
              // Uma linha por número cadastrado que casou (normalmente um só).
              return item.digits.map((digits) => ({
                id: `${item.lid}-${digits}-${st[0]}-${hash(assinatura)}`,
                advbox_lawsuit_id: item.lid,
                numero_processo: item.numero,
                numero_digits: digits,
                tipo: (h.task ?? null) as string | null,
                data: dataDia(h.start) ?? dataDia(h.created_at),
                date_deadline: dataDia(h.date_deadline),
                notes: (h.comments ?? null) as string | null,
                responsaveis: [h.responsible].filter(Boolean),
                // O /history não traz urgência/importância (só o /posts).
                important: false,
                urgent: false,
                concluida: st === 'completed',
                raw: h,
                sincronizado_em: agora,
              }))
            })

            // Tarefas idênticas repetidas colapsam no mesmo id determinístico.
            const unicas = [...new Map(rows.map((r) => [r.id, r])).values()]

            // NADA LIDO => NADA PODADO. Uma resposta vazia bem-sucedida (soluço
            // da API, envelope inesperado) não pode ser lida como "o processo
            // não tem mais tarefas": apagaria histórico legítimo em silêncio,
            // sem sequer contar como erro.
            if (!unicas.length) {
              vazios++
              continue
            }

            const { error } = await svc
              .from('advbox_tarefas')
              .upsert(unicas, { onConflict: 'id' })
            if (error) throw new Error(error.message)
            gravadas += unicas.length

            // Poda escopada a ESTE processo E ESTA situação: o que não veio
            // agora saiu do ADVBOX. Escopo estreito de propósito — assim uma
            // resposta vazia de 'completed' não derruba as pendentes (e
            // vice-versa), e nenhuma poda global por carimbo de tempo pode
            // esvaziar o cache quando dois syncs se sobrepõem.
            const ids = unicas.map((r) => r.id)
            const base = svc
              .from('advbox_tarefas')
              .delete({ count: 'exact' })
              .eq('advbox_lawsuit_id', item.lid)
              .eq('concluida', st === 'completed')
            const { error: eDel, count } =
              ids.length <= 200
                ? await base.not('id', 'in', listaIn(ids))
                // Lista longa demais para a query string: cai no carimbo, mas
                // ainda restrito a este processo e a esta situação.
                : await base.lt('sincronizado_em', agora)
            if (eDel) throw new Error(eDel.message)
            podadas += count ?? 0
          }
        } catch (_e) {
          // Um processo que falha não derruba o lote inteiro nem a cadeia.
          erros++
        }
      }

      if (resto.length) dispararProximo(resto)

      return jsonResponse({
        ok: true,
        primeira,
        processos_no_lote: lote.length,
        restantes: resto.length,
        gravadas,
        podadas,
        erros,
        vazios,
      })
    }

    // action === 'list'
    //
    // VISIBILIDADE: quem não é administrador vê apenas as tarefas em que é
    // responsável. O corte é feito AQUI, no servidor — filtrar só na tela
    // deixaria as tarefas dos colegas trafegarem até o navegador.
    // Sem correspondência entre o nome do perfil e um usuário do ADVBOX, não
    // devolve nada: na dúvida, não mostra. A tela avisa o que aconteceu, senão
    // a pessoa conclui que está sem tarefas.
    const svcPerfil = serviceClient()
    const admin = await isAdmin(caller, svcPerfil)
    let meuNomeAdvbox: string | null = null
    if (!admin) {
      const { data: perfil } = await svcPerfil
        .from('profiles')
        .select('nome')
        .eq('id', caller?.id ?? '')
        .maybeSingle()
      const nomePerfil = String(perfil?.nome ?? '').trim()
      const settings = (await getJson(ctx, '/settings')) as {
        users?: { name?: unknown }[]
      }
      const achado = nomePerfil
        ? (settings.users ?? []).find(
            (u) => normNome(u.name) === normNome(nomePerfil),
          )
        : undefined
      if (!achado) {
        return jsonResponse({
          tarefas: [],
          total: 0,
          restrito: true,
          sem_correspondencia: true,
          perfil_nome: nomePerfil || null,
        })
      }
      meuNomeAdvbox = String(achado.name)
    }

    const map = await processosCasaveis(ctx)
    const posts = await fetchAll(ctx, '/posts')
    const todas = posts
      .filter((p) => p.lawsuits_id != null && map.has(Number(p.lawsuits_id)))
      .map((p) => {
        const law = map.get(Number(p.lawsuits_id))
        const numero = String(law?.process_number || law?.protocol_number || '')
        return {
          id: p.id,
          ...extrairTarefa(p, numero),
          created_at: p.created_at ?? null,
        }
      })
    const tarefas = admin
      ? todas
      : todas.filter((t) =>
          t.responsaveis.some((r) => normNome(r) === normNome(meuNomeAdvbox)),
        )
    return jsonResponse({ tarefas, total: tarefas.length, restrito: !admin })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
