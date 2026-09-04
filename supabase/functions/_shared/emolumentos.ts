// Emolumentos de cartório por UF: escritura pública de cessão + registro em
// títulos e documentos.
//
// ATÉ AQUI O MOTOR DE RPV USAVA UMA TABELA SÓ — a de Virginópolis-MG — para
// crédito de qualquer estado. Emolumento é preço público fixado por cada
// Tribunal de Justiça, e a diferença entre estados não é arredondamento: a
// mesma escritura custa o dobro num e metade noutro. Decisão do dono: a tabela
// passa a ser a DO ESTADO DO TRIBUNAL onde o crédito tramita, e quem a encontra
// é a IA, por busca web na fonte oficial.
//
// O QUE ESTE MÓDULO DEVOLVE É UMA TABELA DE FAIXAS, não um número — e o número
// sai dela. A calibragem do deságio testa milhares de preços de cessão em
// sequência, e o emolumento depende do preço; o motor precisa da função
// preço->custo. `emolumentoDaTabela` é essa função, e o custo em reais que ela
// devolve para o preço calibrado é o que vai para a planilha e para a tela.
//
// FAIXA POR VALOR FIXO OU POR PERCENTUAL. A primeira versão só aceitava valor
// fixo por faixa e por isso FALHOU em Pernambuco: lá (e em boa parte dos
// estados) a escritura com conteúdo econômico cobra percentual sobre o valor,
// com piso e teto, e a IA devolveu "sem faixas para escritura" porque não
// tinha como expressar a regra. Agora uma faixa é `valor` fixo OU
// `percentual` sobre o preço (mais `fixo` opcional, entre `minimo` e `maximo`).
//
// UM ATO PODE FALTAR. Se a IA achou o registro e não a escritura, o cartório sai
// PARCIAL — com a parte conhecida somada e a que falta dita pelo nome. Antes,
// faltar um ato descartava os dois e o preço saía sem cartório nenhum.
//
// COMPARTILHADO (_shared) de propósito: a etapa de Precificação do precatório
// vai precisar exatamente da mesma coisa, e duas cópias desta busca achariam
// duas tabelas diferentes para o mesmo estado.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

const MODELO = 'claude-opus-5'
/** Teto de buscas e de retomadas — ambos pelo teto de tempo da Edge Function. */
const MAX_BUSCAS = 8
const MAX_RETOMADAS = 2

export interface Faixa {
  /** Limite superior da faixa em reais; null = faixa aberta ("acima de X"). */
  ate: number | null
  /** Emolumento fixo da faixa, em reais. Exclusivo com `percentual`. */
  valor?: number | null
  /** Percentual sobre o preço, como FRAÇÃO (0.005 = 0,5%). Exclusivo com `valor`. */
  percentual?: number | null
  /** Parcela fixa somada ao percentual, em reais. */
  fixo?: number | null
  /** Piso e teto do resultado quando a faixa é percentual. */
  minimo?: number | null
  maximo?: number | null
}
export interface TabelaAto {
  faixas: Faixa[]
  observacao?: string | null
}
export interface TabelaEmolumentos {
  /** Ato ausente = a IA não achou tabela confiável para ele. */
  escritura: TabelaAto | null
  registro: TabelaAto | null
}
export interface Emolumentos {
  uf: string
  ano: number
  tabela: TabelaEmolumentos | null
  fontes: string[]
  vigencia: string | null
  /** De onde veio: 'cache' (banco), 'busca' (web, agora) ou 'nenhuma' (não achou). */
  origem: 'cache' | 'busca' | 'nenhuma'
  /** Por que não achou, quando `tabela` é null. */
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

// ---------------------------------------------------------------------------
// A função preço -> custo
// ---------------------------------------------------------------------------

const brl = (n: number) =>
  'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function valorDaFaixa(f: Faixa, preco: number): number | null {
  if (f.valor != null) return f.valor
  if (f.percentual != null) {
    let v = preco * f.percentual + (f.fixo ?? 0)
    if (f.minimo != null) v = Math.max(v, f.minimo)
    if (f.maximo != null) v = Math.min(v, f.maximo)
    return v
  }
  return null
}

function valorNoAto(ato: TabelaAto | null, preco: number): number | null {
  if (!ato || ato.faixas.length === 0) return null
  // Ordena por teto, com a faixa aberta por último: a primeira que couber é a certa.
  const faixas = [...ato.faixas].sort((a, b) => {
    if (a.ate === null) return 1
    if (b.ate === null) return -1
    return a.ate - b.ate
  })
  const f = faixas.find((x) => x.ate === null || preco <= x.ate)
  return f ? valorDaFaixa(f, preco) : null
}

/**
 * Custo de cartório para um preço de cessão: escritura + registro.
 *
 * `total` soma o que se conhece. `completo` diz se os DOIS atos entraram; quando
 * um faltou, `descricao` nomeia qual — e quem chama avisa que o preço saiu com
 * cartório parcial. `total` null só quando nenhum ato foi achado.
 */
export function emolumentoDaTabela(
  tabela: TabelaEmolumentos | null,
  preco: number,
  rotulo?: string,
): {
  total: number | null
  escritura: number | null
  registro: number | null
  completo: boolean
  descricao: string
} {
  const sufixo = rotulo ? ` (${rotulo})` : ''
  if (!tabela || (!tabela.escritura && !tabela.registro)) {
    return {
      total: null,
      escritura: null,
      registro: null,
      completo: false,
      descricao: 'Confirmar com cartório — tabela de emolumentos não encontrada',
    }
  }
  const escritura = valorNoAto(tabela.escritura, preco)
  const registro = valorNoAto(tabela.registro, preco)
  if (escritura === null && registro === null) {
    return {
      total: null,
      escritura,
      registro,
      completo: false,
      descricao: `Confirmar com cartório — ${brl(preco)} fora das faixas da tabela${sufixo}`,
    }
  }
  const partes = [
    escritura === null ? 'escritura NÃO ENCONTRADA' : `Escritura ${brl(escritura)}`,
    registro === null ? 'registro NÃO ENCONTRADO' : `registro ${brl(registro)}`,
  ]
  return {
    total: (escritura ?? 0) + (registro ?? 0),
    escritura,
    registro,
    completo: escritura !== null && registro !== null,
    descricao: `${partes.join(' + ')}${sufixo}`,
  }
}

// ---------------------------------------------------------------------------
// Validação do que a IA devolve
// ---------------------------------------------------------------------------

function validarAto(bruto: unknown, nome: string): TabelaAto | null | string {
  const a = bruto as { faixas?: unknown; observacao?: unknown } | null | undefined
  const lista = a?.faixas
  if (!Array.isArray(lista) || lista.length === 0) return null // ato não achado: aceito, vira parcial
  const faixas: Faixa[] = []
  let abertas = 0
  for (const f of lista as Array<Record<string, unknown>>) {
    const ate = f.ate === null || f.ate === undefined ? null : Number(f.ate)
    if (ate !== null && !(ate > 0)) return `teto inválido em ${nome}: ${String(f.ate)}`
    const valor = f.valor === null || f.valor === undefined ? null : Number(f.valor)
    const percentual =
      f.percentual === null || f.percentual === undefined ? null : Number(f.percentual)
    if (valor === null && percentual === null) return `faixa de ${nome} sem valor nem percentual`
    if (valor !== null && !(valor > 0)) return `valor inválido em ${nome}: ${String(f.valor)}`
    if (percentual !== null && !(percentual > 0 && percentual < 0.2)) {
      // Acima de 20% do preço não é emolumento, é erro de leitura (percentual
      // veio em pontos, não em fração).
      return `percentual fora do razoável em ${nome}: ${String(f.percentual)}`
    }
    const num = (k: string) => (f[k] === null || f[k] === undefined ? null : Number(f[k]))
    if (ate === null) abertas++
    faixas.push({ ate, valor, percentual, fixo: num('fixo'), minimo: num('minimo'), maximo: num('maximo') })
  }
  if (abertas > 1) return `mais de uma faixa aberta em ${nome}`
  return {
    faixas,
    observacao: typeof a?.observacao === 'string' ? a.observacao : null,
  }
}

/**
 * Aceita a tabela que sirva ao cálculo. Ato sem faixas é ACEITO como ausente —
 * vira cartório parcial, dito na tela. O que não passa: valores inválidos,
 * percentual fora do razoável, mais de uma faixa aberta, e tabela SEM FONTE —
 * regra do dono: é preço público, e número sem procedência num deságio é pior
 * que célula vazia.
 */
function validar(bruto: unknown, fontes: string[]): TabelaEmolumentos | string {
  if (fontes.length === 0) return 'a IA não informou a fonte da tabela'
  const t = bruto as { escritura?: unknown; registro?: unknown }
  const escritura = validarAto(t?.escritura, 'escritura')
  if (typeof escritura === 'string') return escritura
  const registro = validarAto(t?.registro, 'registro')
  if (typeof registro === 'string') return registro
  if (!escritura && !registro) return 'sem faixas para escritura nem para registro'
  return { escritura, registro }
}

// ---------------------------------------------------------------------------
// A busca
// ---------------------------------------------------------------------------

const FAIXA_SCHEMA = {
  type: 'object',
  properties: {
    ate: { type: ['number', 'null'], description: 'Teto da faixa em reais; null na última faixa quando ela é "acima de X".' },
    valor: { type: ['number', 'null'], description: 'Emolumento FIXO da faixa, em reais, quando a tabela cobra valor fixo. Deixe null se a faixa é percentual.' },
    percentual: { type: ['number', 'null'], description: 'Quando a tabela cobra PERCENTUAL sobre o valor do ato: a fração (0,5% = 0.005). Deixe null se a faixa é de valor fixo.' },
    fixo: { type: ['number', 'null'], description: 'Parcela fixa somada ao percentual, em reais, se houver.' },
    minimo: { type: ['number', 'null'], description: 'Piso do emolumento na faixa percentual, em reais, se houver.' },
    maximo: { type: ['number', 'null'], description: 'Teto do emolumento na faixa percentual, em reais, se houver.' },
  },
  required: ['ate'],
}

const FERRAMENTA = {
  name: 'registrar_tabela_emolumentos',
  description:
    'Registra a tabela de emolumentos de cartório de uma UF, em faixas de valor (fixas ou percentuais), para escritura pública e para registro em títulos e documentos.',
  input_schema: {
    type: 'object' as const,
    properties: {
      escritura: {
        type: 'object',
        description:
          'ESCRITURA PÚBLICA COM CONTEÚDO ECONÔMICO (a tabela também chama de "com valor declarado" ou "com valor econômico"), no Tabelionato de Notas. É o ato da cessão de crédito. Faixas pelo valor do ato. Se não achou, devolva faixas VAZIAS.',
        properties: {
          faixas: { type: 'array', items: FAIXA_SCHEMA },
          observacao: { type: ['string', 'null'], description: 'O que somou (fundos, selo, taxa) ou o que a tabela cobra à parte. Curto.' },
        },
        required: ['faixas'],
      },
      registro: {
        type: 'object',
        description:
          'REGISTRO DO INSTRUMENTO no Registro de Títulos e Documentos (RTD) — a tabela costuma chamar de "registro de título com conteúdo econômico" ou "registro integral". Faixas pelo valor do título; se a tabela cobra por documento mais por página, converta para UM instrumento de 2 a 6 páginas e diga em observacao. Se não achou, devolva faixas VAZIAS.',
        properties: {
          faixas: { type: 'array', items: FAIXA_SCHEMA },
          observacao: { type: ['string', 'null'] },
        },
        required: ['faixas'],
      },
      fontes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Os endereços EXATOS das páginas de onde saíram os valores. Obrigatório. Sem fonte a tabela é descartada.',
      },
      vigencia: {
        type: ['string', 'null'],
        description: 'O período a que a tabela se refere, como a fonte descreve ("2026", "a partir de 01/01/2026").',
      },
    },
    required: ['escritura', 'registro', 'fontes', 'vigencia'],
  },
}

function sistema(uf: string, ano: number): string {
  return `Você levanta a tabela de emolumentos de cartório do estado ${uf} para o exercício de ${ano}, para dois atos: (1) ESCRITURA PÚBLICA COM CONTEÚDO ECONÔMICO no Tabelionato de Notas — é o ato da cessão de crédito; as tabelas a chamam de "escritura com valor declarado", "com valor econômico" ou "com conteúdo financeiro"; (2) REGISTRO DO INSTRUMENTO no Registro de Títulos e Documentos — "registro de título com conteúdo econômico" ou "registro integral".

ONDE PROCURAR, nesta ordem: o Tribunal de Justiça de ${uf} ou sua Corregedoria-Geral de Justiça (a tabela sai como provimento, portaria, ato normativo ou anexo de lei estadual de custas, e costuma ter um anexo por especialidade — procure o anexo de "Tabelionato de Notas" e o de "Registro de Títulos e Documentos"); o sindicato ou colégio de notários e registradores do estado; a ANOREG. Prefira a página oficial com a tabela inteira à notícia que a resume.

REGRAS:
1. NÃO INVENTE FAIXA NEM VALOR. Se não achou a tabela de ${ano}, use a mais recente em vigor e diga a vigência real. Se não achou um dos atos, devolva esse ato com "faixas" VAZIAS e explique em "observacao" — o outro ato entra sozinho. Se não achou nenhum, os dois vazios. Melhor incompleto que plausível: isto entra num cálculo de deságio.
2. FIXO OU PERCENTUAL, como a tabela cobra. Faixa de valor fixo -> "valor". Faixa que cobra percentual sobre o valor do ato -> "percentual" como FRAÇÃO (0,5% = 0.005), com "minimo"/"maximo" quando a tabela os fixa e "fixo" quando há parcela fixa somada. Muitas tabelas misturam: faixas baixas fixas e a última percentual — devolva cada faixa do jeito dela.
3. VALOR TOTAL. As tabelas separam emolumento, fundos estaduais, selo e taxa de fiscalização. Quando a fonte discrimina, some tudo e devolva o que o usuário paga; diga em "observacao" o que somou.
4. FAIXA ABERTA. A última costuma ser "acima de R$ X": devolva-a com "ate": null.
5. FONTE OBRIGATÓRIA. Todo valor precisa do endereço exato da página em "fontes". Tabela sem fonte é descartada por quem te chamou.
6. Responda chamando a ferramenta registrar_tabela_emolumentos uma única vez, ao final.`
}

async function buscarNaWeb(
  uf: string,
  ano: number,
  apiKey: string,
): Promise<{ tabela: TabelaEmolumentos | null; fontes: string[]; vigencia: string | null; motivo?: string }> {
  const anthropic = new Anthropic({ apiKey })
  const mensagens: Anthropic.MessageParam[] = [
    { role: 'user', content: `Levante a tabela de emolumentos de ${uf} para ${ano}.` },
  ]
  const pedir = () =>
    anthropic.messages
      .stream({
        model: MODELO,
        max_tokens: 8000,
        system: sistema(uf, ano),
        // `tool_choice` em 'auto' de propósito: forçar a ferramenta impediria a
        // busca, e sem busca não há tabela.
        tools: [
          FERRAMENTA,
          { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS },
        ],
        messages: mensagens,
      })
      .finalMessage()

  let resposta = await pedir()
  // O laço de amostragem do servidor tem teto próprio e devolve 'pause_turn' ao
  // bater nele; reenviar o turno pausado retoma de onde parou, sem mensagem nova.
  for (let i = 0; i < MAX_RETOMADAS && resposta.stop_reason === 'pause_turn'; i++) {
    mensagens.push({ role: 'assistant', content: resposta.content })
    resposta = await pedir()
  }

  const uso = resposta.content.find((c) => c.type === 'tool_use' && c.name === FERRAMENTA.name)
  if (!uso || uso.type !== 'tool_use') {
    return {
      tabela: null,
      fontes: [],
      vigencia: null,
      motivo:
        resposta.stop_reason === 'pause_turn'
          ? 'a busca não terminou dentro do limite de retomadas'
          : 'a IA não devolveu a tabela',
    }
  }
  const entrada = uso.input as { fontes?: unknown; vigencia?: unknown }
  const fontes = Array.isArray(entrada.fontes)
    ? (entrada.fontes as unknown[]).map(String).filter((f) => /^https?:\/\//i.test(f))
    : []
  const vigencia = typeof entrada.vigencia === 'string' ? entrada.vigencia : null
  const v = validar(uso.input, fontes)
  if (typeof v === 'string') return { tabela: null, fontes, vigencia, motivo: v }
  return { tabela: v, fontes, vigencia }
}

// ---------------------------------------------------------------------------
// Cache + busca
// ---------------------------------------------------------------------------

/**
 * A tabela de emolumentos de uma UF para o ano corrente.
 *
 * Cache primeiro (public.emolumentos_uf, migração 0053), busca web depois. As
 * duas operações de cache estão em try/catch de propósito: se a migração não
 * rodou, cada análise busca na web e segue — mais lenta, mas nunca barrada por
 * um passo manual que ficou para trás.
 *
 * TABELA PARCIAL NÃO VAI PARA O CACHE. Se só um ato foi achado, a próxima
 * análise da UF busca de novo — a chance de achar o que faltou vale mais que
 * os segundos poupados. O completo é gravado.
 */
export async function obterEmolumentos(
  ufBruta: unknown,
  apiKey: string,
  svc: SupabaseClient,
): Promise<Emolumentos> {
  const ano = new Date().getFullYear()
  const uf = normalizarUf(ufBruta)
  if (!uf) {
    return {
      uf: String(ufBruta ?? ''),
      ano,
      tabela: null,
      fontes: [],
      vigencia: null,
      origem: 'nenhuma',
      motivo: 'UF do tribunal não identificada nos autos',
    }
  }

  try {
    const { data } = await svc
      .from('emolumentos_uf')
      .select('tabela, fontes, vigencia')
      .eq('uf', uf)
      .eq('ano', ano)
      .maybeSingle()
    if (data?.tabela) {
      return {
        uf,
        ano,
        tabela: data.tabela as TabelaEmolumentos,
        fontes: (data.fontes as string[]) ?? [],
        vigencia: (data.vigencia as string | null) ?? null,
        origem: 'cache',
      }
    }
  } catch {
    /* cache indisponível (migração não rodou?): segue para a busca */
  }

  const achado = await buscarNaWeb(uf, ano, apiKey)
  if (!achado.tabela) {
    return { uf, ano, tabela: null, fontes: achado.fontes, vigencia: achado.vigencia, origem: 'nenhuma', motivo: achado.motivo }
  }

  const completa = !!achado.tabela.escritura && !!achado.tabela.registro
  if (completa) {
    try {
      await svc.from('emolumentos_uf').upsert(
        {
          uf,
          ano,
          tabela: achado.tabela,
          fontes: achado.fontes,
          vigencia: achado.vigencia,
          atualizado_por: 'gerar-analise-rpv',
        },
        { onConflict: 'uf,ano' },
      )
    } catch {
      /* sem cache: a próxima análise desta UF busca de novo */
    }
  }

  return { uf, ano, tabela: achado.tabela, fontes: achado.fontes, vigencia: achado.vigencia, origem: 'busca' }
}
