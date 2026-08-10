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
import { getCaller, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'

const MODELO = 'claude-sonnet-5'

// Créditos por invocação, e quantas chamadas ao modelo em paralelo dentro do
// lote. 10 x 3 dá ~4 ondas de ~12s: folgado dentro do limite de recursos.
const BATCH = 10
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

REGRAS DE CONTEÚDO:
- Só afirme o que os andamentos e tarefas fornecidos sustentam. Se a informação não está ali, diga que não há registro — NUNCA invente data, valor ou etapa.
- O ÚLTIMO andamento da lista define a situação de HOJE. Não diga que algo está pendente, resolvido ou a caminho se um andamento posterior disser o contrário.
- Quando o MESMO tipo de evento se repete no processo (por exemplo: alvará expedido e não cumprido mais de uma vez, ou petição seguida de nova petição do mesmo teor), entenda que são CICLOS DISTINTOS. Diga quantas vezes ocorreu e use a data da ÚLTIMA ocorrência. Nunca descreva a mesma ocorrência duas vezes como se fossem duas, nem trate um pedido como já atendido só porque um pedido anterior semelhante foi atendido.
- Distinga PEDIDO de DEFERIMENTO: uma petição requerendo algo não é o ato requerido. Só diga que foi expedido, homologado ou deferido se houver andamento dizendo isso.
- Não prometa prazo de pagamento que o processo não indique.
- Nada de "provavelmente", "acredito", "parece". Se é incerto, diga que é incerto.
- Não repita número do processo nem nome das partes: já estão na tabela.
- Nenhum valor em reais que não esteja nos andamentos.

TAMANHO (regra rígida):
- Cada campo tem no MÁXIMO 600 caracteres. Mire em 400.
- Corte o histórico antigo antes de cortar a situação atual: o investidor precisa saber onde o processo está, não a lista do que já passou.`

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
          'Em que ponto do caminho o processo está HOJE, e o evento mais recente e relevante que levou até aí. Situe o investidor: o que já foi vencido e o que falta. Se houver requisitório expedido, diga qual (RPV ou precatório) e desde quando. Se o processo estiver parado, diga desde quando e aguardando o quê. MÁXIMO 600 CARACTERES, mire em 400.',
      },
      providencias: {
        type: 'string',
        description:
          'O que a Credijuris está fazendo e o que fará em seguida, considerando o estágio apurado. Baseie-se nas tarefas registradas e no próximo passo que o estágio exige. Escreva em nome da Credijuris, no presente e no futuro ("acompanhamos", "peticionaremos"). Se não houver tarefa registrada e o processo aguardar ato do juízo ou da Fazenda, diga que o acompanhamento é de monitoramento, sem ato a praticar no momento. MÁXIMO 600 CARACTERES, mire em 400.',
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
  numero_digits: string | null
  data: string | null
  conteudo: string | null
}

interface TarefaRow {
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

/** Uma chamada ao modelo; devolve os dois textos. */
async function gerarUm(
  anthropic: Anthropic,
  dossie: string,
): Promise<{ estagio_processual: string; providencias: string }> {
  const r = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 1200,
    system: SISTEMA,
    tools: [FERRAMENTA],
    tool_choice: { type: 'tool', name: FERRAMENTA.name },
    messages: [
      {
        role: 'user',
        content:
          'Analise o crédito abaixo e registre os dois textos.\n\n' + dossie,
      },
    ],
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
function dispararProximo(fila: string[], forcar: boolean): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/carteira-resumo`
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const p = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ fila, forcar }),
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
      const caller = await getCaller(req)
      if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)
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
    }
    const svc = serviceClient()
    const anthropic = new Anthropic({ apiKey })

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
    const processos = (procData ?? []) as ProcessoRow[]

    const digitsDe = new Map<string, string>()
    for (const p of processos) digitsDe.set(p.id, onlyDigits(p.numero_cnj))
    const todosDigits = [...new Set([...digitsDe.values()].filter((d) => d.length >= 6))]

    const { data: movData } = todosDigits.length
      ? await svc
          .from('advbox_movimentacoes')
          .select('numero_digits, data, conteudo')
          .in('numero_digits', todosDigits)
          .order('data', { ascending: false })
      : { data: [] }
    const { data: tarData } = todosDigits.length
      ? await svc
          .from('advbox_tarefas')
          .select('numero_digits, tipo, data, date_deadline, notes, concluida')
          .in('numero_digits', todosDigits)
          .order('data', { ascending: false })
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
    let gerados = 0
    let pulados = 0
    let falhas = 0

    await mapPool(processos, CONCORRENCIA, async (p) => {
      const d = digitsDe.get(p.id) ?? ''
      const movs = (movsPor.get(d) ?? []).slice(0, MAX_ANDAMENTOS)
      const tarefas = (tarPor.get(d) ?? []).slice(0, MAX_TAREFAS)

      // Impressão digital: quantidade e data do mais recente de cada fonte,
      // mais os campos do cadastro que mudam o texto.
      const fonte = hash(
        [
          movs.length,
          movs[0]?.data ?? '',
          tarefas.length,
          tarefas[0]?.data ?? '',
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
        const r = await gerarUm(anthropic, montarDossie(p, movs, tarefas))
        await svc.from('carteira_resumos').upsert({
          processo_id: p.id,
          estagio_processual: r.estagio_processual,
          providencias: r.providencias,
          fonte_hash: fonte,
          modelo: MODELO,
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

    if (resto.length) dispararProximo(resto, forcar)

    return jsonResponse({
      ok: true,
      gerados,
      pulados,
      falhas,
      restantes: resto.length,
    })
  } catch (e) {
    return jsonResponse({ error: String((e as Error).message ?? e) }, 500)
  }
})
