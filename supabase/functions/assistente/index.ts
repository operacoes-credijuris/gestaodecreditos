// Assistente de perguntas sobre os dados do sistema (o "Clips").
//
// Recebe uma pergunta em português, consulta o banco através de um conjunto
// FECHADO de ferramentas de leitura e devolve a resposta em texto.
//
// Três decisões de segurança, todas deliberadas:
//   1. Usa callerClient() e não serviceClient(): as consultas rodam sob as RLS
//      do usuário logado, então o assistente nunca mostra mais do que a pessoa
//      já veria navegando pelas telas.
//   2. Não existe ferramenta de escrita. O modelo não tem como alterar nada,
//      mesmo que a pergunta peça — não é uma instrução no prompt, é ausência
//      de capacidade.
//   3. O modelo não escreve SQL. Ele escolhe entre as consultas prontas abaixo
//      e informa os filtros; a montagem da query é nossa.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { callerClient, getCaller, serviceClient } from '../_shared/auth.ts'
// Especificador npm: com versão fixa, pelo mesmo motivo do _shared/auth.ts:
// "@latest" traria mudança de comportamento a produção sem ninguém mexer aqui.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

/**
 * Chave da Anthropic, gravada pela tela de Configurações (mesmo caminho do
 * ADVBOX e do Kommo). A leitura usa a service_role porque a tabela não tem
 * policy nenhuma — é justamente o que impede o cliente de ler a chave.
 *
 * O secret de ambiente ANTHROPIC_API_KEY continua valendo como alternativa,
 * para quem preferir configurar por fora do sistema.
 */
async function chaveAnthropic(): Promise<string | null> {
  const doAmbiente = Deno.env.get('ANTHROPIC_API_KEY')
  if (doAmbiente) return doAmbiente
  const { data } = await serviceClient()
    .from('integracao_anthropic_secret')
    .select('token')
    .eq('id', 1)
    .maybeSingle()
  return data?.token ?? null
}

/** Teto de idas e voltas com o modelo. Barreira contra laço infinito. */
const MAX_RODADAS = 8

/**
 * Sonnet nas duas situações; o que varia é o esforço, escolhido pelo que a
 * pergunta EXIGIU — não pelo que ela parecia exigir.
 *
 * Contagens, listas e somas são consulta estruturada: o trabalho é escolher o
 * filtro certo, e esforço médio dá conta.
 *
 * Interpretar movimentação é outra coisa. O texto é jurídico, corrido, com
 * redação que varia por tribunal, e a resposta precisa distinguir o que o
 * andamento sustenta do que apenas se parece com a pergunta. Errar ali custa
 * caro — um processo apontado como concluso quando não está —, então esse
 * caminho roda em esforço alto.
 *
 * Classificar a pergunta pelas palavras dela erraria: "quantos processos estão
 * conclusos" começa igual a uma contagem. Então começamos no esforço menor e
 * promovemos a partir do momento em que a busca textual é acionada — a decisão
 * vem do comportamento observado, não de um palpite sobre a intenção.
 */
const MODELO = 'claude-sonnet-5'
/** Ferramenta cuja presença promove a conversa ao esforço alto. */
const FERRAMENTA_QUE_PROMOVE = 'buscar_movimentacoes'
/** Teto de linhas por consulta: o que vai para o modelo é contexto, não relatório. */
const LIMITE_MAX = 50
/**
 * A busca textual tem tetos próprios, porque agrupa por processo. Varremos
 * muitas linhas (baratas: só número, data e um trecho) e devolvemos poucos
 * processos — assim dez andamentos do mesmo processo não ocupam dez vagas.
 */
const LINHAS_VARRIDAS = 600
const PROCESSOS_POR_BUSCA = 60

// ---------------------------------------------------------------- ferramentas

const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: 'contar_processos',
    description:
      'Conta créditos/processos cadastrados, opcionalmente filtrando. ' +
      'Use para perguntas de "quantos". Devolve um número exato.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['ativo', 'complementar', 'encerrado'],
          description: 'Situação cadastral do crédito.',
        },
        tribunal: { type: 'string', description: 'Trecho do nome do tribunal.' },
        entidade_devedora: {
          type: 'string',
          description: 'Trecho do nome da entidade devedora.',
        },
      },
    },
  },
  {
    name: 'listar_processos',
    description:
      'Lista créditos/processos com seus dados cadastrais. Use quando a ' +
      'pergunta pedir quais são, não quantos são.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ativo', 'complementar', 'encerrado'] },
        tribunal: { type: 'string' },
        entidade_devedora: { type: 'string' },
        limite: {
          type: 'integer',
          description: `Máximo de linhas (teto ${LIMITE_MAX}).`,
        },
      },
    },
  },
  {
    name: 'buscar_movimentacoes',
    description:
      'Procura um trecho de texto nas movimentações e publicações dos ' +
      'processos. É a ÚNICA forma de responder sobre fase processual ' +
      '("concluso para decisão", "sentença", "trânsito em julgado"), porque ' +
      'essas informações só existem no texto dos andamentos — não há campo ' +
      'no cadastro. Devolve UM registro por processo (o andamento mais ' +
      'recente que casou), mais a contagem exata de ocorrências e de ' +
      'processos distintos. Sempre mostre os processos encontrados; use ' +
      '`processos_distintos_encontrados` para dizer o total e ' +
      '`pode_haver_mais_antigos` para saber se ficou algo de fora.',
    input_schema: {
      type: 'object',
      properties: {
        texto: {
          type: 'string',
          description:
            'Trecho a procurar. Prefira termos curtos ("concluso", ' +
            '"sentença") — variações de redação são comuns.',
        },
        dias: {
          type: 'integer',
          description: 'Só andamentos dos últimos N dias. Omita para todos.',
        },
        limite: {
          type: 'integer',
          description: `Máximo de processos a listar (teto ${PROCESSOS_POR_BUSCA}).`,
        },
      },
      required: ['texto'],
    },
  },
  {
    name: 'contar_publicacoes',
    description:
      'Conta publicações/intimações por situação de leitura e tratamento. ' +
      'Use para perguntas sobre pendências da equipe.',
    input_schema: {
      type: 'object',
      properties: {
        lida: { type: 'boolean' },
        tratada: { type: 'boolean' },
        dias: { type: 'integer', description: 'Últimos N dias.' },
      },
    },
  },
  {
    name: 'resumo_cessoes',
    description:
      'Totais financeiros das cessões (valor de face, aquisição, cessão) ' +
      'agrupados por situação. Use para perguntas de valores da carteira.',
    input_schema: { type: 'object', properties: {} },
  },
]

function limite(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : 20
  return Math.min(Math.max(n, 1), LIMITE_MAX)
}

/** Data ISO de N dias atrás, para os filtros de janela. */
function desde(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Executa a ferramenta escolhida pelo modelo. Devolve texto (JSON) porque é o
 * que o modelo lê — erro incluído, para ele poder tentar outro caminho.
 */
async function executar(
  svc: SupabaseClient,
  nome: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (nome) {
    case 'contar_processos': {
      let q = svc.from('processos').select('id', { count: 'exact', head: true })
      if (args.status) q = q.eq('status', args.status)
      if (args.tribunal) q = q.ilike('tribunal', `%${args.tribunal}%`)
      if (args.entidade_devedora)
        q = q.ilike('entidade_devedora', `%${args.entidade_devedora}%`)
      const { count, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({ total: count ?? 0, filtros: args })
    }

    case 'listar_processos': {
      let q = svc
        .from('processos')
        .select(
          'numero_cnj, tribunal, comarca, vara, cedente, entidade_devedora, ' +
            'status, data_aquisicao, expectativa_liquidacao, data_liquidacao',
        )
        .order('created_at', { ascending: false })
        .limit(limite(args.limite))
      if (args.status) q = q.eq('status', args.status)
      if (args.tribunal) q = q.ilike('tribunal', `%${args.tribunal}%`)
      if (args.entidade_devedora)
        q = q.ilike('entidade_devedora', `%${args.entidade_devedora}%`)
      const { data, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({ quantidade_retornada: data?.length ?? 0, processos: data })
    }

    case 'buscar_movimentacoes': {
      const texto = String(args.texto ?? '')
      if (!texto) return JSON.stringify({ erro: 'Informe o texto a procurar.' })
      const dias = typeof args.dias === 'number' ? args.dias : null
      const maxProcessos = Math.min(
        typeof args.limite === 'number' ? args.limite : PROCESSOS_POR_BUSCA,
        PROCESSOS_POR_BUSCA,
      )

      // Duas fontes independentes: andamentos do ADVBOX e publicações do DJEN.
      // Consultamos as duas porque a mesma fase pode aparecer só em uma delas.
      const filtra = <T>(q: T, campoData: string): T => {
        let r = (q as { ilike: (c: string, v: string) => unknown }).ilike(
          'conteudo',
          `%${texto}%`,
        ) as T
        if (dias) {
          r = (r as { gte: (c: string, v: string) => unknown }).gte(
            campoData,
            desde(dias),
          ) as T
        }
        return r
      }

      // Contagem exata em paralelo com a amostra: é o que permite dizer "521
      // ocorrências em 87 processos, veja as 60 mais recentes" em vez de
      // "atingi o teto e não sei o que ficou de fora".
      const [totMov, totPub, mov, pub] = await Promise.all([
        filtra(
          svc
            .from('advbox_movimentacoes')
            .select('id', { count: 'exact', head: true }),
          'data',
        ),
        filtra(
          svc.from('publicacoes').select('id', { count: 'exact', head: true }),
          'data_publicacao',
        ),
        filtra(
          svc
            .from('advbox_movimentacoes')
            .select('numero_processo, data, conteudo')
            .order('data', { ascending: false })
            .limit(LINHAS_VARRIDAS),
          'data',
        ),
        filtra(
          svc
            .from('publicacoes')
            .select('numero_processo, data_publicacao, conteudo, tipo, tratada')
            .order('data_publicacao', { ascending: false })
            .limit(LINHAS_VARRIDAS),
          'data_publicacao',
        ),
      ])
      if (mov.error && pub.error)
        return JSON.stringify({ erro: mov.error.message })

      // Agrupa por processo, guardando o andamento MAIS RECENTE de cada um.
      // Sem isso, dez andamentos de um mesmo processo consumiam dez vagas do
      // limite e escondiam nove outros processos — que é o que a pessoa quer
      // ver. O trecho é cortado em 220 caracteres: o suficiente para conferir
      // que casou de verdade, sem despejar o andamento inteiro.
      interface Achado {
        numero_processo: string
        data: string | null
        fonte: 'movimentacao' | 'publicacao'
        trecho: string | null
      }
      const porProcesso = new Map<string, Achado>()
      const registra = (a: Achado) => {
        if (!a.numero_processo) return
        const atual = porProcesso.get(a.numero_processo)
        if (!atual || (a.data ?? '') > (atual.data ?? '')) {
          porProcesso.set(a.numero_processo, a)
        }
      }
      const corta = (t: string | null) =>
        t && t.length > 220 ? `${t.slice(0, 220)}…` : t

      for (const m of mov.data ?? []) {
        registra({
          numero_processo: m.numero_processo,
          data: m.data,
          fonte: 'movimentacao',
          trecho: corta(m.conteudo),
        })
      }
      for (const p of pub.data ?? []) {
        registra({
          numero_processo: p.numero_processo,
          data: p.data_publicacao,
          fonte: 'publicacao',
          trecho: corta(p.conteudo),
        })
      }

      const todos = [...porProcesso.values()].sort(
        (a, b) => (b.data ?? '').localeCompare(a.data ?? ''),
      )
      const amostra = todos.slice(0, maxProcessos)
      const totalOcorrencias = (totMov.count ?? 0) + (totPub.count ?? 0)
      const varreduraTruncada =
        (mov.data?.length ?? 0) >= LINHAS_VARRIDAS ||
        (pub.data?.length ?? 0) >= LINHAS_VARRIDAS

      return JSON.stringify({
        aviso:
          'Busca por texto: a redação varia entre tribunais, então a lista ' +
          'pode não estar completa. Cada processo aparece uma vez, com seu ' +
          'andamento mais recente que casou com o texto.',
        total_ocorrencias: totalOcorrencias,
        processos_distintos_encontrados: todos.length,
        processos_listados: amostra.length,
        // Só quando true é que existe coisa fora da lista. Antes, o modelo não
        // tinha como distinguir "achei tudo" de "bati no teto".
        pode_haver_mais_antigos: varreduraTruncada || todos.length > amostra.length,
        processos: amostra,
      })
    }

    case 'contar_publicacoes': {
      let q = svc.from('publicacoes').select('id', { count: 'exact', head: true })
      if (typeof args.lida === 'boolean') q = q.eq('lida', args.lida)
      if (typeof args.tratada === 'boolean') q = q.eq('tratada', args.tratada)
      if (typeof args.dias === 'number')
        q = q.gte('data_publicacao', desde(args.dias))
      const { count, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({ total: count ?? 0, filtros: args })
    }

    case 'resumo_cessoes': {
      const { data, error } = await svc
        .from('cessoes')
        .select('status, valor_face, valor_aquisicao, valor_cessao')
      if (error) return JSON.stringify({ erro: error.message })
      const porStatus: Record<
        string,
        { quantidade: number; valor_face: number; valor_aquisicao: number; valor_cessao: number }
      > = {}
      for (const c of data ?? []) {
        const k = c.status ?? 'sem_status'
        porStatus[k] ??= {
          quantidade: 0,
          valor_face: 0,
          valor_aquisicao: 0,
          valor_cessao: 0,
        }
        porStatus[k].quantidade += 1
        porStatus[k].valor_face += Number(c.valor_face ?? 0)
        porStatus[k].valor_aquisicao += Number(c.valor_aquisicao ?? 0)
        porStatus[k].valor_cessao += Number(c.valor_cessao ?? 0)
      }
      return JSON.stringify({ moeda: 'BRL', por_status: porStatus })
    }

    default:
      return JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` })
  }
}

// -------------------------------------------------------------- prompt do sistema

// Estável de propósito: é o prefixo em cache (cache_control abaixo), então
// qualquer trecho que varie por pergunta invalidaria o cache de todas as
// requisições. Nada de data de hoje ou nome de usuário aqui.
const SISTEMA = `Você é o assistente de dados do sistema de Gestão de Cessões da Credijuris. Responde a perguntas da equipe sobre os dados do próprio sistema, em português do Brasil.

# O que existe no sistema
- **Créditos (processos)**: precatórios e créditos judiciais adquiridos. Campos: número CNJ, tribunal, comarca, vara, cedente, entidade devedora, datas de aquisição e liquidação, expectativa de liquidação, e uma situação cadastral que é só uma de três — \`ativo\`, \`complementar\` ou \`encerrado\`.
- **Movimentações e publicações**: andamentos vindos do ADVBOX e intimações do DJEN. São TEXTO CORRIDO, sem classificação estruturada.
- **Cessões**: o inventário de créditos com valores de face, aquisição e cessão.
- **Publicações pendentes**: cada publicação tem marcações de lida e tratada.

# Regra que não se negocia
Todo número que você afirmar precisa vir de uma ferramenta executada nesta conversa. Você não tem conhecimento prévio dos dados da Credijuris. Se não deu para consultar, diga que não deu — nunca estime, arredonde de cabeça ou complete com um valor plausível.

# Fase processual exige cuidado
Não existe campo de fase processual no cadastro. "Concluso para decisão", "sentenciado", "em recurso" e afins só aparecem no texto das movimentações, e a redação varia entre tribunais. Então, ao responder esse tipo de pergunta:
1. Use \`buscar_movimentacoes\` e considere mais de uma redação possível.
2. **Liste os processos encontrados**, com número e data do andamento, para a pessoa conferir.
3. Diga explicitamente que é uma busca por texto e pode não ser completa. Um número redondo sem essa ressalva passa por exato e induz a erro.
4. O total é \`processos_distintos_encontrados\`; a lista pode ser menor que ele. Só mencione que existem registros fora da lista quando \`pode_haver_mais_antigos\` for verdadeiro — dizer isso quando é falso faz a pessoa desconfiar de um resultado que está completo.
5. O andamento diz que o processo **foi** concluso naquela data, não que ainda está. Deixe isso claro.

Não repita as mesmas ressalvas em toda resposta: diga cada uma uma vez, de forma curta. Um bloco de avisos maior que a resposta faz a pessoa parar de lê-los.

Para perguntas que uma contagem responde direto (quantos encerrados, quanto foi cedido), aí sim o número é exato e você pode afirmá-lo sem ressalva.

# Como escrever
Vá direto ao ponto: a resposta primeiro, o detalhe depois. Valores em reais no formato brasileiro (R$ 1.234,56). Datas como dd/mm/aaaa. Tabela só quando houver vários itens comparáveis; para um número só, uma frase basta.

Se a pergunta for ambígua de um jeito que muda a resposta, pergunte antes de consultar. Se estiver fora do que os dados alcançam — conselho jurídico, previsão de quando um processo será pago, informação de fora do sistema — diga o que você tem e o que não tem.

Você só faz leitura. Não existe ferramenta que altere dados; se pedirem para cadastrar, editar ou apagar algo, explique que isso é feito nas telas do sistema.`

// ------------------------------------------------------------------- handler

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const caller = await getCaller(req)
    if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

    const apiKey = await chaveAnthropic()
    if (!apiKey) {
      return jsonResponse(
        {
          error:
            'Assistente ainda não configurado: cadastre a chave da Anthropic ' +
            'em Configurações → Integração Anthropic.',
        },
        503,
      )
    }

    const { pergunta, historico } = await req.json()
    if (!pergunta || typeof pergunta !== 'string') {
      return jsonResponse({ error: 'Pergunta inválida.' }, 400)
    }

    const svc = callerClient(req)
    const anthropic = new Anthropic({ apiKey })

    // O histórico chega da interface como pares simples de texto. Truncamos em
    // 20 turnos: conversa de assistente não precisa de memória infinita, e o
    // histórico inteiro é reenviado a cada pergunta.
    const mensagens: Anthropic.MessageParam[] = Array.isArray(historico)
      ? historico
          .slice(-20)
          .filter(
            (m: unknown): m is { role: 'user' | 'assistant'; content: string } =>
              !!m &&
              typeof (m as { content?: unknown }).content === 'string' &&
              ((m as { role?: unknown }).role === 'user' ||
                (m as { role?: unknown }).role === 'assistant'),
          )
          .map((m) => ({ role: m.role, content: m.content }))
      : []
    mensagens.push({ role: 'user', content: pergunta })

    const ferramentasUsadas: string[] = []
    // Promoção é de mão única: uma vez em texto livre, a conversa inteira
    // segue em esforço alto. Voltar a abaixar no meio faria a redação final —
    // a parte que a pessoa lê — sair mais rasa justamente na pergunta que
    // exigiu mais.
    let interpretandoTexto = false

    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      const resposta = await anthropic.messages.create({
        model: MODELO,
        max_tokens: 8000,
        // Prefixo estável (ferramentas + sistema) em cache: o mesmo bloco é
        // reenviado em toda pergunta e em toda rodada de ferramenta.
        system: [
          { type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } },
        ],
        tools: FERRAMENTAS,
        messages: mensagens,
        // Raciocínio adaptativo nos dois casos: o modelo decide se pensa. Fica
        // ligado até no caminho barato porque, com ele desligado, o Sonnet
        // aciona ferramentas com menos disposição — e aqui TODA resposta
        // depende de uma consulta. O esforço é que muda entre os caminhos.
        thinking: { type: 'adaptive' },
        output_config: { effort: interpretandoTexto ? 'high' : 'medium' },
      })

      if (resposta.stop_reason === 'refusal') {
        return jsonResponse(
          {
            error:
              'O modelo recusou responder a esta pergunta. Tente reformulá-la.',
          },
          422,
        )
      }

      mensagens.push({ role: 'assistant', content: resposta.content })

      if (resposta.stop_reason !== 'tool_use') {
        const texto = resposta.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
        return jsonResponse({
          resposta:
            texto ||
            'Não consegui formular uma resposta. Tente reformular a pergunta.',
          ferramentas: ferramentasUsadas,
        })
      }

      // Todas as ferramentas do turno em paralelo, e todos os resultados numa
      // única mensagem — separá-los ensina o modelo a parar de paralelizar.
      const chamadas = resposta.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )
      if (chamadas.some((c) => c.name === FERRAMENTA_QUE_PROMOVE)) {
        // A partir daqui há texto livre em jogo: as próximas rodadas — e,
        // principalmente, a redação da resposta — vão em esforço alto.
        interpretandoTexto = true
      }

      const resultados = await Promise.all(
        chamadas.map(async (c) => {
          ferramentasUsadas.push(c.name)
          let conteudo: string
          try {
            conteudo = await executar(
              svc,
              c.name,
              (c.input ?? {}) as Record<string, unknown>,
            )
          } catch (err) {
            conteudo = JSON.stringify({ erro: (err as Error).message })
          }
          return {
            type: 'tool_result' as const,
            tool_use_id: c.id,
            content: conteudo,
          }
        }),
      )
      mensagens.push({ role: 'user', content: resultados })
    }

    return jsonResponse(
      {
        error:
          'A consulta ficou longa demais e foi interrompida. Tente uma ' +
          'pergunta mais específica.',
      },
      504,
    )
  } catch (err) {
    return jsonResponse({ error: mensagemDeErro(err) }, 500)
  }
})

/**
 * Traduz a falha para algo acionável. O erro cru da Anthropic chega como
 * `401 {"type":"error","error":{"type":"authentication_error",...}}` — que na
 * tela do usuário não diz nem onde corrigir.
 */
function mensagemDeErro(err: unknown): string {
  const bruto = (err as Error)?.message ?? String(err)
  const status = (err as { status?: number })?.status

  if (status === 401 || /invalid x-api-key|authentication_error/i.test(bruto)) {
    return (
      'A Anthropic recusou a chave de API. Confira em Configurações → ' +
      'Integração Anthropic; se a chave foi colada incompleta, gere uma nova ' +
      'em console.anthropic.com → API Keys.'
    )
  }
  if (status === 429 || /rate_limit/i.test(bruto)) {
    return 'Limite de uso da Anthropic atingido. Tente de novo em instantes.'
  }
  if (status === 400 && /credit balance|billing/i.test(bruto)) {
    return (
      'A conta da Anthropic está sem crédito. Verifique o saldo e o método de ' +
      'pagamento em console.anthropic.com.'
    )
  }
  if (status === 403 || /permission_error/i.test(bruto)) {
    return 'A chave da Anthropic não tem permissão para esta operação.'
  }
  if (status && status >= 500) {
    return 'A Anthropic está indisponível no momento. Tente de novo em instantes.'
  }
  return bruto
}
