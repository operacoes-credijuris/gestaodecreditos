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
// O QUE ESTE MÓDULO DEVOLVE É UMA TABELA DE FAIXAS, não um número. A calibragem
// do deságio testa milhares de preços de cessão em sequência, e o emolumento
// depende do preço — então o motor precisa da função preço->custo, não de um
// valor pronto. `emolumentoDaTabela` é essa função.
//
// COMPARTILHADO (_shared) de propósito: a etapa de Precificação do precatório
// vai precisar exatamente da mesma coisa, e duas cópias desta busca achariam
// duas tabelas diferentes para o mesmo estado.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

const MODELO = 'claude-opus-5'
/** Teto de buscas e de retomadas — ambos pelo teto de tempo da Edge Function. */
const MAX_BUSCAS = 6
const MAX_RETOMADAS = 2

export interface Faixa {
  /** Limite superior da faixa em reais; null = faixa aberta ("acima de X"). */
  ate: number | null
  valor: number
}
export interface TabelaAto {
  faixas: Faixa[]
  observacao?: string | null
}
export interface TabelaEmolumentos {
  escritura: TabelaAto
  registro: TabelaAto
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

function valorNaFaixa(ato: TabelaAto, preco: number): number | null {
  // Ordena por teto, com a faixa aberta por último: a primeira que couber é a certa.
  const faixas = [...ato.faixas].sort((a, b) => {
    if (a.ate === null) return 1
    if (b.ate === null) return -1
    return a.ate - b.ate
  })
  const f = faixas.find((x) => x.ate === null || preco <= x.ate)
  return f ? f.valor : null
}

/**
 * Custo total de cartório para um preço de cessão: escritura + registro.
 *
 * `total` null quando a tabela não existe ou o preço não cabe em faixa nenhuma
 * (tabela sem faixa aberta e preço acima da última). Quem chama decide o que
 * fazer com null — o motor de RPV precifica SEM o cartório e marca "a
 * confirmar", que é a convenção que ele já tinha para o caso desconhecido.
 */
export function emolumentoDaTabela(
  tabela: TabelaEmolumentos | null,
  preco: number,
  rotulo?: string,
): { total: number | null; escritura: number | null; registro: number | null; descricao: string } {
  if (!tabela) {
    return {
      total: null,
      escritura: null,
      registro: null,
      descricao: 'Confirmar com cartório — tabela de emolumentos não encontrada',
    }
  }
  const escritura = valorNaFaixa(tabela.escritura, preco)
  const registro = valorNaFaixa(tabela.registro, preco)
  if (escritura === null || registro === null) {
    return {
      total: null,
      escritura,
      registro,
      descricao: `Confirmar com cartório — ${brl(preco)} fora das faixas da tabela${rotulo ? ` (${rotulo})` : ''}`,
    }
  }
  return {
    total: escritura + registro,
    escritura,
    registro,
    descricao: `Escritura ${brl(escritura)} + registro ${brl(registro)}${rotulo ? ` (${rotulo})` : ''}`,
  }
}

// ---------------------------------------------------------------------------
// Validação do que a IA devolve
// ---------------------------------------------------------------------------

/**
 * Aceita só tabela que sirva ao cálculo: cada ato com pelo menos uma faixa,
 * valores positivos, tetos crescentes e no máximo uma faixa aberta. E fonte —
 * tabela sem link de origem não entra, por regra do dono: é preço público, e
 * número sem procedência num deságio é pior que célula vazia.
 */
function validar(bruto: unknown, fontes: string[]): TabelaEmolumentos | string {
  if (fontes.length === 0) return 'a IA não informou a fonte da tabela'
  const t = bruto as Partial<Record<'escritura' | 'registro', { faixas?: unknown; observacao?: unknown }>>
  const saida: Partial<TabelaEmolumentos> = {}
  for (const ato of ['escritura', 'registro'] as const) {
    const lista = t?.[ato]?.faixas
    if (!Array.isArray(lista) || lista.length === 0) return `sem faixas para ${ato}`
    const faixas: Faixa[] = []
    let abertas = 0
    for (const f of lista as Array<Record<string, unknown>>) {
      const valor = Number(f.valor)
      const ate = f.ate === null || f.ate === undefined ? null : Number(f.ate)
      if (!(valor > 0)) return `valor inválido em ${ato}: ${String(f.valor)}`
      if (ate !== null && !(ate > 0)) return `teto inválido em ${ato}: ${String(f.ate)}`
      if (ate === null) abertas++
      faixas.push({ ate, valor })
    }
    if (abertas > 1) return `mais de uma faixa aberta em ${ato}`
    saida[ato] = {
      faixas,
      observacao: typeof t?.[ato]?.observacao === 'string' ? (t[ato]!.observacao as string) : null,
    }
  }
  return saida as TabelaEmolumentos
}

// ---------------------------------------------------------------------------
// A busca
// ---------------------------------------------------------------------------

const FERRAMENTA = {
  name: 'registrar_tabela_emolumentos',
  description:
    'Registra a tabela de emolumentos de cartório de uma UF, em faixas de valor, para escritura pública e para registro em títulos e documentos.',
  input_schema: {
    type: 'object' as const,
    properties: {
      escritura: {
        type: 'object',
        description:
          'Escritura pública COM conteúdo financeiro (é o caso da cessão de crédito), no Tabelionato de Notas. Faixas pelo valor declarado do ato.',
        properties: {
          faixas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ate: { type: ['number', 'null'], description: 'Teto da faixa em reais; null na última faixa quando ela é "acima de X".' },
                valor: { type: 'number', description: 'Emolumento TOTAL da faixa em reais, já com os acréscimos que a tabela oficial soma ao emolumento (fundos, selo, taxa de fiscalização), quando a fonte os discrimina.' },
              },
              required: ['ate', 'valor'],
            },
          },
          observacao: { type: ['string', 'null'], description: 'O que a tabela diz que a faixa NÃO inclui, ou regra que muda o valor (ex.: percentual sobre o excedente). Curto.' },
        },
        required: ['faixas'],
      },
      registro: {
        type: 'object',
        description:
          'Registro do instrumento no Registro de Títulos e Documentos (RTD). Faixas pelo valor do título; quando a tabela cobra por documento mais por página, converta para o valor de UM instrumento de cessão típico (2 a 6 páginas) e diga isso em observacao.',
        properties: {
          faixas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ate: { type: ['number', 'null'] },
                valor: { type: 'number' },
              },
              required: ['ate', 'valor'],
            },
          },
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
  return `Você levanta a tabela de emolumentos de cartório do estado ${uf} para o exercício de ${ano}, para dois atos: (1) escritura pública COM conteúdo financeiro no Tabelionato de Notas — é o ato da cessão de crédito; (2) registro do instrumento no Registro de Títulos e Documentos.

ONDE PROCURAR, nesta ordem: o Tribunal de Justiça de ${uf} (a tabela de emolumentos é publicada por ele ou pela Corregedoria-Geral de Justiça, em geral como provimento, portaria ou anexo de lei estadual); o sindicato ou colégio de notários e registradores do estado; a ANOREG. Prefira a página oficial que traz a tabela inteira à notícia que a resume.

REGRAS:
1. NÃO INVENTE FAIXA NEM VALOR. Se não achou a tabela de ${uf} para ${ano}, procure a mais recente vigente e diga a vigência real em "vigencia". Se não achou tabela nenhuma confiável, chame a ferramenta com "faixas" VAZIAS nos dois atos e explique em "observacao" — é melhor que um número plausível, porque este valor entra num cálculo de deságio.
2. VALOR TOTAL DA FAIXA. As tabelas costumam separar emolumento, fundos estaduais, selo e taxa de fiscalização. Quando a fonte discrimina, some tudo e devolva o total que o usuário paga; diga em "observacao" o que somou.
3. FAIXA ABERTA. A última faixa costuma ser "acima de R$ X": devolva-a com "ate": null. Se a tabela cobra percentual sobre o excedente em vez de valor fixo, devolva o valor fixo da faixa e explique o percentual em "observacao".
4. FONTE OBRIGATÓRIA. Todo valor precisa do endereço exato da página em "fontes". Tabela sem fonte é descartada por quem te chamou.
5. Responda chamando a ferramenta registrar_tabela_emolumentos uma única vez, ao final.`
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

  return { uf, ano, tabela: achado.tabela, fontes: achado.fontes, vigencia: achado.vigencia, origem: 'busca' }
}
