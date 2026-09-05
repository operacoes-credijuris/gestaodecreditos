// Custo de cartório por UF: escritura pública de cessão + registro em títulos e
// documentos, PARA UM PREÇO DE CESSÃO.
//
// A PERGUNTA MUDOU, e é isso que faz esta versão funcionar. A primeira tentativa
// pedia à IA a TABELA INTEIRA de emolumentos do estado, em faixas, para o motor
// consultar quantas vezes quisesse. Falhou em Pernambuco: a tabela de lá cobra
// percentual sobre o valor, com piso e teto, e nem o formato de faixas dava
// conta, nem o modelo conseguia transcrever a estrutura toda com confiança —
// devolvia "sem faixas" e o preço saía sem cartório.
//
// Agora a pergunta é a que uma pessoa faria ao cartório: "uma escritura de
// cessão de R$ 52.500 em PE custa quanto, e o registro em RTD custa quanto?".
// Uma consulta pontual, sobre um valor concreto. O modelo lê a tabela oficial e
// aplica a regra dela — percentual, faixa fixa, piso, teto, o que for — em vez
// de traduzi-la para um formato nosso.
//
// COMO ISSO CONVIVE COM A CALIBRAGEM. O motor calibra o deságio testando vários
// preços de cessão, e o custo de cartório depende do preço — daí a ideia
// original da tabela. A saída é em duas etapas: calibra primeiro SEM cartório,
// pergunta o custo para o preço que saiu, e recalibra com esse custo fixo. O
// cartório é ~2% da cessão, então a segunda calibragem move o preço pouco; e
// a consulta devolve A FAIXA em que aquele custo vale, para o motor saber se o
// preço novo saiu dela e avisar.
//
// O CACHE ACUMULA FAIXAS RESOLVIDAS, não a tabela do estado. Cada consulta
// guarda "em PE, entre R$ 50 mil e R$ 100 mil, escritura X + registro Y". A
// próxima cessão de PE nessa faixa não busca nada. É o mesmo cache da migração
// 0053 (coluna `tabela` jsonb) — só o formato de dentro mudou, e ele nunca
// chegou a ser preenchido.
//
// COMPARTILHADO (_shared) de propósito: a etapa de Precificação do precatório
// vai precisar exatamente disto.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

const MODELO = 'claude-opus-5'
/**
 * Tetos das ferramentas de servidor.
 *
 * BUSCAR NÃO BASTA, E FOI ESSA A FALHA EM PE. A busca devolve trechos: cabeçalho
 * e notas explicativas do PDF, não o corpo da tabela. O modelo localizou a norma
 * certa (Ato TJPE 1556/2025, tabela 2026) e mesmo assim devolveu null nos dois
 * atos — as linhas numéricas das faixas estavam dentro do arquivo, que ele não
 * tinha como abrir, e o orçamento de buscas acabou antes. web_fetch abre o
 * documento; é a ferramenta que faltava.
 *
 * O orçamento subiu junto: achar a norma custa 2 ou 3 buscas, e abrir o Anexo
 * Único mais as duas tabelas (Notas e RTD) custa alguns fetches.
 */
const MAX_BUSCAS = 10
const MAX_FETCHES = 6
const MAX_RETOMADAS = 3

/** Uma faixa de preço já resolvida: dentro dela, o custo é este. */
export interface FaixaResolvida {
  de: number
  /** null = faixa aberta ("deste valor para cima"). */
  ate: number | null
  escritura: number | null
  registro: number | null
  observacao?: string | null
  fontes?: string[]
  vigencia?: string | null
}

export interface CustoCartorio {
  uf: string
  ano: number
  /** O preço de cessão consultado. */
  preco: number
  escritura: number | null
  registro: number | null
  /** Soma do que se conhece; null quando nenhum dos dois foi achado. */
  total: number | null
  /** Os DOIS atos entraram. Falso = custo parcial, e a descrição diz o que faltou. */
  completo: boolean
  /** Faixa de preços em que este mesmo custo vale — para detectar troca de faixa. */
  de: number | null
  ate: number | null
  descricao: string
  fontes: string[]
  vigencia: string | null
  observacao: string | null
  origem: 'cache' | 'busca' | 'nenhuma'
  motivo?: string
}

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
])

/** "sp", " SP " -> "SP"; qualquer coisa que não seja UF -> null. */
export function normalizarUf(s: unknown): string | null {
  const t = String(s ?? '').trim().toUpperCase()
  return UFS.has(t) ? t : null
}

const brl = (n: number) =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** O preço cai nesta faixa? */
function cobre(f: FaixaResolvida, preco: number): boolean {
  return preco >= f.de && (f.ate === null || preco <= f.ate)
}

function descrever(escritura: number | null, registro: number | null, sufixo: string): string {
  const partes = [
    escritura === null ? 'escritura NÃO ENCONTRADA' : `Escritura ${brl(escritura)}`,
    registro === null ? 'registro NÃO ENCONTRADO' : `registro ${brl(registro)}`,
  ]
  return partes.join(' + ') + sufixo
}

// ---------------------------------------------------------------------------
// A consulta à IA
// ---------------------------------------------------------------------------

const FERRAMENTA = {
  name: 'registrar_custo_cartorio',
  description:
    'Registra quanto custam, em reais, a escritura pública de cessão de crédito e o registro do instrumento em Títulos e Documentos, para um valor específico, num estado específico.',
  input_schema: {
    type: 'object' as const,
    properties: {
      escritura: {
        type: ['number', 'null'],
        description:
          'Custo TOTAL da escritura pública com conteúdo financeiro para o valor consultado, em reais — já somados emolumento, fundos, selo e taxa de fiscalização, quando a tabela os discrimina. null se não conseguiu determinar.',
      },
      registro: {
        type: ['number', 'null'],
        description:
          'Custo TOTAL do registro do instrumento no Registro de Títulos e Documentos para o valor consultado, em reais, considerando um instrumento de cessão típico (2 a 6 páginas). null se não conseguiu determinar.',
      },
      faixa_de: {
        type: ['number', 'null'],
        description:
          'Piso da faixa de valores em que ESTES MESMOS custos valem, em reais. Se a tabela cobra percentual (o custo muda a cada real), devolva o próprio valor consultado aqui e em faixa_ate.',
      },
      faixa_ate: {
        type: ['number', 'null'],
        description: 'Teto da mesma faixa; null se a faixa é aberta ("acima de X").',
      },
      observacao: {
        type: ['string', 'null'],
        description:
          'Como o valor foi obtido: a faixa da tabela, o percentual aplicado, o que foi somado. Uma ou duas frases. Diga aqui se algum dos dois ficou null e por quê.',
      },
      vigencia: {
        type: ['string', 'null'],
        description: 'Período da tabela usada, como a fonte descreve ("2026", "a partir de 01/01/2026").',
      },
      fontes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Endereços EXATOS das páginas de onde saíram os valores. Obrigatório.',
      },
    },
    required: ['escritura', 'registro', 'faixa_de', 'faixa_ate', 'observacao', 'vigencia', 'fontes'],
  },
}

function sistema(uf: string, preco: number, ano: number): string {
  return `Você consulta a tabela de emolumentos de cartório do estado ${uf} e responde uma pergunta concreta: uma cessão de crédito no valor de ${brl(preco)} vai custar quanto de cartório, hoje (${ano})?

São dois atos, e você responde os dois:
1. ESCRITURA PÚBLICA com conteúdo financeiro, no Tabelionato de Notas — é o ato da cessão. A base de cálculo é o valor da cessão, ${brl(preco)}.
2. REGISTRO do instrumento no Registro de Títulos e Documentos (RTD).

ONDE PROCURAR, nesta ordem: o Tribunal de Justiça de ${uf} ou a Corregedoria-Geral de Justiça (a tabela é publicada por eles, como provimento, ato, portaria ou anexo de lei estadual); depois o sindicato ou colégio de notários e registradores do estado; depois a ANOREG.

ABRA O DOCUMENTO — NÃO SE CONTENTE COM O RESULTADO DA BUSCA. A tabela mora dentro de um anexo (PDF, quase sempre), e a busca devolve só o cabeçalho e as notas explicativas. Use web_fetch no endereço do anexo para ler as linhas numéricas das faixas. Localizar a norma e não abri-la é o modo típico de falhar aqui: dá a impressão de ter achado, e não se leu número nenhum. Gaste as buscas para CHEGAR ao arquivo, e o fetch para lê-lo.

COMO RESPONDER:
1. APLIQUE A REGRA DA TABELA, não a transcreva. Se a tabela de ${uf} cobra por faixa de valor, ache a faixa em que ${brl(preco)} cai e devolva o valor dela. Se cobra percentual sobre o valor, calcule o percentual sobre ${brl(preco)} e respeite piso e teto. Se soma emolumento + fundos + selo + taxa de fiscalização, some tudo e devolva o total que se paga no balcão. O que eu preciso é o NÚMERO em reais para este valor.
2. SOME O QUE A TABELA MANDA SOMAR. Vários estados cobram, além do emolumento da faixa, uma taxa obrigatória de serviço (nomes variam: TSNR, TFJ, taxa de fiscalização, selo, fundos), com regra própria de teto e piso. O que eu preciso é o valor de BALCÃO: emolumento + tudo o que é obrigatório naquele ato. Se a regra da taxa estiver na lei e não na tabela, leia as duas.
3. MOSTRE A CONTA em "observacao": qual faixa, qual percentual, que taxas somou e por qual regra. É o que permite conferir.
4. A FAIXA DE VALIDADE. Em "faixa_de" e "faixa_ate", diga entre que valores esse mesmo custo continua valendo — normalmente os limites da faixa da tabela. Se o custo é percentual e muda a cada real, devolva ${preco} nos dois campos.
5. FONTE OBRIGATÓRIA. Todo valor precisa do endereço da página em "fontes". Sem fonte o resultado é descartado: emolumento é preço público e este número entra num cálculo de deságio.
6. UM ATO PODE FALTAR. Se achou a escritura e não o registro (ou o contrário), devolva o que achou e null no outro, explicando em "observacao". Meio custo com a origem clara é útil; não devolva null nos dois só por insegurança — se achou a tabela oficial, aplique-a.
7. Responda chamando a ferramenta registrar_custo_cartorio uma única vez, ao final.`
}

async function consultarNaWeb(
  uf: string,
  preco: number,
  ano: number,
  apiKey: string,
): Promise<{
  escritura: number | null
  registro: number | null
  de: number | null
  ate: number | null
  fontes: string[]
  vigencia: string | null
  observacao: string | null
  motivo?: string
}> {
  const anthropic = new Anthropic({ apiKey })
  const mensagens: Anthropic.MessageParam[] = [
    { role: 'user', content: `Quanto custa de cartório uma cessão de crédito de ${brl(preco)} em ${uf}?` },
  ]
  const pedir = () =>
    anthropic.messages
      .stream({
        model: MODELO,
        max_tokens: 4000,
        system: sistema(uf, preco, ano),
        // 'auto', e não ferramenta forçada: forçar impediria a busca, e sem
        // busca não há tabela.
        // web_search ACHA o documento, web_fetch ABRE. Sem o segundo, o modelo
        // lê só o resumo da página de busca — foi o que produziu "localizei a
        // norma mas não consegui extrair as linhas numéricas".
        //
        // Sem code_execution junto, de propósito: a filtragem dinâmica já vem
        // embutida nesta versão das duas ferramentas, e declarar o executor
        // à parte cria um segundo ambiente que confunde o modelo.
        tools: [
          FERRAMENTA,
          { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: MAX_FETCHES },
        ],
        messages: mensagens,
      })
      .finalMessage()

  let resposta = await pedir()
  // O laço de amostragem do servidor tem teto próprio e devolve 'pause_turn' ao
  // batê-lo; reenviar o turno pausado retoma de onde parou, sem mensagem nova.
  for (let i = 0; i < MAX_RETOMADAS && resposta.stop_reason === 'pause_turn'; i++) {
    mensagens.push({ role: 'assistant', content: resposta.content })
    resposta = await pedir()
  }

  const vazio = { escritura: null, registro: null, de: null, ate: null, fontes: [], vigencia: null, observacao: null }
  const uso = resposta.content.find((c) => c.type === 'tool_use' && c.name === FERRAMENTA.name)
  if (!uso || uso.type !== 'tool_use') {
    return {
      ...vazio,
      motivo:
        resposta.stop_reason === 'pause_turn'
          ? 'a busca não terminou dentro do limite de retomadas'
          : 'a IA não devolveu o custo',
    }
  }

  const e = uso.input as Record<string, unknown>
  const fontes = Array.isArray(e.fontes)
    ? (e.fontes as unknown[]).map(String).filter((f) => /^https?:\/\//i.test(f))
    : []
  if (fontes.length === 0) return { ...vazio, motivo: 'a IA não informou a fonte' }

  // Positivo e plausível. O teto de 30% do preço existe porque emolumento é
  // ordem de grandeza de centenas ou poucos milhares — um número dessa escala
  // acima disso é erro de leitura (percentual aplicado errado, valor da causa
  // no lugar do emolumento), e ele entraria direto no deságio.
  const num = (v: unknown): number | null => {
    const n = v === null || v === undefined ? null : Number(v)
    if (n === null || !isFinite(n) || n <= 0) return null
    return n > preco * 0.3 ? null : n
  }
  const escritura = num(e.escritura)
  const registro = num(e.registro)
  if (escritura === null && registro === null) {
    return {
      ...vazio,
      fontes,
      motivo:
        typeof e.observacao === 'string' && e.observacao
          ? `a IA não determinou os valores (${e.observacao})`
          : 'a IA não determinou nenhum dos dois valores',
    }
  }

  const faixa = (v: unknown): number | null => {
    const n = v === null || v === undefined ? null : Number(v)
    return n !== null && isFinite(n) && n >= 0 ? n : null
  }
  return {
    escritura,
    registro,
    de: faixa(e.faixa_de),
    ate: faixa(e.faixa_ate),
    fontes,
    vigencia: typeof e.vigencia === 'string' ? e.vigencia : null,
    observacao: typeof e.observacao === 'string' ? e.observacao : null,
  }
}

// ---------------------------------------------------------------------------
// Cache + consulta
// ---------------------------------------------------------------------------

async function lerCache(svc: SupabaseClient, uf: string, ano: number): Promise<FaixaResolvida[]> {
  try {
    const { data } = await svc
      .from('emolumentos_uf')
      .select('tabela')
      .eq('uf', uf)
      .eq('ano', ano)
      .maybeSingle()
    const faixas = (data?.tabela as { faixas?: unknown } | null)?.faixas
    return Array.isArray(faixas) ? (faixas as FaixaResolvida[]) : []
  } catch {
    return [] // migração 0053 não rodou: segue sem cache
  }
}

async function gravarCache(
  svc: SupabaseClient,
  uf: string,
  ano: number,
  nova: FaixaResolvida,
  existentes: FaixaResolvida[],
): Promise<void> {
  try {
    // Descarta faixas que a nova cobre, para o cache não acumular respostas
    // contraditórias para o mesmo intervalo — a última consulta é a que vale.
    const mantidas = existentes.filter((f) => !(f.de >= nova.de && (nova.ate === null || (f.ate !== null && f.ate <= nova.ate))))
    await svc.from('emolumentos_uf').upsert(
      {
        uf,
        ano,
        tabela: { faixas: [...mantidas, nova] },
        fontes: nova.fontes ?? [],
        vigencia: nova.vigencia ?? null,
        atualizado_por: 'gerar-analise-rpv',
      },
      { onConflict: 'uf,ano' },
    )
  } catch {
    /* sem cache: a próxima consulta desta faixa busca de novo */
  }
}

/**
 * Quanto custa o cartório para uma cessão de `preco` em `uf`.
 *
 * Cache primeiro (faixa já resolvida que cubra o preço), consulta web depois. O
 * cache está em try/catch: sem a migração 0053, cada consulta busca e segue.
 */
export async function custoDeCartorio(
  ufBruta: unknown,
  preco: number,
  apiKey: string,
  svc: SupabaseClient,
): Promise<CustoCartorio> {
  const ano = new Date().getFullYear()
  const base = {
    uf: normalizarUf(ufBruta) ?? String(ufBruta ?? ''),
    ano,
    preco,
    escritura: null,
    registro: null,
    total: null,
    completo: false,
    de: null,
    ate: null,
    fontes: [] as string[],
    vigencia: null,
    observacao: null,
  }

  const uf = normalizarUf(ufBruta)
  if (!uf) {
    return {
      ...base,
      descricao: 'Confirmar com cartório — UF do tribunal não identificada',
      origem: 'nenhuma',
      motivo: 'UF do tribunal não identificada nos autos',
    }
  }
  if (!(preco > 0)) {
    return {
      ...base,
      uf,
      descricao: 'Confirmar com cartório — preço de cessão indefinido',
      origem: 'nenhuma',
      motivo: 'preço de cessão ainda não calculado',
    }
  }

  const existentes = await lerCache(svc, uf, ano)
  const doCache = existentes.find((f) => cobre(f, preco))
  if (doCache && (doCache.escritura !== null || doCache.registro !== null)) {
    const total = (doCache.escritura ?? 0) + (doCache.registro ?? 0)
    return {
      ...base,
      uf,
      escritura: doCache.escritura,
      registro: doCache.registro,
      total,
      completo: doCache.escritura !== null && doCache.registro !== null,
      de: doCache.de,
      ate: doCache.ate,
      descricao: descrever(doCache.escritura, doCache.registro, ` (tabela ${uf}/${ano})`),
      fontes: doCache.fontes ?? [],
      vigencia: doCache.vigencia ?? null,
      observacao: doCache.observacao ?? null,
      origem: 'cache',
    }
  }

  const achado = await consultarNaWeb(uf, preco, ano, apiKey)
  if (achado.escritura === null && achado.registro === null) {
    return {
      ...base,
      uf,
      fontes: achado.fontes,
      descricao: 'Confirmar com cartório — custo não encontrado',
      origem: 'nenhuma',
      motivo: achado.motivo,
    }
  }

  const total = (achado.escritura ?? 0) + (achado.registro ?? 0)
  // Faixa ausente ou incoerente vira faixa do próprio preço: o cache guarda
  // pouco, mas nunca guarda um custo válido para um intervalo que não é o dele.
  const de = achado.de !== null && achado.de <= preco ? achado.de : preco
  const ate = achado.ate !== null && achado.ate >= preco ? achado.ate : preco
  await gravarCache(
    svc,
    uf,
    ano,
    { de, ate, escritura: achado.escritura, registro: achado.registro, observacao: achado.observacao, fontes: achado.fontes, vigencia: achado.vigencia },
    existentes,
  )

  return {
    ...base,
    uf,
    escritura: achado.escritura,
    registro: achado.registro,
    total,
    completo: achado.escritura !== null && achado.registro !== null,
    de,
    ate,
    descricao: descrever(achado.escritura, achado.registro, ` (tabela ${uf}/${ano})`),
    fontes: achado.fontes,
    vigencia: achado.vigencia,
    observacao: achado.observacao,
    origem: 'busca',
  }
}
