// Custo de cartório por UF: escritura pública de cessão + registro em títulos e
// documentos.
//
// O QUE SE EXTRAI É A REGRA, não um valor. A IA lê a tabela oficial do estado
// UMA VEZ, traduz o que é preciso para calcular — as faixas de valor e os
// acréscimos que incidem por cima — e a partir daí o custo de QUALQUER preço
// sai localmente, em microssegundos. Decisão do dono, e ela conserta a raiz de
// um problema que duas tentativas anteriores só contornaram.
//
// POR QUE AS DUAS ANTERIORES FALHARAM, para não se repetir:
//
//   1ª — pedir a tabela inteira, mas SEM abrir os documentos (só busca web) e
//        com um formato que só aceitava valor fixo por faixa. Em PE a escritura
//        tem componente percentual (a TSNR do art. 27 da Lei 11.404/96), e o
//        modelo respondeu "sem faixas" porque não tinha como expressar a regra
//        nem como ler o PDF. E eu ainda tinha escrito no prompt uma saída de
//        emergência ("devolva faixas vazias se não tiver certeza") — ele usou.
//
//   2ª — perguntar "quanto custa para ESTE preço". Achava o número, mas o custo
//        entra no cálculo do preço e o preço muda quando o custo entra: cada
//        mudança exigia nova consulta de 140 s, o preço oscilava na fronteira
//        das faixas e às vezes ficava com o emolumento da faixa errada. Caso
//        real de PE: consulta em R$ 51.129 (faixa 50–55 mil), preço final
//        R$ 44.791 (faixa 40–45 mil), emolumento embutido R$ 1.935,19 quando o
//        devido era R$ 1.611,88.
//
// AGORA A REGRA ENTRA DENTRO DA CALIBRAGEM. O motor testa milhares de preços
// procurando o deságio que bate a meta, e cada um já sai com o cartório da SUA
// faixa. Não há convergência a fazer, nem reconsulta quando o preço muda, nem
// oscilação: o preço sai exato na primeira passada.
//
// O que tornou isto possível e não era verdade na 1ª tentativa: web_fetch. Sem
// abrir o anexo do provimento, a busca devolve só o cabeçalho e as notas — as
// linhas numéricas ficam dentro do arquivo.
//
// COMPARTILHADO (_shared) de propósito: a etapa de Precificação do precatório
// vai precisar exatamente disto.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

const MODELO = 'claude-opus-5'
/** Tetos das ferramentas de servidor: achar a norma custa buscas, ler o anexo custa fetches. */
const MAX_BUSCAS = 10
const MAX_FETCHES = 6
const MAX_RETOMADAS = 3

// ---------------------------------------------------------------------------
// O formato da regra
// ---------------------------------------------------------------------------

/**
 * Uma faixa da tabela: até tal valor, o emolumento é este.
 *
 * `valor` OU `percentual` — as tabelas estaduais usam as duas formas, e algumas
 * misturam (percentual sobre o valor, com piso e teto). Aceitar só valor fixo
 * foi o que quebrou a primeira tentativa em Pernambuco.
 */
export interface Faixa {
  /** Teto da faixa em reais; null = faixa aberta ("acima de X"). */
  ate: number | null
  /** Emolumento fixo da faixa. */
  valor?: number | null
  /** Ou percentual sobre o valor do ato, como FRAÇÃO (0.005 = 0,5%). */
  percentual?: number | null
  /** Parcela fixa somada ao percentual. */
  fixo?: number | null
  /** Piso e teto do resultado, quando a faixa é percentual. */
  minimo?: number | null
  maximo?: number | null
}

/**
 * Uma taxa que incide POR CIMA do emolumento — TSNR, selo, fundo, taxa de
 * fiscalização. Vários estados as cobram à parte, e o balcão soma tudo.
 *
 * `teto_emolumento` existe por causa de PE: a TSNR "nunca pode ser superior ao
 * próprio emolumento do ato" (art. 27, Lei 11.404/96). Sem esse campo, o custo
 * sairia maior que o devido nas faixas baixas.
 */
export interface Acrescimo {
  nome: string
  /** Fração. 0.002 = 0,2%. */
  percentual: number
  /** Sobre o que incide: o valor do ato, ou o emolumento já calculado. */
  base: 'valor' | 'emolumento'
  minimo?: number | null
  maximo?: number | null
  teto_emolumento?: boolean | null
}

export interface RegraAto {
  faixas: Faixa[]
  acrescimos?: Acrescimo[]
  observacao?: string | null
}

/** A regra completa do estado. Ato ausente = a IA não achou tabela confiável para ele. */
export interface RegraEmolumentos {
  escritura: RegraAto | null
  registro: RegraAto | null
}

export interface Emolumentos {
  uf: string
  ano: number
  regra: RegraEmolumentos | null
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

// ---------------------------------------------------------------------------
// Aplicar a regra — a função que a calibragem chama milhares de vezes
// ---------------------------------------------------------------------------

/**
 * Faixas ordenadas por teto, com a aberta por último — memorizadas POR ATO.
 *
 * A calibragem consulta milhares de vezes por análise. Ordenar a cada consulta
 * eram dezenas de milhares de cópias de array por requisição — CPU pura, no
 * worker que já devolveu HTTP 546 uma vez. WeakMap: a entrada some junto com a
 * regra, sem cache a administrar.
 */
const ordenadas = new WeakMap<RegraAto, Faixa[]>()

function faixasOrdenadas(ato: RegraAto): Faixa[] {
  const memo = ordenadas.get(ato)
  if (memo) return memo
  const f = [...ato.faixas].sort((a, b) => {
    if (a.ate === null) return 1
    if (b.ate === null) return -1
    return a.ate - b.ate
  })
  ordenadas.set(ato, f)
  return f
}

/** O emolumento de um ato para um valor, já com os acréscimos. */
function custoDoAto(ato: RegraAto | null, valor: number): number | null {
  if (!ato || ato.faixas.length === 0) return null
  const f = faixasOrdenadas(ato).find((x) => x.ate === null || valor <= x.ate)
  if (!f) return null

  let emolumento: number
  if (f.valor != null) emolumento = f.valor
  else if (f.percentual != null) {
    emolumento = valor * f.percentual + (f.fixo ?? 0)
    if (f.minimo != null) emolumento = Math.max(emolumento, f.minimo)
    if (f.maximo != null) emolumento = Math.min(emolumento, f.maximo)
  } else return null

  let total = emolumento
  for (const a of ato.acrescimos ?? []) {
    let v = (a.base === 'emolumento' ? emolumento : valor) * a.percentual
    if (a.minimo != null) v = Math.max(v, a.minimo)
    if (a.maximo != null) v = Math.min(v, a.maximo)
    // "nunca superior ao próprio emolumento do ato" — regra da TSNR em PE.
    if (a.teto_emolumento) v = Math.min(v, emolumento)
    total += v
  }
  return total
}

export interface CustoCartorio {
  total: number | null
  escritura: number | null
  registro: number | null
  /** Os DOIS atos entraram. Falso = parcial, e a descrição diz o que faltou. */
  completo: boolean
  descricao: string
}

/**
 * Custo de cartório para um preço de cessão: escritura + registro.
 *
 * Pura e instantânea — é o que permite chamá-la de dentro do laço de calibragem
 * e ter o preço certo já na primeira passada, sem consulta nenhuma.
 *
 * `total` soma o que se conhece; null só quando nenhum dos dois atos foi achado.
 * Ato faltando vira custo PARCIAL: somar metade avisando é melhor que sumir com
 * o custo do preço.
 */
export function custoParaPreco(
  regra: RegraEmolumentos | null,
  preco: number,
  rotulo?: string,
): CustoCartorio {
  const sufixo = rotulo ? ` (${rotulo})` : ''
  if (!regra || (!regra.escritura && !regra.registro)) {
    return {
      total: null, escritura: null, registro: null, completo: false,
      descricao: 'Confirmar com cartório — tabela de emolumentos não encontrada',
    }
  }
  const escritura = custoDoAto(regra.escritura, preco)
  const registro = custoDoAto(regra.registro, preco)
  if (escritura === null && registro === null) {
    return {
      total: null, escritura, registro, completo: false,
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

function validarAto(bruto: unknown, nome: string): RegraAto | null | string {
  const a = bruto as { faixas?: unknown; acrescimos?: unknown; observacao?: unknown } | null | undefined
  const lista = a?.faixas
  if (!Array.isArray(lista) || lista.length === 0) return null // ato não achado: vira parcial

  const faixas: Faixa[] = []
  let abertas = 0
  for (const f of lista as Array<Record<string, unknown>>) {
    const ate = f.ate === null || f.ate === undefined ? null : Number(f.ate)
    if (ate !== null && !(ate > 0)) return `teto inválido em ${nome}: ${String(f.ate)}`
    const valor = f.valor === null || f.valor === undefined ? null : Number(f.valor)
    const percentual = f.percentual === null || f.percentual === undefined ? null : Number(f.percentual)
    if (valor === null && percentual === null) return `faixa de ${nome} sem valor nem percentual`
    if (valor !== null && !(valor > 0)) return `valor inválido em ${nome}: ${String(f.valor)}`
    // Teto de 20%: emolumento é ordem de centenas sobre dezenas de milhares.
    // Percentual acima disso é leitura errada, e entraria direto no deságio.
    if (percentual !== null && !(percentual > 0 && percentual < 0.2)) {
      return `percentual implausível em ${nome}: ${String(f.percentual)}`
    }
    if (ate === null) abertas++
    faixas.push({
      ate, valor, percentual,
      fixo: f.fixo == null ? null : Number(f.fixo),
      minimo: f.minimo == null ? null : Number(f.minimo),
      maximo: f.maximo == null ? null : Number(f.maximo),
    })
  }
  if (abertas > 1) return `mais de uma faixa aberta em ${nome}`

  const acrescimos: Acrescimo[] = []
  for (const x of Array.isArray(a?.acrescimos) ? (a!.acrescimos as Array<Record<string, unknown>>) : []) {
    const percentual = Number(x?.percentual)
    // Acréscimo implausível é DESCARTADO, não invalida a regra: perder uma taxa
    // acessória custa alguns reais no preço; perder a tabela inteira custa o
    // cartório todo.
    if (!(percentual > 0 && percentual < 0.2)) continue
    acrescimos.push({
      nome: String(x?.nome ?? 'acréscimo'),
      percentual,
      base: x?.base === 'emolumento' ? 'emolumento' : 'valor',
      minimo: x?.minimo == null ? null : Number(x.minimo),
      maximo: x?.maximo == null ? null : Number(x.maximo),
      teto_emolumento: x?.teto_emolumento === true,
    })
  }

  return {
    faixas,
    acrescimos,
    observacao: typeof a?.observacao === 'string' ? a.observacao : null,
  }
}

// ---------------------------------------------------------------------------
// A extração
// ---------------------------------------------------------------------------

const FAIXA_SCHEMA = {
  type: 'array',
  description:
    'As linhas da tabela, na ordem. Copie TODAS as faixas que cubram valores de R$ 1.000 a R$ 500.000 — é a janela em que as cessões caem.',
  items: {
    type: 'object',
    properties: {
      ate: { type: ['number', 'null'], description: 'Teto da faixa em reais; null na última quando ela é "acima de X".' },
      valor: { type: ['number', 'null'], description: 'Emolumento FIXO da faixa, em reais. Use este quando a tabela dá um valor pronto.' },
      percentual: { type: ['number', 'null'], description: 'Ou o percentual sobre o valor do ato, como FRAÇÃO (0,5% = 0.005). Use quando a tabela cobra percentual em vez de valor fixo.' },
      fixo: { type: ['number', 'null'], description: 'Parcela fixa somada ao percentual, se houver.' },
      minimo: { type: ['number', 'null'], description: 'Piso do resultado, se a tabela declarar.' },
      maximo: { type: ['number', 'null'], description: 'Teto do resultado, se a tabela declarar.' },
    },
    required: ['ate', 'valor', 'percentual'],
  },
}

const ACRESCIMO_SCHEMA = {
  type: 'array',
  description:
    'Taxas que incidem POR CIMA do emolumento e que o balcão soma: TSNR, taxa de fiscalização, selo, fundos estaduais. Lista vazia se a tabela já traz tudo embutido no valor da faixa.',
  items: {
    type: 'object',
    properties: {
      nome: { type: 'string' },
      percentual: { type: 'number', description: 'Fração. 0,2% = 0.002.' },
      base: { type: 'string', enum: ['valor', 'emolumento'], description: 'Incide sobre o valor do ato ou sobre o emolumento já calculado.' },
      minimo: { type: ['number', 'null'] },
      maximo: { type: ['number', 'null'], description: 'Teto em reais, se houver.' },
      teto_emolumento: { type: ['boolean', 'null'], description: 'True quando a lei diz que a taxa não pode superar o próprio emolumento do ato.' },
    },
    required: ['nome', 'percentual', 'base'],
  },
}

const FERRAMENTA = {
  name: 'registrar_regra_emolumentos',
  description:
    'Registra a REGRA de cálculo dos emolumentos de um estado: as faixas de valor e os acréscimos, para escritura pública e para registro em títulos e documentos.',
  input_schema: {
    type: 'object' as const,
    properties: {
      escritura: {
        type: 'object',
        description: 'Escritura pública COM conteúdo financeiro (é o ato da cessão de crédito), no Tabelionato de Notas.',
        properties: { faixas: FAIXA_SCHEMA, acrescimos: ACRESCIMO_SCHEMA, observacao: { type: ['string', 'null'] } },
        required: ['faixas'],
      },
      registro: {
        type: 'object',
        description: 'Registro do instrumento no Registro de Títulos e Documentos (RTD), para um instrumento de cessão típico (2 a 6 páginas).',
        properties: { faixas: FAIXA_SCHEMA, acrescimos: ACRESCIMO_SCHEMA, observacao: { type: ['string', 'null'] } },
        required: ['faixas'],
      },
      vigencia: { type: ['string', 'null'], description: 'Período da tabela, como a fonte descreve ("2026", "a partir de 01/01/2026").' },
      observacao: { type: ['string', 'null'], description: 'Como você leu a tabela e o que ficou de fora. Duas ou três frases.' },
      fontes: { type: 'array', items: { type: 'string' }, description: 'Endereços EXATOS de onde saiu cada coisa. Obrigatório.' },
    },
    required: ['escritura', 'registro', 'vigencia', 'observacao', 'fontes'],
  },
}

function sistema(uf: string, ano: number): string {
  return `Você levanta a REGRA DE CÁLCULO dos emolumentos de cartório do estado ${uf}, vigente em ${ano}, para dois atos: (1) ESCRITURA PÚBLICA com conteúdo financeiro, no Tabelionato de Notas — é o ato de uma cessão de crédito; (2) REGISTRO do instrumento no Registro de Títulos e Documentos.

Quem te chama vai aplicar essa regra a MUITOS valores diferentes, sem te consultar de novo. Por isso o que se pede não é um valor: é a TABELA e as taxas que incidem sobre ela.

ONDE PROCURAR, nesta ordem: o Tribunal de Justiça de ${uf} ou a Corregedoria-Geral de Justiça — a tabela é publicada por eles, como provimento, portaria, ato normativo ou anexo de lei estadual; depois o sindicato ou colégio de notários e registradores; depois a ANOREG.

ABRA O DOCUMENTO. A busca devolve o cabeçalho e as notas explicativas; as LINHAS NUMÉRICAS da tabela estão dentro do arquivo, em geral um PDF anexo. Use web_fetch para abrir o anexo e ler as linhas. Não desista na busca: a tabela existe e é pública.

O QUE DEVOLVER:
1. AS FAIXAS. Copie as linhas da tabela na janela de valores que interessa — de R$ 1.000 a R$ 500.000, que é onde as cessões caem. Cada linha vira uma entrada com "ate" (o teto daquela linha) e "valor" (o emolumento). Se a tabela cobra PERCENTUAL em vez de valor fixo, use "percentual" (como fração) com "minimo" e "maximo" quando ela declarar piso e teto.
2. OS ACRÉSCIMOS. Muitas tabelas cobram, por cima do emolumento, uma taxa de fiscalização, selo ou fundo estadual — e é isso que o balcão soma. Devolva cada uma em "acrescimos", com o percentual, sobre o que incide, e os limites. Se a lei disser que a taxa não pode superar o próprio emolumento do ato, marque "teto_emolumento". Se a tabela já traz tudo embutido no valor da faixa, devolva lista vazia e diga isso em "observacao".
3. MOSTRE COMO LEU, em "observacao": qual documento, qual tabela dentro dele, o que somou e o que deixou de fora.
4. FONTE OBRIGATÓRIA. Sem o endereço da página, o resultado é descartado: emolumento é preço público e estes números entram num cálculo de deságio.

NÃO INVENTE FAIXA NEM PERCENTUAL. Se a tabela de ${ano} não estiver disponível, use a mais recente vigente e diga a vigência real. Se conseguiu ler um dos dois atos e não o outro, devolva o que leu e explique o que faltou — meio custo com origem clara é útil. Só devolva faixas vazias nos DOIS atos se realmente não achou a tabela do estado; e nesse caso diga em "observacao" onde procurou.

Responda chamando a ferramenta registrar_regra_emolumentos uma única vez, ao final.`
}

async function extrairRegra(
  uf: string,
  ano: number,
  apiKey: string,
): Promise<{ regra: RegraEmolumentos | null; fontes: string[]; vigencia: string | null; observacao: string | null; motivo?: string }> {
  const anthropic = new Anthropic({ apiKey })
  const mensagens: Anthropic.MessageParam[] = [
    { role: 'user', content: `Levante a regra de emolumentos de ${uf} para ${ano}: as faixas da escritura pública com conteúdo financeiro, as do registro em RTD, e os acréscimos.` },
  ]
  const pedir = () =>
    anthropic.messages
      .stream({
        model: MODELO,
        max_tokens: 12000,
        system: sistema(uf, ano),
        // 'auto': forçar a ferramenta impediria a busca, e sem busca não há tabela.
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

  const vazio = { regra: null, fontes: [] as string[], vigencia: null, observacao: null }
  const uso = resposta.content.find((c) => c.type === 'tool_use' && c.name === FERRAMENTA.name)
  if (!uso || uso.type !== 'tool_use') {
    return {
      ...vazio,
      motivo: resposta.stop_reason === 'pause_turn'
        ? 'a busca não terminou dentro do limite de retomadas'
        : 'a IA não devolveu a regra',
    }
  }

  const e = uso.input as Record<string, unknown>
  const fontes = Array.isArray(e.fontes)
    ? (e.fontes as unknown[]).map(String).filter((f) => /^https?:\/\//i.test(f))
    : []
  const observacao = typeof e.observacao === 'string' ? e.observacao : null
  const vigencia = typeof e.vigencia === 'string' ? e.vigencia : null
  if (fontes.length === 0) return { ...vazio, observacao, motivo: 'a IA não informou a fonte' }

  const escritura = validarAto(e.escritura, 'escritura')
  if (typeof escritura === 'string') return { ...vazio, fontes, observacao, motivo: escritura }
  const registro = validarAto(e.registro, 'registro')
  if (typeof registro === 'string') return { ...vazio, fontes, observacao, motivo: registro }
  if (!escritura && !registro) {
    return {
      ...vazio, fontes, observacao,
      motivo: observacao ? `a IA não achou as tabelas (${observacao})` : 'a IA não achou as tabelas do estado',
    }
  }
  return { regra: { escritura, registro }, fontes, vigencia, observacao }
}

// ---------------------------------------------------------------------------
// Cache + extração
// ---------------------------------------------------------------------------

/**
 * A regra de emolumentos de uma UF, do cache ou da web.
 *
 * UMA EXTRAÇÃO POR UF E ANO, e só. Depois disso todo preço se calcula
 * localmente. O cache está em try/catch: sem a migração 0053, extrai toda vez e
 * segue — mais lento, nunca barrado por um passo manual que ficou para trás.
 */
export async function obterRegra(
  ufBruta: unknown,
  apiKey: string,
  svc: SupabaseClient,
): Promise<Emolumentos> {
  const ano = new Date().getFullYear()
  const uf = normalizarUf(ufBruta)
  if (!uf) {
    return {
      uf: String(ufBruta ?? ''), ano, regra: null, fontes: [], vigencia: null, observacao: null,
      origem: 'nenhuma', motivo: 'UF do tribunal não identificada nos autos',
    }
  }

  try {
    const { data } = await svc
      .from('emolumentos_uf')
      .select('tabela, fontes, vigencia')
      .eq('uf', uf).eq('ano', ano).maybeSingle()
    const guardada = (data?.tabela as { regra?: RegraEmolumentos; observacao?: string } | null) ?? null
    if (guardada?.regra) {
      return {
        uf, ano, regra: guardada.regra,
        fontes: (data?.fontes as string[]) ?? [],
        vigencia: (data?.vigencia as string | null) ?? null,
        observacao: guardada.observacao ?? null,
        origem: 'cache',
      }
    }
  } catch {
    /* cache indisponível (migração não rodou?): segue para a extração */
  }

  const achado = await extrairRegra(uf, ano, apiKey)
  if (!achado.regra) {
    return {
      uf, ano, regra: null, fontes: achado.fontes, vigencia: achado.vigencia,
      observacao: achado.observacao, origem: 'nenhuma', motivo: achado.motivo,
    }
  }

  try {
    await svc.from('emolumentos_uf').upsert(
      {
        uf, ano,
        tabela: { regra: achado.regra, observacao: achado.observacao },
        fontes: achado.fontes,
        vigencia: achado.vigencia,
        atualizado_por: 'gerar-analise-rpv',
      },
      { onConflict: 'uf,ano' },
    )
  } catch {
    /* sem cache: a próxima análise desta UF extrai de novo */
  }

  return {
    uf, ano, regra: achado.regra, fontes: achado.fontes, vigencia: achado.vigencia,
    observacao: achado.observacao, origem: 'busca',
  }
}
