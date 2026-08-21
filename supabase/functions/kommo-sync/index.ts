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
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'

// Funis que o operacional usa.
//
// Além dos CARDS, este sync espelha a ESTRUTURA do kanban (funis e colunas) em
// public.kommo_etapa — ver migration 0044. É o que permitiu a aba de Precatórios
// existir: os status_id dela não estavam escritos em lugar nenhum, e a
// alternativa era alguém abrir o Kommo e copiar número de coluna à mão. Número
// de coluna não tem cara de nada: um dígito trocado aponta para outra coluna que
// também existe, e o card simplesmente não aparece na tela — sem erro nenhum.
const FUNIL_RPV = 13901939
const FUNIL_PRECATORIO = 13971995
const FUNIS = [FUNIL_RPV, FUNIL_PRECATORIO]

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
      const caller = await getCallerAtivo(req, serviceClient())
      if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)
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

    // Um instante só para toda esta passada: cards e colunas gravados com o
    // mesmo `sincronizado_em` dizem "vieram do mesmo sync", que é o que se
    // pergunta quando um deles parece defasado.
    const agora = new Date().toISOString()

    // ---------- Estrutura do kanban (funis e colunas) ----------
    //
    // GET /leads/pipelines devolve os funis com os estágios embutidos em
    // _embedded.statuses de cada um (docs: developers.kommo.com/reference/
    // pipelines-list e stages-list). Cada estágio traz id, name, sort, type e
    // color; `sort` é a ordem no kanban e `type: 1` marca a coluna de entrada.
    //
    // Falha aqui NÃO derruba o sync dos cards: a estrutura muda raramente e a
    // tabela guarda a última versão boa. Mas também não passa em silêncio — o
    // aviso volta no resumo, porque coluna nova no Kommo que não chegou aqui é
    // aba que não aparece na tela.
    let etapasGravadas = 0
    let avisoEtapas: string | null = null
    try {
      const rp = await kommo<{
        _embedded?: {
          pipelines?: {
            id: number
            name?: string
            _embedded?: {
              statuses?: {
                id: number
                name?: string
                sort?: number
                type?: number
                color?: string
              }[]
            }
          }[]
        }
      }>('/leads/pipelines')

      const funis = rp?._embedded?.pipelines ?? []
      if (funis.length === 0) {
        avisoEtapas =
          'A API não devolveu funil nenhum em /leads/pipelines. As abas da tela ' +
          'continuam com a última estrutura gravada.'
      } else {
        const linhas = funis
          .filter((p) => FUNIS.includes(p.id))
          .flatMap((p) =>
            (p._embedded?.statuses ?? []).map((s) => ({
              pipeline_id: p.id,
              status_id: s.id,
              pipeline_nome: p.name ?? null,
              // Nome é NOT NULL na tabela: coluna sem nome recebe o próprio id,
              // porque aba sem rótulo é pior que aba com rótulo feio.
              nome: s.name?.trim() || `Coluna ${s.id}`,
              ordem: s.sort ?? 0,
              tipo: s.type ?? 0,
              cor: s.color ?? null,
              sincronizado_em: agora,
            })),
          )

        if (linhas.length === 0) {
          avisoEtapas =
            `Nenhuma coluna encontrada nos funis ${FUNIS.join(' e ')}. ` +
            `Confira se os ids dos funis mudaram no Kommo.`
        } else {
          const { error } = await svc
            .from('kommo_etapa')
            .upsert(linhas, { onConflict: 'pipeline_id,status_id' })
          if (error) throw new Error(error.message)
          etapasGravadas = linhas.length

          // Coluna apagada no Kommo sai do espelho — senão sobra uma aba
          // fantasma, sempre vazia, sem ninguém saber de onde veio.
          //
          // UM DELETE POR FUNIL, e isto é o ponto. A chave é composta
          // (pipeline_id, status_id), então apagar "todo status_id que não veio"
          // varrendo os dois funis de uma vez tem um modo de falha grave: se a
          // resposta da API não trouxer UM dos funis — id trocado no Kommo,
          // permissão perdida, funil recriado — os status_id dele não entram na
          // lista, e o delete apaga TODAS as colunas dele. A tela ficaria com a
          // aba de Precatórios mostrando só "Venda ganha" e "Venda perdida"
          // (que sobrevivem por existirem no outro funil), com cara de correto.
          //
          // Funil ausente da resposta não é funil sem coluna: é funil que não
          // deu para ler. Avisa e não mexe.
          const idsVindos = new Set(funis.map((p) => p.id))
          const semResposta = FUNIS.filter((f) => !idsVindos.has(f))
          if (semResposta.length) {
            avisoEtapas =
              `O Kommo não devolveu o(s) funil(is) ${semResposta.join(', ')} em ` +
              `/leads/pipelines. Não apaguei as colunas dele(s) — a tela segue ` +
              `com a última estrutura conhecida. Confira se o id do funil mudou.`
          }

          for (const p of funis.filter((x) => FUNIS.includes(x.id))) {
            const ids = (p._embedded?.statuses ?? []).map((s) => s.id)
            if (ids.length === 0) continue // idem: sem coluna = não deu para ler
            const { error: erroDel } = await svc
              .from('kommo_etapa')
              .delete()
              .eq('pipeline_id', p.id)
              .not('status_id', 'in', `(${ids.join(',')})`)
            // Delete que falha deixa aba fantasma. Não derruba o sync, mas avisa.
            if (erroDel) {
              avisoEtapas =
                `Colunas do funil ${p.id} atualizadas, mas não consegui remover ` +
                `as que saíram do Kommo: ${erroDel.message}`
            }
          }
        }
      }
    } catch (e) {
      avisoEtapas = `Não consegui sincronizar as colunas do kanban: ${
        (e as Error)?.message ?? e
      }`
    }

    // ---------- Leads dos funis ----------
    //
    // Os ids são guardados POR FUNIL, e não numa lista só. O motivo está na
    // limpeza do espelho, mais abaixo: com uma lista só, um funil que devolve
    // vazio faz o delete apagar os cards do OUTRO.
    const leads: KommoLead[] = []
    const idsPorFunil = new Map<number, number[]>()
    for (const funil of FUNIS) {
      const idsDoFunil: number[] = []
      for (let pagina = 1; pagina <= 40; pagina++) {
        const r = await kommo<{
          _embedded?: { leads?: KommoLead[] }
          _links?: { next?: { href?: string } }
        }>(`/leads?filter[pipeline_id]=${funil}&limit=250&page=${pagina}`)
        if (!r) break
        const lote = r._embedded?.leads ?? []
        leads.push(...lote)
        idsDoFunil.push(...lote.map((l) => l.id))
        if (!r._links?.next?.href) break
      }
      idsPorFunil.set(funil, idsDoFunil)
    }

    // ---------- Notas ----------
    // Busca DIRIGIDA aos cards que acabaram de ser lidos, com
    // filter[entity_id][], e não uma varredura de notas em nível de conta.
    //
    // POR QUE MUDOU: a varredura por conta tinha teto de 40 páginas × 250 = 10 mil
    // notas. Passando disso, as notas dos últimos cards simplesmente não chegavam
    // — e como o espelho é gravado com o que chegou, o sync gravava notas=[] e
    // processo_cnj=null POR CIMA dos dados bons, respondendo "Kommo
    // sincronizado" como se tudo estivesse certo. O mesmo acontecia se o filtro
    // note_type deixasse de casar e a página 1 voltasse 204.
    //
    // A busca dirigida elimina o teto em vez de aumentá-lo, e para algumas
    // dezenas de cards custa MENOS requisições que as 40 páginas anteriores.
    // Também não gasta orçamento com notas de outros funis nem de cards fechados.
    //
    // O filtro note_type=common é o que mantém as anotações da própria integração
    // (service_message) fora daqui — sem isso, nosso registro de auditoria seria
    // confundido com dado do crédito. Acumula TODAS as notas de cada card, não só
    // a mais antiga: comentários posteriores do comercial também interessam.
    const notasPorLead = new Map<number, KommoNote[]>()
    // 100 ids por requisição: 250 caberiam no limite da API, mas a URL passaria
    // de 2.500 caracteres e servidor intermediário costuma cortar antes disso.
    const IDS_POR_CONSULTA = 100
    for (let i = 0; i < leads.length; i += IDS_POR_CONSULTA) {
      const ids = leads.slice(i, i + IDS_POR_CONSULTA).map((l) => l.id)
      const filtroIds = ids.map((id) => `filter[entity_id][]=${id}`).join('&')
      for (let pagina = 1; pagina <= 40; pagina++) {
        const r = await kommo<{
          _embedded?: { notes?: KommoNote[] }
          _links?: { next?: { href?: string } }
        }>(`/leads/notes?${filtroIds}&filter[note_type][]=common&limit=250&page=${pagina}`)
        if (!r) break
        for (const n of r._embedded?.notes ?? []) {
          if (!n.params?.text?.trim()) continue
          const lista = notasPorLead.get(n.entity_id)
          if (lista) lista.push(n)
          else notasPorLead.set(n.entity_id, [n])
        }
        if (!r._links?.next?.href) break
      }
    }
    // Da mais antiga para a mais recente. A API não garante ordem entre páginas,
    // então ordenar aqui é o que torna notas[0] confiável como "primeira".
    for (const lista of notasPorLead.values()) {
      lista.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
    }

    // ---------- Grava o espelho ----------
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

    // ---------- Limpeza do espelho ----------
    //
    // Card que saiu do funil (ou foi apagado no Kommo) sai do espelho. UM DELETE
    // POR FUNIL, escopado com `.eq('pipeline_id', ...)`.
    //
    // O QUE ISSO CONSERTA, e era grave: a versão anterior juntava os ids dos
    // dois funis numa lista só e apagava `pipeline_id in (os dois) and
    // kommo_lead_id not in (a lista)`. Enquanto o funil de Precatórios estava
    // vazio isso passava, porque a lista era só de RPV. No dia em que o
    // Precatório tivesse UM card e a leitura do RPV voltasse vazia, a lista
    // ficaria com esse único id e o delete apagaria OS 150 CARDS DE RPV — com
    // resposta `ok: true` e a tela mostrando "Nenhum card aguardando revisão".
    // Exatamente "não consegui ler" virando "não tem nada".
    //
    // E FUNIL QUE VOLTOU VAZIO COM ESPELHO CHEIO NÃO É FUNIL QUE ESVAZIOU. O
    // Kommo devolve 204 quando o filtro não casa nada — e um id de funil que
    // deixou de existir casa nada do mesmo jeito que um funil de fato vazio.
    // Nesse caso o certo é não apagar e avisar: 150 cards não somem de uma vez
    // por decisão de ninguém.
    let removidos = 0
    const avisosEspelho: string[] = []
    for (const [funil, ids] of idsPorFunil) {
      if (ids.length === 0) {
        const { count } = await svc
          .from('kommo_leads')
          .select('kommo_lead_id', { count: 'exact', head: true })
          .eq('pipeline_id', funil)
        if ((count ?? 0) > 0) {
          avisosEspelho.push(
            `O funil ${funil} não devolveu card nenhum, mas o espelho tem ` +
            `${count}. NÃO apaguei nada: some tudo de uma vez é sinal de ` +
            `leitura falhada, não de funil esvaziado. Confira o id do funil e ` +
            `as permissões do token no Kommo.`,
          )
        }
        continue
      }
      const { data: apagados, error: erroDel } = await svc
        .from('kommo_leads')
        .delete()
        .eq('pipeline_id', funil)
        .not('kommo_lead_id', 'in', `(${ids.join(',')})`)
        .select('kommo_lead_id')
      if (erroDel) {
        avisosEspelho.push(`Funil ${funil}: falha ao limpar o espelho — ${erroDel.message}`)
      }
      removidos += apagados?.length ?? 0
    }

    // Marcações internas de cards que não existem mais ficariam órfãs — a UI as
    // ignoraria, mas acumulariam sem limite.
    //
    // Derivado DO ESPELHO, não da lista que acabou de chegar da API: assim uma
    // leitura vazia não apaga as marcações de 150 cards que continuam lá. Órfã é
    // marcação sem card em kommo_leads, e é isso que a consulta pergunta.
    const { data: noEspelho } = await svc
      .from('kommo_leads')
      .select('kommo_lead_id')
      .in('pipeline_id', FUNIS)
    const idsEspelho = (noEspelho ?? []).map((r) => r.kommo_lead_id)
    if (idsEspelho.length) {
      await svc
        .from('kommo_analise_interna')
        .delete()
        .not('kommo_lead_id', 'in', `(${idsEspelho.join(',')})`)
    }

    const comCnj = registros.filter((r) => r.processo_cnj).length
    return jsonResponse({
      ok: true,
      resumo: {
        leads: registros.length,
        com_nota: registros.filter((r) => r.nota_texto).length,
        com_cnj: comCnj,
        removidos,
        etapas: etapasGravadas,
      },
      // Sucesso PARCIAL volta como aviso, não como erro: os cards
      // sincronizaram. Mas volta — coluna nova que não chegou aqui é aba que não
      // aparece na tela, e funil que voltou vazio com espelho cheio é leitura
      // falhada. Nenhum dos dois pode ser descoberto por acidente.
      aviso: [avisoEtapas, ...avisosEspelho].filter(Boolean).join(' · ') || null,
      mensagem:
        `Kommo sincronizado — ${registros.length} card(s), ` +
        `${comCnj} com processo identificado` +
        (removidos ? `, ${removidos} removido(s)` : '') +
        (etapasGravadas ? `, ${etapasGravadas} coluna(s) de kanban` : '') + '.',
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
