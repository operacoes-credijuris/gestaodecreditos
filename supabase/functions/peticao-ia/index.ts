// Geração de petição por IA, para os casos SEM modelo — a peça fora da curva.
//
// Duas ações, e nenhuma conversa:
//
//   { action: 'panorama', tarefa_id, processo_id }
//       Lê o histórico do processo e devolve onde o caso está + que peças cabem.
//       Dispara sozinha ao abrir a aba, então é CACHEADA por tarefa
//       (public.peticao_panorama): reabrir a mesma tarefa não custa chamada.
//
//   { action: 'redigir', processo_id, instrucao, panorama?, dados? }
//       Escreve a petição que o usuário pediu, à luz do mesmo histórico.
//
// POR QUE NÃO É CHAT: por decisão de produto. Panorama, um comando, uma resposta
// — e daí em diante a conversa segue no app do Claude (a interface monta o texto
// de passagem). Assim o ir e vir de refinamento não consome a API.
//
// O QUE ESTA FUNÇÃO NÃO FAZ: .docx. Ela devolve TEXTO no mesmo dialeto de
// markdown dos dez modelos do bucket, e quem monta o arquivo é o pipeline que já
// existe (peticaoLayout + peticaoDocx). É o que garante que a peça da IA saia com
// o mesmo timbrado, as mesmas cores, as mesmas margens e o mesmo recuo de 4 cm
// nas citações que a peça de modelo — sem uma segunda formatação para divergir.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'
// Conferência da forma da peça. Em módulo próprio e SEM import nenhum, para o
// mesmo código rodar aqui e num teste fora do Deno — foi assim que se verificou
// que ela reprova peça torta e aprova peça conforme.
import { fechoDe, problemasDaPeca } from '../_shared/peticaoForma.ts'

const MODELO = 'claude-sonnet-5'

/** Bucket dos modelos de petição — o mesmo de src/lib/peticao.ts. */
const BUCKET_MODELOS = 'modelos-peticoes'

/**
 * Quantos modelos entram no guia de estilo.
 *
 * SEMPRE OS MESMOS, na mesma ordem, de propósito: o guia vai no bloco de sistema
 * marcado para cache, e variar o conteúdo por pedido invalidaria o cache a cada
 * chamada — pagaria-se o guia inteiro toda vez. Três peças bastam para o modelo
 * pegar o padrão de endereçamento, de título de seção, de tom e de fecho.
 */
const MODELOS_NO_GUIA = 3

/** Guia de estilo, memorizado por instância da função. */
let guiaCache: { texto: string; em: number } | null = null
const GUIA_TTL_MS = 30 * 60 * 1000

/**
 * Guia de estilo montado a partir dos modelos REAIS do bucket: as peças que a
 * casa já protocola. É delas que saem o padrão de endereçamento, os títulos de
 * seção, o tom e — o que mais importava — quem assina.
 *
 * Falha em silêncio de propósito: bucket fora do ar ou modelo apagado devolvem
 * guia vazio, e a redação segue com as regras escritas no prompt. Melhor peça
 * sem exemplar do que aba que não funciona.
 */
async function guiaDeEstilo(
  svc: ReturnType<typeof serviceClient>,
): Promise<string> {
  if (guiaCache && Date.now() - guiaCache.em < GUIA_TTL_MS) return guiaCache.texto

  const exemplares: { nome: string; texto: string }[] = []
  let fecho: string | null = null
  try {
    const { data } = await svc
      .from('peticao_templates')
      .select('nome, arquivo')
      .eq('ativo', true)
      .not('arquivo', 'is', null)
      // Ordem estável = bloco de sistema estável = cache de prompt aproveitado.
      .order('nome')
    for (const m of (data ?? []) as { nome: string; arquivo: string }[]) {
      if (exemplares.length >= MODELOS_NO_GUIA && fecho) break
      try {
        const baixado = await svc.storage.from(BUCKET_MODELOS).download(m.arquivo)
        const blob = baixado.data
        if (!blob) continue
        const texto = (await blob.text()).replace(/\r\n/g, '\n').trim()
        if (!texto) continue
        if (exemplares.length < MODELOS_NO_GUIA) {
          exemplares.push({ nome: m.nome, texto })
        }
        // O fecho é o mesmo em todas as peças (é o mesmo advogado): o primeiro
        // que aparecer serve.
        if (!fecho) fecho = fechoDe(texto)
      } catch {
        /* modelo indisponível: o guia sai com os que deram */
      }
    }
  } catch {
    /* sem tabela ou sem bucket: guia vazio */
  }

  const partes: string[] = []
  if (fecho) {
    partes.push(
      '## FECHO E ASSINATURA — COPIE EXATAMENTE ESTE BLOCO',
      '',
      'Quem assina a petição é o ADVOGADO da Credijuris. NUNCA o cessionário, nunca o cedente, nunca a empresa. Este é o fecho da casa, extraído dos modelos que ela protocola:',
      '',
      fecho,
      '',
      'Reproduza o nome e a inscrição na OAB exatamente como estão acima. Atualize apenas a data, para a data de hoje informada no pedido. Não acrescente nem troque signatário.',
    )
  }
  if (exemplares.length) {
    partes.push(
      '',
      `## COMO A CREDIJURIS ESCREVE — ${exemplares.length} peça(s) real(is) da casa`,
      '',
      'Leia para seguir o mesmo padrão de endereçamento, de numeração e título das seções, de tom e de estrutura. Imite a FORMA e o TOM; o conteúdo é o do caso que você vai escrever.',
      '',
      'ATENÇÃO: os trechos [ENTRE COLCHETES] nestes exemplares são campos que a plataforma substitui automaticamente. A SUA petição NÃO pode conter nenhum colchete — use os dados cadastrais fornecidos no pedido.',
    )
    for (const e of exemplares) {
      partes.push('', `### Exemplar — ${e.nome}`, '', e.texto)
    }
  }

  const texto = partes.join('\n')
  guiaCache = { texto, em: Date.now() }
  return texto
}

// Teto de insumo. O histórico é integral e alguns processos passam de duzentos
// andamentos; os mais recentes é que dizem onde o processo está. Mais generoso
// que o da carteira-resumo (40/20) porque redigir peça exige o detalhe que um
// resumo de investidor pode descartar.
const MAX_ANDAMENTOS = 60
const MAX_TAREFAS = 30

const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

/** Hash estável (djb2 em base36) — impressão digital dos insumos. */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

// ---------------------------------------------------------------------------
// Contexto fixo do negócio. Vale para as duas ações.
// ---------------------------------------------------------------------------
const CONTEXTO = `A Credijuris adquire créditos judiciais de credores originais (cedentes) e os cede a investidores (cessionários). TODO crédito aqui é processo em FASE DE CUMPRIMENTO DE SENTENÇA CONTRA A FAZENDA PÚBLICA (União, Estado, Município ou autarquia), no qual JÁ HOUVE CESSÃO DE CRÉDITO. O caminho típico:

  1. Sentença/acórdão de mérito e trânsito em julgado da fase de conhecimento
  2. Início do cumprimento de sentença
  3. Impugnação da Fazenda, ou concordância com os cálculos
  4. Cálculos da contadoria judicial e homologação
  5. Expedição do requisitório: RPV (Requisição de Pequeno Valor) ou precatório
  6. Pagamento — RPV em até 60 dias da requisição; precatório no ciclo orçamentário
  7. Levantamento pelo cessionário (alvará ou transferência)

A cessão precisa ser habilitada nos autos para o pagamento sair no nome do cessionário. Daí a recorrência de peças de homologação da cessão, de concordância com cálculos, de sequestro por descumprimento de prazo do RPV, e de levantamento de valores.`

// ---------------------------------------------------------------------------
// Ação 1: panorama
// ---------------------------------------------------------------------------
const SISTEMA_PANORAMA = `Você é advogado da Credijuris, especializado em execução de créditos judiciais contra a Fazenda Pública.

${CONTEXTO}

QUEM LÊ: o advogado da própria equipe, que vai redigir uma petição neste processo agora. É colega de ofício — escreva técnico, sem explicar o básico e sem didatismo. DATAS E PRAZOS IMPORTAM e devem aparecer: é deles que sai a urgência.

O QUE ENTREGAR
1. Onde o processo está HOJE, e o que dos andamentos sustenta essa leitura.
2. Que peça (ou peças) cabe agora, e por quê.

REGRAS
- Direto ao ponto. Frases curtas. Nenhum floreio, nenhuma introdução do tipo "trata-se de".
- Direto ao ponto NÃO É superficial: não omita detalhe que mude a peça a redigir (valor já levantado, prazo em curso, requisitório já expedido, impugnação pendente, alvará devolvido).
- Só afirme o que os andamentos e as tarefas sustentam. Se falta informação, DIGA que falta, e diga o que precisaria ser conferido nos autos. Nunca invente etapa, valor ou decisão.
- O ÚLTIMO andamento define a situação atual. Nada do que você escrever pode contrariá-lo.
- Distinga PEDIDO de DEFERIMENTO. Petição requerendo algo não é o ato requerido.
- Quando o mesmo evento se repete (alvará expedido e devolvido mais de uma vez, petição reiterada), são CICLOS DISTINTOS. Diga quantas vezes e em que pé ficou o último.
- Se nada houver a fazer agora porque o processo aguarda ato de terceiro, diga isso com franqueza e indique o que caberia para provocá-lo.
- NÃO redija a petição aqui. Este é o diagnóstico; a redação vem no passo seguinte.`

const FERRAMENTA_PANORAMA = {
  name: 'registrar_panorama',
  description: 'Registra o diagnóstico do caso e as peças cabíveis.',
  input_schema: {
    type: 'object' as const,
    properties: {
      situacao: {
        type: 'string',
        description:
          'Onde o processo está hoje e o que sustenta essa leitura. Markdown simples (negrito e parágrafos; listas se ajudar). Técnico, direto, com as datas que importam. Entre 300 e 1200 caracteres.',
      },
      sugestoes: {
        type: 'array',
        description:
          'Peças que cabem agora, da mais urgente para a menos. De 1 a 4. Vazio só se realmente não houver nada a peticionar.',
        items: {
          type: 'object' as const,
          properties: {
            peca: {
              type: 'string',
              description:
                'Nome da peça, como um advogado a chamaria. Ex.: "Petição de homologação da cessão de crédito".',
            },
            porque: {
              type: 'string',
              description:
                'Em uma ou duas frases, o que no processo justifica esta peça agora. Cite o andamento ou o prazo que a motiva.',
            },
          },
          required: ['peca', 'porque'],
        },
      },
    },
    required: ['situacao', 'sugestoes'],
  },
}

// ---------------------------------------------------------------------------
// Ação 2: redigir
// ---------------------------------------------------------------------------
//
// O dialeto de markdown abaixo NÃO é decorativo: é exatamente o que lerModelo()
// (src/lib/peticaoLayout.ts) reconhece. Cada regra aqui corresponde a um ramo do
// parser, e o que sair fora dele perde formatação no .docx — vira parágrafo
// comum. É por isso que o texto é CONFERIDO por código antes de voltar.
const FORMA = `FORMA DO TEXTO — REGRA RÍGIDA
O arquivo .docx é montado por um programa que lê exatamente as marcações abaixo. O que fugir delas perde a formatação (cor, régua, recuo) e sai como parágrafo comum.

Blocos são separados por UMA LINHA EM BRANCO. Cada bloco vira um elemento:

1. PRIMEIRO BLOCO — o endereçamento. Uma linha só, TODA em negrito.
   **EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA 2ª VARA DA FAZENDA PÚBLICA DA COMARCA DE GOIÂNIA/GO**

2. SEGUNDO BLOCO — o número do processo. Uma linha só, TODA em negrito.
   **Processo nº 5007431-28.2024.8.09.0100**

3. TÍTULO DE SEÇÃO — uma linha só, TODA em negrito. Ganha cor e régua.
   **I - DOS FATOS**

4. PARÁGRAFO — texto corrido, sem marcação. Sai justificado. É o normal da peça.

5. CITAÇÃO DIRETA de jurisprudência ou doutrina — TODAS as linhas do bloco
   começando com "> ". Sai em corpo 10 e recuada 4 cm.
   > EMENTA: ...

6. LISTA — TODAS as linhas do bloco começando com "- " ou com "1. ", "2. ".

7. DADOS BANCÁRIOS — bloco de VÁRIAS linhas com cada linha em negrito. Vira
   cartão destacado. Use só se a peça pedir pagamento/levantamento.

8. FECHO — o bloco que contém "pede deferimento". DELE EM DIANTE tudo é
   centralizado, inclusive local, data e assinatura. Sempre termine assim.

PROIBIDO
- Títulos com # ou ##. Título é negrito em linha só, como no item 3.
- Tabelas, links, blocos de código, emojis.
- Deixar [qualquer coisa entre colchetes] para alguém preencher depois: use os
  dados fornecidos, e o que não houver, não afirme.
- Inventar número de processo, nome de parte, valor, data ou dado bancário.`

const SISTEMA_REDIGIR = `Você é advogado da Credijuris e redige petições em execuções de crédito judicial contra a Fazenda Pública.

${CONTEXTO}

O QUE VOCÊ FAZ: escreve a petição que o usuário pedir, pronta para protocolo, usando os fatos do histórico do processo e os dados cadastrais fornecidos.

QUEM ASSINA
A petição é assinada pelo ADVOGADO da Credijuris, com o nome e a inscrição na OAB que estão nos modelos da casa. NUNCA assine como o cessionário, como o cedente ou como a empresa: eles são parte, não procurador. Se houver um bloco de fecho e assinatura fornecido abaixo, copie-o.

CONTEÚDO
- Português jurídico formal, na primeira pessoa do plural. Sóbrio: petição não é peça de retórica.
- Estruture em seções numeradas em romano (I - DOS FATOS, II - ..., III - DOS PEDIDOS), quantas o caso pedir.
- Fundamente. Cite os dispositivos que sustentam o pedido (CPC, CF, e a legislação específica quando couber). Se citar jurisprudência, use o bloco de citação e NÃO invente ementa: só transcreva o que você sabe existir, e na dúvida argumente sem citar.
- Narre os fatos pelo que os andamentos dizem, na ordem em que ocorreram. Datas dos andamentos podem e devem ser usadas.
- NUNCA afirme fato que o histórico não sustente. Se o pedido do usuário pressupõe algo que não está nos autos fornecidos, redija o que é possível e não preencha o vão com invenção.
- Termine sempre com os pedidos e o fecho.

${FORMA}`

const FERRAMENTA_REDIGIR = {
  name: 'registrar_peticao',
  description: 'Registra a petição redigida e o título curto que a nomeia.',
  input_schema: {
    type: 'object' as const,
    properties: {
      titulo: {
        type: 'string',
        description:
          'Nome curto da peça, para nomear o arquivo. Sem o número do processo e sem a palavra "petição". Ex.: "Homologação da cessão de crédito", "Sequestro de valores". Máximo 60 caracteres.',
      },
      texto: {
        type: 'string',
        description:
          'A petição inteira, no dialeto de markdown descrito nas instruções. Começa pelo endereçamento em negrito e termina no fecho com "pede deferimento".',
      },
    },
    required: ['titulo', 'texto'],
  },
}

// ---------------------------------------------------------------------------
// Insumos
// ---------------------------------------------------------------------------
interface ProcessoRow {
  id: string
  numero_cnj: string | null
  tribunal: string | null
  comarca: string | null
  vara: string | null
  cedente: string | null
  cessionario: string | null
  entidade_devedora: string | null
  tipo_credito: string[] | null
  data_aquisicao: string | null
  expectativa_liquidacao: string | null
  data_liquidacao: string | null
  especie_requisitorio: string | null
  status: string | null
}
interface MovRow {
  id: string
  data: string | null
  conteudo: string | null
}
interface TarefaRow {
  id: string
  tipo: string | null
  data: string | null
  date_deadline: string | null
  notes: string | null
  concluida: boolean | null
}

/**
 * Dossiê que vai ao modelo. ORDEM CRONOLÓGICA CRESCENTE, de propósito: as listas
 * chegam do mais recente para o mais antigo (é assim que se pegam os N últimos),
 * e entregar nessa ordem desfaz a causalidade — a lição está registrada na
 * carteira-resumo, onde o modelo tratou o segundo alvará devolvido como um
 * terceiro ainda pendente.
 */
function montarDossie(
  p: ProcessoRow,
  movs: MovRow[],
  tarefas: TarefaRow[],
  totalMovs: number,
): string {
  const l: string[] = []
  l.push('## Cadastro do crédito na plataforma')
  l.push(`- Processo: ${p.numero_cnj || 'não informado'}`)
  l.push(`- Cedente (credor original): ${p.cedente || 'não informado'}`)
  l.push(`- Cessionário (quem comprou): ${p.cessionario || 'não informado'}`)
  l.push(`- Ente devedor: ${p.entidade_devedora || 'não informado'}`)
  l.push(
    `- Juízo: ${[p.tribunal, p.comarca, p.vara].filter(Boolean).join(' · ') || 'não informado'}`,
  )
  l.push(`- Tipo de crédito: ${(p.tipo_credito ?? []).join(', ') || 'não informado'}`)
  l.push(`- Espécie do requisitório: ${p.especie_requisitorio || 'não informada'}`)
  l.push(`- Data da cessão: ${p.data_aquisicao || 'não informada'}`)
  l.push(`- Expectativa de liquidação: ${p.expectativa_liquidacao || 'não informada'}`)
  l.push(`- Liquidado em: ${p.data_liquidacao || 'não liquidado'}`)
  l.push(`- Situação no controle interno: ${p.status || 'não informada'}`)

  const cronologico = [...movs].reverse()
  l.push('')
  l.push(
    `## Andamentos do processo (${movs.length} de ${totalMovs}, do mais ANTIGO para o mais RECENTE)`,
  )
  if (cronologico.length === 0) {
    l.push('Nenhum andamento no cache do ADVBOX para este processo.')
  } else {
    for (const m of cronologico) {
      l.push(`- ${m.data ?? 'sem data'}: ${(m.conteudo ?? '').trim()}`)
    }
    const ultimo = cronologico[cronologico.length - 1]
    l.push('')
    l.push(
      `>>> ANDAMENTO MAIS RECENTE (${ultimo.data ?? 'sem data'}): ${(ultimo.conteudo ?? '').trim()}`,
    )
    l.push(
      '>>> É este que descreve onde o processo está HOJE. Nada do que você escrever pode contrariá-lo.',
    )
  }

  l.push('')
  l.push('## Tarefas internas da Credijuris neste processo')
  if (tarefas.length === 0) {
    l.push('Nenhuma tarefa registrada.')
  } else {
    const descreve = (t: TarefaRow) =>
      `- ${t.data ?? 'sem data'}${t.date_deadline ? ` (prazo fatal ${t.date_deadline})` : ''}: ` +
      `${t.tipo ?? 'sem tipo'}${t.notes ? ` — ${t.notes.trim()}` : ''}`
    const asc = (x: TarefaRow[]) => [...x].reverse()
    const pendentes = tarefas.filter((t) => !t.concluida)
    const concluidas = tarefas.filter((t) => t.concluida)
    if (pendentes.length) {
      l.push('Em aberto (do mais antigo para o mais recente):')
      for (const t of asc(pendentes)) l.push(descreve(t))
    }
    if (concluidas.length) {
      l.push('Concluídas (do mais antigo para o mais recente):')
      for (const t of asc(concluidas)) l.push(descreve(t))
    }
  }
  return l.join('\n')
}

interface Insumos {
  processo: ProcessoRow
  movs: MovRow[]
  tarefas: TarefaRow[]
  totalMovs: number
  totalTarefas: number
  dossie: string
  fonte: string
}

async function colherInsumos(
  svc: ReturnType<typeof serviceClient>,
  processoId: string,
): Promise<Insumos | null> {
  const { data: procData } = await svc
    .from('processos')
    .select(
      'id, numero_cnj, tribunal, comarca, vara, cedente, cessionario, entidade_devedora, tipo_credito, data_aquisicao, expectativa_liquidacao, data_liquidacao, especie_requisitorio, status',
    )
    .eq('id', processoId)
    .maybeSingle()
  const processo = procData as ProcessoRow | null
  if (!processo) return null

  const digits = onlyDigits(processo.numero_cnj)
  const temNumero = digits.length >= 6

  // DESEMPATE OBRIGATÓRIO: dois andamentos do mesmo dia saíam em ordem
  // indefinida, e o primeiro deles virava o ">>> MAIS RECENTE" do dossiê. Caso
  // real: "alvará expedido" e "alvará devolvido sem cumprimento" no mesmo dia.
  const { data: movData } = temNumero
    ? await svc
        .from('advbox_movimentacoes')
        .select('id, data, data_ts, conteudo')
        .eq('numero_digits', digits)
        .order('data', { ascending: false })
        .order('data_ts', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
    : { data: [] }
  const { data: tarData } = temNumero
    ? await svc
        .from('advbox_tarefas')
        .select('id, tipo, data, date_deadline, notes, concluida')
        .eq('numero_digits', digits)
        .order('data', { ascending: false })
        .order('id', { ascending: false })
    : { data: [] }

  const todosMovs = (movData ?? []) as MovRow[]
  const todasTarefas = (tarData ?? []) as TarefaRow[]
  const movs = todosMovs.slice(0, MAX_ANDAMENTOS)
  const tarefas = todasTarefas.slice(0, MAX_TAREFAS)

  // Impressão digital pelos IDS da janela, e não por contagem + data: a contagem
  // satura no teto e deixa de detectar novidade (ver carteira_resumos.fonte_hash).
  const fonte = hash(
    [
      todosMovs.length,
      movs.map((m) => m.id).join(','),
      todasTarefas.length,
      tarefas.map((t) => t.id).join(','),
      tarefas.map((t) => (t.concluida ? '1' : '0')).join(''),
      processo.status ?? '',
      processo.data_liquidacao ?? '',
      processo.especie_requisitorio ?? '',
    ].join('|'),
  )

  return {
    processo,
    movs,
    tarefas,
    totalMovs: todosMovs.length,
    totalTarefas: todasTarefas.length,
    dossie: montarDossie(processo, movs, tarefas, todosMovs.length),
    fonte,
  }
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const apiKey = await chaveAnthropic()
    if (!apiKey) {
      return jsonResponse(
        {
          error:
            'Chave da Anthropic não configurada. Informe em Configurações → Integração Anthropic.',
        },
        400,
      )
    }

    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      tarefa_id?: string
      processo_id?: string
      instrucao?: string
      panorama?: string
      dados?: Record<string, string>
      forcar?: boolean
    }

    if (!body.processo_id) {
      return jsonResponse({ error: 'Crédito não informado.' }, 400)
    }

    const anthropic = new Anthropic({ apiKey })

    // ================= PANORAMA =================
    if (body.action === 'panorama') {
      if (!body.tarefa_id) {
        return jsonResponse({ error: 'Tarefa não informada.' }, 400)
      }

      const insumos = await colherInsumos(svc, body.processo_id)
      if (!insumos) return jsonResponse({ error: 'Crédito não encontrado.' }, 404)

      // CACHE É SEMPRE MELHOR-ESFORÇO. Se a tabela ainda não existe (migração
      // 0035 não rodada) ou a leitura falha, a análise segue e só não se aproveita
      // do guardado — o que nunca pode acontecer é a aba parar de funcionar por
      // causa do cache dela. Mesmo raciocínio na gravação abaixo.
      const cache = await svc
        .from('peticao_panorama')
        .select('panorama, fonte_hash, gerado_em')
        .eq('tarefa_id', body.tarefa_id)
        .maybeSingle()
        .then(
          ({ data }) =>
            data as
              | { panorama: string | null; fonte_hash: string | null; gerado_em: string }
              | null,
          () => null,
        )

      /** Grava o cache sem nunca lançar. Ver o comentário acima. */
      const guardar = async (linha: Record<string, unknown>) => {
        try {
          await svc.from('peticao_panorama').upsert(linha)
        } catch {
          /* cache indisponível: o panorama volta pela resposta de qualquer forma */
        }
      }

      // Cache válido: mesma impressão digital e texto gravado. Reabrir a tarefa
      // não custa chamada — é o que torna aceitável disparar ao abrir a aba.
      if (
        !body.forcar &&
        cache?.panorama &&
        cache.fonte_hash === insumos.fonte
      ) {
        return jsonResponse({
          panorama: cache.panorama,
          gerado_em: cache.gerado_em,
          do_cache: true,
        })
      }

      // Sem nenhum insumo não há caso a diagnosticar: pedir análise aqui seria
      // pedir invenção. Registra o motivo, sem gravar hash, para tentar de novo
      // quando a sincronização do ADVBOX trouxer o histórico.
      if (insumos.movs.length === 0 && insumos.tarefas.length === 0) {
        const motivo =
          'Não há andamentos nem tarefas no cache do ADVBOX para este processo. ' +
          'Sincronize as movimentações e tente de novo.'
        await guardar({
          tarefa_id: body.tarefa_id,
          processo_id: insumos.processo.id,
          erro: motivo,
          gerado_em: new Date().toISOString(),
        })
        return jsonResponse({ error: motivo }, 422)
      }

      try {
        const r = await anthropic.messages.create({
          model: MODELO,
          max_tokens: 4000,
          system: [
            { type: 'text', text: SISTEMA_PANORAMA, cache_control: { type: 'ephemeral' } },
          ],
          tools: [FERRAMENTA_PANORAMA],
          // FERRAMENTA FORÇADA E SEM `thinking`: a API não aceita as duas coisas
          // juntas — tool_choice de tipo 'tool' exige raciocínio desligado. As
          // duas funções que já usam o modelo aqui provam o par certo: a
          // carteira-resumo força ferramenta sem thinking, o assistente usa
          // thinking sem forçar. Misturar devolve 400 e derrubaria a aba inteira
          // no primeiro uso.
          tool_choice: { type: 'tool', name: FERRAMENTA_PANORAMA.name },
          messages: [
            {
              role: 'user',
              content:
                'Analise o processo abaixo e registre o panorama.\n\n' + insumos.dossie,
            },
          ],
        })

        let situacao = ''
        let sugestoes: { peca: string; porque: string }[] = []
        for (const bloco of r.content) {
          if (bloco.type === 'tool_use') {
            const i = bloco.input as Record<string, unknown>
            situacao = String(i.situacao ?? '').trim()
            sugestoes = Array.isArray(i.sugestoes)
              ? (i.sugestoes as Record<string, unknown>[]).map((s) => ({
                  peca: String(s.peca ?? '').trim(),
                  porque: String(s.porque ?? '').trim(),
                }))
              : []
          }
        }
        if (!situacao) throw new Error('O modelo não devolveu o panorama.')

        // Guardado como MARKDOWN pronto, não como JSON: quem lê é a tela, e o
        // formato de exibição não deve depender de remontagem no cliente.
        const texto = [
          situacao,
          sugestoes.length
            ? '\n**Peças cabíveis agora**\n' +
              sugestoes.map((s) => `- **${s.peca}** — ${s.porque}`).join('\n')
            : '\n**Peças cabíveis agora**\n- Nada a peticionar neste momento, conforme a análise acima.',
        ].join('\n')

        await guardar({
          tarefa_id: body.tarefa_id,
          processo_id: insumos.processo.id,
          panorama: texto,
          fonte_hash: insumos.fonte,
          modelo: MODELO,
          erro: null,
          gerado_em: new Date().toISOString(),
        })

        return jsonResponse({
          panorama: texto,
          gerado_em: new Date().toISOString(),
          do_cache: false,
        })
      } catch (e) {
        const msg = mensagemDeErro(e)
        // Não grava fonte_hash: a próxima abertura tenta de novo em vez de achar
        // que este panorama está em dia.
        await guardar({
          tarefa_id: body.tarefa_id,
          processo_id: insumos.processo.id,
          erro: msg.slice(0, 500),
          gerado_em: new Date().toISOString(),
        })
        return jsonResponse({ error: msg }, 502)
      }
    }

    // ================= REDIGIR =================
    if (body.action === 'redigir') {
      const instrucao = String(body.instrucao ?? '').trim()
      if (!instrucao) {
        return jsonResponse({ error: 'Escreva o que a petição deve pedir.' }, 400)
      }

      const insumos = await colherInsumos(svc, body.processo_id)
      if (!insumos) return jsonResponse({ error: 'Crédito não encontrado.' }, 404)

      // Os dados vêm RESOLVIDOS da interface (lib/peticao.ts), e não recalculados
      // aqui: é a mesma resolução que preenche as petições de modelo — juízo,
      // qualificação do cessionário, dados bancários. Duas resoluções do mesmo
      // dado divergiriam, e a peça da IA sairia com endereçamento diferente da
      // peça de modelo do MESMO processo.
      const dados = body.dados ?? {}
      const blocoDados = Object.entries(dados)
        .filter(([, v]) => String(v ?? '').trim())
        .map(([k, v]) => `### ${k}\n${v}`)
        .join('\n\n')

      const pedido = [
        'Redija a petição pedida abaixo.',
        '',
        // A data entra explícita: o modelo não tem relógio, e o fecho copiado dos
        // modelos traz a data em que AQUELA peça foi escrita.
        `Hoje é ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' })}.`,
        '',
        '## O que o advogado pediu',
        instrucao,
        '',
        body.panorama ? `## Panorama já levantado deste caso\n${body.panorama}\n` : '',
        blocoDados
          ? '## Dados cadastrais para usar no texto (use EXATAMENTE como estão)\n\n' +
            blocoDados +
            '\n'
          : '',
        insumos.dossie,
      ]
        .filter(Boolean)
        .join('\n')

      // Os modelos reais da casa, lidos do bucket: é deles que saem o estilo e o
      // bloco de assinatura. Vai no MESMO bloco de sistema marcado para cache, e
      // por isso é sempre o mesmo conteúdo (ver MODELOS_NO_GUIA).
      const guia = await guiaDeEstilo(svc)
      const sistema = guia ? `${SISTEMA_REDIGIR}\n\n${guia}` : SISTEMA_REDIGIR

      const chamar = async (
        correcao: { anterior: string; problemas: string[] } | null,
      ) => {
        let conteudo = pedido
        if (correcao) {
          conteudo +=
            '\n\n## Sua petição anterior violou as regras de forma\n' +
            'Problemas a corrigir:\n' +
            correcao.problemas.map((p) => `- ${p}`).join('\n') +
            '\n\nReescreva a petição INTEIRA corrigindo a forma e preservando o conteúdo jurídico.'
        }
        const r = await anthropic.messages.create({
          model: MODELO,
          max_tokens: 16000,
          system: [
            { type: 'text', text: sistema, cache_control: { type: 'ephemeral' } },
          ],
          tools: [FERRAMENTA_REDIGIR],
          // Ferramenta forçada, sem thinking — mesmo motivo do panorama acima. A
          // garantia de qualidade da forma vem da conferência por código
          // (problemasDaPeca) e da reescrita, não do raciocínio estendido.
          tool_choice: { type: 'tool', name: FERRAMENTA_REDIGIR.name },
          messages: [{ role: 'user', content: conteudo }],
        })
        for (const bloco of r.content) {
          if (bloco.type === 'tool_use') {
            const i = bloco.input as Record<string, unknown>
            return {
              titulo: String(i.titulo ?? '').trim(),
              texto: String(i.texto ?? '').trim(),
              truncada: r.stop_reason === 'max_tokens',
            }
          }
        }
        throw new Error('O modelo não devolveu a petição.')
      }

      try {
        let peca = await chamar(null)
        let problemas = problemasDaPeca(peca.texto)
        // UMA reescrita. A conferência não pode virar laço caro: se a segunda
        // tentativa também sair torta, a peça volta com o aviso e o usuário
        // decide — o texto é editável antes de salvar.
        if (problemas.length > 0) {
          const nova = await chamar({ anterior: peca.texto, problemas })
          const problemasNova = problemasDaPeca(nova.texto)
          if (problemasNova.length <= problemas.length) {
            peca = nova
            problemas = problemasNova
          }
        }
        return jsonResponse({
          titulo: peca.titulo,
          texto: peca.texto,
          truncada: peca.truncada,
          // A tela mostra isto como aviso: a peça sai, mas com a forma imperfeita
          // sinalizada, em vez de o defeito só aparecer no .docx.
          avisos: problemas,
        })
      } catch (e) {
        return jsonResponse({ error: mensagemDeErro(e) }, 502)
      }
    }

    return jsonResponse({ error: 'Ação desconhecida.' }, 400)
  } catch (e) {
    return jsonResponse({ error: String((e as Error).message ?? e) }, 500)
  }
})

/**
 * Traduz a falha para algo acionável. Mesmas mensagens do assistente: o erro cru
 * da Anthropic chega como `401 {"type":"error",...}`, que na tela não diz nem
 * onde corrigir.
 */
function mensagemDeErro(err: unknown): string {
  const bruto = (err as Error)?.message ?? String(err)
  const status = (err as { status?: number })?.status

  if (status === 401 || /invalid x-api-key|authentication_error/i.test(bruto)) {
    return (
      'A Anthropic recusou a chave de API. Confira em Configurações → ' +
      'Integração Anthropic.'
    )
  }
  if (status === 429 || /rate_limit/i.test(bruto)) {
    return 'Limite de uso da Anthropic atingido. Tente de novo em instantes.'
  }
  if (status === 400 && /credit balance|billing/i.test(bruto)) {
    return (
      'A conta da Anthropic está sem crédito. Verifique o saldo em ' +
      'console.anthropic.com.'
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
