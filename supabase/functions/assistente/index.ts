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
import { montarPainel, type CreditoBruto } from '../_shared/nucleo/painel.ts'
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
 * O modelo é escolha da pessoa, feita no seletor do próprio chat — Sonnet é o
 * padrão recomendado (a interface já sugere assim), Haiku para respostas
 * rápidas e baratas, Opus para casos difíceis. O que NÃO muda com a escolha é
 * o esforço de raciocínio (abaixo): ele é decidido pelo que a pergunta
 * EXIGIU, não pelo que parecia exigir, e vale para qualquer um dos três.
 *
 * Contagens, listas e somas são consulta estruturada: o trabalho é escolher o
 * filtro certo, e esforço BAIXO dá conta — é rodada rápida, sem ambiguidade
 * de interpretação, então gastar tempo pensando ali é só demora sem ganho.
 *
 * Interpretar movimentação é outra coisa. O texto é jurídico, corrido, com
 * redação que varia por tribunal, e a resposta precisa distinguir o que o
 * andamento sustenta do que apenas se parece com a pergunta. Errar ali custa
 * caro — um processo apontado como concluso quando não está —, então esse
 * caminho continua em esforço ALTO: é o único ponto em que vale pagar o tempo
 * extra de raciocínio, porque é o único em que ele muda o resultado.
 *
 * Classificar a pergunta pelas palavras dela erraria: "quantos processos estão
 * conclusos" começa igual a uma contagem. Então começamos no esforço menor e
 * promovemos a partir do momento em que a busca textual é acionada — a decisão
 * vem do comportamento observado, não de um palpite sobre a intenção.
 */
const MODELOS_PERMITIDOS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-5',
  'claude-opus-5',
])
const MODELO_PADRAO = 'claude-sonnet-5'

/** Nunca repassa a escolha do cliente direto pra API sem checar o allowlist. */
function resolverModelo(pedido: unknown): string {
  return typeof pedido === 'string' && MODELOS_PERMITIDOS.has(pedido)
    ? pedido
    : MODELO_PADRAO
}
/**
 * Ferramentas cuja presença promove a conversa ao esforço alto — as duas que
 * pedem para o modelo interpretar texto jurídico corrido, não só consultar
 * campo estruturado.
 */
const FERRAMENTAS_QUE_PROMOVEM = new Set(['buscar_movimentacoes', 'ler_historico_apos_data'])
/** Teto de linhas por consulta: o que vai para o modelo é contexto, não relatório. */
const LIMITE_MAX = 50
/**
 * A busca textual tem tetos próprios, porque agrupa por processo. Varremos
 * muitas linhas (baratas: só número, data e um trecho) e devolvemos poucos
 * processos — assim dez andamentos do mesmo processo não ocupam dez vagas.
 */
const LINHAS_VARRIDAS = 600
const PROCESSOS_POR_BUSCA = 60
/**
 * Teto de processos por chamada de `ler_historico_apos_data` — ali o texto
 * vai INTEIRO, sem cortar, então o custo por processo é bem maior que nas
 * outras ferramentas. Poucos processos lidos a fundo, e não uma amostra rasa
 * de muitos, é a troca certa quando o pedido é "entenda de verdade".
 */
const LIMITE_LER_HISTORICO = 15

// ---------------------------------------------------------------- ferramentas

/**
 * Colunas de `processos` que o modelo pode filtrar, com o TIPO que decide os
 * operadores válidos — allowlist explícita: nunca aceita nome de coluna
 * arbitrário vindo do modelo.
 *
 * Compartilhada por contar_processos, listar_processos, resumo_financeiro_creditos
 * e resumos_da_carteira via `aplicarFiltrosGenericos` — as quatro TÊM de filtrar
 * igual: se `contar` aceitasse um filtro que `listar` não aceita, a mesma
 * pergunta daria total e lista discordantes, e o modelo apresentaria as duas
 * coisas como coerentes.
 *
 * É um ARRAY de {campo, operador, valor} combináveis à vontade — não um
 * parâmetro fixo por coluna — porque a pessoa pergunta cruzando o que quiser
 * (tribunal + prazo + valor mínimo, por exemplo), e prever cada combinação
 * como parâmetro próprio travava toda pergunta que ninguém tinha previsto.
 */
type TipoFiltroProcesso = 'texto' | 'categoria' | 'data' | 'numero'
const COLUNAS_FILTRAVEIS_PROCESSO: Record<
  string,
  { tipo: TipoFiltroProcesso; valores?: string[]; descricao: string }
> = {
  status: {
    tipo: 'categoria',
    valores: ['ativo', 'complementar', 'encerrado'],
    descricao: 'Situação cadastral. complementar = já recebeu parte e há saldo a receber.',
  },
  especie_requisitorio: {
    tipo: 'categoria',
    valores: ['rpv', 'precatorio'],
    descricao: 'RPV (Requisição de Pequeno Valor) ou precatório.',
  },
  tribunal: { tipo: 'texto', descricao: 'Nome do tribunal.' },
  comarca: { tipo: 'texto', descricao: 'Comarca do processo.' },
  vara: { tipo: 'texto', descricao: 'Vara do processo.' },
  entidade_devedora: {
    tipo: 'texto',
    descricao: 'Nome do ente devedor (União, Estado, Município, autarquia).',
  },
  cedente: { tipo: 'texto', descricao: 'Nome do credor original.' },
  cedente_advogado: { tipo: 'texto', descricao: 'Advogado do cedente.' },
  cessionario: { tipo: 'texto', descricao: 'Nome do investidor que comprou o crédito.' },
  originador: { tipo: 'texto', descricao: 'Quem originou a aquisição.' },
  numero_cnj: { tipo: 'texto', descricao: 'Número do processo, com ou sem pontuação.' },
  data_aquisicao: { tipo: 'data', descricao: 'Data em que a Credijuris adquiriu o crédito.' },
  expectativa_liquidacao: {
    tipo: 'data',
    descricao: 'Data esperada de pagamento. Use para "o que vence nos próximos N meses".',
  },
  data_liquidacao: {
    tipo: 'data',
    descricao:
      'Data em que foi pago DE FATO — é este campo, com vazio/nao_vazio, que responde ' +
      '"já foi pago?", nunca o status.',
  },
  capital_investido: { tipo: 'numero', descricao: 'Quanto a Credijuris pagou pelo crédito.' },
  valor_face: { tipo: 'numero', descricao: 'Valor de face do crédito.' },
  ja_recebido: { tipo: 'numero', descricao: 'Quanto já entrou.' },
  valor_estimado_complementar: { tipo: 'numero', descricao: 'Saldo estimado a receber.' },
}

const OPERADORES_POR_TIPO: Record<TipoFiltroProcesso, string[]> = {
  texto: ['contem', 'igual', 'vazio', 'nao_vazio'],
  categoria: ['igual', 'diferente'],
  data: ['igual', 'maior_igual', 'menor_igual', 'maior', 'menor', 'vazio', 'nao_vazio'],
  numero: ['igual', 'maior_igual', 'menor_igual', 'maior', 'menor'],
}

/** Schema de `filtros`, embutido nas quatro ferramentas que filtram `processos`. */
const FILTROS_PROCESSO_SCHEMA = {
  filtros: {
    type: 'array' as const,
    description:
      'Filtros a combinar (E lógico entre eles — todos precisam bater). Cada um é ' +
      '{campo, operador, valor}. Campos: ' +
      Object.entries(COLUNAS_FILTRAVEIS_PROCESSO)
        .map(
          ([campo, def]) =>
            `\`${campo}\` (${def.tipo}${def.valores ? `: ${def.valores.join('|')}` : ''}) — ${def.descricao}`,
        )
        .join(' · ') +
      '. Operadores por tipo — texto: contem/igual/vazio/nao_vazio; categoria: ' +
      'igual/diferente; data e número: igual/maior_igual/menor_igual/maior/menor (data ' +
      'também aceita vazio/nao_vazio). Datas em AAAA-MM-DD. `valor` é dispensável só em ' +
      'vazio/nao_vazio.',
    items: {
      type: 'object' as const,
      properties: {
        campo: { type: 'string' as const, enum: Object.keys(COLUNAS_FILTRAVEIS_PROCESSO) },
        operador: {
          type: 'string' as const,
          enum: [
            'contem',
            'igual',
            'diferente',
            'maior_igual',
            'menor_igual',
            'maior',
            'menor',
            'vazio',
            'nao_vazio',
          ],
        },
        valor: {},
      },
      required: ['campo', 'operador'],
    },
  },
}

const FERRAMENTAS: Anthropic.Tool[] = [
  {
    name: 'contar_processos',
    description:
      'Conta créditos/processos cadastrados, opcionalmente filtrando. ' +
      'Use para perguntas de "quantos". Devolve um número exato.',
    input_schema: { type: 'object', properties: { ...FILTROS_PROCESSO_SCHEMA } },
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
        ...FILTROS_PROCESSO_SCHEMA,
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
        ...FILTROS_PROCESSO_SCHEMA,
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
    name: 'ler_historico_apos_data',
    description:
      'Lê o texto INTEIRO (sem cortar) de todos os andamentos e publicações ' +
      'de um ou mais processos a partir de uma data — para você interpretar ' +
      'de verdade se algo mudou (ex: se uma decisão foi proferida depois de ' +
      '"concluso"), em vez de confiar no resumo cortado de ' +
      '`buscar_movimentacoes`. Use nos processos que essa ferramenta marcou ' +
      'com `ha_andamento_mais_recente_que_o_encontrado`, passando a data do ' +
      'andamento que casou como `desde`. Aceita vários processos numa única ' +
      'chamada — não repita a chamada um processo de cada vez.',
    input_schema: {
      type: 'object',
      properties: {
        processos: {
          type: 'array',
          description: `Até ${LIMITE_LER_HISTORICO} processos por chamada.`,
          items: {
            type: 'object',
            properties: {
              numero_processo: { type: 'string' },
              desde: {
                type: 'string',
                description: 'Só andamentos DEPOIS desta data (AAAA-MM-DD).',
              },
            },
            required: ['numero_processo', 'desde'],
          },
        },
      },
      required: ['processos'],
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
      'recente que CASOU COM O TEXTO — não necessariamente o mais recente do ' +
      'processo: confira sempre `ha_andamento_mais_recente_que_o_encontrado`, ' +
      'porque "concluso" pode já ter sido seguido de sentença ou intimação), ' +
      'mais a contagem exata de ocorrências e de processos distintos. Sempre ' +
      'mostre os processos encontrados; use `processos_distintos_encontrados` ' +
      'para dizer o total e `pode_haver_mais_antigos` para saber se ficou algo ' +
      'de fora.',
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
      'tarefas o Fulano tem". Omitir `concluida` traz as duas MISTURADAS — ' +
      'para "o que falta fazer", "pendências" ou "a vencer", passe SEMPRE ' +
      '`concluida: false` explicitamente; não confie em filtrar de cabeça ' +
      'depois de receber a lista.',
    input_schema: {
      type: 'object',
      properties: {
        numero_processo: { type: 'string' },
        concluida: {
          type: 'boolean',
          description:
            'false = só em aberto (use para qualquer pergunta de pendência/prazo); ' +
            'true = só já concluídas; omita apenas quando a pergunta pedir os dois juntos.',
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
        ...FILTROS_PROCESSO_SCHEMA,
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'panorama_economico',
    description:
      'PERFORMANCE da carteira: rentabilidade (mediana, média e ponderada pelo ' +
      'capital), rentabilidade anualizada, prazos, forecast de recebimentos por ' +
      'mês e previsões vencidas. Não confunda com `resumo_financeiro_creditos`, que dá SOMAS; ' +
      'esta dá DESEMPENHO — quanto rendeu, em quanto tempo, com que dispersão e ' +
      'com quanta base estatística. Os números saem da mesma camada de cálculo ' +
      'das telas do Quadro Econômico; não refaça conta sobre eles.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'recorte_economico',
    description:
      'Dinheiro e desempenho agrupados por tribunal, ente devedor ou investidor. ' +
      'Cada grupo traz quanto já investiu, quanto já recebeu e quanto falta ' +
      'receber, mais a rentabilidade das operações encerradas dele. Vem também ' +
      'o tamanho da amostra e a classe de representatividade: grupo marcado com ' +
      '`pode_comparar: false` NÃO pode ser comparado com outro nem chamado de ' +
      'melhor ou pior.',
    input_schema: {
      type: 'object',
      properties: {
        dimensao: {
          type: 'string',
          enum: ['tribunal', 'ente', 'investidor'],
          description: 'Como agrupar as operações.',
        },
      },
      required: ['dimensao'],
    },
  },
  {
    name: 'situacao_due_diligence',
    description:
      'Status do checklist de certidões (due diligence documental) de um ' +
      'cedente/crédito: quantas certidões são necessárias, quantas já foram ' +
      'obtidas, quantas estão pendentes ou vencidas, e a lista das pendentes ' +
      'com o nome de cada uma. Use para "a diligência do processo X está ' +
      'completa", "que certidões faltam para o Fulano", "o dossiê documental ' +
      'já fechou".',
    input_schema: {
      type: 'object',
      properties: {
        busca: {
          type: 'string',
          description: 'Número do processo (CNJ) ou nome do cedente.',
        },
      },
      required: ['busca'],
    },
  },
  {
    name: 'funil_comercial',
    description:
      'Em que etapa do funil comercial (Kommo) está um crédito em análise, e ' +
      'quem é o responsável. Cobre a fase de originação, ANTES de o crédito ' +
      'virar processo da carteira. Use para "em que fase está o card do ' +
      'Fulano", "quem está responsável pelo processo X no comercial", "quais ' +
      'cards estão parados". Omita `busca` para listar os mais recentes.',
    input_schema: {
      type: 'object',
      properties: {
        busca: {
          type: 'string',
          description: 'Número do processo ou nome do cedente/card.',
        },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'creditos_a_vencer',
    description:
      'Créditos ativos/complementares ainda não liquidados, com expectativa de ' +
      'liquidação nos próximos 30 dias — já agrupados por urgência (hoje/atrasado, ' +
      'esta semana, este mês), sem você precisar fazer a conta de data. Use para ' +
      '"o que vence essa semana", "créditos próximos da liquidação".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'processos_parados',
    description:
      'Créditos ativos/complementares SEM nenhuma movimentação recente — mesmo ' +
      'critério da aba Publicações e Movimentações → Paralisados (padrão: mais de ' +
      '20 dias sem andamento; quem nunca teve andamento também entra). Devolve ' +
      'ordenado do menos parado ao mais parado. Use para "quais processos estão ' +
      'parados", "processos sem andamento".',
    input_schema: {
      type: 'object',
      properties: {
        dias: {
          type: 'integer',
          description:
            'Corte em dias sem movimentação (padrão 20 — o mesmo da tela). Ofereça ' +
            '20/45/90/180 como as mesmas faixas que a tela usa visualmente, se a ' +
            'pessoa quiser refinar.',
        },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'propor_peticao',
    description:
      'Propõe gerar uma petição para um crédito — NÃO gera nada sozinho, só ' +
      'prepara os dados para a pessoa confirmar numa tela de revisão. Use ' +
      'sempre que pedirem para redigir/gerar uma petição (ex: "gere uma ' +
      'petição de sequestro para o processo X"). O texto de verdade só é ' +
      'escrito depois que a pessoa confirmar, com revisão humana antes de ' +
      'qualquer exportação — esta ferramenta nunca produz o documento final.',
    input_schema: {
      type: 'object',
      properties: {
        busca: {
          type: 'string',
          description: 'Número do processo (CNJ) ou nome do cedente.',
        },
        instrucao: {
          type: 'string',
          description:
            'O que a petição deve pedir, nas palavras da pessoa (ex: ' +
            '"sequestro de valores via SISBAJUD, art. 854 do CPC").',
        },
      },
      required: ['busca', 'instrucao'],
    },
  },
  {
    name: 'propor_contato',
    description:
      'Empacota um contato (telefone/WhatsApp) do gabinete ou da serventia ' +
      'junto com o PEDIDO de acompanhamento/cobrança, para a interface montar ' +
      'a mensagem no padrão fixo da casa e mostrar como um cartão com o ' +
      'número clicável — ao clicar, abre o WhatsApp daquele número E copia a ' +
      'mensagem pronta para colar. Você não escreve a saudação, o nome de ' +
      'quem fala nem o fecho — isso a interface preenche sozinha, sempre ' +
      'igual; você só escreve o CONTEÚDO (o pedido em si). Use depois de ' +
      'achar o contato via `listar_contatos` e o crédito via ' +
      '`ficha_do_credito`/`listar_processos`. Não invente o contato: só use ' +
      'um `whatsapp` que veio de verdade de `listar_contatos`.',
    input_schema: {
      type: 'object',
      properties: {
        nome_contato: {
          type: 'string',
          description: 'Nome do órgão/gabinete/serventia, para identificar o cartão.',
        },
        whatsapp: {
          type: 'string',
          description: 'Número de WhatsApp, exatamente como veio de listar_contatos.',
        },
        numero_cnj: {
          type: 'string',
          description: 'Número do processo, para entrar no "nos autos do processo n. ...".',
        },
        cessionario: {
          type: 'string',
          description: 'Nome do investidor — entra em "em nome do cessionário".',
        },
        conteudo: {
          type: 'string',
          description:
            'SÓ o pedido em si (o que está sendo solicitado/cobrado), sem saudação, sem ' +
            '"me chamo" e sem fecho — a interface monta o resto ao redor disso.',
        },
      },
      required: ['whatsapp', 'numero_cnj', 'cessionario', 'conteudo'],
    },
  },
]
/** Fração -> pontos percentuais. Null continua null. */
function pctOuNulo(f: number | null | undefined): number | null {
  return typeof f === 'number' && Number.isFinite(f) ? Math.round(f * 10000) / 100 : null
}

/** Colunas que `montarPainel` exige. Nada além delas. */
const COLUNAS_PAINEL =
  'id, numero_cnj, tribunal, entidade_devedora, cessionario, status, ' +
  'data_aquisicao, data_referencia, expectativa_liquidacao, data_liquidacao, ' +
  'capital_investido, valor_face, ja_recebido, valor_estimado_complementar, ' +
  'indice_atualizacao'

/**
 * Monta o painel econômico com a MESMA função que as telas usam.
 *
 * É o que impede o assistente de divergir da tela: não há segunda conta em
 * lugar nenhum. Se o número mudar em `_shared/nucleo`, muda nos dois.
 */
async function carregarPainel(
  svc: SupabaseClient,
): Promise<{ painel: ReturnType<typeof montarPainel> } | { erro: string }> {
  const [creditos, parametros] = await Promise.all([
    svc.from('processos').select(COLUNAS_PAINEL),
    svc
      .from('parametros_atualizacao')
      .select('selic_aa, ipca_12m_aa, data_referencia')
      .eq('id', 1)
      .maybeSingle(),
  ])
  if (creditos.error) return { erro: creditos.error.message }
  const hoje = new Date().toISOString().slice(0, 10)
  return {
    painel: montarPainel(
      (creditos.data ?? []) as unknown as CreditoBruto[],
      (parametros.data ?? undefined) as Parameters<typeof montarPainel>[1],
      hoje,
    ),
  }
}

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
  neq: (c: string, v: unknown) => unknown
  ilike: (c: string, v: string) => unknown
  is: (c: string, v: null) => unknown
  not: (c: string, op: string, v: unknown) => unknown
  lte: (c: string, v: unknown) => unknown
  gte: (c: string, v: unknown) => unknown
  lt: (c: string, v: unknown) => unknown
  gt: (c: string, v: unknown) => unknown
}

/** Um item do array `filtros` que as ferramentas de crédito recebem. */
interface FiltroBruto {
  campo?: unknown
  operador?: unknown
  valor?: unknown
}

/**
 * Aplica o array `filtros` (genérico, combinável) a qualquer consulta sobre
 * `processos` — compartilhado por contar, listar, resumir e resumos_da_carteira:
 * se cada um filtrasse do seu jeito, a mesma pergunta daria total e lista
 * discordantes, e o modelo apresentaria as duas coisas como coerentes.
 *
 * Nunca lança por filtro malformado: campo desconhecido ou operador que não
 * vale pro tipo da coluna é IGNORADO e vai para `avisos`, que entra na
 * resposta da ferramenta — o modelo vê o que foi descartado e pode corrigir
 * na próxima chamada, em vez da pergunta inteira falhar por um filtro errado
 * no meio de vários corretos.
 */
function aplicarFiltrosGenericos<T>(q: T, filtros: unknown): { query: T; avisos: string[] } {
  let r = q as unknown as Filtravel
  const avisos: string[] = []
  if (filtros === undefined || filtros === null) return { query: r as unknown as T, avisos }
  if (!Array.isArray(filtros)) {
    return { query: r as unknown as T, avisos: ['`filtros` precisa ser uma lista — ignorado.'] }
  }

  for (const bruto of filtros as FiltroBruto[]) {
    const campo = String(bruto?.campo ?? '')
    const def = COLUNAS_FILTRAVEIS_PROCESSO[campo]
    if (!def) {
      avisos.push(`Campo desconhecido "${campo}" — ignorado.`)
      continue
    }
    const operador = String(bruto?.operador ?? '')
    if (!OPERADORES_POR_TIPO[def.tipo].includes(operador)) {
      avisos.push(`Operador "${operador}" não vale para "${campo}" (${def.tipo}) — ignorado.`)
      continue
    }
    const valor = bruto?.valor
    if (operador !== 'vazio' && operador !== 'nao_vazio' && (valor === undefined || valor === null)) {
      avisos.push(`Filtro em "${campo}" sem valor — ignorado.`)
      continue
    }
    switch (operador) {
      case 'igual':
        r = r.eq(campo, valor) as Filtravel
        break
      case 'diferente':
        r = r.neq(campo, valor) as Filtravel
        break
      case 'contem':
        r = r.ilike(campo, `%${String(valor)}%`) as Filtravel
        break
      case 'maior_igual':
        r = r.gte(campo, valor) as Filtravel
        break
      case 'menor_igual':
        r = r.lte(campo, valor) as Filtravel
        break
      case 'maior':
        r = r.gt(campo, valor) as Filtravel
        break
      case 'menor':
        r = r.lt(campo, valor) as Filtravel
        break
      case 'vazio':
        r = r.is(campo, null) as Filtravel
        break
      case 'nao_vazio':
        r = r.not(campo, 'is', null) as Filtravel
        break
    }
  }
  return { query: r as unknown as T, avisos }
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

/** Espelho de `desde()` pra data FUTURA — "daqui a N dias", mesmo fuso. */
function daqui(dias: number): string {
  const hojeSP = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo',
  })
  const [a, m, d] = hojeSP.split('-').map(Number)
  const base = new Date(Date.UTC(a, m - 1, d))
  base.setUTCDate(base.getUTCDate() + dias)
  return base.toISOString().slice(0, 10)
}

/**
 * "Bom dia"/"Boa tarde"/"Boa noite" pelo horário de BRASÍLIA — nunca pelo
 * modelo (que não tem relógio, mesmo motivo de `desde()` acima e do "Hoje é
 * ..." explícito em peticao-ia): a saudação do padrão de mensagem tem de
 * bater com a hora real de quem manda, não com um palpite do modelo.
 */
function saudacaoPorHorario(): string {
  const hora = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
  )
  if (hora < 12) return 'Bom dia'
  if (hora < 18) return 'Boa tarde'
  return 'Boa noite'
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
  contexto: { nomeUsuario: string },
): Promise<string> {
  switch (nome) {
    case 'contar_processos': {
      const { query, avisos } = aplicarFiltrosGenericos(
        svc.from('processos').select('id', { count: 'exact', head: true }),
        args.filtros,
      )
      const { count, error } = await query
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({
        total: count ?? 0,
        filtros_aplicados: args.filtros,
        avisos: avisos.length ? avisos : undefined,
      })
    }

    case 'listar_processos': {
      const { query, avisos } = aplicarFiltrosGenericos(
        svc
          .from('processos')
          .select(COLUNAS_PROCESSO)
          .order('created_at', { ascending: false })
          .limit(limite(args.limite)),
        args.filtros,
      )
      const { data, error } = await query
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
        avisos: avisos.length ? avisos : undefined,
        processos: data,
      })
    }

    case 'resumo_financeiro_creditos': {
      // Sem limite: são somas, e amostra daria total errado apresentado como
      // exato. O acervo é de centenas de linhas, não de milhões.
      const { query, avisos } = aplicarFiltrosGenericos(
        svc
          .from('processos')
          .select(
            'status, especie_requisitorio, originador, cessionario, tribunal, ' +
              'entidade_devedora, capital_investido, valor_face, ja_recebido, ' +
              'valor_estimado_complementar, data_liquidacao',
          ),
        args.filtros,
      )
      const { data, error } = await query
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
      for (const l of (data ?? []) as unknown as Record<string, unknown>[]) {
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
        avisos: avisos.length ? avisos : undefined,
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

    case 'ler_historico_apos_data': {
      const pedidos = Array.isArray(args.processos) ? args.processos : []
      if (pedidos.length === 0) {
        return JSON.stringify({ erro: 'Informe ao menos um processo (numero_processo + desde).' })
      }
      const cortados = pedidos.slice(0, LIMITE_LER_HISTORICO) as Record<string, unknown>[]
      const alemDoLimite = pedidos.length > LIMITE_LER_HISTORICO

      const resultados = await Promise.all(
        cortados.map(async (p) => {
          const numero = String(p?.numero_processo ?? '')
          const desde = String(p?.desde ?? '')
          const digitos = numero.replace(/\D/g, '')
          if (!digitos || !desde) {
            return {
              numero_processo: numero || null,
              erro: 'Informe numero_processo e desde (AAAA-MM-DD).',
            }
          }
          const prefixo = digitos.slice(0, 7)
          const [mov, pub] = await Promise.all([
            svc
              .from('advbox_movimentacoes')
              .select('data, conteudo')
              .ilike('numero_processo', `%${prefixo}%`)
              .gt('data', desde)
              .order('data', { ascending: true })
              .limit(20),
            svc
              .from('djen_publicacoes')
              .select('data_disponibilizacao, tipo_comunicacao, raw')
              .ilike('numero_processo', `%${prefixo}%`)
              .gt('data_disponibilizacao', desde)
              .order('data_disponibilizacao', { ascending: true })
              .limit(20),
          ])
          if (mov.error && pub.error) {
            return { numero_processo: numero, erro: mov.error.message }
          }
          // Texto INTEIRO, sem cortar — é o que diferencia esta ferramenta de
          // buscar_movimentacoes: aqui o modelo lê pra entender, não só pra achar.
          const andamentos = [
            ...((mov.data ?? []) as Record<string, unknown>[]).map((m) => ({
              data: m.data,
              fonte: 'movimentacao' as const,
              texto: m.conteudo,
            })),
            ...((pub.data ?? []) as Record<string, unknown>[]).map((x) => ({
              data: x.data_disponibilizacao,
              fonte: 'publicacao' as const,
              texto: textoDjen(x.raw),
            })),
          ].sort((a, b) => String(a.data ?? '').localeCompare(String(b.data ?? '')))
          return {
            numero_processo: numero,
            quantidade_andamentos: andamentos.length,
            andamentos,
          }
        }),
      )

      return JSON.stringify({
        aviso: alemDoLimite
          ? `Só os primeiros ${LIMITE_LER_HISTORICO} processos desta lista foram lidos ` +
            '— peça o restante numa chamada seguinte.'
          : undefined,
        resultados,
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

      // O andamento que CASOU com o texto não é necessariamente o mais
      // recente DO PROCESSO — "concluso" pode ter sido seguido de "sentença"
      // ou "intimação" depois, e sem checar isso o modelo afirmaria uma fase
      // que já passou (defeito relatado: lista de "conclusos" incluía
      // processos que já teriam avançado). Busca o andamento mais recente de
      // verdade de cada processo da amostra, SEM filtro de texto, e compara.
      const CAP_VERIFICACAO = 2000
      const numerosDaAmostra = [
        ...new Set(amostra.map((a) => a.numero_processo).filter(Boolean)),
      ]
      const maisRecentePorProcesso = new Map<
        string,
        { data: string | null; fonte: 'movimentacao' | 'publicacao'; trecho: string | null }
      >()
      let verificacaoTruncada = false
      if (numerosDaAmostra.length > 0) {
        const [movRecentes, pubRecentes] = await Promise.all([
          svc
            .from('advbox_movimentacoes')
            .select('numero_processo, data, conteudo')
            .in('numero_processo', numerosDaAmostra)
            .order('data', { ascending: false })
            .limit(CAP_VERIFICACAO),
          svc
            .from('djen_publicacoes')
            .select('numero_processo, data_disponibilizacao, raw')
            .in('numero_processo', numerosDaAmostra)
            .order('data_disponibilizacao', { ascending: false })
            .limit(CAP_VERIFICACAO),
        ])
        verificacaoTruncada =
          (movRecentes.data?.length ?? 0) >= CAP_VERIFICACAO ||
          (pubRecentes.data?.length ?? 0) >= CAP_VERIFICACAO
        const registraRecente = (
          numero: string,
          data: string | null,
          fonte: 'movimentacao' | 'publicacao',
          trecho: string | null,
        ) => {
          const atual = maisRecentePorProcesso.get(numero)
          if (!atual || (data ?? '') > (atual.data ?? '')) {
            maisRecentePorProcesso.set(numero, { data, fonte, trecho })
          }
        }
        for (const m of (movRecentes.data ?? []) as Record<string, unknown>[]) {
          registraRecente(
            String(m.numero_processo),
            m.data as string | null,
            'movimentacao',
            corta(m.conteudo as string | null),
          )
        }
        for (const p of (pubRecentes.data ?? []) as Record<string, unknown>[]) {
          registraRecente(
            String(p.numero_processo),
            p.data_disponibilizacao as string | null,
            'publicacao',
            corta(textoDjen(p.raw)),
          )
        }
      }

      const processosComVerificacao = amostra.map((a) => {
        const maisRecente = maisRecentePorProcesso.get(a.numero_processo)
        const superado = !!maisRecente && (maisRecente.data ?? '') > (a.data ?? '')
        return {
          ...a,
          // true = o processo teve andamento DEPOIS do que casou com a busca;
          // o que o texto encontrado descreve pode não valer mais.
          ha_andamento_mais_recente_que_o_encontrado: superado || undefined,
          ultimo_andamento_do_processo: superado
            ? { data: maisRecente!.data, fonte: maisRecente!.fonte, trecho: maisRecente!.trecho }
            : undefined,
        }
      })

      return JSON.stringify({
        aviso:
          'Busca por texto: a redação varia entre tribunais, então a lista ' +
          'pode não estar completa. Cada processo aparece uma vez, com seu ' +
          'andamento mais recente que casou com o texto — NÃO necessariamente ' +
          'o andamento mais recente do processo. Quando ' +
          '`ha_andamento_mais_recente_que_o_encontrado` for true, houve algo ' +
          'depois (em `ultimo_andamento_do_processo`): a fase que o texto ' +
          'buscado descreve pode já ter passado, e isso tem de aparecer na ' +
          'resposta. O texto do DJEN é guardado em HTML, então termo com ' +
          'acento pode deixar de casar.',
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
        // Só quando true é que a checagem de "houve algo mais recente" pode ter
        // ficado incompleta para algum processo muito ativo da amostra.
        verificacao_de_atualidade_limitada: verificacaoTruncada || undefined,
        processos: processosComVerificacao,
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
      let tarefas = (data ?? []) as unknown as Record<string, unknown>[]
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
        // Só aparece quando `concluida` não foi filtrado — é o aviso que falta
        // pra impedir "quais tarefas estão pendentes" sair com concluída
        // misturada porque ninguém checou o campo linha a linha.
        aviso:
          typeof args.concluida !== 'boolean'
            ? 'Esta lista mistura concluídas e em aberto — confira o campo `concluida` de ' +
              'cada uma antes de apresentar como pendência ou prazo a vencer.'
            : undefined,
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
      interface TotaisCarteira {
        creditos: number
        capital_investido: number
        valor_face: number
        ja_recebido: number
        valor_estimado_complementar: number
        liquidados: number
      }
      const totais = creditos.reduce<TotaisCarteira>(
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
      // filtro é do lado do crédito.
      const { query: alvo, avisos } = aplicarFiltrosGenericos(
        svc.from('processos').select('id, numero_cnj, cedente, cessionario, status'),
        args.filtros,
      )
      const { data: procs, error } = await alvo
      if (error) return JSON.stringify({ erro: error.message })
      const lista = ((procs ?? []) as Record<string, unknown>[]).slice(
        0,
        limite(args.limite),
      )
      if (lista.length === 0)
        return JSON.stringify({
          quantidade_retornada: 0,
          creditos: [],
          avisos: avisos.length ? avisos : undefined,
        })
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
        avisos: avisos.length ? avisos : undefined,
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

    case 'situacao_due_diligence': {
      const busca = String(args.busca ?? '')
      if (!busca) return JSON.stringify({ erro: 'Informe o processo ou o nome do cedente.' })
      const digitos = busca.replace(/\D/g, '')

      let leadId: number | null = null
      if (digitos.length >= 6) {
        const { data } = await svc
          .from('kommo_leads')
          .select('kommo_lead_id')
          .ilike('processo_cnj', `%${digitos.slice(0, 7)}%`)
          .limit(1)
          .maybeSingle()
        leadId = data ? Number(data.kommo_lead_id) : null
      }
      if (leadId === null) {
        const { data } = await svc
          .from('dd_sujeito')
          .select('kommo_lead_id')
          .eq('papel', 'CEDENTE')
          .ilike('nome', `%${busca}%`)
          .limit(2)
        const achados = (data ?? []) as { kommo_lead_id: number }[]
        if (achados.length === 1) leadId = Number(achados[0].kommo_lead_id)
        else if (achados.length > 1) {
          return JSON.stringify({
            encontrado: false,
            aviso: 'Mais de um cedente casou com esse nome. Peça à pessoa qual, ou refine.',
          })
        }
      }
      if (leadId === null) {
        return JSON.stringify({
          encontrado: false,
          aviso: `Nenhuma due diligence encontrada para "${busca}".`,
        })
      }

      const [completude, pendentes] = await Promise.all([
        svc.from('v_dd_completude').select('*').eq('kommo_lead_id', leadId).maybeSingle(),
        svc
          .from('dd_certidao')
          .select('status, certidao_catalogo(nome_curto)')
          .eq('kommo_lead_id', leadId)
          .eq('obrigatoria', true)
          .in('status', ['PENDENTE', 'EM_EMISSAO', 'PENDENTE_MANUAL', 'FALHA'])
          .limit(30),
      ])
      if (completude.error) return JSON.stringify({ erro: completude.error.message })
      if (pendentes.error) return JSON.stringify({ erro: pendentes.error.message })

      return JSON.stringify({
        encontrado: true,
        resumo:
          completude.data ??
          { aviso: 'Nenhum sujeito cadastrado ainda para este crédito.' },
        certidoes_pendentes: ((pendentes.data ?? []) as Record<string, unknown>[]).map(
          (c) => ({
            certidao:
              (c.certidao_catalogo as { nome_curto?: string } | null)?.nome_curto ?? null,
            status: c.status,
          }),
        ),
      })
    }

    case 'funil_comercial': {
      let q = svc
        .from('kommo_leads')
        .select(
          'nome, processo_cnj, pipeline_id, status_id, responsavel_nome, atualizado_em',
        )
        .order('atualizado_em', { ascending: false })
        .limit(limite(args.limite))
      const busca = String(args.busca ?? '')
      if (busca) {
        const digitos = busca.replace(/\D/g, '')
        q = digitos.length >= 6
          ? q.ilike('processo_cnj', `%${digitos.slice(0, 7)}%`)
          : q.ilike('nome', `%${busca}%`)
      }
      const { data, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      const cards = (data ?? []) as Record<string, unknown>[]
      if (cards.length === 0) return JSON.stringify({ quantidade_retornada: 0, cards: [] })

      // Sem FK entre kommo_leads e kommo_etapa (mesma composta pipeline_id +
      // status_id) — segunda consulta e Map em memória, mesmo estilo de
      // listar_investidores logo acima.
      const { data: etapas } = await svc
        .from('kommo_etapa')
        .select('pipeline_id, status_id, pipeline_nome, nome')
        .in('pipeline_id', [...new Set(cards.map((c) => c.pipeline_id as number))])
      const porChave = new Map(
        ((etapas ?? []) as Record<string, unknown>[]).map((e) => [
          `${e.pipeline_id}:${e.status_id}`,
          { funil: e.pipeline_nome, etapa: e.nome },
        ]),
      )
      return JSON.stringify({
        quantidade_retornada: cards.length,
        cards: cards.map((c) => ({
          nome: c.nome,
          processo_cnj: c.processo_cnj,
          responsavel: c.responsavel_nome,
          atualizado_em: c.atualizado_em,
          ...(porChave.get(`${c.pipeline_id}:${c.status_id}`) ?? {
            funil: null,
            etapa: null,
          }),
        })),
      })
    }

    // ---- Quadro Econômico ------------------------------------------------
    //
    // ATENÇÃO: estes dois `case` já sumiram uma vez, num rebase, e ficaram
    // meses declarados ao modelo sem executor nenhum — o modelo chamava e
    // recebia "Ferramenta desconhecida". `deno check` e os testes passam
    // assim mesmo, porque import não usado e `case` faltando são TypeScript
    // válido. Se for mexer neste arquivo, confirme que `montarPainel`
    // continua sendo CHAMADO, e não só importado.
    case 'panorama_economico': {
      const r = await carregarPainel(svc)
      if ('erro' in r) return JSON.stringify(r)
      const { painel } = r
      const c = painel.carteira
      const vencidas = painel.forecast.blocos.find((b) => b.rotulo === 'Previsão vencida')
      return JSON.stringify({
        base_de_calculo: {
          operacoes_na_carteira: painel.operacoes.length,
          encerradas_consideradas: c.n,
          regra:
            'Performance só sobre operações com status encerrado E data de aquisição, ' +
            'data de liquidação, capital e valor recebido preenchidos. As de realização ' +
            'parcial (aguardando complementar) ficam de fora: o resultado final delas ' +
            'ainda não é conhecido.',
          classe_da_amostra: c.representatividade.classe,
          pode_concluir: c.representatividade.permiteInsight,
          parametros_data_base: painel.parametrosEm,
        },
        capital: {
          investido_carteira_inteira: painel.capitalTotalInvestido,
          investido_nas_encerradas: c.capitalInvestido,
          recebido_nas_encerradas: c.valorRecebido,
          ganho_nominal_nas_encerradas: c.ganhoNominal,
        },
        rentabilidade_pct: {
          do_investidor_ponderada: pctOuNulo(c.retornoPonderado),
          mediana: pctOuNulo(c.retorno.mediana),
          media: pctOuNulo(c.retorno.media),
          anualizada_mediana: pctOuNulo(c.tir.mediana),
          anualizada_media: pctOuNulo(c.tir.media),
          aviso:
            'A taxa da Credijuris já está embutida no capital investido, então estes ' +
            'números são o que ficou para o INVESTIDOR. A média anualizada é inflada ' +
            'por operações de prazo muito curto — use a mediana e a ponderada.',
          operacoes_marcadas_como_extremo: c.extremosTir.length,
        },
        prazo_dias: {
          mediano: c.prazo.mediana,
          medio: c.prazo.media,
          mais_rapida: c.prazo.minimo,
          mais_demorada: c.prazo.maximo,
        },
        a_receber: {
          total: painel.forecast.totalGeral,
          com_mes_definido: painel.forecast.totalFuturo,
          em_previsao_vencida: vencidas?.valor ?? 0,
          fracao_vencida_pct: pctOuNulo(painel.forecast.fracaoVencida),
          blocos_sem_mes: painel.forecast.blocos.map((b) => ({
            rotulo: b.rotulo,
            valor: b.valor,
            operacoes: b.operacoes,
          })),
          proximos_meses: painel.forecast.meses.slice(0, 12).map((m) => ({
            mes: m.mes,
            valor: m.valor,
            operacoes: m.operacoes,
          })),
        },
        concentracao: painel.concentracao,
        leituras: painel.insights.map((i) => ({ texto: i.texto, base: i.base })),
      })
    }

    case 'recorte_economico': {
      const r = await carregarPainel(svc)
      if ('erro' in r) return JSON.stringify(r)
      const { painel } = r
      const dim = String(args.dimensao ?? 'tribunal')
      const grupos =
        dim === 'ente' ? painel.porEnte
        : dim === 'investidor' ? painel.porInvestidor
        : painel.porTribunal
      return JSON.stringify({
        dimensao: dim,
        aviso:
          'Já investiu, já recebeu e falta receber contam TODAS as operações do grupo, ' +
          'em qualquer status. A rentabilidade conta só as encerradas — por isso o `n` ' +
          'de cada grupo vem junto.',
        grupos: grupos.map((g) => ({
          nome: g.rotulo,
          operacoes: g.total,
          encerradas: g.n,
          ja_investiu: g.capitalTotal,
          ja_recebeu: g.recebidoTotal,
          falta_receber: g.aReceber,
          rentabilidade_ponderada_pct: pctOuNulo(g.retornoPonderado),
          rentabilidade_mediana_pct: pctOuNulo(g.retorno.mediana),
          anualizada_mediana_pct: pctOuNulo(g.tir.mediana),
          prazo_mediano_dias: g.prazo.mediana,
          amostra: {
            n: g.n,
            classe: g.representatividade.classe,
            pode_comparar: g.representatividade.permiteComparacao,
          },
        })),
      })
    }

    case 'creditos_a_vencer': {
      const hoje = desde(0)
      const fimSemana = daqui(7)
      const fimMes = daqui(30)
      const { data, error } = await svc
        .from('processos')
        .select('numero_cnj, cedente, cessionario, status, expectativa_liquidacao, valor_face')
        .in('status', ['ativo', 'complementar'])
        .is('data_liquidacao', null)
        .not('expectativa_liquidacao', 'is', null)
        .lte('expectativa_liquidacao', fimMes)
        .order('expectativa_liquidacao', { ascending: true })
        .limit(LIMITE_MAX)
      if (error) return JSON.stringify({ erro: error.message })
      const linhas = (data ?? []) as Record<string, unknown>[]
      const hoje_ou_atrasado: Record<string, unknown>[] = []
      const esta_semana: Record<string, unknown>[] = []
      const este_mes: Record<string, unknown>[] = []
      // Um só corte por data, e não três consultas: os limiares (hoje, fim da
      // semana, fim do mês) são os mesmos pontos que já vieram no filtro —
      // reaproveitar evita três idas ao banco pra separar o que já está em mãos.
      for (const l of linhas) {
        const exp = String(l.expectativa_liquidacao)
        if (exp <= hoje) hoje_ou_atrasado.push(l)
        else if (exp <= fimSemana) esta_semana.push(l)
        else este_mes.push(l)
      }
      return JSON.stringify({
        moeda: 'BRL',
        hoje,
        fim_da_semana: fimSemana,
        fim_do_mes: fimMes,
        aviso:
          linhas.length >= LIMITE_MAX
            ? `Bateu no teto de ${LIMITE_MAX} linhas — pode haver mais além do que veio.`
            : undefined,
        // "hoje_ou_atrasado" e não só "hoje": expectativa já vencida sem
        // liquidação é a informação mais urgente das três, e escondê-la aqui
        // seria pior do que juntar com o dia de hoje.
        hoje_ou_atrasado,
        esta_semana,
        este_mes,
      })
    }

    case 'processos_parados': {
      const diasCorte = typeof args.dias === 'number' ? args.dias : 20
      const corte = desde(diasCorte)

      const [statusRows, processosAtivos] = await Promise.all([
        svc.from('advbox_processo_status').select('numero_processo, ultima_movimentacao').limit(5000),
        svc
          .from('processos')
          .select('numero_cnj, cedente, cessionario, status')
          .in('status', ['ativo', 'complementar']),
      ])
      if (statusRows.error) return JSON.stringify({ erro: statusRows.error.message })
      if (processosAtivos.error) return JSON.stringify({ erro: processosAtivos.error.message })

      // Prefixo de 7 dígitos do CNJ, mesmo padrão de casamento usado no resto
      // deste arquivo (advbox_movimentacoes guarda o número em formato solto).
      const porDigitos = new Map(
        ((processosAtivos.data ?? []) as Record<string, unknown>[]).map((p) => [
          String(p.numero_cnj).replace(/\D/g, '').slice(0, 7),
          p,
        ]),
      )

      interface Parado {
        numero_processo: string
        cedente: unknown
        cessionario: unknown
        ultima_movimentacao: string | null
      }
      const parados: Parado[] = []
      for (const s of (statusRows.data ?? []) as {
        numero_processo: string
        ultima_movimentacao: string | null
      }[]) {
        const chave = String(s.numero_processo ?? '').replace(/\D/g, '').slice(0, 7)
        const proc = porDigitos.get(chave)
        // Sem cadastro casando = não é um crédito ativo/complementar nosso —
        // fora do escopo desta ferramenta (mesmo filtro da tela: encerrados
        // não entram em Paralisados).
        if (!proc) continue
        if (s.ultima_movimentacao && s.ultima_movimentacao >= corte) continue
        parados.push({
          numero_processo: s.numero_processo,
          cedente: (proc as Record<string, unknown>).cedente,
          cessionario: (proc as Record<string, unknown>).cessionario,
          ultima_movimentacao: s.ultima_movimentacao,
        })
      }
      // Do menos parado ao mais parado; nunca-movimentou (null) por último —
      // mesma ordenação da aba Paralisados.
      parados.sort((a, b) => {
        if (!a.ultima_movimentacao && !b.ultima_movimentacao) return 0
        if (!a.ultima_movimentacao) return 1
        if (!b.ultima_movimentacao) return -1
        return b.ultima_movimentacao.localeCompare(a.ultima_movimentacao)
      })

      return JSON.stringify({
        aviso: 'Mesmo critério da aba Publicações e Movimentações → Paralisados.',
        corte_dias: diasCorte,
        total_parados: parados.length,
        quantidade_retornada: Math.min(parados.length, limite(args.limite)),
        processos: parados.slice(0, limite(args.limite)),
      })
    }

    case 'propor_peticao': {
      const busca = String(args.busca ?? '')
      const instrucao = String(args.instrucao ?? '').trim()
      if (!busca || !instrucao) {
        return JSON.stringify({
          erro: 'Informe o processo/cedente e o que a petição deve pedir.',
        })
      }
      const digitos = busca.replace(/\D/g, '')
      let q = svc.from('processos').select('id, numero_cnj, cedente, cessionario').limit(3)
      q = digitos.length >= 6
        ? q.ilike('numero_cnj', `%${digitos.slice(0, 7)}%`)
        : q.ilike('cedente', `%${busca}%`)
      const { data, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      const lista = (data ?? []) as Record<string, unknown>[]
      if (lista.length === 0) {
        return JSON.stringify({ encontrado: false, aviso: `Nenhum crédito casou com "${busca}".` })
      }
      if (lista.length > 1) {
        return JSON.stringify({
          encontrado: false,
          aviso: 'Mais de um crédito casou. Peça à pessoa qual, ou refine o número.',
          candidatos: lista.map((p) => ({ numero_cnj: p.numero_cnj, cedente: p.cedente })),
        })
      }
      const p = lista[0]
      // `proposta: true` é o sinal que o handler usa para montar `acao_proposta`
      // na resposta HTTP — ver o filtro sobre `chamadas` no loop principal.
      return JSON.stringify({
        encontrado: true,
        proposta: true,
        processo_id: p.id,
        numero_cnj: p.numero_cnj,
        cessionario: p.cessionario,
        instrucao,
        aviso:
          'Isto é só uma proposta. A petição de verdade é redigida e revisada na tela ' +
          'de confirmação — diga isso à pessoa, não descreva o texto como já pronto.',
      })
    }

    case 'propor_contato': {
      const whatsapp = String(args.whatsapp ?? '').trim()
      const numeroCnj = String(args.numero_cnj ?? '').trim()
      const cessionario = String(args.cessionario ?? '').trim()
      const conteudo = String(args.conteudo ?? '').trim()
      if (!whatsapp || !numeroCnj || !cessionario || !conteudo) {
        return JSON.stringify({
          erro: 'Informe whatsapp, numero_cnj, cessionario e conteudo.',
        })
      }
      // Padrão FIXO da casa, montado aqui — não pelo modelo — porque
      // saudação por horário exige relógio (o modelo não tem) e o formato
      // precisa ser sempre idêntico, não uma redação que varia a cada
      // chamada.
      const mensagem =
        `Olá, ${saudacaoPorHorario()}! Meu nome é ${contexto.nomeUsuario} e entro em ` +
        `contato em nome do cessionário nos autos do processo n. ${numeroCnj}.\n\n` +
        `${conteudo}\n\nDesde já agradeço.`
      // `proposta: true` é o mesmo sinal de propor_peticao — o handler monta
      // `contato_sugerido` na resposta HTTP a partir dele.
      return JSON.stringify({
        proposta: true,
        nome_contato: args.nome_contato ? String(args.nome_contato) : null,
        whatsapp,
        mensagem,
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
- **Due diligence documental** — \`situacao_due_diligence\`: o checklist de certidões de um cedente (quantas faltam, quais venceram, quais já foram obtidas).
- **Funil comercial (Kommo)** — \`funil_comercial\`: em que etapa está um card, na fase de originação, ANTES de o crédito virar processo da carteira.
- **Créditos a vencer** — \`creditos_a_vencer\`: os que estão prestes a liquidar, já agrupados em hoje/atrasado, esta semana e este mês.
- **Processos parados** — \`processos_parados\`: sem movimentação recente, mesmo critério da aba Paralisados.

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
5. O andamento diz que o processo **foi** concluso naquela data, não que ainda está — e às vezes já não está mesmo: **confira \`ha_andamento_mais_recente_que_o_encontrado\` em CADA processo da lista.** Quando for \`true\`, houve andamento depois do que casou com a busca (em \`ultimo_andamento_do_processo\`) — não apresente aquele processo como parado em "concluso" sem mencionar o que veio depois; se o andamento mais novo já responde à pergunta (ex.: virou "sentenciado"), diga isso em vez do estágio antigo.
6. Quando a pergunta pedir uma leitura fina (ex.: "esses processos já tiveram decisão depois do concluso?"), o resumo cortado não basta — use \`ler_historico_apos_data\` nos processos marcados no passo 5, com \`desde\` = a data do andamento que casou, e LEIA o texto inteiro dos andamentos seguintes para decidir de verdade se algo (decisão, despacho decisório, homologação) aconteceu. Não infira pelo tamanho ou pela quantidade de andamentos — leia o conteúdo.

Não repita as mesmas ressalvas em toda resposta: diga cada uma uma vez, de forma curta. Um bloco de avisos maior que a resposta faz a pessoa parar de lê-los.

Para perguntas que uma contagem responde direto (quantos encerrados, quanto foi cedido), aí sim o número é exato e você pode afirmá-lo sem ressalva. O mesmo vale para \`resumo_financeiro_creditos\`: ele percorre todos os créditos que casam com o filtro, então os totais são exatos.

# Menu "Consultar processos por situação"
Quando a pergunta for exatamente "Consultar processos por situação" (o botão de sugestão da tela inicial), NÃO rode nenhuma ferramenta ainda — primeiro ofereça estas cinco opções para a pessoa escolher:

1. Processos com pedido de bloqueio
2. Processos conclusos
3. Processos com alvará expedido e ainda não cumprido
4. Processos sem decisão de homologação
5. Processos parados

Depois que a pessoa escolher, cada opção usa um caminho diferente:

- **Pedido de bloqueio**: \`buscar_movimentacoes\` com texto "bloqueio".
- **Conclusos**: \`buscar_movimentacoes\` com texto "concluso", seguindo a seção "Fase processual exige cuidado" acima (passos 5 e 6).
- **Alvará expedido e ainda não cumprido**: \`buscar_movimentacoes\` com texto "alvará"; para os marcados com \`ha_andamento_mais_recente_que_o_encontrado\`, use \`ler_historico_apos_data\` e verifique se o texto seguinte já menciona levantamento, depósito ou pagamento — se mencionar, o alvará FOI cumprido e o processo sai da lista; se não, continua pendente.
- **Sem decisão de homologação**: \`buscar_movimentacoes\` com texto "homologação"; aqui a lógica é INVERSA à de conclusos — o processo entra na lista quando, lendo o histórico completo com \`ler_historico_apos_data\`, NENHUM andamento posterior ao pedido de homologação contém uma decisão (deferindo, indeferindo, homologando os cálculos). Não presuma pela ausência de \`ha_andamento_mais_recente_que_o_encontrado\`: mesmo sem andamento mais novo algum, ainda pode não ter havido decisão — leia para confirmar.
- **Parados**: \`processos_parados\`. Antes de rodar, pergunte se a pessoa quer o padrão (20+ dias) ou um corte mais grave (45+, 90+ ou 180+ dias) — as mesmas faixas que a cor do card usa na tela de Publicações e Movimentações.

Em qualquer uma das cinco, se a lista vier vazia, diga isso como notícia boa (nenhum processo naquela situação), não como falha da consulta.

# Análise econômica: quatro regras
Somas são uma coisa, desempenho é outra. \`resumo_financeiro_creditos\` responde "quanto"; \`panorama_economico\` e \`recorte_economico\` respondem "quanto rendeu, em quanto tempo e com que base". Ao usar os dois últimos:
1. **Nunca compare grupos marcados com \`pode_comparar: false\`.** Mostre os números de cada um e diga que não há base para dizer qual é melhor. Um grupo com duas operações não perde nem ganha de um com cinquenta — a comparação não existe.
2. **Nunca use a média da rentabilidade anualizada para descrever a carteira.** Uma operação liquidada em poucos dias produz taxa anual de milhares por cento, correta para ela e absurda como média. Use a mediana e a rentabilidade ponderada pelo capital, e diga qual está usando.
3. **Distinga as duas leituras.** A mediana descreve a operação típica; a ponderada descreve o dinheiro. Quando divergem, a divergência é a informação — apresente as duas.
4. **Repasse as ressalvas que a ferramenta trouxer.** Se ela devolve \`aviso_metodologico\`, ou diz que a estimativa ajustada não está disponível, isso vai na resposta. Não invente cenário, não projete valor que a ferramenta não deu e não some blocos que ela separou.

Quando uma lista traz \`aviso_limite\`, ela bateu no teto e NÃO é o conjunto todo. Nesse caso, ou peça o total com a ferramenta de contagem, ou diga que está mostrando uma parte — nunca apresente o tamanho da lista como se fosse o total.

# Você pode calcular
Somar, subtrair, dividir e comparar o que as ferramentas devolveram é seu trabalho — deságio, percentual recebido, ticket médio, concentração por investidor. O que não vale é inventar o insumo. Mostre a conta quando ela não for óbvia, para a pessoa poder conferir.

# Como escrever
Vá direto ao ponto: a resposta primeiro, o detalhe depois. Valores em reais no formato brasileiro (R$ 1.234,56). Datas como dd/mm/aaaa. Tabela só quando houver vários itens comparáveis; para um número só, uma frase basta.

Se a pergunta for ambígua de um jeito que muda a resposta, pergunte antes de consultar.

# Você pode opinar
Interpretar, opinar e sugerir é seu trabalho também — inclusive prazo provável, leitura de risco e
próximos passos, mesmo quando a pergunta sai do que uma ferramenta devolve pronto. A diferença é que
opinião não é fato: sempre que a resposta for uma leitura sua e não um número/registro tirado de
ferramenta, marque isso explicitamente ("na minha leitura...", "um risco a considerar é...", "eu
sugeriria...") e nunca apresente como informação do sistema. A regra de que todo número/fato precisa
vir de ferramenta continua de pé — ela existe para não inventar DADO, não para te impedir de pensar
sobre o dado.

# Você pode propor uma ação
Quando pedirem para gerar/redigir uma petição, use \`propor_peticao\` — ela não redige nada, só
resolve o crédito e devolve os dados para a pessoa confirmar numa tela de revisão. Depois de chamá-la
com sucesso, diga que a petição será escrita e revisada nessa tela, sem descrever ou antecipar o
texto da peça: quem escreve o texto de verdade é a Edge Function de redação, não você.

Você não tem ferramenta que altere os dados do sistema (créditos, processos, cadastros): se pedirem
para cadastrar, editar ou apagar algo, explique que isso é feito nas telas do sistema. Isso é
diferente de gerar uma petição ou de usar uma Skill habilitada, que produzem um documento à parte —
nunca escrevem no banco.

# Processo parado: cruzar com contato e redigir mensagem
Depois de identificar (por leitura de verdade, via \`ler_historico_apos_data\`) que um processo está
parado numa fase, você pode ir além: descubra o tribunal/vara/comarca do processo (\`ficha_do_credito\`
ou \`listar_processos\`) e cruze com \`listar_contatos\` para achar telefone, WhatsApp ou e-mail do
gabinete ou da serventia. Se houver WhatsApp, chame \`propor_contato\` passando \`numero_cnj\`,
\`cessionario\` e só o \`conteudo\` (o pedido em si, SEM saudação, SEM "meu nome é" e SEM fecho) — a
interface monta a mensagem inteira no padrão fixo da casa (saudação pelo horário, nome de quem está
logado, fecho) e mostra um cartão com o número clicável que já abre o WhatsApp e copia a mensagem
pronta. NÃO redija a saudação/nome/fecho você mesmo, e NÃO repita o número nem o conteúdo solto no
corpo da resposta — o cartão já mostra isso, repetir é redundante. Se não houver WhatsApp, mas houver
telefone ou e-mail, escreva-os normalmente no texto (aí sim, com suas próprias palavras). É elaboração
sua, não um dado do sistema — deixe isso claro. Se \`listar_contatos\` não achar nada para aquele
tribunal/vara, diga isso — nunca invente ou suponha um contato.

# Botão "Entrar em contato com a serventia"
Quando a pergunta for exatamente essa (o botão de sugestão da tela inicial), peça SÓ o número do
processo — nunca pergunte de volta o que a pessoa quer pedir/cobrar. Depois de receber o número, o
trabalho de decidir o pedido é SEU:
1. Leia a situação do processo (\`ficha_do_credito\` já traz as movimentações recentes; se o estágio
   não estiver claro, aprofunde com \`ler_historico_apos_data\`).
2. A partir do que estiver acontecendo — prazo parado, alvará expedido e não cumprido, pedido de
   conclusão para decisão, remessa para efetivação, expedição de levantamento etc. — decida sozinho
   qual é o pedido cabível. Não devolva a decisão para a pessoa.
3. Cruze o contato (\`listar_contatos\`) e chame \`propor_contato\` direto, sem mais perguntas no meio.
Só pergunte de volta se o número do processo não for encontrado ou casar com mais de um crédito.`

// ------------------------------------------------------------------- skills

/** Ferramenta code_execution: obrigatória para o modelo poder usar Skills. */
const FERRAMENTA_CODE_EXECUTION = {
  type: 'code_execution_20260521',
  name: 'code_execution',
} as unknown as Anthropic.Tool

/** Skills ativas, cadastradas em Configurações → Skills do Assistente. */
async function skillsAtivas(
  svc: SupabaseClient,
): Promise<{ skill_id: string; nome: string }[]> {
  const { data } = await svc
    .from('assistente_skills')
    .select('skill_id, nome')
    .eq('ativo', true)
  return (data ?? []) as { skill_id: string; nome: string }[]
}

/**
 * Baixa os arquivos que uma Skill gerou dentro do container de code execution
 * e sobe pro Storage, num bucket privado por usuário — o assistente nunca
 * repassa o link da Anthropic direto pro navegador: aquele link não é de
 * longa duração nem passa pelas RLS daqui.
 *
 * SEMPRE com a service_role: a policy de leitura do bucket é por usuário, mas
 * não há policy de ESCRITA nenhuma (de propósito — ver migração 0048), então
 * o callerClient não conseguiria subir o arquivo.
 */
async function extrairArquivosGerados(
  content: unknown[],
  apiKey: string,
  userId: string,
): Promise<{ nome: string; url: string }[]> {
  const fileIds: string[] = []
  for (const bloco of content as Record<string, unknown>[]) {
    if (bloco.type !== 'bash_code_execution_tool_result') continue
    const inner = (bloco.content ?? {}) as Record<string, unknown>
    if (inner.type !== 'bash_code_execution_result') continue
    for (const saida of (inner.content ?? []) as Record<string, unknown>[]) {
      if (typeof saida.file_id === 'string') fileIds.push(saida.file_id)
    }
  }
  if (fileIds.length === 0) return []

  const svc = serviceClient()
  const cabecalhos = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  const arquivos: { nome: string; url: string }[] = []
  for (const fileId of fileIds) {
    try {
      const meta = await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
        headers: cabecalhos,
      }).then((r) => (r.ok ? r.json() : null))
      const nome = (meta?.filename as string | undefined) || `arquivo-${fileId}`

      const conteudo = await fetch(
        `https://api.anthropic.com/v1/files/${fileId}/content`,
        { headers: cabecalhos },
      )
      if (!conteudo.ok) continue
      const bytes = new Uint8Array(await conteudo.arrayBuffer())

      const caminho = `${userId}/${fileId}-${nome}`
      const { error } = await svc.storage
        .from('assistente-arquivos')
        .upload(caminho, bytes, { upsert: true })
      if (error) continue

      const { data: assinado } = await svc.storage
        .from('assistente-arquivos')
        .createSignedUrl(caminho, 3600)
      if (assinado?.signedUrl) arquivos.push({ nome, url: assinado.signedUrl })
    } catch {
      // Um arquivo que falhou não pode derrubar a resposta inteira — a pessoa
      // ainda lê o texto, só não recebe aquele anexo.
    }
  }
  return arquivos
}

/** MIME → tipo de bloco de conteúdo, conforme a Files API da Anthropic. */
function tipoDeBloco(mime: string): 'image' | 'document' | 'container_upload' {
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) return 'image'
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'document'
  // xlsx, docx, etc: o bloco `document` não lê esses formatos. Só dá pra
  // processar dentro do container de code execution — por isso exige skill
  // ativa (ver validação no handler).
  return 'container_upload'
}

/**
 * Sobe os arquivos que a pessoa anexou pra Files API da Anthropic e devolve
 * os blocos de conteúdo prontos pra entrar na mensagem do usuário.
 *
 * Upload é sempre novo, nunca reaproveitado: a Files API é do WORKSPACE
 * inteiro (não por usuário nem por conversa), e reaproveitar um id feriria
 * esse limite — ver o aviso da documentação sobre nunca aceitar file_id vindo
 * de fora. Cada pergunta sobe de novo os arquivos que anexou.
 */
async function anexarArquivosDeEntrada(
  arquivos: File[],
  apiKey: string,
  temSkillAtiva: boolean,
): Promise<{ blocos: Record<string, unknown>[]; erro?: string }> {
  const cabecalhos = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  const blocos: Record<string, unknown>[] = []

  for (const arquivo of arquivos) {
    const tipo = tipoDeBloco(arquivo.type || 'application/octet-stream')
    if (tipo === 'container_upload' && !temSkillAtiva) {
      return {
        blocos: [],
        erro:
          `Não consigo ler "${arquivo.name}" (${arquivo.type || 'tipo desconhecido'}) sem ` +
          'uma Skill ativa — só PDF, imagem e texto simples são lidos direto. Ative uma ' +
          'Skill em Configurações ou envie um formato compatível.',
      }
    }

    const form = new FormData()
    form.append('file', arquivo, arquivo.name)
    const resp = await fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: cabecalhos,
      body: form,
    })
    if (!resp.ok) {
      const corpo = await resp.json().catch(() => null)
      return {
        blocos: [],
        erro:
          corpo?.error?.message ??
          `Falha ao enviar "${arquivo.name}" (HTTP ${resp.status}).`,
      }
    }
    const enviado = await resp.json()
    const fileId = enviado?.id as string | undefined
    if (!fileId) {
      return { blocos: [], erro: `A Anthropic não devolveu o id de "${arquivo.name}".` }
    }

    if (tipo === 'container_upload') {
      blocos.push({ type: 'container_upload', file_id: fileId })
    } else if (tipo === 'image') {
      blocos.push({ type: 'image', source: { type: 'file', file_id: fileId } })
    } else {
      blocos.push({
        type: 'document',
        source: { type: 'file', file_id: fileId },
        title: arquivo.name,
      })
    }
  }
  return { blocos }
}

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

    // Anexo de arquivo exige multipart; o caminho comum (sem anexo) continua
    // JSON puro, mais barato de montar nos dois lados.
    const contentType = req.headers.get('content-type') ?? ''
    let pergunta: unknown
    let historico: unknown
    let modelo: unknown
    let skillsPedidas: unknown
    let arquivosAnexados: File[] = []

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      pergunta = form.get('pergunta')
      try {
        historico = JSON.parse(String(form.get('historico') ?? '[]'))
      } catch {
        historico = []
      }
      modelo = form.get('modelo')
      try {
        skillsPedidas = JSON.parse(String(form.get('skills') ?? 'null'))
      } catch {
        skillsPedidas = null
      }
      arquivosAnexados = form.getAll('arquivo').filter((f): f is File => f instanceof File)
    } else {
      const body = await req.json()
      pergunta = body.pergunta
      historico = body.historico
      modelo = body.modelo
      skillsPedidas = body.skills ?? null
    }

    if (!pergunta || typeof pergunta !== 'string') {
      return jsonResponse({ error: 'Pergunta inválida.' }, 400)
    }
    const modeloResolvido = resolverModelo(modelo)

    const svc = callerClient(req)
    const anthropic = new Anthropic({ apiKey })

    // Nome de quem está perguntando — só usado para assinar a mensagem de
    // propor_contato ("Meu nome é ..."). Cai pro e-mail se o perfil não tiver
    // nome preenchido, pra nunca ficar "Meu nome é undefined".
    const { data: perfilCaller } = await serviceClient()
      .from('profiles')
      .select('nome')
      .eq('id', caller.id)
      .maybeSingle()
    const nomeUsuario = perfilCaller?.nome || caller.email || 'a equipe da Credijuris'

    // Skills são configuração do sistema (não do usuário nem da RLS dele), lidas
    // com service_role — mesma lógica de chaveAnthropic(). O pedido do
    // frontend (`skillsPedidas`) só FILTRA dentro das ativas — nunca amplia:
    // uma skill desligada em Configurações não volta a valer só porque o
    // corpo da requisição pediu o id dela.
    const todasSkillsAtivas = await skillsAtivas(serviceClient())
    const skills = Array.isArray(skillsPedidas)
      ? todasSkillsAtivas.filter((s) => skillsPedidas.includes(s.skill_id))
      : todasSkillsAtivas
    const ferramentas = skills.length > 0 ? [...FERRAMENTAS, FERRAMENTA_CODE_EXECUTION] : FERRAMENTAS

    // O histórico chega da interface como pares simples de texto. Truncamos em
    // 20 turnos: conversa de assistente não precisa de memória infinita, e o
    // histórico inteiro é reenviado a cada pergunta.
    //
    // Turno com ANEXO no histórico é descartado aqui (o filtro só aceita
    // `content` string): o file_id já pode ter perdido validade, e replicar o
    // upload de novo a cada rodada custaria caro sem necessidade — o texto da
    // pergunta daquele turno continua contando a conversa, só o arquivo em si
    // não volta a ser lido depois da rodada em que foi anexado.
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

    if (arquivosAnexados.length > 0) {
      const { blocos, erro } = await anexarArquivosDeEntrada(
        arquivosAnexados,
        apiKey,
        skills.length > 0,
      )
      if (erro) return jsonResponse({ error: erro }, 400)
      mensagens.push({
        role: 'user',
        content: [{ type: 'text', text: pergunta }, ...blocos] as unknown as Anthropic.MessageParam['content'],
      })
    } else {
      mensagens.push({ role: 'user', content: pergunta })
    }

    const ferramentasUsadas: string[] = []
    // Promoção é de mão única: uma vez em texto livre, a conversa inteira
    // segue em esforço alto. Voltar a abaixar no meio faria a redação final —
    // a parte que a pessoa lê — sair mais rasa justamente na pergunta que
    // exigiu mais.
    let interpretandoTexto = false
    // Última proposta de ação bem-sucedida (ex.: propor_peticao) na conversa —
    // vai pra resposta HTTP como `acao_proposta`, pro frontend renderizar o
    // cartão de confirmação. É a ferramenta que só PROPÕE, nunca executa.
    let acaoProposta: Record<string, unknown> | undefined
    // Mesma lógica, para o cartão de contato clicável (propor_contato).
    let contatoProposto: Record<string, unknown> | undefined

    // O SDK fixado (0.115.0) já declara `container`, mas como string (reuso de
    // container por id) — o formato de Skills é objeto (`{ skills: [...] }`).
    // `Omit` + intersecção local substitui só esse campo, sem perder a
    // tipagem do resto (é o que mantém `resposta` como `Message`, e não a
    // união com `Stream<...>`, nas linhas abaixo).
    type ParametrosMensagem = Omit<
      Anthropic.MessageCreateParamsNonStreaming,
      'container'
    > & {
      container?: { skills: { type: string; skill_id: string; version: string }[] }
    }

    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      const params: ParametrosMensagem = {
        model: modeloResolvido,
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
        tools: ferramentas,
        messages: mensagens,
        // Raciocínio adaptativo nos dois casos: o modelo decide se pensa. Fica
        // ligado até no caminho barato porque, com ele desligado, o Sonnet
        // aciona ferramentas com menos disposição — e aqui TODA resposta
        // depende de uma consulta. O esforço é que muda entre os caminhos.
        thinking: { type: 'adaptive' },
        output_config: { effort: interpretandoTexto ? 'high' : 'low' },
      }
      if (skills.length > 0) {
        params.container = {
          skills: skills.map((s) => ({
            type: 'custom',
            skill_id: s.skill_id,
            version: 'latest',
          })),
        }
      }
      // O método em si reexige o tipo estrito do SDK (container: string) no
      // ponto de chamada — o `Omit` acima não basta ali. Cast duplo só aqui,
      // no menor escopo possível, mantendo `resposta` como `Message` (não a
      // união com `Stream<...>`) para o resto da função.
      const resposta = await anthropic.messages.create(
        params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      )

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
        // Arquivo gerado por Skill: só existe quando há skills ativas, então
        // a varredura do content não custa nada nas conversas sem nenhuma.
        const arquivos =
          skills.length > 0
            ? await extrairArquivosGerados(resposta.content, apiKey, caller.id)
            : []
        return jsonResponse({
          resposta:
            texto ||
            'Não consegui formular uma resposta. Tente reformular a pergunta.',
          truncada: truncada || undefined,
          ferramentas: ferramentasUsadas,
          acao_proposta: acaoProposta,
          contato_sugerido: contatoProposto,
          arquivos: arquivos.length > 0 ? arquivos : undefined,
        })
      }

      // Todas as ferramentas do turno em paralelo, e todos os resultados numa
      // única mensagem — separá-los ensina o modelo a parar de paralelizar.
      const chamadas = resposta.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )
      if (chamadas.some((c) => FERRAMENTAS_QUE_PROMOVEM.has(c.name))) {
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
              { nomeUsuario },
            )
          } catch (err) {
            conteudo = JSON.stringify({ erro: (err as Error).message })
          }
          if (c.name === 'propor_peticao') {
            try {
              const r = JSON.parse(conteudo)
              if (r.proposta === true) {
                acaoProposta = {
                  tipo: 'gerar_peticao',
                  processo_id: r.processo_id,
                  numero_cnj: r.numero_cnj,
                  cessionario: r.cessionario,
                  instrucao: r.instrucao,
                }
              }
            } catch {
              /* conteudo não era JSON — não é o caso normal desta ferramenta */
            }
          }
          if (c.name === 'propor_contato') {
            try {
              const r = JSON.parse(conteudo)
              if (r.proposta === true) {
                contatoProposto = {
                  nome_contato: r.nome_contato,
                  whatsapp: r.whatsapp,
                  mensagem: r.mensagem,
                }
              }
            } catch {
              /* conteudo não era JSON — não é o caso normal desta ferramenta */
            }
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
