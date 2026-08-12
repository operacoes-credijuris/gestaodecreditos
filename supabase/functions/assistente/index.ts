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
import { ERRO_ACESSO, callerClient, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
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

/**
 * Filtros do crédito, compartilhados por contar_processos, listar_processos e
 * resumo_financeiro_creditos.
 *
 * Em constante porque as três ferramentas TÊM de filtrar igual: se `contar`
 * aceitasse um filtro que `listar` não aceita, a mesma pergunta daria total e
 * lista discordantes, e o modelo apresentaria as duas coisas como coerentes.
 */
const FILTROS_PROCESSO = {
  status: {
    type: 'string' as const,
    enum: ['ativo', 'complementar', 'encerrado'],
    description:
      'Situação cadastral. `complementar` = já recebeu parte e há saldo a receber.',
  },
  tribunal: { type: 'string' as const, description: 'Trecho do nome do tribunal.' },
  entidade_devedora: {
    type: 'string' as const,
    description: 'Trecho do nome do ente devedor (União, Estado, Município, autarquia).',
  },
  cedente: { type: 'string' as const, description: 'Trecho do nome do credor original.' },
  cessionario: {
    type: 'string' as const,
    description: 'Trecho do nome do investidor que comprou o crédito.',
  },
  originador: {
    type: 'string' as const,
    description: 'Trecho do nome de quem originou a aquisição.',
  },
  especie_requisitorio: {
    type: 'string' as const,
    enum: ['rpv', 'precatorio'],
    description: 'RPV (Requisição de Pequeno Valor) ou precatório.',
  },
  liquidado: {
    type: 'boolean' as const,
    description:
      'true = já tem data de liquidação; false = ainda não foi pago. É a data que diz se o crédito foi pago, não o status.',
  },
  expectativa_ate: {
    type: 'string' as const,
    description:
      'Só créditos com expectativa de liquidação até esta data (AAAA-MM-DD). Use para "o que vence nos próximos N meses".',
  },
  expectativa_desde: {
    type: 'string' as const,
    description: 'Só créditos com expectativa de liquidação a partir desta data (AAAA-MM-DD).',
  },
}

const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: 'contar_processos',
    description:
      'Conta créditos/processos cadastrados, opcionalmente filtrando. ' +
      'Use para perguntas de "quantos". Devolve um número exato.',
    input_schema: { type: 'object', properties: { ...FILTROS_PROCESSO } },
  },
  {
    name: 'listar_processos',
    description:
      'Lista créditos/processos com o cadastro COMPLETO, inclusive os campos ' +
      'financeiros (capital investido, valor de face, já recebido, saldo ' +
      'estimado complementar) e o tipo de crédito. Use quando a pergunta ' +
      'pedir quais são, ou quando precisar dos valores de créditos ' +
      'específicos.',
    input_schema: {
      type: 'object',
      properties: {
        ...FILTROS_PROCESSO,
        limite: {
          type: 'integer',
          description: `Máximo de linhas (teto ${LIMITE_MAX}).`,
        },
      },
    },
  },
  {
    name: 'resumo_financeiro_creditos',
    description:
      'Somas e contagens dos créditos, agrupadas pela dimensão que você ' +
      'escolher. É a ferramenta para "quanto a Credijuris tem investido", ' +
      '"qual o valor de face da carteira", "quanto já foi recebido", ' +
      '"quanto falta receber nos complementares". Percorre TODOS os créditos ' +
      'que casam com o filtro, então os totais são exatos — não é amostra.',
    input_schema: {
      type: 'object',
      properties: {
        agrupar_por: {
          type: 'string',
          enum: [
            'status',
            'especie_requisitorio',
            'originador',
            'cessionario',
            'tribunal',
            'entidade_devedora',
            'nenhum',
          ],
          description: 'Dimensão do agrupamento. `nenhum` devolve só o total geral.',
        },
        ...FILTROS_PROCESSO,
      },
      required: ['agrupar_por'],
    },
  },
  {
    name: 'ficha_do_credito',
    description:
      'TUDO sobre UM crédito: cadastro completo, apensos, o resumo de estágio ' +
      'processual e providências, as tarefas internas, as últimas ' +
      'movimentações e as últimas publicações. Use quando a pergunta for ' +
      'sobre um processo específico ("o que está acontecendo no processo X", ' +
      '"me explique a situação do crédito da Maria"). Uma chamada substitui ' +
      'cinco.',
    input_schema: {
      type: 'object',
      properties: {
        numero_processo: {
          type: 'string',
          description:
            'Número do processo, com ou sem pontuação. Também aceita trecho do nome do cedente, se o número não for conhecido.',
        },
        movimentacoes: {
          type: 'integer',
          description: 'Quantas movimentações recentes trazer (padrão 15, teto 40).',
        },
      },
      required: ['numero_processo'],
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
      'Conta publicações/intimações do DJEN por situação de tratamento. ' +
      'Use para perguntas sobre pendências da equipe. A janela é contada por ' +
      'data de disponibilização, no fuso de Brasília.',
    input_schema: {
      type: 'object',
      properties: {
        // Sem `lida`: a tabela do DJEN só tem `tratada`. O parâmetro existia e
        // apontava para uma coluna inexistente.
        tratada: { type: 'boolean' },
        dias: { type: 'integer', description: 'Últimos N dias.' },
      },
    },
  },
  {
    name: 'listar_publicacoes',
    description:
      'Lista publicações do DJEN COM O TEXTO do comunicado. Use quando a ' +
      'pergunta pedir o que diz uma intimação, quais são as pendências, ou ' +
      'para ler as publicações de um processo. Diferente de ' +
      'buscar_movimentacoes, que procura um termo no acervo todo: aqui você ' +
      'lista por processo ou por período e lê o conteúdo.',
    input_schema: {
      type: 'object',
      properties: {
        numero_processo: { type: 'string', description: 'Número do processo (com ou sem pontuação).' },
        tratada: {
          type: 'boolean',
          description: 'false = ainda não providenciada pela equipe.',
        },
        dias: { type: 'integer', description: 'Últimos N dias.' },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'listar_tarefas',
    description:
      'Tarefas internas da equipe, vindas do ADVBOX — com tipo, data, PRAZO ' +
      'FATAL, responsáveis, observação e se já foram concluídas. É a ' +
      'ferramenta para "o que vence esta semana", "quais tarefas estão ' +
      'atrasadas", "o que a equipe está fazendo no processo X", "quantas ' +
      'tarefas o Fulano tem". O histórico inclui as CONCLUÍDAS.',
    input_schema: {
      type: 'object',
      properties: {
        numero_processo: { type: 'string' },
        concluida: {
          type: 'boolean',
          description: 'false = em aberto; true = já concluídas; omita para as duas.',
        },
        responsavel: { type: 'string', description: 'Trecho do nome do responsável.' },
        tipo: { type: 'string', description: 'Trecho do tipo da tarefa.' },
        prazo_ate: {
          type: 'string',
          description: 'Só tarefas com prazo fatal até esta data (AAAA-MM-DD).',
        },
        vencidas: {
          type: 'boolean',
          description: 'true = só com prazo fatal já passado e ainda não concluídas.',
        },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'resumo_cessoes',
    description:
      'Totais das CESSÕES (o inventário comercial): valor de face, aquisição ' +
      'e cessão, agrupados por situação. Atenção: cessão é o registro ' +
      'comercial da operação; para os valores dos CRÉDITOS em si use ' +
      'resumo_financeiro_creditos.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'carteira_do_investidor',
    description:
      'A carteira de um investidor: os créditos em que ele é o cessionário, ' +
      'com os valores, as datas e o estágio de cada um. É a mesma fonte da ' +
      'tela de Carteiras (o campo cessionário do crédito), então os números ' +
      'batem com o que a pessoa vê lá. Use para "o que o Fulano tem", ' +
      '"quanto o Fulano investiu", "como está a carteira dele".',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Trecho do nome do investidor.' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'listar_investidores',
    description:
      'Investidores e originadores cadastrados, com quantos créditos cada um ' +
      'tem e se a ficha cadastral está completa. NÃO devolve CPF, RG, conta ' +
      'nem Pix — só se estão preenchidos. Use para "quem são os ' +
      'investidores", "quem está com ficha incompleta", "quantos ' +
      'originadores temos".',
    input_schema: {
      type: 'object',
      properties: {
        papel: {
          type: 'string',
          enum: ['investidor', 'originador'],
          description: 'Omita para trazer os dois.',
        },
        nome: { type: 'string', description: 'Trecho do nome.' },
        ficha_incompleta: {
          type: 'boolean',
          description: 'true = só quem tem algum campo essencial em branco.',
        },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'listar_analises',
    description:
      'Análises de crédito — a fase PRÉ-CONTRATUAL, antes de o crédito ' +
      'existir. Traz cedente, devedor, tribunal, valor de face, valor ' +
      'avaliado, risco e situação da análise. Use para perguntas sobre o ' +
      'funil de aquisição ("o que está em análise", "quantas foram ' +
      'reprovadas"). Não confunda com Créditos, que é o que já foi adquirido.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pendente', 'em_analise', 'aprovada', 'reprovada'],
        },
        risco: { type: 'string', enum: ['baixo', 'medio', 'alto'] },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'listar_requerimentos',
    description:
      'Requerimentos administrativos: pedidos protocolados fora do processo ' +
      'judicial, com órgão, matéria, classe e data de protocolo.',
    input_schema: {
      type: 'object',
      properties: {
        orgao: { type: 'string', description: 'Trecho do nome do órgão.' },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'listar_contatos',
    description:
      'Contatos das serventias e gabinetes: telefone, WhatsApp e e-mail por ' +
      'órgão. Use para "como falo com a vara X".',
    input_schema: {
      type: 'object',
      properties: {
        orgao: { type: 'string', description: 'Trecho do nome do órgão ou da vara.' },
        tribunal: { type: 'string' },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'resumos_da_carteira',
    description:
      'O estágio processual e as providências de vários créditos de uma vez, ' +
      'nos textos que a plataforma já mantém escritos para a carteira do ' +
      'investidor. Use quando a pergunta pedir um retrato de MUITOS créditos ' +
      '("resuma a situação dos créditos ativos", "onde estão os créditos do ' +
      'Fulano") — evita ler o histórico de cada um.',
    input_schema: {
      type: 'object',
      properties: {
        cessionario: { type: 'string', description: 'Trecho do nome do investidor.' },
        status: { type: 'string', enum: ['ativo', 'complementar', 'encerrado'] },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
]

function limite(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : 20
  return Math.min(Math.max(n, 1), LIMITE_MAX)
}

/**
 * Colunas do crédito que o assistente pode ver.
 *
 * `drive_pasta_id` fica DE FORA de propósito: é cache do id de uma pasta do
 * Google, uso interno, e a decisão do produto é que ele não aparece em lugar
 * nenhum (migração 0033). Um id opaco na resposta do assistente é exatamente
 * "aparecer em algum lugar".
 */
const COLUNAS_PROCESSO =
  'numero_cnj, tribunal, comarca, vara, cedente, cedente_advogado, cessionario, ' +
  'originador, entidade_devedora, status, especie_requisitorio, instrumento, ' +
  'numero_rtdpj, data_aquisicao, expectativa_liquidacao, data_liquidacao, ' +
  'tipo_credito, capital_investido, valor_face, data_referencia, ' +
  'indice_atualizacao, ja_recebido, valor_estimado_complementar'

/** A ficha precisa do id para buscar apensos, resumo e tarefas do crédito. */
const COLUNAS_PROCESSO_FICHA = `id, ${COLUNAS_PROCESSO}`

/** Só o que o construtor de consulta precisa expor para os filtros abaixo. */
interface Filtravel {
  eq: (c: string, v: unknown) => unknown
  ilike: (c: string, v: string) => unknown
  is: (c: string, v: null) => unknown
  not: (c: string, op: string, v: unknown) => unknown
  lte: (c: string, v: string) => unknown
  gte: (c: string, v: string) => unknown
}

/**
 * Aplica os filtros de crédito a qualquer consulta sobre `processos`.
 *
 * Compartilhado por contar, listar e resumir — se cada um filtrasse do seu jeito,
 * a mesma pergunta produziria total e lista que não fecham, e o modelo
 * apresentaria os dois números como se conversassem.
 */
function aplicarFiltros<T>(q: T, args: Record<string, unknown>): T {
  let r = q as unknown as Filtravel
  const eq = (c: string, v: unknown) => {
    r = r.eq(c, v) as Filtravel
  }
  const like = (c: string, v: unknown) => {
    r = r.ilike(c, `%${String(v)}%`) as Filtravel
  }
  if (args.status) eq('status', args.status)
  if (args.especie_requisitorio) eq('especie_requisitorio', args.especie_requisitorio)
  if (args.tribunal) like('tribunal', args.tribunal)
  if (args.entidade_devedora) like('entidade_devedora', args.entidade_devedora)
  if (args.cedente) like('cedente', args.cedente)
  if (args.cessionario) like('cessionario', args.cessionario)
  if (args.originador) like('originador', args.originador)
  // A DATA é que diz se o crédito foi pago, não o status — a plataforma inteira
  // trata assim, e o assistente tem de concordar com as telas.
  if (typeof args.liquidado === 'boolean') {
    r = (
      args.liquidado
        ? r.not('data_liquidacao', 'is', null)
        : r.is('data_liquidacao', null)
    ) as Filtravel
  }
  if (typeof args.expectativa_ate === 'string')
    r = r.lte('expectativa_liquidacao', args.expectativa_ate) as Filtravel
  if (typeof args.expectativa_desde === 'string')
    r = r.gte('expectativa_liquidacao', args.expectativa_desde) as Filtravel
  return r as unknown as T
}

/**
 * Data ISO de N dias atrás, no fuso de BRASÍLIA.
 *
 * toISOString() (UTC) errava o dia inteiro depois das 21h: às 21h30 de 10/08,
 * "últimos 1 dia" virava ">= 2026-08-10" — contava HOJE e excluía 09/08, que era
 * exatamente o dia pedido. E a resposta saía com número exato, sem ressalva.
 * A Edge Function roda em UTC, então o fuso tem de ser explícito.
 */
function desde(dias: number): string {
  const hojeSP = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo',
  })
  const [a, m, d] = hojeSP.split('-').map(Number)
  const base = new Date(Date.UTC(a, m - 1, d))
  base.setUTCDate(base.getUTCDate() - dias)
  return base.toISOString().slice(0, 10)
}

/** Texto legível a partir do HTML do DJEN (o `raw.texto` vem com marcação). */
function textoDjen(raw: unknown): string | null {
  const t = (raw as { texto?: unknown } | null)?.texto
  if (typeof t !== 'string') return null
  return t
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
      const { count, error } = await aplicarFiltros(
        svc.from('processos').select('id', { count: 'exact', head: true }),
        args,
      )
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({ total: count ?? 0, filtros: args })
    }

    case 'listar_processos': {
      const { data, error } = await aplicarFiltros(
        svc
          .from('processos')
          .select(COLUNAS_PROCESSO)
          .order('created_at', { ascending: false })
          .limit(limite(args.limite)),
        args,
      )
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({
        moeda: 'BRL',
        quantidade_retornada: data?.length ?? 0,
        // Sem isto o modelo não sabe se a lista é tudo ou só o teto. Já respondeu
        // "temos 20 créditos ativos" quando havia 40 e o limite era 20.
        aviso_limite:
          (data?.length ?? 0) >= limite(args.limite)
            ? 'A lista bateu no limite pedido; use contar_processos para o total exato.'
            : undefined,
        processos: data,
      })
    }

    case 'resumo_financeiro_creditos': {
      // Sem limite: são somas, e amostra daria total errado apresentado como
      // exato. O acervo é de centenas de linhas, não de milhões.
      const { data, error } = await aplicarFiltros(
        svc
          .from('processos')
          .select(
            'status, especie_requisitorio, originador, cessionario, tribunal, ' +
              'entidade_devedora, capital_investido, valor_face, ja_recebido, ' +
              'valor_estimado_complementar, data_liquidacao',
          ),
        args,
      )
      if (error) return JSON.stringify({ erro: error.message })

      const dimensao = String(args.agrupar_por ?? 'nenhum')
      const grupos: Record<string, Record<string, number>> = {}
      const soma = (alvo: Record<string, number>, l: Record<string, unknown>) => {
        alvo.quantidade += 1
        alvo.capital_investido += Number(l.capital_investido ?? 0)
        alvo.valor_face += Number(l.valor_face ?? 0)
        alvo.ja_recebido += Number(l.ja_recebido ?? 0)
        alvo.valor_estimado_complementar += Number(l.valor_estimado_complementar ?? 0)
        if (l.data_liquidacao) alvo.liquidados += 1
      }
      const zero = () => ({
        quantidade: 0,
        capital_investido: 0,
        valor_face: 0,
        ja_recebido: 0,
        valor_estimado_complementar: 0,
        liquidados: 0,
      })
      const total = zero()
      for (const l of (data ?? []) as Record<string, unknown>[]) {
        soma(total, l)
        if (dimensao !== 'nenhum') {
          const k = String(l[dimensao] ?? 'não informado') || 'não informado'
          grupos[k] ??= zero()
          soma(grupos[k], l)
        }
      }
      return JSON.stringify({
        moeda: 'BRL',
        significado: {
          capital_investido: 'quanto a Credijuris pagou pelo crédito',
          valor_face: 'valor de face do crédito no processo',
          ja_recebido: 'quanto já entrou (só nos complementares/encerrados)',
          valor_estimado_complementar: 'saldo estimado a receber',
          liquidados: 'quantos têm data de liquidação preenchida',
        },
        creditos_considerados: data?.length ?? 0,
        total_geral: total,
        agrupado_por: dimensao === 'nenhum' ? undefined : dimensao,
        grupos: dimensao === 'nenhum' ? undefined : grupos,
      })
    }

    case 'ficha_do_credito': {
      const busca = String(args.numero_processo ?? '')
      const digitos = busca.replace(/\D/g, '')
      // Por número quando vier número; por nome do cedente quando vier nome.
      let q = svc.from('processos').select(COLUNAS_PROCESSO_FICHA).limit(3)
      q = digitos.length >= 6
        ? q.ilike('numero_cnj', `%${digitos.slice(0, 7)}%`)
        : q.ilike('cedente', `%${busca}%`)
      const { data: achados, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      const lista = (achados ?? []) as Record<string, unknown>[]
      if (lista.length === 0) {
        return JSON.stringify({
          encontrado: false,
          aviso: `Nenhum crédito casou com "${busca}". Confira o número ou use listar_processos.`,
        })
      }
      if (lista.length > 1) {
        return JSON.stringify({
          encontrado: false,
          aviso: 'Mais de um crédito casou. Peça à pessoa qual, ou refine o número.',
          candidatos: lista.map((p) => ({
            numero_cnj: p.numero_cnj,
            cedente: p.cedente,
            cessionario: p.cessionario,
          })),
        })
      }
      const p = lista[0]
      const idProc = String(p.id)
      const dig = String(p.numero_cnj ?? '').replace(/\D/g, '')
      const quantasMov = Math.min(
        typeof args.movimentacoes === 'number' ? args.movimentacoes : 15,
        40,
      )

      const [apensos, resumo, tarefas, movs, pubs] = await Promise.all([
        svc.from('apensos').select('*').eq('processo_id', idProc).limit(20),
        svc
          .from('carteira_resumos')
          .select('estagio_processual, providencias, gerado_em, erro')
          .eq('processo_id', idProc)
          .maybeSingle(),
        dig
          ? svc
              .from('advbox_tarefas')
              .select('tipo, data, date_deadline, notes, responsaveis, concluida')
              .eq('numero_digits', dig)
              .order('data', { ascending: false })
              .limit(25)
          : Promise.resolve({ data: [], error: null }),
        dig
          ? svc
              .from('advbox_movimentacoes')
              .select('data, conteudo')
              .eq('numero_digits', dig)
              .order('data', { ascending: false })
              .order('data_ts', { ascending: false, nullsFirst: false })
              .order('id', { ascending: false })
              .limit(quantasMov)
          : Promise.resolve({ data: [], error: null }),
        dig
          ? svc
              .from('djen_publicacoes')
              .select('data_disponibilizacao, tipo_comunicacao, tratada, raw')
              .ilike('numero_processo', `%${dig.slice(0, 7)}%`)
              .order('data_disponibilizacao', { ascending: false })
              .limit(8)
          : Promise.resolve({ data: [], error: null }),
      ])

      // Cronológico CRESCENTE: lida de trás para frente, a sequência causal se
      // desfaz — dois ciclos de "alvará expedido / devolvido" viram três, com o
      // último parecendo pendente. Mesma lição da carteira-resumo.
      const movCrescente = [...((movs.data ?? []) as Record<string, unknown>[])].reverse()

      return JSON.stringify({
        encontrado: true,
        moeda: 'BRL',
        cadastro: p,
        apensos: apensos.data ?? [],
        resumo_da_carteira: resumo.data ?? null,
        tarefas: tarefas.data ?? [],
        movimentacoes_do_mais_antigo_ao_mais_recente: movCrescente,
        publicacoes_recentes: ((pubs.data ?? []) as Record<string, unknown>[]).map(
          (x) => ({
            data: x.data_disponibilizacao,
            tipo: x.tipo_comunicacao,
            tratada: x.tratada,
            texto: textoDjen(x.raw)?.slice(0, 1200) ?? null,
          }),
        ),
        aviso:
          'O andamento mais recente da lista descreve onde o processo está hoje; ' +
          'nada da sua resposta pode contrariá-lo.',
      })
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
      //
      // O campo de texto é PARÂMETRO porque as duas fontes guardam o texto em
      // lugares diferentes: advbox_movimentacoes tem a coluna `conteudo`, e o
      // DJEN guarda o comunicado dentro de `raw` (jsonb), em HTML.
      const filtra = <T>(q: T, campoData: string, campoTexto: string): T => {
        let r = (q as { ilike: (c: string, v: string) => unknown }).ilike(
          campoTexto,
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
      // ⚠️ djen_publicacoes, e NÃO public.publicacoes: aquela tabela é legado e
      // está vazia. Com ela, "quantas publicações não foram tratadas?" respondia
      // "nenhuma pendente" com 180 na tela — número errado dado como exato, que é
      // o pior jeito de errar num assistente.
      const [totMov, totPub, mov, pub] = await Promise.all([
        filtra(
          svc
            .from('advbox_movimentacoes')
            .select('id', { count: 'exact', head: true }),
          'data',
          'conteudo',
        ),
        filtra(
          svc.from('djen_publicacoes').select('id', { count: 'exact', head: true }),
          'data_disponibilizacao',
          'raw->>texto',
        ),
        filtra(
          svc
            .from('advbox_movimentacoes')
            .select('numero_processo, data, conteudo')
            .order('data', { ascending: false })
            .limit(LINHAS_VARRIDAS),
          'data',
          'conteudo',
        ),
        filtra(
          svc
            .from('djen_publicacoes')
            .select('numero_processo, data_disponibilizacao, tipo_comunicacao, tratada, raw')
            .order('data_disponibilizacao', { ascending: false })
            .limit(LINHAS_VARRIDAS),
          'data_disponibilizacao',
          'raw->>texto',
        ),
      ])
      if (mov.error && pub.error)
        return JSON.stringify({ erro: mov.error.message })

      // Fonte que caiu tem de ser DECLARADA, não seguida em silêncio: antes, se a
      // contagem exata estourasse o statement_timeout, count vinha null e o JSON
      // dizia "total_ocorrencias: 0" ao lado de processos encontrados — o modelo
      // lia zero como fato e afirmava que não havia nada.
      const fontesIndisponiveis: string[] = []
      if (mov.error || totMov.error) fontesIndisponiveis.push('movimentacoes')
      if (pub.error || totPub.error) fontesIndisponiveis.push('publicacoes')
      const contagemIncompleta =
        totMov.count === null || totPub.count === null || fontesIndisponiveis.length > 0

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
          data: p.data_disponibilizacao,
          fonte: 'publicacao',
          // O comunicado do DJEN vem em HTML dentro de raw; sem limpar, o modelo
          // receberia marcação em vez de texto.
          trecho: corta(textoDjen(p.raw)),
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
          'andamento mais recente que casou com o texto. O texto do DJEN é ' +
          'guardado em HTML, então termo com acento pode deixar de casar.',
        // null e não 0 quando a contagem não fechou: zero é afirmação, e afirmar
        // zero sem ter conseguido contar é o erro que isto evita.
        total_ocorrencias: contagemIncompleta ? null : totalOcorrencias,
        contagem_exata_indisponivel: contagemIncompleta || undefined,
        fontes_indisponiveis: fontesIndisponiveis.length ? fontesIndisponiveis : undefined,
        processos_distintos_encontrados: todos.length,
        processos_listados: amostra.length,
        // Só quando true é que existe coisa fora da lista. Antes, o modelo não
        // tinha como distinguir "achei tudo" de "bati no teto". Fonte que caiu
        // também liga a bandeira: com uma das duas fora, a lista é parcial por
        // definição.
        pode_haver_mais_antigos:
          varreduraTruncada || todos.length > amostra.length || contagemIncompleta,
        processos: amostra,
      })
    }

    case 'contar_publicacoes': {
      // djen_publicacoes (a tabela viva). A coluna `lida` não existe nela — o
      // parâmetro saiu do schema da ferramenta junto com esta troca.
      let q = svc
        .from('djen_publicacoes')
        .select('id', { count: 'exact', head: true })
      if (typeof args.tratada === 'boolean') q = q.eq('tratada', args.tratada)
      if (typeof args.dias === 'number')
        q = q.gte('data_disponibilizacao', desde(args.dias))
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

    case 'listar_publicacoes': {
      let q = svc
        .from('djen_publicacoes')
        .select('numero_processo, data_disponibilizacao, sigla_tribunal, tipo_comunicacao, tratada, raw')
        .order('data_disponibilizacao', { ascending: false })
        .limit(limite(args.limite))
      if (typeof args.tratada === 'boolean') q = q.eq('tratada', args.tratada)
      if (typeof args.dias === 'number')
        q = q.gte('data_disponibilizacao', desde(args.dias))
      if (args.numero_processo) {
        const d = String(args.numero_processo).replace(/\D/g, '')
        // Casa pelo prefixo de dígitos: o DJEN grava o número em formatos
        // variados e a coluna não é normalizada.
        q = q.ilike('numero_processo', `%${(d || String(args.numero_processo)).slice(0, 7)}%`)
      }
      const { data, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({
        quantidade_retornada: data?.length ?? 0,
        publicacoes: ((data ?? []) as Record<string, unknown>[]).map((p) => ({
          numero_processo: p.numero_processo,
          data: p.data_disponibilizacao,
          tribunal: p.sigla_tribunal,
          tipo: p.tipo_comunicacao,
          tratada: p.tratada,
          // Cortado: o comunicado inteiro pode ter milhares de caracteres, e o
          // que decide a leitura está no começo.
          texto: textoDjen(p.raw)?.slice(0, 1500) ?? null,
        })),
      })
    }

    case 'listar_tarefas': {
      let q = svc
        .from('advbox_tarefas')
        .select(
          'numero_processo, tipo, data, date_deadline, notes, responsaveis, ' +
            'important, urgent, concluida',
        )
        .order('date_deadline', { ascending: true, nullsFirst: false })
        .limit(limite(args.limite))
      if (typeof args.concluida === 'boolean') q = q.eq('concluida', args.concluida)
      if (args.tipo) q = q.ilike('tipo', `%${args.tipo}%`)
      if (args.numero_processo) {
        const d = String(args.numero_processo).replace(/\D/g, '')
        if (d.length >= 6) q = q.eq('numero_digits', d)
        else q = q.ilike('numero_processo', `%${args.numero_processo}%`)
      }
      if (typeof args.prazo_ate === 'string') q = q.lte('date_deadline', args.prazo_ate)
      if (args.vencidas === true) {
        // Vencida = prazo fatal no passado E ainda não concluída. Sem o segundo
        // filtro, tarefa cumprida no prazo apareceria como atrasada.
        q = q.lt('date_deadline', desde(0)).eq('concluida', false)
      }
      const { data, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      let tarefas = (data ?? []) as Record<string, unknown>[]
      // Responsável é jsonb (lista de nomes): filtra em memória, porque `ilike`
      // não entra dentro do array.
      if (args.responsavel) {
        const alvo = String(args.responsavel).toLowerCase()
        tarefas = tarefas.filter((t) =>
          (Array.isArray(t.responsaveis) ? (t.responsaveis as unknown[]) : [])
            .some((r) => String(r).toLowerCase().includes(alvo)),
        )
      }
      return JSON.stringify({
        hoje: desde(0),
        quantidade_retornada: tarefas.length,
        legenda: {
          date_deadline: 'prazo fatal; null = tarefa sem prazo',
          concluida: 'true = já cumprida',
        },
        tarefas,
      })
    }

    case 'carteira_do_investidor': {
      const nome = String(args.nome ?? '')
      if (!nome) return JSON.stringify({ erro: 'Informe o nome do investidor.' })
      // MESMA FONTE DA TELA DE CARTEIRAS: o campo `cessionario` do crédito. A
      // tabela `investimentos` é o registro comercial e pode não refletir a
      // carteira real; responder por ela daria número diferente do que a pessoa
      // vê em Carteiras de Investimento.
      const { data, error } = await svc
        .from('processos')
        .select(`id, ${COLUNAS_PROCESSO}`)
        .ilike('cessionario', `%${nome}%`)
      if (error) return JSON.stringify({ erro: error.message })
      const creditos = (data ?? []) as Record<string, unknown>[]
      if (creditos.length === 0) {
        return JSON.stringify({
          encontrado: false,
          aviso: `Nenhum crédito com cessionário casando "${nome}".`,
        })
      }
      const num = (v: unknown) => Number(v ?? 0)
      const totais = creditos.reduce(
        (t, c) => ({
          creditos: t.creditos + 1,
          capital_investido: t.capital_investido + num(c.capital_investido),
          valor_face: t.valor_face + num(c.valor_face),
          ja_recebido: t.ja_recebido + num(c.ja_recebido),
          valor_estimado_complementar:
            t.valor_estimado_complementar + num(c.valor_estimado_complementar),
          liquidados: t.liquidados + (c.data_liquidacao ? 1 : 0),
        }),
        {
          creditos: 0,
          capital_investido: 0,
          valor_face: 0,
          ja_recebido: 0,
          valor_estimado_complementar: 0,
          liquidados: 0,
        },
      )
      const { data: resumos } = await svc
        .from('carteira_resumos')
        .select('processo_id, estagio_processual, providencias')
        .in('processo_id', creditos.map((c) => String(c.id)))
      const porId = new Map(
        ((resumos ?? []) as Record<string, unknown>[]).map((r) => [
          String(r.processo_id),
          { estagio_processual: r.estagio_processual, providencias: r.providencias },
        ]),
      )
      return JSON.stringify({
        encontrado: true,
        moeda: 'BRL',
        fonte: 'campo cessionário dos créditos — a mesma da tela de Carteiras',
        nomes_casados: [...new Set(creditos.map((c) => c.cessionario))],
        totais,
        creditos: creditos.map(({ id, ...resto }) => ({
          ...resto,
          situacao_atual: porId.get(String(id)) ?? null,
        })),
      })
    }

    case 'listar_investidores': {
      let q = svc
        .from('investidor_dados')
        // SEM cpf, rg, conta, agência e Pix: nenhuma pergunta de análise precisa
        // do valor desses campos, e mandá-los para fora do sistema seria expor
        // dado bancário sem necessidade. O que vai é se estão PREENCHIDOS.
        .select('tipo, nome_exibicao, nome_chave, cpf, rg, banco, agencia, conta, pix, cidade, uf, representante')
        .limit(LIMITE_MAX)
      if (args.papel) q = q.eq('tipo', args.papel)
      if (args.nome) q = q.ilike('nome_exibicao', `%${args.nome}%`)
      const { data, error } = await q
      if (error) return JSON.stringify({ erro: error.message })

      // Quantos créditos cada pessoa tem, no papel dela.
      const { data: procs } = await svc
        .from('processos')
        .select('cessionario, originador')
      const conta = (campo: 'cessionario' | 'originador') => {
        const m = new Map<string, number>()
        for (const p of (procs ?? []) as Record<string, unknown>[]) {
          const n = String(p[campo] ?? '').trim().toLowerCase()
          if (n) m.set(n, (m.get(n) ?? 0) + 1)
        }
        return m
      }
      const porCessionario = conta('cessionario')
      const porOriginador = conta('originador')

      const cheio = (v: unknown) => !!String(v ?? '').trim()
      let pessoas = ((data ?? []) as Record<string, unknown>[]).map((d) => {
        const nome = String(d.nome_exibicao ?? d.nome_chave ?? '')
        const chave = nome.trim().toLowerCase()
        const faltando = [
          cheio(d.cpf) ? null : 'documento',
          cheio(d.banco) ? null : 'banco',
          cheio(d.conta) ? null : 'conta',
          cheio(d.pix) ? null : 'pix',
          cheio(d.cidade) ? null : 'endereço',
        ].filter(Boolean)
        return {
          nome,
          papel: d.tipo,
          cidade_uf: [d.cidade, d.uf].filter(Boolean).join('/') || null,
          // Documento com mais de 11 dígitos é CNPJ — mesma régua da plataforma.
          pessoa_juridica: String(d.cpf ?? '').replace(/\D/g, '').length > 11,
          representante_legal: d.representante ?? null,
          creditos_como_cessionario: porCessionario.get(chave) ?? 0,
          creditos_como_originador: porOriginador.get(chave) ?? 0,
          ficha_completa: faltando.length === 0,
          campos_em_branco: faltando.length ? faltando : undefined,
        }
      })
      if (args.ficha_incompleta === true)
        pessoas = pessoas.filter((p) => !p.ficha_completa)
      return JSON.stringify({
        aviso:
          'CPF/CNPJ, RG, agência, conta e Pix NÃO são expostos ao assistente — ' +
          'só se estão preenchidos. Para ver os valores, use a tela Dados cadastrais.',
        quantidade_retornada: pessoas.length,
        pessoas: pessoas.slice(0, limite(args.limite)),
      })
    }

    case 'listar_analises': {
      let q = svc
        .from('analises_credito')
        .select('numero_processo, cedente, devedor, tribunal, valor_face, valor_avaliado, risco, status, observacoes, created_at')
        .order('created_at', { ascending: false })
        .limit(limite(args.limite))
      if (args.status) q = q.eq('status', args.status)
      if (args.risco) q = q.eq('risco', args.risco)
      const { data, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({
        moeda: 'BRL',
        contexto: 'Fase PRÉ-CONTRATUAL: candidato a aquisição, ainda não é crédito da carteira.',
        quantidade_retornada: data?.length ?? 0,
        analises: data,
      })
    }

    case 'listar_requerimentos': {
      // select('*') e não lista de colunas: esta tabela ganhou campos em seis
      // migrações diferentes, e enumerar errado faz o PostgREST recusar a
      // consulta TODA — o assistente diria "não há requerimentos" havendo.
      let q = svc
        .from('requerimentos')
        .select('*')
        .order('data_protocolo', { ascending: false, nullsFirst: false })
        .limit(limite(args.limite))
      if (args.orgao) q = q.ilike('orgao', `%${args.orgao}%`)
      const { data, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({ quantidade_retornada: data?.length ?? 0, requerimentos: data })
    }

    case 'listar_contatos': {
      // Mesmo motivo do select('*') acima: a tabela foi remodelada em 0003/0004/0008.
      let q = svc.from('contatos_serventias').select('*').limit(limite(args.limite))
      if (args.orgao) q = q.ilike('orgao', `%${args.orgao}%`)
      if (args.tribunal) q = q.ilike('tribunal', `%${args.tribunal}%`)
      const { data, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({ quantidade_retornada: data?.length ?? 0, contatos: data })
    }

    case 'resumos_da_carteira': {
      // Os textos já escritos pela plataforma, juntados ao crédito. Duas
      // consultas, e não um join: `carteira_resumos` referencia processo_id, e o
      // filtro (cessionário, status) é do lado do crédito.
      const alvo = aplicarFiltros(
        svc.from('processos').select('id, numero_cnj, cedente, cessionario, status'),
        args,
      )
      const { data: procs, error } = await alvo
      if (error) return JSON.stringify({ erro: error.message })
      const lista = ((procs ?? []) as Record<string, unknown>[]).slice(
        0,
        limite(args.limite),
      )
      if (lista.length === 0)
        return JSON.stringify({ quantidade_retornada: 0, creditos: [] })
      const { data: resumos } = await svc
        .from('carteira_resumos')
        .select('processo_id, estagio_processual, providencias, erro, gerado_em')
        .in('processo_id', lista.map((p) => String(p.id)))
      const porId = new Map(
        ((resumos ?? []) as Record<string, unknown>[]).map((r) => [String(r.processo_id), r]),
      )
      return JSON.stringify({
        aviso:
          'Textos mantidos pela plataforma para a carteira do investidor, escritos ' +
          'sem datas de propósito. Para a cronologia de um caso use ficha_do_credito.',
        quantidade_retornada: lista.length,
        creditos: lista.map(({ id, ...resto }) => {
          const r = porId.get(String(id))
          return {
            ...resto,
            estagio_processual: r?.estagio_processual ?? null,
            providencias: r?.providencias ?? null,
            sem_resumo_porque: r ? (r.erro ?? undefined) : 'ainda não foi gerado',
          }
        }),
      })
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

# O negócio
A Credijuris compra créditos judiciais de credores originais (**cedentes**) e os cede a investidores (**cessionários**). Todo crédito é processo em cumprimento de sentença contra a Fazenda Pública. O caminho: cumprimento de sentença → impugnação ou concordância com os cálculos → homologação → expedição do requisitório (**RPV** ou **precatório**) → pagamento → levantamento pelo cessionário.

# O que você alcança
- **Créditos (processos)** — o cadastro inteiro, inclusive os campos financeiros: capital investido (o que a Credijuris pagou), valor de face, já recebido, saldo estimado complementar, espécie do requisitório, tipo de crédito, originador, cessionário. Situação cadastral é só uma de três: \`ativo\`, \`complementar\` (recebeu parte, há saldo) ou \`encerrado\`. **Quem diz se o crédito foi pago é a data de liquidação, não o status.**
- **Ficha de um crédito** — \`ficha_do_credito\` junta cadastro, apensos, estágio processual, tarefas, movimentações e publicações de um processo só. Prefira-a a quatro chamadas separadas.
- **Movimentações e publicações** — andamentos do ADVBOX e intimações do DJEN. TEXTO CORRIDO, sem classificação. A publicação tem a marcação "tratada" (não existe "lida"), e a janela de dias corre pela data de disponibilização, no fuso de Brasília.
- **Tarefas** — o trabalho da equipe, com prazo fatal, responsáveis e se já foi concluída. O histórico inclui as concluídas.
- **Carteiras** — os créditos de cada investidor, pela mesma fonte da tela (o campo cessionário do crédito).
- **Análises de crédito** — a fase PRÉ-CONTRATUAL. Não é carteira: é candidato a aquisição.
- **Cessões** — o inventário comercial da operação, com valores de face, aquisição e cessão.
- **Investidores e originadores** — quem são, quantos créditos têm e se a ficha cadastral está completa.
- **Requerimentos administrativos** e **contatos das serventias**.

# O que você NÃO alcança
CPF/CNPJ, RG, agência, conta e Pix das fichas cadastrais não são expostos a você — você só sabe se estão preenchidos. Se pedirem o número, diga onde encontrar (Comercial → Dados cadastrais) em vez de tentar consultar.

# Duas confusões a evitar
- **Análise de crédito ≠ crédito.** A análise é anterior à compra; o crédito já é da carteira. Perguntas sobre "o que estamos avaliando" são de análises; sobre "o que temos" são de créditos.
- **Cessão ≠ crédito.** A tabela de cessões é o registro comercial da operação. Para "quanto a Credijuris tem investido" ou "qual o valor de face da carteira", use \`resumo_financeiro_creditos\`, que soma os próprios créditos.

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

Para perguntas que uma contagem responde direto (quantos encerrados, quanto foi cedido), aí sim o número é exato e você pode afirmá-lo sem ressalva. O mesmo vale para \`resumo_financeiro_creditos\`: ele percorre todos os créditos que casam com o filtro, então os totais são exatos.

Quando uma lista traz \`aviso_limite\`, ela bateu no teto e NÃO é o conjunto todo. Nesse caso, ou peça o total com a ferramenta de contagem, ou diga que está mostrando uma parte — nunca apresente o tamanho da lista como se fosse o total.

# Você pode calcular
Somar, subtrair, dividir e comparar o que as ferramentas devolveram é seu trabalho — deságio, percentual recebido, ticket médio, concentração por investidor. O que não vale é inventar o insumo. Mostre a conta quando ela não for óbvia, para a pessoa poder conferir.

# Como escrever
Vá direto ao ponto: a resposta primeiro, o detalhe depois. Valores em reais no formato brasileiro (R$ 1.234,56). Datas como dd/mm/aaaa. Tabela só quando houver vários itens comparáveis; para um número só, uma frase basta.

Se a pergunta for ambígua de um jeito que muda a resposta, pergunte antes de consultar. Se estiver fora do que os dados alcançam — conselho jurídico, previsão de quando um processo será pago, informação de fora do sistema — diga o que você tem e o que não tem.

Você só faz leitura. Não existe ferramenta que altere dados; se pedirem para cadastrar, editar ou apagar algo, explique que isso é feito nas telas do sistema.`

// ------------------------------------------------------------------- handler

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const caller = await getCallerAtivo(req, serviceClient())
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

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
        // 16000 e não 8000: com thinking adaptativo o orçamento é dividido entre
        // o pensamento e o texto visível, e o caminho de interpretação roda em
        // esforço alto. Com 8000, pedir uma tabela de 60 processos estourava na
        // linha ~35 e a resposta CORTADA era entregue como completa.
        max_tokens: 16000,
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
        // Resposta INTERROMPIDA por limite de tokens não pode ser entregue como
        // se estivesse inteira: uma tabela de 60 processos cortada na linha 35
        // parece completa, e quem lê usa o pedaço como se fosse o todo.
        const truncada = resposta.stop_reason === 'max_tokens'
        return jsonResponse({
          resposta:
            texto ||
            'Não consegui formular uma resposta. Tente reformular a pergunta.',
          truncada: truncada || undefined,
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
