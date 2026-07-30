// Sincroniza os cards (leads) do Kommo para a tabela public.kommo_leads, que é
// de onde a aba Análise de Crédito lê. A UI nunca fala com a API do Kommo por
// dois motivos: a API não devolve headers de CORS (chamada do navegador é
// bloqueada) e o token tem direitos de administrador da conta.
//
// Detalhes da API do Kommo que este código precisa respeitar:
//   - A conta é resolvida pelo HOST: https://<subdominio>.kommo.com. O token
//     sozinho não a identifica — bater em api-g.kommo.com devolve 401
//     "Account not found" mesmo com token válido.
//   - Teto de 7 requisições/segundo. Violar repetidamente BLOQUEIA O IP, e aí
//     tudo passa a responder 403. Daí o intervalo entre chamadas.
//   - GET /leads devolve 204 COM CORPO VAZIO quando o filtro não casa nada.
//     Chamar .json() nesse caso estoura.
//   - Leads não têm contagem total: paginação é seguir _links.next até acabar.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, serviceClient } from '../_shared/auth.ts'

// Funis que o operacional usa. O Precatório (13971995) entra na fase 2.
const FUNIS = [13901939]

// Margem confortável abaixo do teto de 7/s.
const INTERVALO_MS = 160

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

// CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO. Formato rígido, então o regex é seguro —
// diferente do resto dos dados do crédito, que vêm em texto livre e variam de
// card para card (por isso a nota é guardada crua, sem parser).
const RE_CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/

function extrairCnj(...textos: (string | null | undefined)[]): string | null {
  for (const t of textos) {
    const m = t?.match(RE_CNJ)
    if (m) return m[0]
  }
  return null
}

const iso = (unix: unknown): string | null =>
  typeof unix === 'number' && unix > 0 ? new Date(unix * 1000).toISOString() : null

interface KommoLead {
  id: number
  name?: string
  status_id: number
  pipeline_id: number
  responsible_user_id?: number
  created_at?: number
  updated_at?: number
  _embedded?: { tags?: { name?: string }[] }
}

interface KommoNote {
  id: number
  entity_id: number
  created_at?: number
  created_by?: number
  params?: { text?: string }
}

/** Uma anotação como fica guardada em kommo_leads.notas. */
interface NotaGravada {
  id: number
  texto: string
  criado_em: string | null
  autor: string | null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Autorização: JWT de usuário (chamada do app) OU segredo de cron —
    // mesmo padrão de djen-publicacoes e advbox-movimentacoes. O cron precisa
    // rodar sem ninguém logado, daí verify_jwt = false no config.toml.
    const cronSecret = Deno.env.get('CRON_SECRET')
    const headerSecret = req.headers.get('x-cron-secret')
    const autorizadoPorCron = !!cronSecret && headerSecret === cronSecret
    if (!autorizadoPorCron) {
      const caller = await getCaller(req)
      if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)
    }

    const svc = serviceClient()
    const { data: secret } = await svc
      .from('integracao_kommo_secret')
      .select('token, subdominio')
      .eq('id', 1)
      .maybeSingle()
    const token = secret?.token
    const subdominio = secret?.subdominio
    if (!token || !subdominio) {
      return jsonResponse(
        { error: 'Token ou subdomínio do Kommo não configurado.' },
        400,
      )
    }

    const base = `https://${subdominio}.kommo.com/api/v4`
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }

    // Uma requisição ao Kommo, com throttle e o tratamento do 204-vazio.
    // Devolve null quando não há conteúdo, para o chamador parar de paginar.
    let ultimaChamada = 0
    async function kommo<T>(path: string): Promise<T | null> {
      const espera = INTERVALO_MS - (Date.now() - ultimaChamada)
      if (espera > 0) await dormir(espera)
      ultimaChamada = Date.now()

      const res = await fetch(`${base}${path}`, { headers })
      // 204 = nada encontrado / passou da última página. Corpo vazio.
      if (res.status === 204) return null
      if (res.status === 429) {
        throw new Error(
          'Kommo devolveu 429 (limite de requisições). Tente novamente em alguns minutos.',
        )
      }
      if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
      return (await res.json()) as T
    }

    // Nome dos usuários do Kommo, para exibir o responsável sem outra consulta.
    const usuarios = new Map<number, string>()
    const respUsers = await kommo<{ _embedded?: { users?: { id: number; name?: string }[] } }>(
      '/users?limit=250',
    )
    for (const u of respUsers?._embedded?.users ?? []) {
      if (u.name) usuarios.set(u.id, u.name)
    }

    // ---------- Leads dos funis ----------
    const leads: KommoLead[] = []
    for (const funil of FUNIS) {
      for (let pagina = 1; pagina <= 40; pagina++) {
        const r = await kommo<{
          _embedded?: { leads?: KommoLead[] }
          _links?: { next?: { href?: string } }
        }>(`/leads?filter[pipeline_id]=${funil}&limit=250&page=${pagina}`)
        if (!r) break
        leads.push(...(r._embedded?.leads ?? []))
        if (!r._links?.next?.href) break
      }
    }

    // ---------- Notas ----------
    // Busca as notas em nível de conta (6 páginas) em vez de uma requisição por
    // card (que seriam dezenas). O filtro note_type=common é o que mantém as
    // anotações da própria integração (service_message) fora daqui — sem isso,
    // nosso registro de auditoria seria confundido com dado do crédito.
    // Acumula TODAS as notas de cada card, não só a mais antiga: comentários
    // posteriores do comercial também interessam ao operacional.
    const notasPorLead = new Map<number, KommoNote[]>()
    for (let pagina = 1; pagina <= 40; pagina++) {
      const r = await kommo<{
        _embedded?: { notes?: KommoNote[] }
        _links?: { next?: { href?: string } }
      }>(`/leads/notes?filter[note_type][]=common&limit=250&page=${pagina}`)
      if (!r) break
      for (const n of r._embedded?.notes ?? []) {
        if (!n.params?.text?.trim()) continue
        const lista = notasPorLead.get(n.entity_id)
        if (lista) lista.push(n)
        else notasPorLead.set(n.entity_id, [n])
      }
      if (!r._links?.next?.href) break
    }
    // Da mais antiga para a mais recente. A API não garante ordem entre páginas,
    // então ordenar aqui é o que torna notas[0] confiável como "primeira".
    for (const lista of notasPorLead.values()) {
      lista.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
    }

    // ---------- Grava o espelho ----------
    const agora = new Date().toISOString()
    const registros = leads.map((l) => {
      const doLead = notasPorLead.get(l.id) ?? []
      const notas: NotaGravada[] = doLead.map((n) => ({
        id: n.id,
        texto: n.params?.text ?? '',
        criado_em: iso(n.created_at),
        // created_by = 0 é o robô/automação do Kommo, não uma pessoa.
        autor: n.created_by ? usuarios.get(n.created_by) ?? null : null,
      }))
      // nota_texto é simplesmente a PRIMEIRA anotação — sem promessa de conter
      // os dados do crédito. Há cards em que a primeira é um comentário curto
      // ("qualificado") e o bloco de dados vem na segunda.
      const nota = notas[0]?.texto ?? null
      return {
        kommo_lead_id: l.id,
        pipeline_id: l.pipeline_id,
        status_id: l.status_id,
        nome: l.name ?? null,
        responsavel_id: l.responsible_user_id ?? null,
        responsavel_nome: l.responsible_user_id
          ? usuarios.get(l.responsible_user_id) ?? null
          : null,
        nota_texto: nota,
        notas,
        // Procura em TODAS as anotações, não só na primeira: o bloco com o
        // processo às vezes está numa nota posterior.
        processo_cnj: extrairCnj(...notas.map((n) => n.texto), l.name),
        // filter(Boolean) não estreita o tipo em TS, então o predicado é
        // explícito — a coluna é text[] not null e não aceita nulo no meio.
        tags: (l._embedded?.tags ?? [])
          .map((t) => t.name)
          .filter((n): n is string => typeof n === 'string' && n.length > 0),
        criado_em: iso(l.created_at),
        atualizado_em: iso(l.updated_at),
        raw: l,
        sincronizado_em: agora,
      }
    })

    if (registros.length) {
      const { error } = await svc
        .from('kommo_leads')
        .upsert(registros, { onConflict: 'kommo_lead_id' })
      if (error) throw new Error(error.message)
    }

    // Cards que saíram do funil (ou foram apagados no Kommo) somem do espelho.
    // Restrito aos funis sincronizados para não apagar o que veio de outro.
    const vistos = registros.map((r) => r.kommo_lead_id)
    let removidos = 0
    if (vistos.length) {
      const { data: apagados } = await svc
        .from('kommo_leads')
        .delete()
        .in('pipeline_id', FUNIS)
        .not('kommo_lead_id', 'in', `(${vistos.join(',')})`)
        .select('kommo_lead_id')
      removidos = apagados?.length ?? 0
    }

    // Marcações internas de cards que não existem mais no espelho ficariam
    // órfãs — a UI as ignoraria, mas acumulariam sem limite.
    if (vistos.length) {
      await svc
        .from('kommo_analise_interna')
        .delete()
        .not('kommo_lead_id', 'in', `(${vistos.join(',')})`)
    }

    const comCnj = registros.filter((r) => r.processo_cnj).length
    return jsonResponse({
      ok: true,
      resumo: {
        leads: registros.length,
        com_nota: registros.filter((r) => r.nota_texto).length,
        com_cnj: comCnj,
        removidos,
      },
      mensagem:
        `Kommo sincronizado — ${registros.length} card(s), ` +
        `${comCnj} com processo identificado` +
        (removidos ? `, ${removidos} removido(s)` : '') + '.',
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
