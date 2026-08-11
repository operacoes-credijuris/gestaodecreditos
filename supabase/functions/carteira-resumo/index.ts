// Escreve as colunas "Estágio processual" e "Providências / prox. passos" da
// carteira do investidor (public.carteira_resumos), com o Claude, a partir do
// histórico de movimentações e de tarefas que os caches do ADVBOX já mantêm.
//
// POR QUE OS DOIS TEXTOS SAEM DA MESMA CHAMADA: providências depende do estágio
// apurado. Em duas chamadas separadas o modelo pode apurar o estágio de um jeito
// num campo e de outro no outro, e os dois textos se contradizem na frente do
// investidor. Juntos, saem coerentes por construção — e custa metade.
//
// Modos:
//   { processo_id }        um crédito só, sempre forçado (botão "gerar novamente")
//   { forcar?: boolean }   varredura: primeira chamada da cadeia
//   { fila: string[] }     fatia encadeada (uso interno)
//
// Autorização: JWT do usuário (app) OU x-cron-secret (pg_cron), igual às demais.
//
// A varredura se auto-encadeia em lotes pequenos: 95 créditos numa invocação
// estouraria o WORKER_RESOURCE_LIMIT (~150s) do edge function.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'

// Haiku dá conta desta tarefa: o texto é curto, o formato é fixo e o dossiê
// chega pronto e em ordem cronológica, então sobra pouca decisão para o modelo.
// O corpo da requisição aceita `modelo` para comparar sem novo deploy.
const MODELO = 'claude-haiku-4-5-20251001'

// Créditos por invocação, e quantas chamadas ao modelo em paralelo dentro do
// lote. Cada crédito pode custar até TRÊS idas ao modelo (a conferência de
// forma manda reescrever até duas vezes), então o pior caso de 6 x 3 é ~6 ondas
// de ~12s. Folga sobre o WORKER_RESOURCE_LIMIT de ~150s.
const BATCH = 6
const CONCORRENCIA = 3

// Teto de insumo por crédito. O histórico é integral e alguns processos têm
// centenas de andamentos; os mais recentes é que dizem onde o processo está.
const MAX_ANDAMENTOS = 40
const MAX_TAREFAS = 20

const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

// Hash estável (djb2 em base36) — impressão digital dos insumos.
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

const SISTEMA = `Você é analista jurídico da Credijuris, especializada em créditos judiciais contra a Fazenda Pública.

CONTEXTO FIXO — vale para todo crédito analisado:
A Credijuris adquire créditos judiciais de credores originais (cedentes) e os cede a investidores (cessionários). Todo crédito aqui é processo em FASE DE CUMPRIMENTO DE SENTENÇA CONTRA A FAZENDA PÚBLICA (União, Estado, Município ou autarquia). O caminho típico:

  1. Sentença/acórdão de mérito e trânsito em julgado da fase de conhecimento
  2. Início do cumprimento de sentença
  3. Impugnação da Fazenda, ou concordância com os cálculos
  4. Cálculos da contadoria judicial e homologação
  5. Expedição do requisitório: RPV (Requisição de Pequeno Valor) ou precatório
  6. Pagamento — RPV em até 60 dias da requisição; precatório no ciclo orçamentário
  7. Levantamento pelo credor (alvará ou transferência)

QUEM LÊ: o investidor que comprou o crédito. Pessoa de bom nível de compreensão, mas NÃO formada em Direito. Português formal e técnico, explicando o termo quando ele for indispensável. Direto ao ponto, sem floreio, sem citar artigos de lei, sem jargão desnecessário.

PARA QUE SERVE O TEXTO
É a prestação de contas da Credijuris ao investidor. Ele precisa deixar evidente que a equipe acompanha o caso de perto e age sempre que existe algo a fazer. A maneira de demonstrar isso é ser ESPECÍFICO sobre os atos praticados, dizendo que petição foi protocolada, o que ela pedia e o que se obteve com ela. Não é usar adjetivos sobre a própria atuação. NUNCA qualifique a equipe. As palavras diligente, diligência, atenta, atentos, dedicada, proativa, empenhada, empenho, zelosa e comprometida estão PROIBIDAS, inclusive em fechamentos do tipo "permanecemos atentos" ou "a equipe segue atenta aos prazos". Diga o que se está acompanhando, não que se está atento. Mostre o trabalho e deixe o investidor concluir sozinho.
Todo ato praticado pela Credijuris deve aparecer. Quando o processo depende de terceiro, seja o juízo, a Fazenda ou o banco, diga o que a Credijuris fez para provocar esse terceiro e o que fará em seguida, para o investidor nunca ter a impressão de que o caso dele está parado sem ninguém olhando. Escreva na primeira pessoa do plural, como parte da equipe (acompanhamos, protocolamos, requereremos).

REGRAS DE CONTEÚDO:
- NÃO MENCIONE DATAS. Nenhuma, em nenhuma forma. Nem dia, nem mês, nem ano, nem "há três meses", nem "desde o ano passado", nem "recentemente" com data. As datas do dossiê existem só para você entender a ORDEM dos fatos. Para situar no tempo use palavras de sequência, como inicialmente, em seguida, depois, mais recentemente, ainda, já.
- Só afirme o que os andamentos e tarefas fornecidos sustentam. Se a informação não está ali, diga que não há registro. NUNCA invente etapa nem valor.
- O ÚLTIMO andamento da lista define a situação de HOJE. Não diga que algo está pendente, resolvido ou a caminho se um andamento posterior disser o contrário.
- Quando o MESMO tipo de evento se repete no processo, por exemplo alvará expedido e não cumprido mais de uma vez, ou petição seguida de nova petição do mesmo teor, entenda que são CICLOS DISTINTOS. Diga quantas vezes ocorreu, sem datar. Nunca descreva a mesma ocorrência duas vezes como se fossem duas, nem trate um pedido como já atendido só porque um pedido anterior semelhante foi atendido.
- Distinga PEDIDO de DEFERIMENTO. Uma petição requerendo algo não é o ato requerido. Só diga que foi expedido, homologado ou deferido se houver andamento dizendo isso.
- Não prometa prazo de pagamento.
- Nada de "provavelmente", "acredito", "parece". Se é incerto, diga que é incerto.
- Não repita número do processo nem nome das partes, já estão na tabela.
- Nenhum valor em reais.

FORMA (regra rígida):
- NÃO use dois-pontos em nenhum lugar do texto.
- NÃO use travessão nem meia-risca. Para separar ideias use vírgula, ponto, ou reescreva a frase.
- Texto corrido, sem listas, marcadores ou negrito.
- Cada campo tem no MÁXIMO 600 caracteres. O limite é CONFERIDO automaticamente e o texto é devolvido para reescrita se estourar. Mire em 350 para ter folga.
- Corte o histórico antigo antes de cortar a situação atual. O investidor precisa saber onde o processo está, não a lista do que já passou. Não é preciso narrar todos os atos, só os que explicam onde o processo chegou.`

const FERRAMENTA = {
  name: 'registrar_resumo',
  description:
    'Registra os dois textos que vão para as colunas da carteira do investidor.',
  input_schema: {
    type: 'object' as const,
    properties: {
      estagio_processual: {
        type: 'string',
        description:
          'Em que ponto do caminho o processo está hoje e o que aconteceu de mais relevante para chegar aí. Situe o investidor sobre o que já foi vencido e o que ainda falta. Se houver requisitório expedido, diga qual, RPV ou precatório. Se o processo aguarda ato de terceiro, diga aguardando o quê. SEM NENHUMA DATA, sem dois-pontos e sem travessão. MÁXIMO 600 CARACTERES, mire em 400.',
      },
      providencias: {
        type: 'string',
        description:
          'O que a Credijuris fez, está fazendo e fará em seguida, considerando o estágio apurado. Cite os atos concretos praticados e o que cada um buscava, para o investidor ver o acompanhamento em vez de ouvir que ele existe. Se o próximo passo depende de decisão do juízo, da Fazenda ou do banco, diga o que a Credijuris fez para provocá-la e como seguirá acompanhando. Primeira pessoa do plural. SEM NENHUMA DATA, sem dois-pontos e sem travessão. MÁXIMO 600 CARACTERES, mire em 400.',
      },
    },
    required: ['estagio_processual', 'providencias'],
  },
}

interface ProcessoRow {
  id: string
  numero_cnj: string | null
  tribunal: string | null
  comarca: string | null
  vara: string | null
  entidade_devedora: string | null
  tipo_credito: string[] | null
  data_aquisicao: string | null
  expectativa_liquidacao: string | null
  data_liquidacao: string | null
  status: string | null
}

interface MovRow {
  /** PK estável (text). Entra na impressão digital do insumo. */
  id: string
  numero_digits: string | null
  data: string | null
  data_ts: string | null
  conteudo: string | null
}

interface TarefaRow {
  id: string
  numero_digits: string | null
  tipo: string | null
  data: string | null
  date_deadline: string | null
  notes: string | null
  concluida: boolean | null
}

/** Texto que vai ao modelo: cadastro do crédito + andamentos + tarefas. */
function montarDossie(
  p: ProcessoRow,
  movs: MovRow[],
  tarefas: TarefaRow[],
): string {
  const linhas: string[] = []
  linhas.push('## Cadastro do crédito')
  linhas.push(`- Ente devedor: ${p.entidade_devedora || 'não informado'}`)
  linhas.push(
    `- Tribunal/vara: ${[p.tribunal, p.comarca, p.vara].filter(Boolean).join(' · ') || 'não informado'}`,
  )
  linhas.push(`- Tipo de crédito: ${(p.tipo_credito ?? []).join(', ') || 'não informado'}`)
  linhas.push(`- Data da cessão: ${p.data_aquisicao || 'não informada'}`)
  linhas.push(
    `- Expectativa de liquidação: ${p.expectativa_liquidacao || 'não informada'}`,
  )
  linhas.push(
    `- Data de liquidação: ${p.data_liquidacao || 'não liquidado'}`,
  )

  linhas.push('')
  // ORDEM CRONOLÓGICA CRESCENTE, de propósito. `movs` chega do mais recente
  // para o mais antigo (é assim que se seleciona os N últimos), mas entregar
  // nessa ordem ao modelo embaralha a causalidade: num processo com dois ciclos
  // de "alvará expedido → não cumprido", ele tratou o segundo alvará como um
  // terceiro, ainda pendente, quando o andamento seguinte já dizia que também
  // não foi cumprido. Lida de trás para frente, a sequência causal se desfaz.
  const cronologico = [...movs].reverse()
  linhas.push(
    `## Andamentos (${movs.length} enviados, do mais ANTIGO para o mais RECENTE)`,
  )
  if (cronologico.length === 0) {
    linhas.push('Nenhum andamento registrado.')
  } else {
    for (const m of cronologico) {
      linhas.push(`- ${m.data ?? 'sem data'}: ${(m.conteudo ?? '').trim()}`)
    }
    const ultimo = cronologico[cronologico.length - 1]
    linhas.push('')
    linhas.push(
      `>>> SITUAÇÃO MAIS RECENTE (${ultimo.data ?? 'sem data'}): ` +
        `${(ultimo.conteudo ?? '').trim()}`,
    )
    linhas.push(
      '>>> É este andamento que descreve onde o processo está HOJE. Nenhuma ' +
        'afirmação sobre a situação atual pode contrariá-lo.',
    )
  }

  const pendentes = tarefas.filter((t) => !t.concluida)
  const concluidas = tarefas.filter((t) => t.concluida)
  linhas.push('')
  linhas.push('## Tarefas internas da Credijuris')
  if (tarefas.length === 0) {
    linhas.push('Nenhuma tarefa registrada.')
  } else {
    const descreve = (t: TarefaRow) =>
      `- ${t.data ?? 'sem data'}${t.date_deadline ? ` (prazo ${t.date_deadline})` : ''}: ` +
      `${t.tipo ?? 'sem tipo'}${t.notes ? ` — ${t.notes.trim()}` : ''}`
    // Também em ordem crescente, e pelo mesmo motivo: a sequência de petições
    // (pedir → reiterar → pedir dilação) só faz sentido lida para frente.
    const asc = (l: TarefaRow[]) => [...l].reverse()
    if (pendentes.length) {
      linhas.push('Em aberto (do mais antigo para o mais recente):')
      for (const t of asc(pendentes)) linhas.push(descreve(t))
    }
    if (concluidas.length) {
      linhas.push('Concluídas (do mais antigo para o mais recente):')
      for (const t of asc(concluidas)) linhas.push(descreve(t))
    }
  }
  return linhas.join('\n')
}

// ---------- Conferência das regras de forma ----------
// POR QUE ISTO EXISTE: instrução no prompt não basta. Na varredura de
// 2026-08-10, com as regras já escritas, 12 de 94 textos citaram data e 52
// estouraram o limite de caracteres. Confiar na auto-observância do modelo
// entrega texto fora do padrão ao investidor, então o código confere e manda
// reescrever apontando exatamente o que violou.
const LIMITE_CHARS = 600

const RE_DATA =
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b(19|20)\d{2}\b|\b(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i

// Só ADJETIVO de autoelogio. Duas exclusões deliberadas, aprendidas medindo:
//   "diligenciamos o registro cartorial"  -> verbo de ação, passa
//   "os autos saíram da diligência"       -> estado processual dos autos, passa
// O substantivo "diligência" é vocabulário jurídico corrente; bani-lo forçava
// reescrita de texto correto. O que não passa é qualificar a equipe, como em
// "a equipe segue atenta".
const RE_AUTOELOGIO =
  /\b(diligente|diligentes|proativ\w*|empenhad\w*|dedicad\w*|atent[oa]s?|zelos[oa]s?|comprometid[oa]s?)\b/i

// Piso de tamanho. SEM ISTO A CONFERÊNCIA PREMIA O CAMPO VAZIO: texto vazio não
// tem data, nem dois-pontos, nem excesso de caracteres, então pontua como
// perfeitamente conforme, e a escolha da "tentativa menos problemática" acaba
// preferindo uma resposta que abandonou o campo. Aconteceu de verdade.
const MIN_CHARS = 80

function problemas(campo: string, texto: string): string[] {
  const p: string[] = []
  if (texto.trim().length < MIN_CHARS) {
    p.push(
      `${campo} está vazio ou muito curto (${texto.trim().length} caracteres). Escreva o texto completo, entre ${MIN_CHARS} e ${LIMITE_CHARS} caracteres.`,
    )
  }
  if (texto.length > LIMITE_CHARS) {
    p.push(
      `${campo} tem ${texto.length} caracteres. O limite é ${LIMITE_CHARS}. Encurte cortando o histórico antigo, nunca a situação atual.`,
    )
  }
  const d = texto.match(RE_DATA)
  if (d) p.push(`${campo} menciona "${d[0]}". Datas são proibidas.`)
  if (texto.includes(':')) p.push(`${campo} usa dois-pontos, que são proibidos.`)
  if (/[—–]/.test(texto)) p.push(`${campo} usa travessão, que é proibido.`)
  const a = texto.match(RE_AUTOELOGIO)
  if (a) {
    p.push(
      `${campo} usa "${a[0]}", que é elogio à própria atuação. Descreva o ato praticado em vez de qualificar a equipe.`,
    )
  }
  return p
}

interface Resumo {
  estagio_processual: string
  providencias: string
}

const conferir = (r: Resumo): string[] => [
  ...problemas('O estágio processual', r.estagio_processual),
  ...problemas('As providências', r.providencias),
]

/** Uma ida ao modelo. `correcao` presente = segunda tentativa. */
async function chamar(
  anthropic: Anthropic,
  dossie: string,
  modelo: string,
  correcao: { anterior: Resumo; problemas: string[] } | null,
): Promise<Resumo> {
  let conteudo = 'Analise o crédito abaixo e registre os dois textos.\n\n' + dossie
  if (correcao) {
    conteudo +=
      '\n\n## Sua resposta anterior violou as regras\n' +
      `Estágio processual anterior:\n${correcao.anterior.estagio_processual}\n\n` +
      `Providências anteriores:\n${correcao.anterior.providencias}\n\n` +
      'Problemas a corrigir:\n' +
      correcao.problemas.map((p) => `- ${p}`).join('\n') +
      '\n\nReescreva os DOIS campos corrigindo esses problemas e preservando os fatos.'
  }
  const r = await anthropic.messages.create({
    model: modelo,
    max_tokens: 1200,
    system: SISTEMA,
    tools: [FERRAMENTA],
    tool_choice: { type: 'tool', name: FERRAMENTA.name },
    messages: [{ role: 'user', content: conteudo }],
  })
  for (const bloco of r.content) {
    if (bloco.type === 'tool_use') {
      const i = bloco.input as Record<string, unknown>
      return {
        estagio_processual: String(i.estagio_processual ?? '').trim(),
        providencias: String(i.providencias ?? '').trim(),
      }
    }
  }
  throw new Error('O modelo não retornou os campos esperados.')
}

// Reescritas depois da primeira tentativa. Com UMA só, sobraram 6 estouros de
// tamanho e 3 datas em 94 créditos; a segunda existe para essa cauda.
const TENTATIVAS_CORRECAO = 2

/** Gera e, enquanto a forma violar as regras, manda reescrever. */
async function gerarUm(
  anthropic: Anthropic,
  dossie: string,
  modelo: string,
): Promise<Resumo> {
  let melhor = await chamar(anthropic, dossie, modelo, null)
  let problemasMelhor = conferir(melhor)

  for (let i = 0; i < TENTATIVAS_CORRECAO && problemasMelhor.length > 0; i++) {
    const nova = await chamar(anthropic, dossie, modelo, {
      anterior: melhor,
      problemas: problemasMelhor,
    })
    const problemasNova = conferir(nova)
    // PESO, e não contagem. Contando, "providências vazias" (1 problema) empatava
    // com "estágio 20 caracteres acima do limite" (1 problema) e, por ser mais
    // recente, VENCIA: o loop trocava um texto completo e comprido por um campo
    // abandonado, e gravava isso como resumo válido na carteira do investidor.
    // Campo abandonado pesa 100; excesso de tamanho, acento de estilo e afins
    // pesam 1. E nenhuma tentativa que ESVAZIA um campo que já estava cheio é
    // aceita, mesmo que pontue melhor no resto.
    if (esvaziouCampo(melhor, nova)) continue
    if (pontuar(problemasNova) <= pontuar(problemasMelhor)) {
      melhor = nova
      problemasMelhor = problemasNova
    }
  }
  return melhor
}

/** Gravidade somada dos problemas: campo abandonado domina o resto. */
function pontuar(problemas: string[]): number {
  return problemas.reduce(
    (t, p) => t + (/vazio ou muito curto/.test(p) ? 100 : 1),
    0,
  )
}

/** A nova tentativa deixou vazio um campo que a anterior tinha preenchido? */
function esvaziouCampo(anterior: Resumo, nova: Resumo): boolean {
  const cheio = (v: string) => v.trim().length >= MIN_CHARS
  return (
    (cheio(anterior.estagio_processual) && !cheio(nova.estagio_processual)) ||
    (cheio(anterior.providencias) && !cheio(nova.providencias))
  )
}

/** Map com concorrência limitada, 1 resultado por item, preservando a ordem. */
async function mapPool<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const saida = new Array<R>(itens.length)
  let proximo = 0
  const trabalhador = async (): Promise<void> => {
    while (true) {
      const i = proximo++
      if (i >= itens.length) return
      saida[i] = await fn(itens[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, trabalhador),
  )
  return saida
}

/** Dispara a próxima fatia numa invocação separada (fire-and-forget). */
function dispararProximo(fila: string[], forcar: boolean, modelo: string): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/carteira-resumo`
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const p = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    // O modelo vai adiante: sem isso a cadeia trocaria de modelo no meio da
    // varredura e a carteira ficaria com textos de origens diferentes.
    body: JSON.stringify({ fila, forcar, modelo }),
  }).catch(() => {})
  const rt = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
  }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    const headerSecret = req.headers.get('x-cron-secret')
    const autorizadoPorCron = !!cronSecret && headerSecret === cronSecret
    if (!autorizadoPorCron) {
      const caller = await getCallerAtivo(req, serviceClient())
      if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)
    }

    const apiKey = await chaveAnthropic()
    if (!apiKey) {
      return jsonResponse(
        {
          error:
            'Chave da Anthropic não configurada. Informe em Configurações → Integrações.',
        },
        400,
      )
    }

    const body = (await req.json().catch(() => ({}))) as {
      processo_id?: string
      fila?: string[]
      forcar?: boolean
      modelo?: string
    }
    const svc = serviceClient()
    const anthropic = new Anthropic({ apiKey })
    // Override só para comparar modelos sem redeploy; o padrão é MODELO.
    const modelo = body.modelo && body.modelo.trim() ? body.modelo.trim() : MODELO

    // ----- Monta o lote desta invocação -----
    let lote: string[]
    let resto: string[] = []
    // Um crédito só (botão da caixa de texto) sempre regera, mesmo sem novidade.
    let forcar = body.forcar === true

    if (body.processo_id) {
      lote = [body.processo_id]
      forcar = true
    } else if (Array.isArray(body.fila)) {
      lote = body.fila.slice(0, BATCH)
      resto = body.fila.slice(BATCH)
    } else {
      // Primeira chamada da cadeia: só os créditos que aparecem em carteira,
      // isto é, que têm cessionário. Crédito sem cessionário não é de ninguém.
      const { data } = await svc
        .from('processos')
        .select('id')
        .not('cessionario', 'is', null)
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
      lote = ids.slice(0, BATCH)
      resto = ids.slice(BATCH)
    }

    if (lote.length === 0) {
      return jsonResponse({ ok: true, gerados: 0, pulados: 0, falhas: 0, restantes: 0 })
    }

    // ----- Insumos do lote: 2 consultas, não 2 por crédito -----
    const { data: procData } = await svc
      .from('processos')
      .select(
        'id, numero_cnj, tribunal, comarca, vara, entidade_devedora, tipo_credito, data_aquisicao, expectativa_liquidacao, data_liquidacao, status',
      )
      .in('id', lote)
    const todos = (procData ?? []) as ProcessoRow[]

    // Crédito ENCERRADO não recebe resumo gerado: não há processo a narrar nem
    // providência a tomar, e a carteira mostra uma mensagem fixa no lugar (ver
    // RESUMO_ENCERRADO em src/lib/labels.ts). Duas consequências aqui:
    //   - não gasta chamada ao modelo;
    //   - apaga o registro que existir, para não sobrar no banco a narrativa
    //     antiga de um processo que já terminou. A tabela é cache derivado, e
    //     volta a ser gerada sozinha se o status deixar de ser encerrado.
    const encerrados = todos.filter((p) => p.status === 'encerrado').map((p) => p.id)
    if (encerrados.length) {
      await svc.from('carteira_resumos').delete().in('processo_id', encerrados)
    }
    const processos = todos.filter((p) => p.status !== 'encerrado')

    const digitsDe = new Map<string, string>()
    for (const p of processos) digitsDe.set(p.id, onlyDigits(p.numero_cnj))
    const todosDigits = [...new Set([...digitsDe.values()].filter((d) => d.length >= 6))]

    // DESEMPATE OBRIGATÓRIO na ordenação. Com `.order('data')` só, dois
    // andamentos do MESMO dia saíam em ordem indefinida — e o primeiro deles vira
    // o ">>> SITUAÇÃO MAIS RECENTE" do dossiê. No caso real: "alvará expedido"
    // (09:14) e "alvará devolvido sem cumprimento" (16:02) no dia 12/08; sem
    // desempate o texto entregue ao investidor podia afirmar que o alvará saiu,
    // quando ele havia voltado. data_ts primeiro, id como último critério —
    // é ele que garante saída estável quando data_ts for meia-noite.
    const { data: movData } = todosDigits.length
      ? await svc
          .from('advbox_movimentacoes')
          .select('id, numero_digits, data, data_ts, conteudo')
          .in('numero_digits', todosDigits)
          .order('data', { ascending: false })
          .order('data_ts', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false })
      : { data: [] }
    const { data: tarData } = todosDigits.length
      ? await svc
          .from('advbox_tarefas')
          .select('id, numero_digits, tipo, data, date_deadline, notes, concluida')
          .in('numero_digits', todosDigits)
          .order('data', { ascending: false })
          .order('id', { ascending: false })
      : { data: [] }

    const movsPor = new Map<string, MovRow[]>()
    for (const m of (movData ?? []) as MovRow[]) {
      const k = m.numero_digits ?? ''
      const l = movsPor.get(k) ?? []
      l.push(m)
      movsPor.set(k, l)
    }
    const tarPor = new Map<string, TarefaRow[]>()
    for (const t of (tarData ?? []) as TarefaRow[]) {
      const k = t.numero_digits ?? ''
      const l = tarPor.get(k) ?? []
      l.push(t)
      tarPor.set(k, l)
    }

    // Hashes já gravados, para pular o que não teve novidade.
    const { data: jaTem } = await svc
      .from('carteira_resumos')
      .select('processo_id, fonte_hash')
      .in('processo_id', lote)
    const hashAtual = new Map<string, string | null>()
    for (const r of (jaTem ?? []) as {
      processo_id: string
      fonte_hash: string | null
    }[]) {
      hashAtual.set(r.processo_id, r.fonte_hash)
    }

    // ----- Gera -----
    // Encerrados entram como pulados: não são falha, é a regra.
    let gerados = 0
    let pulados = encerrados.length
    let falhas = 0

    await mapPool(processos, CONCORRENCIA, async (p) => {
      const d = digitsDe.get(p.id) ?? ''
      const movs = (movsPor.get(d) ?? []).slice(0, MAX_ANDAMENTOS)
      const tarefas = (tarPor.get(d) ?? []).slice(0, MAX_TAREFAS)

      // Impressão digital pelos IDS da janela enviada, e não por contagem + data.
      //
      // O defeito que isso corrige: `movs.length` satura no teto de
      // MAX_ANDAMENTOS. Num processo com 200 andamentos, a contagem já era 40 e
      // continuava 40; se o novo andamento caísse no MESMO dia do anterior, a
      // data também não mudava — hash idêntico, crédito "sem novidade", e a
      // carteira seguia mostrando "aguardando alvará" depois de o RPV ter sido
      // pago. Com os ids, qualquer troca na janela muda a impressão digital.
      // A contagem NÃO truncada entra junto para o caso de o andamento novo ser
      // mais antigo que os 40 da janela.
      const fonte = hash(
        [
          (movsPor.get(d) ?? []).length,
          movs.map((m) => m.id).join(','),
          (tarPor.get(d) ?? []).length,
          tarefas.map((t) => t.id).join(','),
          // Tarefa muda de estado sem mudar de id, e o texto fala do que está
          // pendente.
          tarefas.map((t) => (t.concluida ? '1' : '0')).join(''),
          p.data_liquidacao ?? '',
          p.expectativa_liquidacao ?? '',
          p.status ?? '',
        ].join('|'),
      )

      if (!forcar && hashAtual.get(p.id) === fonte) {
        pulados++
        return
      }

      // Sem nenhum insumo não há o que resumir: gravar texto do modelo aqui
      // seria pedir invenção. Registra o motivo e segue.
      if (movs.length === 0 && tarefas.length === 0) {
        await svc.from('carteira_resumos').upsert({
          processo_id: p.id,
          fonte_hash: fonte,
          erro: 'Sem andamentos ou tarefas no cache do ADVBOX para este crédito.',
          gerado_em: new Date().toISOString(),
        })
        falhas++
        return
      }

      try {
        const r = await gerarUm(anthropic, montarDossie(p, movs, tarefas), modelo)
        await svc.from('carteira_resumos').upsert({
          processo_id: p.id,
          estagio_processual: r.estagio_processual,
          providencias: r.providencias,
          fonte_hash: fonte,
          modelo,
          erro: null,
          gerado_em: new Date().toISOString(),
        })
        gerados++
      } catch (e) {
        // Não grava fonte_hash: assim a próxima rodada tenta de novo em vez de
        // achar que este crédito já está em dia.
        await svc.from('carteira_resumos').upsert({
          processo_id: p.id,
          erro: String((e as Error).message ?? e).slice(0, 500),
          gerado_em: new Date().toISOString(),
        })
        falhas++
      }
    })

    if (resto.length) dispararProximo(resto, forcar, modelo)

    return jsonResponse({
      ok: true,
      modelo,
      gerados,
      pulados,
      falhas,
      restantes: resto.length,
    })
  } catch (e) {
    return jsonResponse({ error: String((e as Error).message ?? e) }, 500)
  }
})
