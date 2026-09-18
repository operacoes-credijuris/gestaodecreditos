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
import { ehNotaNossa } from '../_shared/notaCredijuris.ts'
import { semEntidadesHtml } from '../_shared/textoDoKommo.ts'
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
import { cnjDoCard } from '../_shared/nucleo/cnj.ts'

const FUNIL_RPV = 13901939
const FUNIL_PRECATORIO = 13971995
// OS DOIS FUNIS NOVOS DE PRECATÓRIO, criados em 14/09/2026 para separar o que
// antes convivia num pipeline só — a trilha interna e a externa. Entram aqui
// antes de qualquer outra coisa porque NADA da tela funciona sem isto: o
// espelho das colunas é filtrado por esta lista (`FUNIS.includes(p.id)`), e os
// cards também são buscados por ela. Sem estes dois ids, os funis novos não
// existem para a plataforma.
const FUNIL_PRECATORIO_INTERNO = 14439512;
const FUNIL_PRECATORIO_EXTERNO = 14439516;
// O FUNIL ANTIGO CONTINUA NA LISTA POR ENQUANTO. Ele foi dado por encerrado,
// mas tirá-lo agora deixaria de atualizar cards que talvez ainda estejam lá —
// e o espelho deles some da tela sem aviso. Sai quando a migração terminar.
const FUNIS = [FUNIL_RPV, FUNIL_PRECATORIO, FUNIL_PRECATORIO_INTERNO, FUNIL_PRECATORIO_EXTERNO];

// Margem confortável abaixo do teto de 7/s.
const INTERVALO_MS = 160

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

// O CNJ, EM QUALQUER FORMA DE ESCREVER, e a ordem das fontes: ver
// _shared/nucleo/cnj.ts.
//
// AQUI ESTAVA A CAUSA de um card carregar o número de outro processo. O regex
// daqui exigia o formato PONTUADO, e o título que o comercial digita costuma
// trazer os VINTE DÍGITOS CRUS — "Dr. Alex Dornelas Loures -
// 10063770820204013814". Não achando o número no título, a busca seguia para as
// ANOTAÇÕES e gravava o primeiro CNJ pontuado que houvesse ali: um processo
// CITADO numa nota, das dívidas que a diligência apurou sobre o titular. O card
// passava a se chamar por um processo que não é o dele — no nome do arquivo do
// Drive, na conferência do anexo, na busca por processo.
const extrairCnj = (...textos: (string | null | undefined)[]): string | null =>
  cnjDoCard(textos[0], ...textos.slice(1)) || null

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

/**
 * Um evento de movimentação de card (`lead_status_changed`).
 *
 * `value_after` é uma LISTA de um item só — é assim que a API devolve, e
 * tratá-la como objeto foi a primeira coisa que eu errei ao ler a documentação.
 */
interface EventoKommo {
  entity_id: number
  created_at?: number
  value_after?: { lead_status?: { id?: number; pipeline_id?: number } }[]
}

interface RespostaEventos {
  _embedded?: { events?: EventoKommo[] }
  _links?: { next?: { href?: string } }
}

interface KommoNote {
  id: number
  entity_id: number
  note_type?: string
  created_at?: number
  created_by?: number
  params?: Record<string, unknown>
}

/**
 * O texto de uma nota, qualquer que seja o tipo dela.
 *
 * NEM TODA NOTA GUARDA O TEXTO EM `text`. O anexo guarda o nome do arquivo, e
 * era por isso que "fulano anexou o PDF" nunca aparecia no histórico do card:
 * a nota vinha, `params.text` era vazio, e o laço a descartava. Num card cuja
 * conversa inteira é troca de documento, o histórico ficava quase vazio.
 */
function textoDaNota(n: KommoNote): string {
  const p = n.params ?? {}
  // SEM AS ENTIDADES HTML: o Kommo guarda a nota como HTML e a devolve
  // escapada — "-&gt;" onde a pessoa escreveu "->". Ver _shared/textoDoKommo.ts.
  const texto = semEntidadesHtml(p.text).trim()
  if (texto) return texto
  const arquivo = semEntidadesHtml(p.original_file_name ?? p.file_name).trim()
  return arquivo ? `📎 ${arquivo}` : ''
}

/** Uma anotação como fica guardada em kommo_leads.notas. */
interface NotaGravada {
  id: number
  texto: string
  criado_em: string | null
  autor: string | null
  /** O tipo no Kommo: `common`, `service_message`, `attachment`… */
  tipo: string
  /**
   * O uuid do arquivo, quando a nota é um anexo.
   *
   * É A CHAVE DE VERDADE DO ARQUIVO, e o que permite abri-lo. Sem ele, a tela
   * procurava o anexo clicado pelo NOME na lista de arquivos do card — e nome de
   * arquivo repete ("default.aspx1.pdf", "default.aspx2.pdf", que é como um
   * tribunal exporta), além de a lista da entidade nem sempre conter o arquivo de
   * uma anotação. Abrir a peça errada é pior do que não abrir nada.
   *
   * O ENDEREÇO NÃO É GUARDADO: ele é assinado e vence. Guarda-se o uuid, que não
   * muda, e o endereço se pede no clique (ver a function kommo-anexo).
   */
  arquivo_uuid: string | null
  /**
   * A nota foi escrita pelo sistema?
   *
   * MARCA EM VEZ DE DESCARTE, e é a correção que este campo traz. A nota nossa
   * era EXCLUÍDA do espelho para a análise não reler a própria ficha como
   * cadastro do comercial — o que continua valendo. Mas quem lê o card na tela
   * perdia junto o registro do que a casa decidiu, e o histórico ficava com
   * buracos sem explicação: anotações esparsas, como se o comercial tivesse
   * escrito pouco.
   *
   * Agora a nota fica, marcada. Quem exibe mostra tudo; quem alimenta a análise
   * filtra por este campo.
   */
  automatica: boolean
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
    // TODOS OS TIPOS DE NOTA, e não só `common` — foi o que fez o histórico do
    // card aparecer pela metade. O filtro `note_type=common` deixava de fora o
    // registro de movimentação (`service_message`, que é como a plataforma anota
    // quem moveu o card e por quê), as mensagens de automação do Kommo e os
    // anexos. Quem abria o card na plataforma via anotações esparsas e concluía
    // que o comercial tinha escrito pouco.
    //
    // A NOSSA PRÓPRIA ANOTAÇÃO TAMBÉM FICA, agora MARCADA em vez de descartada.
    // O motivo do descarte continua de pé e não pode ser esquecido: deixar a
    // nossa anotação ALIMENTAR A ANÁLISE é a análise ler o próprio resultado como
    // cadastro do comercial — a ficha que ela escreveu vira "o que o card diz" na
    // análise seguinte, e o sistema confirma a si mesmo. Isso já aconteceu.
    //
    // O que mudou é que são DUAS PERGUNTAS: o que o card tem (tudo, para quem
    // lê) e o que é cadastro do comercial (só o que não é nosso, para quem
    // analisa). `NotaGravada.automatica` separa as duas.
    const notasPorLead = new Map<number, KommoNote[]>()
    // 100 ids por requisição: 250 caberiam no limite da API, mas a URL passaria
    // de 2.500 caracteres e servidor intermediário costuma cortar antes disso.
    const IDS_POR_CONSULTA = 100
    // O TETO DE PÁGINAS SUBIU COM OS TIPOS. Filtrando `common` cabiam 10 mil notas
    // por lote de 100 cards; trazendo movimentação, anexo e automação o volume
    // multiplica, e passar do teto faz os ÚLTIMOS cards do lote chegarem sem nota
    // nenhuma — gravando `notas: []` por cima dos dados bons, com resposta "Kommo
    // sincronizado". É o mesmo defeito que a busca dirigida veio corrigir.
    const MAX_PAGINAS_NOTAS = 100
    let notasCortadas = 0
    for (let i = 0; i < leads.length; i += IDS_POR_CONSULTA) {
      const ids = leads.slice(i, i + IDS_POR_CONSULTA).map((l) => l.id)
      const filtroIds = ids.map((id) => `filter[entity_id][]=${id}`).join('&')
      let pagina = 1
      for (; pagina <= MAX_PAGINAS_NOTAS; pagina++) {
        const r = await kommo<{
          _embedded?: { notes?: KommoNote[] }
          _links?: { next?: { href?: string } }
        }>(`/leads/notes?${filtroIds}&limit=250&page=${pagina}`)
        if (!r) break
        for (const n of r._embedded?.notes ?? []) {
          // SEM TEXTO NENHUM não há o que mostrar nem o que ler: nota de
          // geolocalização, por exemplo, não tem palavra nenhuma.
          if (!textoDaNota(n)) continue
          const lista = notasPorLead.get(n.entity_id)
          if (lista) lista.push(n)
          else notasPorLead.set(n.entity_id, [n])
        }
        if (!r._links?.next?.href) break
      }
      // SAIU PELO TETO, E NÃO PORQUE ACABOU: o que falta não pode passar calado.
      if (pagina > MAX_PAGINAS_NOTAS) notasCortadas += ids.length
    }
    // Da mais antiga para a mais recente. A API não garante ordem entre páginas,
    // então ordenar aqui é o que torna notas[0] confiável como "primeira".
    for (const lista of notasPorLead.values()) {
      lista.sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
    }

    // ---------- Desde quando cada card está na coluna em que está ----------
    //
    // A PERGUNTA DE QUEM ABRE A TELA é há quanto tempo um crédito está parado
    // naquela coluna, e nenhum campo do card responde isso: `created_at` é o
    // nascimento e `updated_at` muda com qualquer edição — responsável, tag,
    // anotação. Um card criado em março e movido ontem erra nos dois.
    //
    // A FONTE É O EVENTO `lead_status_changed`, que traz origem, destino e hora.
    // Duas passadas, e a divisão é o que mantém isto barato: a janela recente
    // cobre quem se moveu desde a última sincronização — que é quase sempre o
    // único grupo que mudou —, e a busca dirigida preenche o resto, uma vez por
    // card, porque o valor fica guardado no espelho.
    //
    // FALHAR AQUI NÃO DERRUBA O SYNC: a data é conforto na tela, os cards são o
    // serviço. Mas o aviso volta no resumo, porque uma coluna sem data é
    // diferente de uma coluna cujos cards entraram todos hoje.
    const jaSabido = new Map<number, { em: string | null; status: number | null }>()
    // A PRÓPRIA LEITURA DIZ SE A MIGRAÇÃO 0066 JÁ RODOU, e isso não é esperteza:
    // é o que separa o deploy da migração. Sem a coluna, um upsert que a mencione
    // derruba a sincronização INTEIRA — os cards param de chegar à tela por causa
    // de uma data no canto do card. Detectando aqui, o sync segue sem a data e diz
    // o que falta, em vez de morrer com um erro de coluna inexistente.
    let temColunaEtapa = true
    {
      const { data: doEspelho, error: erroEspelho } = await svc
        .from('kommo_leads')
        .select('kommo_lead_id, etapa_em, etapa_status_id')
        .in('pipeline_id', FUNIS)
      if (erroEspelho) temColunaEtapa = false
      for (const r of doEspelho ?? []) {
        jaSabido.set(r.kommo_lead_id, { em: r.etapa_em, status: r.etapa_status_id })
      }
    }

    const statusAtual = new Map(leads.map((l) => [l.id, l.status_id]))
    const entradaNaColuna = new Map<number, string>()
    const perguntados = new Set<number>()

    /**
     * Guarda o evento se ele for a entrada na coluna ATUAL do card.
     *
     * A MAIS RECENTE ENTRE AS QUE CASAM, e não a primeira que aparecer: um card
     * que foi de Revisão para Diligência e voltou tem duas entradas em Revisão,
     * e a que vale é a última. A API não promete ordem entre páginas, então isto
     * é um máximo.
     */
    const anotarEvento = (e: EventoKommo) => {
      const destino = e.value_after?.[0]?.lead_status?.id
      const quando = iso(e.created_at)
      if (!quando || !destino || destino !== statusAtual.get(e.entity_id)) return
      const anterior = entradaNaColuna.get(e.entity_id)
      if (!anterior || quando > anterior) entradaNaColuna.set(e.entity_id, quando)
    }

    // A MENSAGEM TEM DE DIZER O QUE FALTA. Cair no catch aqui responderia 'não
    // consegui ler os eventos do Kommo', que é falso e manda procurar no lugar
    // errado: o Kommo está bem, o banco é que ainda não tem onde guardar.
    let avisoEventos: string | null = temColunaEtapa
      ? null
      : 'A migração 0066 ainda não rodou (colunas etapa_em e etapa_status_id). Os cards ' +
        'sincronizam normalmente; o que falta é a data de entrada na coluna, no canto do card.'
    try {
      const desde = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60
      for (let pagina = 1; temColunaEtapa && pagina <= 20; pagina++) {
        const r = await kommo<RespostaEventos>(
          '/events?filter[entity]=lead&filter[type]=lead_status_changed' +
            `&filter[created_at][from]=${desde}&limit=250&page=${pagina}`,
        )
        if (!r) break
        for (const e of r._embedded?.events ?? []) anotarEvento(e)
        if (!r._links?.next?.href) break
      }

      // Quem continua sem data: card novo para o espelho, card que se moveu há
      // mais tempo que a janela, ou card cuja data guardada é de outra coluna.
      const faltando = !temColunaEtapa ? [] : leads.filter((l) => {
        if (entradaNaColuna.has(l.id)) return false
        const s = jaSabido.get(l.id)
        return !(s?.em && s.status === l.status_id)
      })
      // DEZ IDS POR CONSULTA é o teto documentado do filter[entity_id] em
      // /events — não é escolha nossa, e é por isso que há um teto de consultas
      // logo abaixo: 300 cards sem data custariam 30 requisições.
      const IDS_POR_CONSULTA_EVENTO = 10
      const MAX_CONSULTAS_EVENTO = 40
      let consultas = 0
      for (
        let i = 0;
        i < faltando.length && consultas < MAX_CONSULTAS_EVENTO;
        i += IDS_POR_CONSULTA_EVENTO
      ) {
        const ids = faltando.slice(i, i + IDS_POR_CONSULTA_EVENTO).map((l) => l.id)
        consultas++
        for (let pagina = 1; pagina <= 10; pagina++) {
          const r = await kommo<RespostaEventos>(
            `/events?filter[entity]=lead&filter[entity_id]=${ids.join(',')}` +
              '&filter[type]=lead_status_changed&limit=250&page=' + pagina,
          )
          if (!r) break
          for (const e of r._embedded?.events ?? []) anotarEvento(e)
          if (!r._links?.next?.href) break
        }
        // PERGUNTADO É DIFERENTE DE NÃO ACHADO. Só quem passou por aqui pode
        // cair no `created_at`: para quem não coube na passada, ficar sem data é
        // o que faz a próxima tentar de novo — gravar um palpite congelaria o
        // erro, porque a condição que traz o card de volta a esta lista é
        // justamente não ter data.
        for (const id of ids) perguntados.add(id)
      }
      const semConsulta = faltando.length - consultas * IDS_POR_CONSULTA_EVENTO
      if (semConsulta > 0) {
        avisoEventos =
          `${semConsulta} card(s) ficaram sem a data de entrada na coluna nesta passada ` +
          '(teto de consultas por sincronização). A próxima continua de onde esta parou.'
      }
    } catch (e) {
      avisoEventos =
        'Não consegui ler os eventos de movimentação do Kommo: ' +
        `${(e as Error)?.message ?? e}. As datas de entrada na coluna ficam como estavam.`
    }

    /** A data de entrada na coluna atual, e a coluna a que ela se refere. */
    const etapaDoLead = (l: KommoLead): { em: string | null; status: number | null } => {
      const achado = entradaNaColuna.get(l.id)
      if (achado) return { em: achado, status: l.status_id }
      const antes = jaSabido.get(l.id)
      if (antes?.em && antes.status === l.status_id) return { em: antes.em, status: antes.status }
      // Perguntamos e não há evento: ou o card nunca saiu da coluna em que
      // nasceu, ou a movimentação é mais antiga que o histórico que o Kommo
      // guarda. `created_at` é a melhor resposta verdadeira nos dois casos — e é
      // a resposta exata no primeiro.
      if (perguntados.has(l.id)) return { em: iso(l.created_at), status: l.status_id }
      return { em: antes?.em ?? null, status: antes?.status ?? null }
    }

    // ---------- Grava o espelho ----------
    const registros = leads.map((l) => {
      const doLead = notasPorLead.get(l.id) ?? []
      const notas: NotaGravada[] = doLead.map((n) => {
        const texto = textoDaNota(n)
        const criadoEm = iso(n.created_at)
        return {
          id: n.id,
          texto,
          criado_em: criadoEm,
          // created_by = 0 é o robô/automação do Kommo, não uma pessoa.
          autor: n.created_by ? usuarios.get(n.created_by) ?? null : null,
          tipo: String(n.note_type ?? 'common'),
          arquivo_uuid: String((n.params as Record<string, unknown> | undefined)?.file_uuid ?? '') || null,
          // O QUE NÃO É `common` NÃO É CADASTRO. Movimentação, anexo e mensagem
          // de automação são registro do que aconteceu com o card, não o que o
          // comercial declarou sobre o crédito — e a análise lê declaração.
          // A DATA VAI JUNTO: sem ela, o reconhecimento por forma — que existe para
          // as notas antigas, sem assinatura — marcaria como nossa a nota em que uma
          // PESSOA colou o resumo da oportunidade.
          automatica: n.note_type !== 'common' || ehNotaNossa(texto, criadoEm),
        }
      })
      // nota_texto é simplesmente a PRIMEIRA anotação DO COMERCIAL — sem promessa
      // de conter os dados do crédito. Há cards em que a primeira é um comentário
      // curto ("qualificado") e o bloco de dados vem na segunda.
      //
      // SÓ AS DE GENTE, e é o que preserva o que este campo sempre significou:
      // agora que as nossas e as de sistema também são guardadas, a primeira nota
      // do card pode ser uma movimentação automática — e a análise passaria a ler
      // "Card movido para Diligência" como cadastro do crédito.
      const doComercial = notas.filter((n) => !n.automatica)
      const nota = doComercial[0]?.texto ?? null
      const etapa = etapaDoLead(l)
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
        // O TÍTULO PRIMEIRO, depois as anotações. O título é o cadastro do
        // card — "[intermediador] - [cedente] - [nº] - …" —, e qualquer CNJ
        // citado numa anotação (processo conexo, outro do mesmo cedente, um
        // "ver também") vencia o dele. Como esse número sobrepõe o que a IA lê
        // nos autos, o processo errado ia para o nome do arquivo e para a UF
        // do cartório. As anotações continuam valendo, para o card antigo sem
        // número no título.
        processo_cnj: extrairCnj(l.name, ...doComercial.map((n) => n.texto)),
        // filter(Boolean) não estreita o tipo em TS, então o predicado é
        // explícito — a coluna é text[] not null e não aceita nulo no meio.
        tags: (l._embedded?.tags ?? [])
          .map((t) => t.name)
          .filter((n): n is string => typeof n === 'string' && n.length > 0),
        criado_em: iso(l.created_at),
        atualizado_em: iso(l.updated_at),
        // A DATA E A COLUNA A QUE ELA SE REFERE, sempre juntas: sozinha, a
        // data continuaria na tela depois de o card mudar de coluna, dizendo
        // com confiança há quanto tempo ele está num lugar onde não está.
        ...(temColunaEtapa ? { etapa_em: etapa.em, etapa_status_id: etapa.status } : {}),
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
      aviso: [
        avisoEtapas,
        avisoEventos,
        notasCortadas > 0
          ? `Um lote de ${notasCortadas} card(s) tem mais anotações do que coube nesta ` +
            `passada: o histórico deles pode estar incompleto.`
          : null,
        ...avisosEspelho,
      ].filter(Boolean).join(' · ') || null,
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
