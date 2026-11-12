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
import { aceitaRaciocinioAdaptativo, resolverModeloDoAssistente } from '../_shared/modeloDoAssistente.ts'
import {
  baseDoKommoEmPedacos,
  COLUNAS_DO_SISTEMA,
  type EtapaDoEspelho,
  type LinhaDoEspelho,
} from '../_shared/baseDoKommo.ts'
import { hojeEmBrasilia } from '../_shared/dataDeBrasilia.ts'
// A CHAVE DA ANTHROPIC VEM DO MÓDULO DE SEGREDOS (varredura de 23/10/2026): havia
// aqui uma cópia idêntica da função, que é o tipo de cópia que diverge no dia em
// que uma das duas muda. Mesma regra: ambiente primeiro, depois a tabela.
import { chaveAnthropic } from '../_shared/segredos.ts'
import { estourouOTempo, sinalAteOTeto, tempoAteOTeto } from '../_shared/relogioDaInvocacao.ts'
import {
  lerPorIds,
  lerTodasAsLinhas,
  type LeituraCompleta,
  type PaginaDoBanco,
} from '../_shared/leituraPaginada.ts'
import { normalizarNome } from '../_shared/nucleo/texto.ts'
import {
  cortarPorTamanho,
  dataAAAAMMDD,
  escolherInvestidor,
  type FichaDaPessoa,
  formasDoNumero,
  grupoDoValor,
  inteiroEntre,
  inteiroPositivoOuNulo,
  investidoresDistintos,
  type PapelDaPessoa,
  paradosDaCarteira,
  pareceNumeroDeProcesso,
  pessoasDoAssistente,
  regexDosDigitos,
  soDigitos,
  TETO_DE_CARACTERES_DO_HISTORICO,
  traduzirErroDaAnthropic,
} from '../_shared/regrasDoAssistente.ts'
// OS TEXTOS DE SISTEMA E AS FERRAMENTAS DA OPERAÇÃO EM ARQUIVOS PRÓPRIOS (12/11/2026):
// fase processual, ficha do card, resumo do funil, contratos e due diligence.
import { SISTEMA, SISTEMA_BASE_KOMMO, textoDaData } from './sistema.ts'
import { executarDaOperacao, FERRAMENTAS_DA_OPERACAO } from './ferramentasDaOperacao.ts'

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
 *
 * A LISTA E A REGRA DA ESCOLHA moram em `_shared/modeloDoAssistente.ts`, a
 * mesma que a tela usa (`resolverModeloDoAssistente`): o Opus é o 5.5 desde
 * 05/10/2026, e quem ainda manda o id de um Opus anterior — a escolha guardada
 * no navegador, uma aba aberta da versão antiga — recebe o 5.5. Fora da lista,
 * vale o padrão: nunca a escolha crua do cliente.
 *
 * NO OPUS 5.5 o texto que o modelo escreve ENTRE chamadas de ferramenta vem em
 * blocos `thinking` (vazios por padrão), e não mais em `text`. Aqui isso não
 * tira nada da tela: ela só mostra o texto da ÚLTIMA rodada (a que termina sem
 * ferramenta), que continua em `text`; o que vinha entre ferramentas nunca foi
 * exibido. E os blocos `thinking` voltam intactos na rodada seguinte, porque a
 * resposta entra em `mensagens` inteira, como chegou.
 */
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
                description: 'Andamentos A PARTIR desta data, inclusive (AAAA-MM-DD).',
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
      'processos. Para FASE processual use antes `fase_processual` (a ' +
      'classificação da aba Fase processual); esta busca é o plano B — termo ' +
      'que a classificação não cobre ("perícia", "trânsito em julgado"), ' +
      'crédito encerrado, ou conferência caso a caso. Devolve UM registro por processo (o andamento mais ' +
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
        prazo_de: {
          type: 'string',
          description: 'Só tarefas com prazo fatal a partir desta data (AAAA-MM-DD).',
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
        parados_ha_dias: {
          type: 'integer',
          description: 'Só cards na MESMA coluna há pelo menos N dias, do mais parado ao menos.',
        },
        limite: { type: 'integer', description: `Teto ${LIMITE_MAX}.` },
      },
    },
  },
  {
    name: 'creditos_a_vencer',
    description:
      'Créditos ativos/complementares ainda não liquidados, com expectativa de ' +
      'liquidação vencida ou nos próximos 30 dias — já agrupados por urgência (atrasados, ' +
      'próximos 7 dias, de 8 a 30 dias), cada grupo com o total exato, sem você ' +
      'precisar fazer a conta de data. Use para ' +
      '"o que vence essa semana", "créditos próximos da liquidação".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'processos_parados',
    description:
      'Créditos ativos/complementares SEM nenhuma movimentação recente — mesmo ' +
      'critério da aba Publicações e Movimentações → Paralisados (padrão: mais de ' +
      '20 dias sem andamento; quem nunca teve andamento também entra). Devolve ' +
      'do MAIS parado ao menos parado, e quem nunca teve andamento no fim. Use para "quais processos estão ' +
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
  // fase_processual, ficha_do_card, resumo_do_funil, listar_contratos e
  // situacao_due_diligence — definidas e executadas em ferramentasDaOperacao.ts.
  ...FERRAMENTAS_DA_OPERACAO,
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
    // PAGINADO (23/10/2026): o painel é a carteira INTEIRA, e um select sem
    // range para em 1000 linhas sem avisar — o panorama sairia com números
    // menores, apresentados como os da tela.
    lerTudo(() => svc.from('processos').select(COLUNAS_PAINEL), ['id']),
    svc
      .from('parametros_atualizacao')
      .select('selic_aa, ipca_12m_aa, data_referencia')
      .eq('id', 1)
      .maybeSingle(),
  ])
  if (creditos.erro) return { erro: creditos.erro }
  if (creditos.cortada) return { erro: LEITURA_CORTADA }
  // A LEITURA DOS ÍNDICES QUE FALHOU NÃO É "SEM ÍNDICE" (12/11/2026): O ERRO era
  // ignorado, e toda projeção do painel saía nula — o "a receber" e a previsão
  // vinham menores, apresentados como exatos.
  if (parametros.error) return { erro: `Não consegui ler os parâmetros de atualização: ${parametros.error.message}` }
  // Em Brasília, como desde()/daqui() abaixo: das 21h em diante o UTC já é amanhã.
  const hoje = hojeEmBrasilia()
  return {
    painel: montarPainel(
      creditos.linhas as unknown as CreditoBruto[],
      (parametros.data ?? undefined) as Parameters<typeof montarPainel>[1],
      hoje,
    ),
  }
}

/**
 * O `limite` que o modelo mandou, entre 1 e LIMITE_MAX.
 *
 * INTEIRO E FINITO (23/10/2026): `limite: 7.5` ia como `limit=7.5` e o
 * PostgREST recusava a consulta inteira; `NaN` passava pelo min/max como NaN.
 * O modelo lê o erro e tenta de novo — uma rodada a mais, por nada.
 */
function limite(valor: unknown): number {
  const n = typeof valor === 'number' && Number.isFinite(valor) ? Math.floor(valor) : 20
  return Math.min(Math.max(n, 1), LIMITE_MAX)
}

/** O que dizer quando a leitura bateu no teto de páginas e não terminou. */
const LEITURA_CORTADA =
  'A leitura passou do teto de páginas e ficou incompleta — o total não seria exato.'

/** O mínimo do construtor do supabase-js que a leitura paginada usa. */
interface ConsultaPaginavel {
  order: (coluna: string, opcoes?: { ascending?: boolean }) => ConsultaPaginavel
  range: (de: number, ate: number) => PromiseLike<PaginaDoBanco<Record<string, unknown>>>
}

/**
 * A tabela INTEIRA, página a página (varredura de 23/10/2026).
 *
 * O PostgREST devolve no máximo 1000 linhas e NÃO AVISA que cortou. As
 * ferramentas que somam ou contam a carteira (painel, resumo financeiro,
 * cessões, investidores, paralisados) liam com um select cru e, passado esse
 * tamanho, respondiam um total menor COMO EXATO — o pior jeito de errar aqui.
 *
 * `montar` devolve a consulta já com select e filtros, nova a cada página;
 * `ordem` são colunas que formam chave — sem ordem estável, uma linha pode cair
 * em duas páginas e outra em nenhuma.
 */
async function lerTudo(
  montar: () => unknown,
  ordem: string[],
): Promise<LeituraCompleta<Record<string, unknown>>> {
  return await lerTodasAsLinhas<Record<string, unknown>>((de, ate) => {
    let q = montar() as ConsultaPaginavel
    for (const c of ordem) q = q.order(c, { ascending: true })
    return q.range(de, ate)
  })
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
  filter: (c: string, op: string, v: unknown) => unknown
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
    // O NÚMERO DO PROCESSO CASA PELOS DÍGITOS (12/11/2026), com ou sem máscara:
    // o cadastro guarda dos dois jeitos (digitado à mão ou vindo do Drive), e o
    // `ilike` com o texto do modelo só achava o crédito escrito do mesmo jeito.
    // `igual` exige o número inteiro; `contem`, um trecho.
    if (
      campo === 'numero_cnj' &&
      (operador === 'igual' || operador === 'contem') &&
      pareceNumeroDeProcesso(valor)
    ) {
      r = r.filter(
        campo,
        'imatch',
        regexDosDigitos(String(valor), { inteiro: operador === 'igual' }),
      ) as Filtravel
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
      // exato. E PAGINADO (23/10/2026): "sem limite" num select cru ainda era o
      // teto calado de 1000 linhas do PostgREST.
      let avisos: string[] = []
      const leitura = await lerTudo(() => {
        const r = aplicarFiltrosGenericos(
          svc
            .from('processos')
            .select(
              'status, especie_requisitorio, originador, cessionario, tribunal, ' +
                'entidade_devedora, capital_investido, valor_face, ja_recebido, ' +
                'valor_estimado_complementar, data_liquidacao',
            ),
          args.filtros,
        )
        avisos = r.avisos
        return r.query
      }, ['id'])
      if (leitura.erro) return JSON.stringify({ erro: leitura.erro })
      if (leitura.cortada) return JSON.stringify({ erro: LEITURA_CORTADA })
      const data = leitura.linhas

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
      // O MESMO NOME ESCRITO DE DOIS JEITOS É UM GRUPO SÓ (12/11/2026): "Fulano",
      // "fulano " e "Fulano  de Tal" eram grupos separados, cada um com um pedaço
      // da carteira. Agrupa pela chave normalizada; o rótulo é a primeira grafia.
      const rotuloDaChave = new Map<string, string>()
      for (const l of (data ?? []) as unknown as Record<string, unknown>[]) {
        soma(total, l)
        if (dimensao !== 'nenhum') {
          const { chave, rotulo } = grupoDoValor(dimensao, l[dimensao])
          if (!rotuloDaChave.has(chave)) rotuloDaChave.set(chave, rotulo)
          const k = rotuloDaChave.get(chave)!
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
      // O NÚMERO CASA PELOS DÍGITOS, com ou sem máscara (12/11/2026): os 7
      // primeiros achavam qualquer crédito com o mesmo começo, e o número
      // sem pontuação não achava o cadastrado com ela.
      let q = svc.from('processos').select(COLUNAS_PROCESSO_FICHA).limit(3)
      q = digitos.length >= 6
        ? q.filter('numero_cnj', 'imatch', regexDosDigitos(digitos, { inteiro: digitos.length >= 20 }))
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
      // INTEIRO ENTRE 1 E 40 (12/11/2026): `movimentacoes: 7.5` ia como
      // `limit=7.5` e o PostgREST recusava; zero ou negativo vinha vazio.
      const quantasMov = inteiroEntre(args.movimentacoes, { min: 1, max: 40, padrao: 15 })

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
              // PELOS DÍGITOS INTEIROS, com ou sem máscara: os 7 primeiros
              // casavam publicação de outro processo com o mesmo começo.
              .filter('numero_processo', 'imatch', regexDosDigitos(dig, { inteiro: true }))
              .order('data_disponibilizacao', { ascending: false })
              .limit(8)
          : Promise.resolve({ data: [], error: null }),
      ])

      // A PARTE QUE FALHOU É DITA, E NÃO ENTREGUE VAZIA (12/11/2026): sem olhar
      // `.error`, a consulta que caiu chegava como "nenhuma tarefa", "nenhuma
      // movimentação" — e o modelo afirmava a ausência como fato. O campo vira
      // null e o motivo vai em `falhas`.
      const falhas: Record<string, string> = {}
      const ouFalha = <T>(nomeDaParte: string, r: { data: T | null; error: { message: string } | null }, vazio: T) => {
        if (r.error) {
          falhas[nomeDaParte] = r.error.message
          return null
        }
        return r.data ?? vazio
      }
      const apensosLidos = ouFalha('apensos', apensos, [])
      const resumoLido = ouFalha('resumo_da_carteira', resumo, null)
      const tarefasLidas = ouFalha('tarefas', tarefas, [])
      const movsLidas = ouFalha('movimentacoes', movs, [])
      const pubsLidas = ouFalha('publicacoes', pubs, [])

      // Cronológico CRESCENTE: lida de trás para frente, a sequência causal se
      // desfaz — dois ciclos de "alvará expedido / devolvido" viram três, com o
      // último parecendo pendente. Mesma lição da carteira-resumo.
      const movCrescente = movsLidas
        ? [...(movsLidas as Record<string, unknown>[])].reverse()
        : null

      return JSON.stringify({
        encontrado: true,
        moeda: 'BRL',
        cadastro: p,
        apensos: apensosLidos,
        resumo_da_carteira: resumoLido,
        tarefas: tarefasLidas,
        movimentacoes_do_mais_antigo_ao_mais_recente: movCrescente,
        publicacoes_recentes: pubsLidas
          ? (pubsLidas as Record<string, unknown>[]).map((x) => ({
              data: x.data_disponibilizacao,
              tipo: x.tipo_comunicacao,
              tratada: x.tratada,
              texto: textoDjen(x.raw)?.slice(0, 1200) ?? null,
            }))
          : null,
        falhas: Object.keys(falhas).length
          ? {
              ...falhas,
              aviso:
                'Estas partes da ficha NÃO foram lidas (vêm null). Não diga que ' +
                'não existem — diga que não deu para consultar.',
            }
          : undefined,
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
      // Andamentos por FONTE e por processo. Pede-se um a mais para saber se
      // havia mais do que o teto.
      const POR_FONTE = 20
      // O TETO DE TEXTO dividido entre os processos da chamada: cada um tem a
      // sua parte, e nenhum come a dos outros.
      const orcamentoPorProcesso = Math.floor(TETO_DE_CARACTERES_DO_HISTORICO / cortados.length)

      const resultados = await Promise.all(
        cortados.map(async (p) => {
          const numero = String(p?.numero_processo ?? '')
          const desde = dataAAAAMMDD(p?.desde)
          const digitos = soDigitos(numero)
          if (digitos.length < 6 || !desde) {
            return {
              numero_processo: numero || null,
              erro: 'Informe numero_processo e desde (AAAA-MM-DD).',
            }
          }
          const numeroInteiro = digitos.length >= 20
          // DO MAIS NOVO PARA O MAIS ANTIGO, e depois invertido (12/11/2026). A
          // leitura era crescente com teto de 20: num processo movimentado, os 20
          // PRIMEIROS depois de `desde` vinham e os mais novos — justamente o que
          // diz se algo mudou depois do "concluso" — ficavam de fora, calados.
          //
          // `gte`, e não `gt`: `desde` é a data do andamento que casou, e o que
          // aconteceu NO MESMO DIA, depois dele (a decisão logo após a conclusão),
          // sumia. E pelos DÍGITOS (o processo inteiro quando vem inteiro), não
          // pelos 7 primeiros, que traziam andamento de outro processo.
          let qMov = svc
            .from('advbox_movimentacoes')
            .select('data, conteudo')
            .gte('data', desde)
          qMov = numeroInteiro
            ? qMov.eq('numero_digits', digitos)
            : qMov.ilike('numero_digits', `%${digitos}%`)
          const [mov, pub] = await Promise.all([
            qMov
              .order('data', { ascending: false })
              .order('id', { ascending: false })
              .limit(POR_FONTE + 1),
            svc
              .from('djen_publicacoes')
              .select('data_disponibilizacao, tipo_comunicacao, raw')
              .filter('numero_processo', 'imatch', regexDosDigitos(digitos, { inteiro: numeroInteiro }))
              .gte('data_disponibilizacao', desde)
              .order('data_disponibilizacao', { ascending: false })
              .order('id', { ascending: false })
              .limit(POR_FONTE + 1),
          ])
          // CADA FONTE COM O SEU ERRO: antes, uma fonte caída passava calada
          // (só a queda das duas virava erro) e o histórico parcial era lido como
          // o histórico inteiro.
          if (mov.error && pub.error) {
            return {
              numero_processo: numero,
              erro_movimentacoes: mov.error.message,
              erro_publicacoes: pub.error.message,
            }
          }
          const movs = ((mov.data ?? []) as Record<string, unknown>[])
          const pubs = ((pub.data ?? []) as Record<string, unknown>[])
          const truncadoNoBanco = movs.length > POR_FONTE || pubs.length > POR_FONTE
          // Texto INTEIRO, sem cortar — é o que diferencia esta ferramenta de
          // buscar_movimentacoes: aqui o modelo lê pra entender, não só pra achar.
          const todos = [
            ...movs.slice(0, POR_FONTE).map((m) => ({
              data: m.data,
              fonte: 'movimentacao' as const,
              texto: m.conteudo,
            })),
            ...pubs.slice(0, POR_FONTE).map((x) => ({
              data: x.data_disponibilizacao,
              fonte: 'publicacao' as const,
              texto: textoDjen(x.raw),
            })),
          ].sort((a, b) => String(a.data ?? '').localeCompare(String(b.data ?? '')))
          const { andamentos, cortado: truncadoPorTamanho } = cortarPorTamanho(todos, orcamentoPorProcesso)
          return {
            numero_processo: numero,
            quantidade_andamentos: andamentos.length,
            movimentacoes_lidas: Math.min(movs.length, POR_FONTE),
            publicacoes_lidas: Math.min(pubs.length, POR_FONTE),
            erro_movimentacoes: mov.error?.message,
            erro_publicacoes: pub.error?.message,
            // true = havia mais andamentos desde `desde` do que vieram: chegaram os
            // MAIS RECENTES; os mais antigos do período ficaram de fora.
            truncado: truncadoNoBanco || truncadoPorTamanho || undefined,
            motivo_do_corte: truncadoNoBanco
              ? `mais de ${POR_FONTE} andamentos numa das fontes — vieram os mais recentes`
              : truncadoPorTamanho
                ? 'o texto passou do teto de tamanho da chamada — vieram os mais recentes'
                : undefined,
            andamentos,
          }
        }),
      )

      return JSON.stringify({
        aviso: alemDoLimite
          ? `Só os primeiros ${LIMITE_LER_HISTORICO} processos desta lista foram lidos ` +
            '— peça o restante numa chamada seguinte.'
          : undefined,
        aviso_de_corte: resultados.some((r) => 'truncado' in r && r.truncado)
          ? 'Algum processo veio com `truncado: true`: os andamentos MAIS RECENTES estão ' +
            'aqui, mas não todos os do período. Para ler o começo, peça de novo com um ' +
            '`desde` mais recente ou menos processos por chamada.'
          : undefined,
        aviso_de_fonte:
          resultados.some((r) => 'erro_movimentacoes' in r && r.erro_movimentacoes) ||
          resultados.some((r) => 'erro_publicacoes' in r && r.erro_publicacoes)
            ? 'Uma das fontes (movimentações ou publicações) falhou em algum processo — ' +
              'o histórico dele está incompleto; diga isso na resposta.'
            : undefined,
        resultados,
      })
    }

    case 'buscar_movimentacoes': {
      const texto = String(args.texto ?? '')
      if (!texto) return JSON.stringify({ erro: 'Informe o texto a procurar.' })
      // INTEIROS POSITIVOS (12/11/2026): `dias: 7.5` virava data inválida e
      // `limite: 0` devolvia lista vazia apresentada como "nada encontrado".
      const dias = inteiroPositivoOuNulo(args.dias)
      const maxProcessos = inteiroEntre(args.limite, {
        min: 1,
        max: PROCESSOS_POR_BUSCA,
        padrao: PROCESSOS_POR_BUSCA,
      })

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
            .select('numero_processo, numero_digits, data, conteudo')
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
      //
      // O PROCESSO É A CHAVE DE DÍGITOS (12/11/2026), e não o texto cru: o ADVBOX
      // e o DJEN gravam o mesmo número com e sem máscara, e o mesmo processo
      // aparecia DUAS vezes na lista, contado duas vezes em
      // `processos_distintos_encontrados`. As grafias vistas de cada um ficam
      // guardadas para a verificação de atualidade abaixo.
      interface Achado {
        numero_processo: string
        data: string | null
        fonte: 'movimentacao' | 'publicacao'
        trecho: string | null
      }
      const chaveDoProcesso = (numero: string) => soDigitos(numero) || numero
      const porProcesso = new Map<string, Achado>()
      const grafiasPorChave = new Map<string, Set<string>>()
      const registra = (a: Achado) => {
        if (!a.numero_processo) return
        const chave = chaveDoProcesso(a.numero_processo)
        let grafias = grafiasPorChave.get(chave)
        if (!grafias) grafiasPorChave.set(chave, (grafias = new Set()))
        grafias.add(a.numero_processo)
        const atual = porProcesso.get(chave)
        if (!atual || (a.data ?? '') > (atual.data ?? '')) {
          porProcesso.set(chave, a)
        }
      }
      const corta = (t: string | null) =>
        t && t.length > 220 ? `${t.slice(0, 220)}…` : t

      for (const m of mov.data ?? []) {
        registra({
          numero_processo: m.numero_processo || m.numero_digits,
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
      // MIL, E NÃO DOIS MIL (23/10/2026): o PostgREST devolve no máximo 1000
      // linhas, então `.limit(2000)` voltava com 1000 e o `>= 2000` abaixo nunca
      // acendia — processo da amostra empurrado para fora do corte por outros
      // mais ativos saía como "sem andamento mais recente", sem aviso nenhum.
      const CAP_VERIFICACAO = 1000
      const chavesDaAmostra = [
        ...new Set(amostra.map((a) => chaveDoProcesso(a.numero_processo)).filter(Boolean)),
      ]
      // Os dígitos (para o ADVBOX, que tem a coluna só-dígitos) e TODAS as grafias
      // (para o DJEN, que não tem): as vistas na busca e as duas formas padrão
      // do CNJ — o processo achado só no ADVBOX pode estar mascarado no DJEN.
      const digitosDaAmostra = chavesDaAmostra.filter((c) => /^\d+$/.test(c))
      const grafiasDaAmostra = [
        ...new Set(
          chavesDaAmostra.flatMap((c) => [...(grafiasPorChave.get(c) ?? []), ...formasDoNumero(c)]),
        ),
      ]
      const maisRecentePorProcesso = new Map<
        string,
        { data: string | null; fonte: 'movimentacao' | 'publicacao'; trecho: string | null }
      >()
      let verificacaoLimitada = false
      if (chavesDaAmostra.length > 0) {
        const [movRecentes, pubRecentes] = await Promise.all([
          digitosDaAmostra.length > 0
            ? svc
                .from('advbox_movimentacoes')
                .select('numero_processo, numero_digits, data, conteudo')
                .in('numero_digits', digitosDaAmostra)
                .order('data', { ascending: false })
                .limit(CAP_VERIFICACAO)
            : Promise.resolve({ data: [], error: null }),
          svc
            .from('djen_publicacoes')
            .select('numero_processo, data_disponibilizacao, raw')
            .in('numero_processo', grafiasDaAmostra)
            .order('data_disponibilizacao', { ascending: false })
            .limit(CAP_VERIFICACAO),
        ])
        // A VERIFICAÇÃO QUE FALHOU TAMBÉM LIMITA (12/11/2026): com erro, a
        // consulta voltava sem linhas e todo processo saía como "sem andamento
        // mais recente" — o "ainda concluso" afirmado sem ter sido conferido.
        verificacaoLimitada =
          !!movRecentes.error ||
          !!pubRecentes.error ||
          (movRecentes.data?.length ?? 0) >= CAP_VERIFICACAO ||
          (pubRecentes.data?.length ?? 0) >= CAP_VERIFICACAO
        const registraRecente = (
          numero: string,
          data: string | null,
          fonte: 'movimentacao' | 'publicacao',
          trecho: string | null,
        ) => {
          const chave = chaveDoProcesso(numero)
          const atual = maisRecentePorProcesso.get(chave)
          if (!atual || (data ?? '') > (atual.data ?? '')) {
            maisRecentePorProcesso.set(chave, { data, fonte, trecho })
          }
        }
        for (const m of (movRecentes.data ?? []) as Record<string, unknown>[]) {
          registraRecente(
            String(m.numero_digits || m.numero_processo),
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
        const maisRecente = maisRecentePorProcesso.get(chaveDoProcesso(a.numero_processo))
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
        // ficado incompleta — processo muito ativo na amostra, ou a consulta da
        // checagem falhou.
        verificacao_de_atualidade_limitada: verificacaoLimitada || undefined,
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
      // INTEIRO POSITIVO (12/11/2026): `dias: 7.5` dava data inválida e a
      // contagem inteira falhava.
      const dias = inteiroPositivoOuNulo(args.dias)
      if (dias) q = q.gte('data_disponibilizacao', desde(dias))
      const { count, error } = await q
      if (error) return JSON.stringify({ erro: error.message })
      return JSON.stringify({
        total: count ?? 0,
        filtros: args,
        aviso:
          args.dias !== undefined && !dias
            ? '`dias` precisa ser um inteiro positivo — a contagem foi feita sem janela de dias.'
            : undefined,
      })
    }

    case 'listar_publicacoes': {
      // O TOTAL EXATO VEM JUNTO (12/11/2026): "quantas intimações pendentes" era
      // respondido pelo tamanho da lista, que para no teto.
      const teto = limite(args.limite)
      let q = svc
        .from('djen_publicacoes')
        .select('numero_processo, data_disponibilizacao, sigla_tribunal, tipo_comunicacao, tratada, raw', {
          count: 'exact',
        })
        .order('data_disponibilizacao', { ascending: false })
        .order('id', { ascending: false })
        .limit(teto)
      if (typeof args.tratada === 'boolean') q = q.eq('tratada', args.tratada)
      const dias = inteiroPositivoOuNulo(args.dias)
      if (dias) q = q.gte('data_disponibilizacao', desde(dias))
      if (args.numero_processo) {
        const d = soDigitos(args.numero_processo)
        // PELOS DÍGITOS, com ou sem máscara (12/11/2026): o DJEN grava o número
        // dos dois jeitos. Os 7 primeiros traziam publicação de outro processo
        // com o mesmo começo; o número inteiro casa só ele.
        q = d.length >= 6
          ? q.filter('numero_processo', 'imatch', regexDosDigitos(d, { inteiro: d.length >= 20 }))
          : q.ilike('numero_processo', `%${String(args.numero_processo)}%`)
      }
      const { data, error, count } = await q
      if (error) return JSON.stringify({ erro: error.message })
      const voltaram = data?.length ?? 0
      return JSON.stringify({
        total: count ?? null,
        quantidade_retornada: voltaram,
        aviso_limite:
          count !== null && count > voltaram
            ? `Há ${count} publicações com estes filtros; a lista traz as ${voltaram} mais recentes.`
            : undefined,
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
      const teto = limite(args.limite)
      const avisosDeFiltro: string[] = []
      const prazoAte = args.prazo_ate === undefined ? null : dataAAAAMMDD(args.prazo_ate)
      const prazoDe = args.prazo_de === undefined ? null : dataAAAAMMDD(args.prazo_de)
      if (args.prazo_ate !== undefined && !prazoAte) avisosDeFiltro.push('`prazo_ate` não é uma data AAAA-MM-DD — ignorado.')
      if (args.prazo_de !== undefined && !prazoDe) avisosDeFiltro.push('`prazo_de` não é uma data AAAA-MM-DD — ignorado.')
      // Os filtros que o banco aplica, numa consulta nova a cada chamada (a
      // leitura paginada pede uma por página).
      const filtrar = <Q,>(q0: Q): Q => {
        let q = q0 as unknown as Filtravel
        if (typeof args.concluida === 'boolean') q = q.eq('concluida', args.concluida) as Filtravel
        if (args.tipo) q = q.ilike('tipo', `%${args.tipo}%`) as Filtravel
        if (args.numero_processo) {
          // TRECHO DO NÚMERO TAMBÉM CASA (12/11/2026): só o número inteiro achava
          // a tarefa; "o que a equipe faz no 0001234" voltava vazio. O número
          // inteiro continua exato; o trecho procura nos dígitos.
          const d = soDigitos(args.numero_processo)
          if (d.length >= 20) q = q.eq('numero_digits', d) as Filtravel
          else if (d.length >= 4) q = q.ilike('numero_digits', `%${d}%`) as Filtravel
          else q = q.ilike('numero_processo', `%${args.numero_processo}%`) as Filtravel
        }
        if (prazoAte) q = q.lte('date_deadline', prazoAte) as Filtravel
        if (prazoDe) q = q.gte('date_deadline', prazoDe) as Filtravel
        if (args.vencidas === true) {
          // Vencida = prazo fatal no passado E ainda não concluída. Sem o segundo
          // filtro, tarefa cumprida no prazo apareceria como atrasada.
          q = (q.lt('date_deadline', desde(0)) as Filtravel).eq('concluida', false) as Filtravel
        }
        return q as unknown as Q
      }
      const COLUNAS_TAREFA =
        'numero_processo, tipo, data, date_deadline, notes, responsaveis, important, urgent, concluida'

      let tarefas: Record<string, unknown>[]
      let total: number | null
      if (args.responsavel) {
        // O RESPONSÁVEL FILTRA SOBRE TODAS AS TAREFAS, E NÃO SOBRE AS 20 PRIMEIRAS
        // (12/11/2026). `responsaveis` é jsonb (lista de nomes) e o PostgREST não
        // procura trecho dentro dele, então o filtro é em memória — mas era feito
        // DEPOIS do teto: "quantas tarefas a Ana tem" olhava as 20 primeiras de
        // todo mundo e respondia 3. Agora lê todas as que passam pelos outros
        // filtros, filtra, conta e só então corta. Sem acento e sem caixa.
        const lidas = await lerTudo(
          () => filtrar(svc.from('advbox_tarefas').select(COLUNAS_TAREFA)),
          ['date_deadline', 'id'],
        )
        if (lidas.erro) return JSON.stringify({ erro: lidas.erro })
        if (lidas.cortada) return JSON.stringify({ erro: LEITURA_CORTADA })
        const alvo = normalizarNome(String(args.responsavel))
        const todas = lidas.linhas.filter((t) =>
          (Array.isArray(t.responsaveis) ? (t.responsaveis as unknown[]) : [])
            .some((r) => normalizarNome(String(r)).includes(alvo)),
        )
        total = todas.length
        tarefas = todas.slice(0, teto)
      } else {
        const { data, error, count } = await filtrar(
          svc.from('advbox_tarefas').select(COLUNAS_TAREFA, { count: 'exact' }),
        )
          .order('date_deadline', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .limit(teto)
        if (error) return JSON.stringify({ erro: error.message })
        tarefas = (data ?? []) as unknown as Record<string, unknown>[]
        total = count ?? null
      }
      return JSON.stringify({
        hoje: desde(0),
        total,
        quantidade_retornada: tarefas.length,
        aviso_limite:
          total !== null && total > tarefas.length
            ? `Há ${total} tarefas com estes filtros; a lista traz ${tarefas.length} (as de prazo mais próximo). ` +
              'Para dizer quantas são, use `total`.'
            : undefined,
        avisos: avisosDeFiltro.length ? avisosDeFiltro : undefined,
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
      // PAGINADO: a carteira de um investidor grande passa de mil créditos.
      const lidos = await lerTudo(
        () => svc.from('processos').select(`id, ${COLUNAS_PROCESSO}`).ilike('cessionario', `%${nome}%`),
        ['id'],
      )
      if (lidos.erro) return JSON.stringify({ erro: lidos.erro })
      if (lidos.cortada) return JSON.stringify({ erro: LEITURA_CORTADA })
      if (lidos.linhas.length === 0) {
        return JSON.stringify({
          encontrado: false,
          aviso: `Nenhum crédito com cessionário casando "${nome}".`,
        })
      }
      // UM INVESTIDOR SÓ (12/11/2026): o trecho "Silva" casava três investidores
      // e a carteira saía com a soma dos três, apresentada como de um. Mais de um
      // nome distinto (pela chave normalizada) e nenhum igual ao pedido = devolve
      // os candidatos para a pessoa escolher.
      const distintos = investidoresDistintos(lidos.linhas)
      const escolhido = escolherInvestidor(nome, distintos)
      if (!escolhido) {
        return JSON.stringify({
          encontrado: false,
          aviso:
            `"${nome}" casou com ${distintos.length} investidores diferentes. Pergunte à ` +
            'pessoa qual deles, ou chame de novo com o nome completo.',
          candidatos: distintos.map((d) => ({ nome: d.nome, creditos: d.creditos })),
        })
      }
      const creditos = lidos.linhas.filter((c) => normalizarNome(String(c.cessionario ?? '')) === escolhido)
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
      // A LISTA TEM TETO, OS TOTAIS NÃO (12/11/2026): carteira de centenas de
      // créditos, cada um com o texto do estágio, estourava o contexto do
      // modelo. Os totais acima contam todos; a lista traz os 60 adquiridos mais
      // recentemente, com aviso.
      const TETO_DA_CARTEIRA = 60
      const listados = [...creditos]
        .sort((a, b) => String(b.data_aquisicao ?? '').localeCompare(String(a.data_aquisicao ?? '')))
        .slice(0, TETO_DA_CARTEIRA)
      // Em fatias (`lerPorIds`): a lista de ids vai na URL, e passadas algumas
      // centenas a consulta falha. E o erro é DITO: sem olhar, o estágio de
      // todos saía null, como se nunca tivesse sido gerado.
      const resumos = await lerPorIds(
        listados.map((c) => String(c.id)),
        (fatia, de, ate) =>
          svc
            .from('carteira_resumos')
            .select('processo_id, estagio_processual, providencias')
            .in('processo_id', fatia)
            .order('processo_id', { ascending: true })
            .range(de, ate),
      )
      const porId = new Map(
        (resumos.linhas as Record<string, unknown>[]).map((r) => [
          String(r.processo_id),
          { estagio_processual: r.estagio_processual, providencias: r.providencias },
        ]),
      )
      return JSON.stringify({
        encontrado: true,
        moeda: 'BRL',
        fonte: 'campo cessionário dos créditos — a mesma da tela de Carteiras',
        investidor: distintos.find((d) => d.chave === escolhido)?.nome,
        outros_investidores_com_nome_parecido:
          distintos.length > 1
            ? distintos.filter((d) => d.chave !== escolhido).map((d) => d.nome)
            : undefined,
        nomes_casados: [...new Set(creditos.map((c) => c.cessionario))],
        totais,
        quantidade_retornada: listados.length,
        aviso_limite:
          creditos.length > listados.length
            ? `A carteira tem ${creditos.length} créditos (os totais contam todos); a lista traz ` +
              `os ${listados.length} adquiridos mais recentemente.`
            : undefined,
        erro_situacao_atual: resumos.erro
          ? `Não consegui ler o estágio dos créditos (${resumos.erro}) — situacao_atual veio vazia por isso, não por falta de resumo.`
          : undefined,
        creditos: listados.map(({ id, ...resto }) => ({
          ...resto,
          situacao_atual: porId.get(String(id)) ?? null,
        })),
      })
    }

    case 'listar_investidores': {
      // TODAS AS FICHAS, E NÃO AS 50 PRIMEIRAS (23/10/2026): o teto era aplicado
      // ANTES do filtro `ficha_incompleta`, feito em memória — "quem está com
      // ficha incompleta" olhava só 50 fichas em ordem qualquer e dizia "todas
      // completas" sobre as outras. O teto vale agora só no que volta ao modelo.
      //
      // A MESMA LISTA DA TELA (12/11/2026): pessoas das fichas E de todo
      // cessionário/originador que aparece nos créditos (`listarPessoas`, em
      // src/lib/pessoas.ts) — quem está nos créditos sem ficha nenhuma é o caso
      // mais incompleto de todos, e não aparecia. Créditos contados pela chave
      // normalizada, a mesma das fichas (`normalizarNome === nome_chave`).
      const fichas = await lerTudo(() => {
        let q = svc
          .from('investidor_dados')
          // SEM cpf, rg, conta, agência e Pix: nenhuma pergunta de análise precisa
          // do valor desses campos, e mandá-los para fora do sistema seria expor
          // dado bancário sem necessidade. O que vai é se estão PREENCHIDOS.
          .select('tipo, nome_exibicao, nome_chave, cpf, rg, banco, agencia, conta, pix, cidade, uf, representante')
        if (args.papel) q = q.eq('tipo', args.papel)
        return q
      }, ['tipo', 'nome_chave'])
      if (fichas.erro) return JSON.stringify({ erro: fichas.erro })
      if (fichas.cortada) return JSON.stringify({ erro: LEITURA_CORTADA })

      // Quantos créditos cada pessoa tem, no papel dela — da carteira INTEIRA,
      // paginada: o select cru parava em 1000 créditos e contava a menos.
      const creditos = await lerTudo(
        () => svc.from('processos').select('cessionario, originador'),
        ['id'],
      )
      if (creditos.erro) return JSON.stringify({ erro: creditos.erro })
      if (creditos.cortada) return JSON.stringify({ erro: LEITURA_CORTADA })
      const procs = creditos.linhas
      const conta = (campo: 'cessionario' | 'originador') => {
        const m = new Map<string, number>()
        for (const p of procs) {
          const n = normalizarNome(String(p[campo] ?? ''))
          if (n) m.set(n, (m.get(n) ?? 0) + 1)
        }
        return m
      }
      const porCessionario = conta('cessionario')
      const porOriginador = conta('originador')

      const papeis: PapelDaPessoa[] =
        args.papel === 'investidor' || args.papel === 'originador'
          ? [args.papel]
          : ['investidor', 'originador']
      const fichasLidas = fichas.linhas as unknown as FichaDaPessoa[]
      const alvo = args.nome ? normalizarNome(String(args.nome)) : ''

      const cheio = (v: unknown) => !!String(v ?? '').trim()
      let pessoas = papeis
        .flatMap((papel) => pessoasDoAssistente(papel, procs, fichasLidas))
        .filter((p) => !alvo || p.chave.includes(alvo))
        .map((p) => {
          const d = (p.ficha ?? {}) as Record<string, unknown>
          const faltando = p.ficha
            ? [
                cheio(d.cpf) ? null : 'documento',
                cheio(d.banco) ? null : 'banco',
                cheio(d.conta) ? null : 'conta',
                cheio(d.pix) ? null : 'pix',
                cheio(d.cidade) ? null : 'endereço',
              ].filter(Boolean)
            : ['ficha inteira (não cadastrada)']
          return {
            nome: p.nome,
            papel: p.papel,
            ficha_cadastrada: !!p.ficha,
            cidade_uf: [d.cidade, d.uf].filter(Boolean).join('/') || null,
            // Documento com mais de 11 dígitos é CNPJ — mesma régua da plataforma.
            pessoa_juridica: String(d.cpf ?? '').replace(/\D/g, '').length > 11,
            representante_legal: d.representante ?? null,
            creditos_como_cessionario: porCessionario.get(p.chave) ?? 0,
            creditos_como_originador: porOriginador.get(p.chave) ?? 0,
            ficha_completa: faltando.length === 0,
            campos_em_branco: faltando.length ? faltando : undefined,
          }
        })
      if (args.ficha_incompleta === true)
        pessoas = pessoas.filter((p) => !p.ficha_completa)
      const teto = limite(args.limite)
      return JSON.stringify({
        aviso:
          'CPF/CNPJ, RG, agência, conta e Pix NÃO são expostos ao assistente — ' +
          'só se estão preenchidos. Para ver os valores, use a tela Dados cadastrais.',
        // O TOTAL É O DA LISTA INTEIRA; `quantidade_retornada`, o que veio. Antes
        // o segundo levava o valor do primeiro, e a lista cortada passava por toda.
        total: pessoas.length,
        quantidade_retornada: Math.min(pessoas.length, teto),
        aviso_limite:
          pessoas.length > teto
            ? `Há ${pessoas.length} pessoas com estes filtros; a lista traz as ${teto} primeiras em ordem alfabética.`
            : undefined,
        pessoas: pessoas.slice(0, limite(args.limite)),
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
      // O TETO VAI NA CONSULTA (23/10/2026): lia-se a carteira inteira (até as
      // 1000 do PostgREST) para usar só as `limite` primeiras.
      // ORDEM ESTÁVEL E TOTAL EXATO (12/11/2026): sem ordem, duas chamadas com o
      // mesmo filtro traziam créditos diferentes; sem total, "resuma os créditos
      // ativos" falava dos 20 que vieram como se fossem todos.
      const { query: alvo, avisos } = aplicarFiltrosGenericos(
        svc
          .from('processos')
          .select('id, numero_cnj, cedente, cessionario, status', { count: 'exact' })
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .limit(limite(args.limite)),
        args.filtros,
      )
      const { data: procs, error, count: totalDoFiltro } = await alvo
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
      const { data: resumos, error: erroDosResumos } = await svc
        .from('carteira_resumos')
        .select('processo_id, estagio_processual, providencias, erro, gerado_em')
        .in('processo_id', lista.map((p) => String(p.id)))
      // Consulta dos textos que caiu não é "ainda não foi gerado" para todos.
      if (erroDosResumos) return JSON.stringify({ erro: erroDosResumos.message })
      const porId = new Map(
        ((resumos ?? []) as Record<string, unknown>[]).map((r) => [String(r.processo_id), r]),
      )
      return JSON.stringify({
        aviso:
          'Textos mantidos pela plataforma para a carteira do investidor, escritos ' +
          'sem datas de propósito. Para a cronologia de um caso use ficha_do_credito.',
        total: totalDoFiltro ?? null,
        quantidade_retornada: lista.length,
        aviso_limite:
          totalDoFiltro !== null && totalDoFiltro > lista.length
            ? `Há ${totalDoFiltro} créditos com estes filtros; vieram os ${lista.length} cadastrados mais recentemente.`
            : undefined,
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

    case 'funil_comercial': {
      // PARADOS NA COLUNA (12/11/2026): "quais cards estão parados" era
      // respondido pela data de ATUALIZAÇÃO, que muda com qualquer edição
      // (etiqueta, nota, responsável). A data de entrada na coluna (`etapa_em`,
      // migração 0066) é a que diz há quanto tempo o card não anda — do mais
      // parado ao menos. Colunas de fechamento (ganho/perdido) não contam como
      // parado: o card terminou.
      const paradosHaDias = inteiroPositivoOuNulo(args.parados_ha_dias)
      let q = svc
        .from('kommo_leads')
        .select(
          'nome, processo_cnj, pipeline_id, status_id, responsavel_nome, atualizado_em, etapa_em, etapa_status_id',
          { count: 'exact' },
        )
      if (paradosHaDias) {
        q = q
          .lte('etapa_em', desde(paradosHaDias))
          .not('status_id', 'in', '(142,143)')
          .order('etapa_em', { ascending: true })
      } else {
        q = q.order('atualizado_em', { ascending: false })
      }
      q = q.order('kommo_lead_id', { ascending: true }).limit(limite(args.limite))
      const busca = String(args.busca ?? '')
      if (busca) {
        const digitos = soDigitos(busca)
        // Pelos DÍGITOS, com ou sem máscara (os 7 primeiros achavam outro card).
        q = digitos.length >= 6
          ? q.filter('processo_cnj', 'imatch', regexDosDigitos(digitos, { inteiro: digitos.length >= 20 }))
          : q.ilike('nome', `%${busca}%`)
      }
      const { data, error, count } = await q
      if (error) return JSON.stringify({ erro: error.message })
      const cards = (data ?? []) as Record<string, unknown>[]
      if (cards.length === 0) return JSON.stringify({ total: count ?? 0, quantidade_retornada: 0, cards: [] })

      // Sem FK entre kommo_leads e kommo_etapa (mesma composta pipeline_id +
      // status_id) — segunda consulta e Map em memória, mesmo estilo de
      // listar_investidores logo acima.
      const { data: etapas, error: erroEtapas } = await svc
        .from('kommo_etapa')
        .select('pipeline_id, status_id, pipeline_nome, nome')
        .in('pipeline_id', [...new Set(cards.map((c) => c.pipeline_id as number))])
      const porChave = new Map(
        ((etapas ?? []) as Record<string, unknown>[]).map((e) => [
          `${e.pipeline_id}:${e.status_id}`,
          { funil: e.pipeline_nome, etapa: e.nome },
        ]),
      )
      const nomeDoFunil = new Map(
        ((etapas ?? []) as Record<string, unknown>[]).map((e) => [Number(e.pipeline_id), e.pipeline_nome]),
      )
      const voltaram = cards.length
      return JSON.stringify({
        total: count ?? null,
        quantidade_retornada: voltaram,
        aviso_limite:
          count !== null && count > voltaram
            ? `Há ${count} cards com estes filtros; a lista traz ${voltaram}.`
            : undefined,
        // As colunas sem nome por FALHA, e não porque não existem.
        erro_colunas: erroEtapas
          ? `Não consegui ler os nomes das colunas (${erroEtapas.message}) — funil/etapa vêm null por isso.`
          : undefined,
        cards: cards.map((c) => {
          const daTabela = porChave.get(`${c.pipeline_id}:${c.status_id}`)
          // 142 e 143 são as colunas que o Kommo tem em todo funil (ganho e
          // perdido) e não vêm em kommo_etapa: sem isto, saíam com etapa null.
          const doSistema = COLUNAS_DO_SISTEMA[Number(c.status_id)]
          const dataValeParaAColuna = c.etapa_status_id == null || Number(c.etapa_status_id) === Number(c.status_id)
          return {
            nome: c.nome,
            processo_cnj: c.processo_cnj,
            responsavel: c.responsavel_nome,
            atualizado_em: c.atualizado_em,
            funil: daTabela?.funil ?? nomeDoFunil.get(Number(c.pipeline_id)) ?? null,
            etapa: daTabela?.etapa ?? doSistema ?? null,
            na_etapa_desde: dataValeParaAColuna ? (c.etapa_em ?? null) : null,
            // O card mudou de coluna depois da última apuração da data: a que
            // está guardada é da coluna anterior.
            data_da_etapa_incerta: dataValeParaAColuna ? undefined : true,
          }
        }),
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
      // UMA CONSULTA POR GRUPO, CADA UMA COM O SEU TOTAL (12/11/2026). Era uma
      // consulta só, em ordem crescente e com teto de 50: as previsões VENCIDAS
      // (as mais antigas, e numa carteira real são dezenas) enchiam o teto e
      // "esta semana" e "este mês" saíam vazios — afirmação de que nada vence,
      // com coisa vencendo. E os nomes diziam "esta semana" e "este mês" para
      // "os próximos 7 dias" e "os próximos 30": agora dizem o que são.
      const grupo = (aplicar: <Q>(q: Q) => Q) =>
        aplicar(
          svc
            .from('processos')
            .select('numero_cnj, cedente, cessionario, status, expectativa_liquidacao, valor_face', {
              count: 'exact',
            })
            .in('status', ['ativo', 'complementar'])
            .is('data_liquidacao', null)
            .not('expectativa_liquidacao', 'is', null),
        )
          .order('expectativa_liquidacao', { ascending: true })
          .order('id', { ascending: true })
          .limit(LIMITE_MAX)
      const [atrasados, semana, mes] = await Promise.all([
        grupo((q) => (q as unknown as Filtravel).lt('expectativa_liquidacao', hoje) as typeof q),
        grupo(
          (q) =>
            ((q as unknown as Filtravel).gte('expectativa_liquidacao', hoje) as Filtravel).lte(
              'expectativa_liquidacao',
              fimSemana,
            ) as typeof q,
        ),
        grupo(
          (q) =>
            ((q as unknown as Filtravel).gt('expectativa_liquidacao', fimSemana) as Filtravel).lte(
              'expectativa_liquidacao',
              fimMes,
            ) as typeof q,
        ),
      ])
      const erro = atrasados.error ?? semana.error ?? mes.error
      if (erro) return JSON.stringify({ erro: erro.message })
      const comTotal = (r: { data: unknown[] | null; count: number | null }) => {
        const linhas = r.data ?? []
        return {
          total: r.count ?? null,
          aviso_limite:
            r.count !== null && r.count > linhas.length
              ? `São ${r.count}; a lista traz ${linhas.length} (as previsões mais antigas primeiro).`
              : undefined,
          creditos: linhas,
        }
      }
      return JSON.stringify({
        moeda: 'BRL',
        hoje,
        legenda: {
          atrasados: `expectativa de liquidação ANTES de hoje (${hoje}) e ainda não liquidado`,
          proximos_7_dias: `expectativa de hoje (${hoje}) até ${fimSemana}`,
          de_8_a_30_dias: `expectativa depois de ${fimSemana} até ${fimMes}`,
        },
        atrasados: comTotal(atrasados),
        proximos_7_dias: comTotal(semana),
        de_8_a_30_dias: comTotal(mes),
      })
    }

    case 'processos_parados': {
      // INTEIRO POSITIVO (12/11/2026): `dias: 7.5` dava data inválida.
      const diasCorte = inteiroEntre(args.dias, { min: 1, max: 3650, padrao: 20 })
      const corte = desde(diasCorte)

      // PAGINADO (23/10/2026): o `.limit(5000)` não valia — o PostgREST para em
      // 1000 de qualquer jeito, e o processo que ficasse fora do corte não
      // aparecia como parado, com `total_parados` dado como exato.
      //
      // O CRITÉRIO DA TELA, POR INTEIRO (12/11/2026) — ver `paradosDaCarteira`:
      // dígitos inteiros (não os 7 primeiros), apenso herdando o crédito pai, e
      // andamento dentro da janela em `advbox_movimentacoes` tirando o processo
      // da lista mesmo com a linha de status atrasada.
      const [statusRows, processosAtivos, apensos, recentes] = await Promise.all([
        lerTudo(
          () => svc.from('advbox_processo_status').select('numero_processo, ultima_movimentacao'),
          ['numero_processo'],
        ),
        lerTudo(
          () =>
            svc
              .from('processos')
              .select('id, numero_cnj, cedente, cessionario, status')
              .in('status', ['ativo', 'complementar']),
          ['id'],
        ),
        lerTudo(() => svc.from('apensos').select('numero, processo_id'), ['id']),
        lerTudo(
          () => svc.from('advbox_movimentacoes').select('numero_digits').gte('data', corte),
          ['id'],
        ),
      ])
      if (statusRows.erro) return JSON.stringify({ erro: statusRows.erro })
      if (processosAtivos.erro) return JSON.stringify({ erro: processosAtivos.erro })
      if (statusRows.cortada || processosAtivos.cortada) {
        return JSON.stringify({ erro: LEITURA_CORTADA })
      }
      // Apensos e andamentos recentes REFINAM a lista; se não deu para lê-los,
      // ela sai pelo status só, e isso é dito.
      const semApensos = !!apensos.erro || apensos.cortada
      const semConferencia = !!recentes.erro || recentes.cortada

      const parados = paradosDaCarteira({
        status: statusRows.linhas as unknown as { numero_processo: unknown; ultima_movimentacao: string | null }[],
        creditos: processosAtivos.linhas as unknown as Parameters<typeof paradosDaCarteira>[0]['creditos'],
        apensos: semApensos ? [] : (apensos.linhas as { numero: unknown; processo_id: unknown }[]),
        comMovimentoNaJanela: semConferencia
          ? new Set()
          : new Set(recentes.linhas.map((r) => String(r.numero_digits ?? '')).filter(Boolean)),
        corte,
        hoje: desde(0),
      })

      const teto = limite(args.limite)
      return JSON.stringify({
        aviso:
          'Mesmo critério da aba Publicações e Movimentações → Paralisados (só créditos ' +
          'ativos e complementares). Do MAIS parado ao menos parado; quem nunca teve ' +
          'andamento vem no fim.',
        corte_dias: diasCorte,
        total_parados: parados.length,
        quantidade_retornada: Math.min(parados.length, teto),
        aviso_limite:
          parados.length > teto
            ? `São ${parados.length} parados; a lista traz os ${teto} mais parados.`
            : undefined,
        conferencia_limitada:
          semApensos || semConferencia
            ? 'Não consegui ' +
              [semApensos ? 'ler os apensos' : null, semConferencia ? 'conferir os andamentos recentes' : null]
                .filter(Boolean)
                .join(' nem ') +
              ' — a lista pode ter diferenças pequenas em relação à tela.'
            : undefined,
        processos: parados.slice(0, teto),
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
      // TODOS OS DÍGITOS, COMO NA FICHA DO CRÉDITO (12/11/2026): SÓ OS 7
      // primeiros entravam no filtro. Um número fora da carteira casava com outro
      // crédito de mesmo sequencial (0001234-56.2020… com 0001234-99.2019…) e a
      // petição era proposta para ele; com os dois na carteira, o número inteiro
      // nunca desempatava.
      q = digitos.length >= 6
        ? q.filter('numero_cnj', 'imatch', regexDosDigitos(digitos, { inteiro: digitos.length >= 20 }))
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

    default: {
      // AS FERRAMENTAS DA OPERAÇÃO (12/11/2026) se executam em ferramentasDaOperacao.ts;
      // `null` de lá = o nome não é de ninguém.
      const daOperacao = await executarDaOperacao(svc, nome, args)
      if (daOperacao !== null) return daOperacao
      return JSON.stringify({ erro: `Ferramenta desconhecida: ${nome}` })
    }
  }
}

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
 * O nome de um arquivo, do jeito que a chave do Storage aceita: sem acento, sem
 * barra e só com os caracteres que o Supabase Storage admite — o resto vira `_`.
 * Barra sai também por segurança: o nome vem do código que o modelo escreveu, e
 * não pode abrir subpasta dentro da pasta da pessoa.
 */
function nomeParaOStorage(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._\- ()]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 120)
  return limpo || 'arquivo'
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
  sinal?: AbortSignal,
  /**
   * Onde anotar os arquivos JÁ COPIADOS para o Storage (12/11/2026): a cópia
   * da Anthropic não serve mais a ninguém, e ficava para sempre no workspace —
   * quem chama os apaga depois da resposta (`apagarArquivosDaAnthropic`).
   */
  paraApagar?: string[],
): Promise<{ nome: string; url: string; caminho: string }[]> {
  // SEM REPETIR o mesmo arquivo: a varredura agora cobre todas as rodadas da
  // pergunta, e o mesmo file_id pode aparecer em mais de uma.
  const fileIds = new Set<string>()
  for (const bloco of content as Record<string, unknown>[]) {
    if (bloco?.type !== 'bash_code_execution_tool_result') continue
    const inner = (bloco.content ?? {}) as Record<string, unknown>
    if (inner.type !== 'bash_code_execution_result') continue
    for (const saida of (inner.content ?? []) as Record<string, unknown>[]) {
      if (typeof saida.file_id === 'string') fileIds.add(saida.file_id)
    }
  }
  if (fileIds.size === 0) return []

  const svc = serviceClient()
  const cabecalhos = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  const arquivos: { nome: string; url: string; caminho: string }[] = []
  for (const fileId of fileIds) {
    try {
      const meta = await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
        headers: cabecalhos,
        signal: sinal,
      }).then((r) => (r.ok ? r.json() : null))
      const nome = (meta?.filename as string | undefined) || `arquivo-${fileId}`

      const conteudo = await fetch(
        `https://api.anthropic.com/v1/files/${fileId}/content`,
        { headers: cabecalhos, signal: sinal },
      )
      if (!conteudo.ok) continue
      const bytes = new Uint8Array(await conteudo.arrayBuffer())

      // O NOME VAI LIMPO PARA A CHAVE DO STORAGE (23/10/2026). O Storage só
      // aceita ASCII na chave: "Relatório de créditos.xlsx" — o nome normal de
      // um arquivo pedido em português — era recusado ("Invalid key"), o
      // `continue` abaixo engolia a recusa e a pessoa recebia o texto dizendo
      // "segue o arquivo" sem arquivo nenhum. O nome de exibição (`nome`)
      // continua o original. E com o tipo: sem `contentType`, o supabase-js
      // grava texto puro, e a planilha baixava como texto.
      const caminho = `${userId}/${fileId}-${nomeParaOStorage(nome)}`
      const { error } = await svc.storage
        .from('assistente-arquivos')
        .upload(caminho, bytes, {
          upsert: true,
          contentType:
            (typeof meta?.mime_type === 'string' && meta.mime_type) || 'application/octet-stream',
        })
      if (error) {
        console.error('[assistente] arquivo gerado não subiu ao Storage:', error.message)
        continue
      }
      paraApagar?.push(fileId)

      const { data: assinado } = await svc.storage
        .from('assistente-arquivos')
        .createSignedUrl(caminho, 3600)
      // O CAMINHO VAI JUNTO porque o link vence em uma hora e a conversa fica no
      // histórico: ao reabri-la, o navegador assina de novo a partir dele (a
      // policy do bucket deixa cada um ler a própria pasta).
      if (assinado?.signedUrl) arquivos.push({ nome, url: assinado.signedUrl, caminho })
    } catch {
      // Um arquivo que falhou não pode derrubar a resposta inteira — a pessoa
      // ainda lê o texto, só não recebe aquele anexo.
    }
  }
  return arquivos
}

// ------------------------------------------------------------ base do Kommo

/**
 * MONTA E SOBE A BASE DO KOMMO como arquivo do container (12/11/2026): todos os
 * cards do espelho, com as notas. LÊ COM A SESSÃO DE QUEM PERGUNTA (as RLS
 * valem) e em páginas — o PostgREST para em 1000 linhas sem avisar. Do `raw`
 * vêm só os três campos usados, e não o lead inteiro: é o que mais pesava.
 */
async function anexarBaseDoKommo(
  svc: SupabaseClient,
  apiKey: string,
  inicio: number,
  /** Onde anotar o arquivo enviado, para ser apagado depois da resposta. */
  paraApagar: string[],
): Promise<{ bloco: Record<string, unknown>; cards: number } | { erro: string; status: number }> {
  const sinal = sinalAteOTeto(inicio)
  // As colunas primeiro: a base é montada página a página, e cada página já
  // precisa delas para dar nome à coluna de cada card.
  const { data: etapas, error: erroEtapas } = await svc
    .from('kommo_etapa')
    .select('pipeline_id, status_id, pipeline_nome, nome, ordem')
    .abortSignal(sinal)
  if (erroEtapas) return { erro: `Não consegui ler as colunas do Kommo: ${erroEtapas.message}`, status: 502 }
  const base = baseDoKommoEmPedacos((etapas ?? []) as EtapaDoEspelho[])

  // PÁGINA A PÁGINA, COM O RELÓGIO (12/11/2026). A leitura juntava o espelho
  // inteiro antes de montar qualquer coisa, sem olhar o tempo: num espelho
  // grande, a função morria aos 150 s no meio da leitura, calada, e a pessoa via
  // um erro de rede. Agora cada página vira texto assim que chega (as linhas são
  // soltas), o sinal do teto corta a consulta, e entre uma página e outra o
  // relógio é conferido: sem tempo para o modelo trabalhar depois, para aqui e
  // diz por quê.
  const POR_PAGINA = 500
  const MAX_PAGINAS = 40
  const TEMPO_MINIMO_PARA_O_MODELO_MS = 40_000
  let pagina = 0
  for (; pagina < MAX_PAGINAS; pagina++) {
    if (tempoAteOTeto(inicio, Date.now(), { minimoMs: 0 }) < TEMPO_MINIMO_PARA_O_MODELO_MS) {
      return {
        erro:
          `Montar a Base do Kommo levou tempo demais (${base.total} cards lidos até aqui) e ` +
          'não sobraria tempo para a análise. Tente de novo em instantes; se persistir, ' +
          'peça o relatório sem a base ou avise o suporte.',
        status: 504,
      }
    }
    const de = pagina * POR_PAGINA
    const { data, error } = await svc
      .from('kommo_leads')
      .select('kommo_lead_id, pipeline_id, status_id, nome, responsavel_nome, processo_cnj, tags, tags_em, criado_em, atualizado_em, etapa_em, sincronizado_em, notas, campos:raw->custom_fields_values, preco:raw->price, fechado:raw->closed_at')
      .order('kommo_lead_id')
      .range(de, de + POR_PAGINA - 1)
      .abortSignal(sinal)
    if (error) return { erro: `Não consegui ler o espelho do Kommo: ${error.message}`, status: 502 }
    const lote = (data ?? []) as Record<string, unknown>[]
    base.adicionar(
      lote.map((l) => ({
        ...(l as unknown as LinhaDoEspelho),
        raw: { custom_fields_values: l.campos, price: l.preco, closed_at: l.fechado },
      })),
    )
    if (lote.length < POR_PAGINA) break
  }
  if (pagina >= MAX_PAGINAS) {
    return { erro: 'O espelho do Kommo passou do teto de leitura (20 mil cards).', status: 502 }
  }

  const form = new FormData()
  form.append('file', new Blob(base.pedacos(new Date()), { type: 'application/json' }), 'base_kommo.json')
  const resp = await fetch('https://api.anthropic.com/v1/files', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: form,
    signal: sinal,
  })
  const corpo = await resp.json().catch(() => null)
  if (!resp.ok || !corpo?.id) {
    return {
      erro: `Falha ao enviar a Base do Kommo à IA: ${traduzirErroDaAnthropic(resp.status, String(corpo?.error?.message ?? ''))}`,
      status: 502,
    }
  }
  paraApagar.push(String(corpo.id))
  return { bloco: { type: 'container_upload', file_id: String(corpo.id) }, cards: base.total }
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
  /**
   * Onde anotar cada arquivo ASSIM QUE SOBE (12/11/2026): eles ficavam para
   * sempre no workspace da Anthropic. Anotado na hora, e não no fim, para que,
   * se o segundo falhar, o primeiro — já enviado — também seja apagado.
   */
  paraApagar: string[],
  sinal?: AbortSignal,
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
      signal: sinal,
    })
    if (!resp.ok) {
      const corpo = await resp.json().catch(() => null)
      // EM PORTUGUÊS (12/11/2026): a mensagem crua da Anthropic ("File too
      // large", em inglês) ia direto para a tela.
      return {
        blocos: [],
        erro:
          `Falha ao enviar "${arquivo.name}": ` +
          traduzirErroDaAnthropic(resp.status, String(corpo?.error?.message ?? '')),
      }
    }
    const enviado = await resp.json()
    const fileId = enviado?.id as string | undefined
    if (!fileId) {
      return { blocos: [], erro: `A Anthropic não devolveu o id de "${arquivo.name}".` }
    }
    paraApagar.push(fileId)

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

/**
 * APAGA DA ANTHROPIC OS ARQUIVOS DESTA PERGUNTA (12/11/2026): os anexos, a Base
 * do Kommo e os gerados já copiados para o Storage. Ficavam no workspace para
 * sempre — a base do Kommo inteira, com as notas dos cards, a cada pergunta.
 * Melhor esforço: falha de um não impede os outros nem chega à pessoa.
 */
async function apagarArquivosDaAnthropic(ids: readonly string[], apiKey: string): Promise<void> {
  await Promise.allSettled(
    [...new Set(ids)].map(async (id) => {
      const r = await fetch(`https://api.anthropic.com/v1/files/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(10_000),
      })
      await r.body?.cancel()
      if (!r.ok && r.status !== 404) console.error('[assistente] arquivo não foi apagado da Anthropic:', id, r.status)
    }),
  )
}

/**
 * Trabalho que segue DEPOIS da resposta, sem atrasá-la: o runtime das Edge
 * Functions o espera (`EdgeRuntime.waitUntil`); fora dele, segue solto.
 */
function emSegundoPlano(p: Promise<unknown>): void {
  const seguro = p.catch(() => {})
  const rt = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
  }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(seguro)
}

// ------------------------------------------------------------------- handler

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // O RELÓGIO DA INVOCAÇÃO (23/10/2026): até 8 rodadas com o modelo, em esforço
  // alto quando há texto jurídico a interpretar, e o SDK com 10 minutos de
  // timeout por chamada. A Edge Function morre por volta de 150 s, calada — a
  // tela recebia um erro de rede genérico, sem dizer que a pergunta era grande
  // demais. Contado daqui, e não de cada chamada.
  const inicio = Date.now()
  // OS ARQUIVOS DESTA PERGUNTA NA ANTHROPIC (anexos, Base do Kommo, gerados já
  // copiados), apagados no `finally` — em qualquer saída, erro e 504 inclusive.
  const arquivosParaApagar: string[] = []
  let chaveParaApagar: string | null = null

  try {
    const caller = await getCallerAtivo(req, serviceClient())
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const apiKey = await chaveAnthropic()
    chaveParaApagar = apiKey || null
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
    // A BASE DO KOMMO (12/11/2026): o botão "Base do Kommo" do assistente.
    let comBaseDoKommo = false

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
      comBaseDoKommo = form.get('base_kommo') === 'true'
    } else {
      const body = await req.json()
      pergunta = body.pergunta
      historico = body.historico
      modelo = body.modelo
      skillsPedidas = body.skills ?? null
      comBaseDoKommo = body.base_kommo === true
    }

    if (!pergunta || typeof pergunta !== 'string') {
      return jsonResponse({ error: 'Pergunta inválida.' }, 400)
    }
    const modeloResolvido = resolverModeloDoAssistente(modelo)
    // LISTA DE QUEM ACEITA, e não "tudo que não começa com claude-haiku"
    // (12/11/2026): o Haiku 5.5 tem raciocínio adaptativo e esforço, e o prefixo
    // os tirava dele.
    const comRaciocinio = aceitaRaciocinioAdaptativo(modeloResolvido)

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
    // A EXECUÇÃO DE CÓDIGO também com a base do Kommo: é nela que as contas se fazem.
    const comCodigo = skills.length > 0 || comBaseDoKommo
    const ferramentas = comCodigo ? [...FERRAMENTAS, FERRAMENTA_CODE_EXECUTION] : FERRAMENTAS

    // O histórico chega da interface como pares simples de texto. Truncamos em
    // 30 MENSAGENS — umas 15 trocas de pergunta e resposta: conversa de
    // assistente não precisa de memória infinita, e o histórico inteiro é
    // reenviado (e cobrado) a cada pergunta e a cada rodada de ferramenta.
    // (12/11/2026: o comentário dizia "20 turnos" e o corte era de 20
    // MENSAGENS, 10 trocas; 30 é o meio-termo entre memória e custo.)
    //
    // O conteúdo de cada mensagem passa INTEIRO, como texto: o que a tela
    // acrescenta a ele (a lista dos anexos daquele turno, uma nota) chega ao
    // modelo como parte da conversa — da pessoa ou do assistente.
    //
    // Turno com ANEXO no histórico é descartado aqui (o filtro só aceita
    // `content` string): o file_id já pode ter perdido validade, e replicar o
    // upload de novo a cada rodada custaria caro sem necessidade — o texto da
    // pergunta daquele turno continua contando a conversa, só o arquivo em si
    // não volta a ser lido depois da rodada em que foi anexado.
    //
    // TEXTO VAZIO SAI, E A CONVERSA COMEÇA PELA PESSOA (23/10/2026). Um turno
    // de texto vazio é recusado pela API (400, "text content blocks must be
    // non-empty") e derrubava a pergunta nova por causa de uma velha. E uma
    // pergunta que falhou fica na tela sem resposta: o corte deixa de
    // cair num par e pode começar por uma resposta do assistente — que sai
    // aqui, para o histórico abrir sempre com a pessoa.
    const MENSAGENS_DO_HISTORICO = 30
    const mensagens: Anthropic.MessageParam[] = Array.isArray(historico)
      ? historico
          .slice(-MENSAGENS_DO_HISTORICO)
          .filter(
            (m: unknown): m is { role: 'user' | 'assistant'; content: string } =>
              !!m &&
              typeof (m as { content?: unknown }).content === 'string' &&
              ((m as { content: string }).content.trim() !== '') &&
              ((m as { role?: unknown }).role === 'user' ||
                (m as { role?: unknown }).role === 'assistant'),
          )
          .map((m) => ({ role: m.role, content: m.content }))
      : []
    while (mensagens.length > 0 && mensagens[0].role === 'assistant') mensagens.shift()

    // A BASE DO KOMMO VAI JUNTO COM A PERGUNTA, como um anexo do container.
    const blocosDaBase: Record<string, unknown>[] = []
    if (comBaseDoKommo) {
      const base = await anexarBaseDoKommo(svc, apiKey, inicio, arquivosParaApagar)
      if ('erro' in base) return jsonResponse({ error: base.erro }, base.status)
      blocosDaBase.push(base.bloco)
    }
    if (arquivosAnexados.length > 0 || blocosDaBase.length > 0) {
      const { blocos, erro } = arquivosAnexados.length > 0
        ? await anexarArquivosDeEntrada(
            arquivosAnexados,
            apiKey,
            comCodigo,
            arquivosParaApagar,
            sinalAteOTeto(inicio),
          )
        : { blocos: [] as Record<string, unknown>[], erro: undefined }
      if (erro) return jsonResponse({ error: erro }, 400)
      mensagens.push({
        role: 'user',
        content: [{ type: 'text', text: pergunta }, ...blocos, ...blocosDaBase] as unknown as Anthropic.MessageParam['content'],
      })
    } else {
      mensagens.push({ role: 'user', content: pergunta })
    }
    // Daqui em diante, tudo o que entra em `mensagens` é desta pergunta — é o
    // trecho em que se procuram os arquivos gerados (ver o fim do laço).
    const inicioDestaPergunta = mensagens.length

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
      container?: { id?: string; skills: { type: string; skill_id: string; version: string }[] }
    }

    // Os arquivos que a execução de código gerou EM TODAS AS RODADAS DESTA
    // PERGUNTA, e não só na última (23/10/2026): o arquivo nasce na rodada em
    // que o código roda — muitas vezes uma pausada (`pause_turn`) ou uma que
    // ainda chamou ferramenta nossa —, e a rodada final só traz o texto.
    // Olhando só ela, o "segue a planilha" chegava sem a planilha.
    const arquivosDestaPergunta = async () => {
      // Arquivo gerado: só existe com a execução de código ligada, então a
      // varredura não custa nada nas conversas sem ela.
      if (!comCodigo) return []
      const blocosDestaPergunta = mensagens
        .slice(inicioDestaPergunta)
        .filter((m) => m.role === 'assistant' && Array.isArray(m.content))
        .flatMap((m) => m.content as unknown[])
      return await extrairArquivosGerados(
        blocosDestaPergunta,
        apiKey,
        caller.id,
        sinalAteOTeto(inicio, { folgaMs: 5_000, minimoMs: 1_000 }),
        arquivosParaApagar,
      )
    }

    /**
     * O QUE JÁ EXISTE, MARCADO COMO INCOMPLETO (12/11/2026). Rodadas esgotadas
     * com o modelo ainda chamando ferramenta — ou tempo acabando entre uma rodada
     * e outra — davam um 504 genérico, e jogavam fora a petição já proposta, o
     * contato já montado, os arquivos já gerados e o texto já escrito. Agora a
     * pessoa recebe tudo isso, com `truncada: true` (a tela avisa que a resposta
     * está incompleta).
     */
    const entregarParcial = async () => {
      const texto = mensagens
        .slice(inicioDestaPergunta)
        .filter((m) => m.role === 'assistant' && Array.isArray(m.content))
        .flatMap((m) => m.content as Anthropic.ContentBlock[])
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      const arquivos = await arquivosDestaPergunta()
      return jsonResponse({
        resposta:
          (texto ? `${texto}\n\n` : '') +
          'A consulta ficou longa demais e foi interrompida antes do fim — o que está ' +
          'acima pode estar incompleto. Tente uma pergunta mais específica.',
        truncada: true,
        ferramentas: ferramentasUsadas,
        acao_proposta: acaoProposta,
        contato_sugerido: contatoProposto,
        arquivos: arquivos.length > 0 ? arquivos : undefined,
      })
    }

    // O CONTAINER DA EXECUÇÃO DE CÓDIGO, guardado a CADA resposta (12/11/2026).
    // Era guardado só na pausa (`pause_turn`): depois de uma rodada que chamou
    // ferramenta nossa, a seguinte abria um container NOVO — e as variáveis do
    // Python, a base do Kommo já aberta e os arquivos gerados até ali sumiam no
    // meio da pergunta.
    let containerId: string | undefined
    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      // NÃO COMEÇA UMA RODADA QUE NÃO CABE: com menos de 25 s até o teto, a
      // chamada seria cortada no meio de qualquer jeito. Da segunda rodada em
      // diante, há o que entregar.
      if (tempoAteOTeto(inicio, Date.now(), { minimoMs: 0 }) < 25_000) {
        if (rodada > 0) return await entregarParcial()
        return jsonResponse({ error: PERGUNTA_LONGA_DEMAIS }, 504)
      }
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
          // A DATA DE HOJE (12/11/2026), DEPOIS do bloco em cache e sem cache_control:
          // muda todo dia e não pode invalidar o prefixo das outras perguntas.
          { type: 'text', text: textoDaData(hojeEmBrasilia()) },
          ...(comBaseDoKommo ? [{ type: 'text' as const, text: SISTEMA_BASE_KOMMO }] : []),
        ],
        tools: ferramentas,
        messages: mensagens,
        // Raciocínio adaptativo nos dois casos: o modelo decide se pensa. Fica
        // ligado até no caminho barato porque, com ele desligado, o Sonnet
        // aciona ferramentas com menos disposição — e aqui TODA resposta
        // depende de uma consulta. O esforço é que muda entre os caminhos.
        // Modelo fora da lista dos que aceitam (o Haiku 4.5 era um) vai sem os
        // dois: mandá-los dava erro (defeito antigo, achado em 05/10/2026).
        ...(comRaciocinio
          ? {
              thinking: { type: 'adaptive' as const },
              output_config: { effort: interpretandoTexto ? ('high' as const) : ('low' as const) },
            }
          : {}),
      }
      if (skills.length > 0) {
        params.container = {
          ...(containerId ? { id: containerId } : {}),
          skills: skills.map((s) => ({
            type: 'custom',
            skill_id: s.skill_id,
            version: 'latest',
          })),
        }
      } else if (containerId) {
        // SÓ A BASE DO KOMMO, sem skill: as rodadas seguintes voltam ao mesmo
        // container (onde o arquivo e as contas estão), pelo id.
        ;(params as unknown as { container?: string }).container = containerId
      }
      // O método em si reexige o tipo estrito do SDK (container: string) no
      // ponto de chamada — o `Omit` acima não basta ali. Cast duplo só aqui,
      // no menor escopo possível, mantendo `resposta` como `Message` (não a
      // união com `Stream<...>`) para o resto da função.
      // COM O SINAL DO TETO: a chamada é interrompida antes de a função morrer,
      // e a pessoa recebe o motivo (o `catch` do fim) em vez de um erro de rede.
      const resposta = await anthropic.messages.create(
        params as unknown as Anthropic.MessageCreateParamsNonStreaming,
        { signal: sinalAteOTeto(inicio) },
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
      // Depois de TODA resposta, e não só da pausada: ver `containerId`.
      containerId = resposta.container?.id ?? containerId

      // TURNO PAUSADO (auditoria de bugs, 09/10/2026): a execução de código das
      // Skills roda no servidor e, num trabalho longo (gerar planilha, docx),
      // bate no limite dele e volta com `pause_turn`. Era entregue como resposta
      // final — o "Vou gerar o arquivo…" sem arquivo nenhum, e sem aviso. A
      // retomada é reenviar a conversa como está (a resposta pausada já entrou
      // acima), no mesmo container. Na última rodada, sai marcada como truncada.
      if (resposta.stop_reason === 'pause_turn' && rodada < MAX_RODADAS - 1) {
        continue
      }

      if (resposta.stop_reason !== 'tool_use') {
        const texto = resposta.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim()
        // Resposta INTERROMPIDA por limite de tokens não pode ser entregue como
        // se estivesse inteira: uma tabela de 60 processos cortada na linha 35
        // parece completa, e quem lê usa o pedaço como se fosse o todo.
        // A janela de contexto cheia também corta a resposta (stop_reason
        // `model_context_window_exceeded`) — mesma marca de interrompida.
        const motivo: string = resposta.stop_reason ?? ''
        const truncada =
          motivo === 'max_tokens' || motivo === 'pause_turn' || motivo === 'model_context_window_exceeded'
        const arquivos = await arquivosDestaPergunta()
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

    // AS RODADAS ACABARAM COM O MODELO AINDA CHAMANDO FERRAMENTA: entrega o que
    // já existe, marcado como incompleto (ver `entregarParcial`).
    return await entregarParcial()
  } catch (err) {
    // O TETO DE TEMPO DISPAROU (o sinal da chamada ao modelo): é a mesma
    // situação das rodadas esgotadas, e merece a mesma frase — não o "Request
    // was aborted." cru do SDK.
    if (err instanceof Anthropic.APIUserAbortError || estourouOTempo(err)) {
      return jsonResponse({ error: PERGUNTA_LONGA_DEMAIS }, 504)
    }
    // O original vai para o log (é o que o suporte procura); a tela recebe a
    // frase em português.
    console.error('[assistente] falha:', (err as { status?: number })?.status, (err as Error)?.message ?? err)
    return jsonResponse({ error: mensagemDeErro(err) }, 500)
  } finally {
    // Em QUALQUER saída — resposta, erro, 504 —, os arquivos desta pergunta saem
    // da Anthropic. Depois da resposta, sem atrasá-la.
    if (arquivosParaApagar.length > 0 && chaveParaApagar) {
      emSegundoPlano(apagarArquivosDaAnthropic(arquivosParaApagar, chaveParaApagar))
    }
  }
})

/** Rodadas ou tempo esgotados: a frase é a mesma, porque o remédio é o mesmo. */
const PERGUNTA_LONGA_DEMAIS =
  'A consulta ficou longa demais e foi interrompida. Tente uma pergunta mais específica.'

/**
 * Traduz a falha para algo acionável. O erro cru da Anthropic chega como
 * `401 {"type":"error","error":{"type":"authentication_error",...}}` — que na
 * tela do usuário não diz nem onde corrigir.
 *
 * A REGRA MORA EM `_shared/regrasDoAssistente.ts` (12/11/2026), testada: o que
 * não casava com nenhum caso saía cru, em inglês ("prompt is too long…"). Agora
 * sempre em português, com o código HTTP quando não há frase própria.
 */
function mensagemDeErro(err: unknown): string {
  const bruto = (err as Error)?.message ?? String(err)
  const status = (err as { status?: number })?.status
  return traduzirErroDaAnthropic(typeof status === 'number' ? status : undefined, bruto)
}
