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

// ---------------------------------------------------------------------------
// O formato da regra e o cálculo — em arquivo próprio, sem dependências, para
// os testes poderem alcançá-los. Reexportados aqui para não mexer em quem
// importa deste módulo.
// ---------------------------------------------------------------------------
import {
  custoParaPreco,
  normalizarUf,
  type Acrescimo,
  type CustoCartorio,
  type Faixa,
  type RegraAto,
  type RegraEmolumentos,
} from './emolumentos-calculo.ts'

export {
  custoParaPreco,
  normalizarUf,
  type Acrescimo,
  type CustoCartorio,
  type Faixa,
  type RegraAto,
  type RegraEmolumentos,
}

// ---------------------------------------------------------------------------
// O estado do levantamento
// ---------------------------------------------------------------------------

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

/**
 * Em que pé está o levantamento de uma UF — o que a tela precisa saber.
 *
 *   pronta     -> `emolumentos.regra` tem a regra; pode precificar
 *   levantando -> a pesquisa roda AGORA em segundo plano; volte a perguntar
 *   falhou     -> acabou sem achar; `emolumentos.motivo` diz o quê
 *   sem_uf     -> não dá para saber de que estado é o crédito
 */
export type EstadoLevantamento = 'pronta' | 'levantando' | 'falhou' | 'sem_uf'

export interface RespostaEmolumentos {
  estado: EstadoLevantamento
  emolumentos: Emolumentos | null
  /** Segundos sugeridos até a próxima pergunta, quando `levantando`. */
  reconsultar_em?: number
  /** Em que etapa está, em português — a tela mostra em vez de só "aguarde". */
  etapa?: string
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
      de: f.de == null ? null : Number(f.de),
      ate, valor, percentual,
      fixo: f.fixo == null ? null : Number(f.fixo),
      sobre_excedente: f.sobre_excedente === true,
      minimo: f.minimo == null ? null : Number(f.minimo),
      maximo: f.maximo == null ? null : Number(f.maximo),
    })
  }
  if (abertas > 1) return `mais de uma faixa aberta em ${nome}`

  const acrescimos: Acrescimo[] = []
  for (const x of Array.isArray(a?.acrescimos) ? (a!.acrescimos as Array<Record<string, unknown>>) : []) {
    const percentual = x?.percentual == null ? null : Number(x.percentual)
    const valorFixo = x?.valor == null ? null : Number(x.valor)
    // Acréscimo implausível é DESCARTADO, não invalida a regra: perder uma taxa
    // acessória custa alguns reais no preço; perder a tabela inteira custa o
    // cartório todo. Teto de 20% no percentual e de R$ 5.000 no valor fixo —
    // selo é ordem de reais a dezenas de reais.
    const pctOk = percentual !== null && percentual > 0 && percentual < 0.2
    const valOk = valorFixo !== null && valorFixo > 0 && valorFixo < 5000
    if (!pctOk && !valOk) continue
    acrescimos.push({
      nome: String(x?.nome ?? 'acréscimo'),
      percentual: pctOk ? percentual : null,
      valor: valOk ? valorFixo : null,
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
// O que a IA devolve, por etapa
// ---------------------------------------------------------------------------

const FAIXA_SCHEMA = {
  type: 'array',
  description: 'As linhas da tabela na janela de valores que interessa (R$ 1.000 a R$ 500.000).',
  items: {
    type: 'object',
    properties: {
      de: { type: ['number', 'null'], description: 'Piso da faixa em reais, como impresso na tabela ("De R$ 50.000,01 a ..." -> 50000.01). Obrigatório quando o percentual incide sobre o excedente.' },
      ate: { type: ['number', 'null'], description: 'Teto da faixa em reais; null na última quando ela é "acima de X".' },
      valor: { type: ['number', 'null'], description: 'Emolumento FIXO da faixa, em reais. Use este quando a tabela dá um valor pronto.' },
      percentual: { type: ['number', 'null'], description: 'Ou o percentual sobre o valor do ato, como FRAÇÃO (0,5% = 0.005). Use quando a tabela cobra percentual em vez de valor fixo.' },
      fixo: { type: ['number', 'null'], description: 'Parcela fixa somada ao percentual, se houver ("R$ 500 mais 0,5% sobre...").' },
      sobre_excedente: { type: ['boolean', 'null'], description: 'True quando o percentual incide só sobre o que EXCEDE o piso da faixa ("mais 0,5% sobre o que exceder R$ 50.000"). Nesse caso preencha "de" também. False ou ausente = o percentual incide sobre o valor inteiro.' },
      minimo: { type: ['number', 'null'], description: 'Piso do resultado, se a tabela declarar.' },
      maximo: { type: ['number', 'null'], description: 'Teto do resultado, se a tabela declarar.' },
    },
    required: ['de', 'ate', 'valor', 'percentual'],
  },
}

const ACRESCIMO_SCHEMA = {
  type: 'array',
  description: 'Taxas que incidem POR CIMA do emolumento (fiscalização, selo, fundo estadual). Lista vazia se a tabela já traz tudo embutido.',
  items: {
    type: 'object',
    properties: {
      nome: { type: 'string' },
      percentual: { type: ['number', 'null'], description: 'Fração, quando a taxa é percentual. 0,2% = 0.002.' },
      valor: { type: ['number', 'null'], description: 'Ou um VALOR FIXO em reais por ato — é o caso do selo digital de vários estados. Preencha um ou outro, não os dois.' },
      base: { type: 'string', enum: ['valor', 'emolumento'], description: 'Para o percentual: incide sobre o valor do ato ou sobre o emolumento já calculado.' },
      minimo: { type: ['number', 'null'] },
      maximo: { type: ['number', 'null'], description: 'Teto em reais, se houver.' },
      teto_emolumento: { type: ['boolean', 'null'], description: 'True quando a lei diz que a taxa não pode superar o próprio emolumento do ato.' },
    },
    required: ['nome', 'base'],
  },
}

/** Etapa 1: só ACHAR o documento. Nada de faixas ainda. */
const FERRAMENTA_ACHAR = {
  name: 'registrar_documentos',
  description: 'Registra onde está a tabela oficial de emolumentos do estado.',
  input_schema: {
    type: 'object' as const,
    properties: {
      documentos: {
        type: 'array',
        description: 'De um a três endereços, do mais provável para o menos. Prefira o arquivo com as LINHAS NUMÉRICAS (em geral um PDF anexo), não a página que fala dele.',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Endereço completo, começando com http.' },
            descricao: { type: 'string', description: 'Que documento é (provimento, portaria, anexo da lei) e por que você acha que é o certo.' },
          },
          required: ['url', 'descricao'],
        },
      },
      vigencia: { type: ['string', 'null'], description: 'Período da tabela, como a fonte descreve ("2026", "a partir de 01/01/2026").' },
      observacao: { type: ['string', 'null'], description: 'Onde procurou e o que encontrou. Duas ou três frases.' },
    },
    required: ['documentos'],
  },
}

/** Etapas 2 e 3: extrair UM ato do documento já localizado. */
const FERRAMENTA_ATO = {
  name: 'registrar_ato',
  description: 'Registra a regra de cálculo de um ato de cartório.',
  input_schema: {
    type: 'object' as const,
    properties: {
      faixas: FAIXA_SCHEMA,
      acrescimos: ACRESCIMO_SCHEMA,
      vigencia: { type: ['string', 'null'], description: 'Período da tabela, como o documento descreve.' },
      observacao: { type: ['string', 'null'], description: 'Qual documento, qual tabela dentro dele, o que somou e o que deixou de fora.' },
      fontes: { type: 'array', items: { type: 'string' }, description: 'Endereços EXATOS de onde saiu cada coisa. Obrigatório.' },
    },
    required: ['faixas', 'fontes'],
  },
}

// ---------------------------------------------------------------------------
// Os prompts, um por etapa
// ---------------------------------------------------------------------------
//
// SEPARADOS PORQUE O TEMPO É CURTO. Ver o comentário de `executarPasso`: cada
// etapa roda numa invocação própria, com um teto de tempo próprio, e um prompt
// que pede tudo de uma vez leva o modelo a gastar o orçamento inteiro de buscas
// e downloads antes de escrever qualquer coisa.

function promptAchar(uf: string, ano: number): string {
  return `Ache O DOCUMENTO OFICIAL com a tabela de emolumentos de cartório do estado ${uf}, vigente em ${ano}.

NÃO extraia valores agora. Sua única tarefa é dizer ONDE está a tabela. Outra chamada vai abrir o documento e ler as linhas.

ONDE PROCURAR, nesta ordem: o Tribunal de Justiça de ${uf} ou a Corregedoria-Geral de Justiça — a tabela é publicada por eles, como provimento, portaria, ato normativo ou anexo de lei estadual; depois o sindicato ou colégio de notários e registradores; depois a ANOREG.

O QUE INTERESSA: a tabela precisa cobrir dois atos — ESCRITURA PÚBLICA com conteúdo financeiro (Tabelionato de Notas) e REGISTRO em Títulos e Documentos. Em geral os dois estão no mesmo provimento, em tabelas diferentes.

PREFIRA O ARQUIVO, NÃO A PÁGINA. A página costuma trazer só o cabeçalho e as notas; as linhas numéricas estão dentro de um PDF anexo. Se a busca mostrar o endereço do anexo, é ele que você registra.

Devolva de um a três endereços, do mais provável para o menos, chamando registrar_documentos uma única vez. Seja rápido: poucas buscas, sem abrir arquivos.`
}

function promptAto(uf: string, ano: number, ato: 'escritura' | 'registro', docs: string[]): string {
  const qual = ato === 'escritura'
    ? 'ESCRITURA PÚBLICA com conteúdo financeiro, lavrada no Tabelionato de Notas — é o ato de uma cessão de crédito'
    : 'REGISTRO de instrumento no Registro de Títulos e Documentos (RTD)'

  return `Abra o documento abaixo e extraia a REGRA DE CÁLCULO do emolumento de ${qual}, no estado ${uf}, vigente em ${ano}.

DOCUMENTO(S) JÁ LOCALIZADO(S):
${docs.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Use web_fetch para abrir o primeiro. Se ele não tiver a tabela (for uma página de apresentação, por exemplo), tente o próximo, ou faça UMA busca para achar o anexo — mas não gaste tempo: o documento certo provavelmente está na lista.

Quem te chama vai aplicar essa regra a MUITOS valores diferentes, sem te consultar de novo. Por isso o que se pede não é um valor: é a TABELA e as taxas que incidem sobre ela.

O QUE DEVOLVER:
1. AS FAIXAS, na janela de R$ 1.000 a R$ 500.000, que é onde as cessões caem. Cada linha da tabela vira uma entrada com "de" e "ate" (os limites impressos). As tabelas brasileiras aparecem em três formas, e o formato aceita as três:
   (a) VALOR FIXO por faixa — o caso mais comum. Preencha "valor".
   (b) PERCENTUAL sobre o valor do ato. Preencha "percentual" como fração, com "minimo" e "maximo" se a tabela declarar piso e teto.
   (c) PARCELA FIXA MAIS PERCENTUAL SOBRE O EXCEDENTE — "R$ 500,00 acrescidos de 0,5% sobre o que exceder R$ 50.000,00". Preencha "fixo" (500), "percentual" (0.005), "de" (50000) e marque "sobre_excedente": true. NÃO marque sobre_excedente quando o percentual incidir sobre o valor inteiro — a diferença entre as duas leituras chega a 45% do emolumento.
2. OS ACRÉSCIMOS. Muitas tabelas cobram, por cima do emolumento, uma taxa de fiscalização, selo ou fundo estadual — e é isso que o balcão soma. Pode ser PERCENTUAL (campo "percentual", dizendo em "base" se incide sobre o valor do ato ou sobre o emolumento) ou VALOR FIXO por ato (campo "valor") — o selo digital de vários estados é fixo. Se a lei disser que a taxa não pode superar o próprio emolumento do ato, marque "teto_emolumento". Se a tabela já traz tudo embutido no valor da faixa, devolva lista vazia e diga isso em "observacao".
3. MOSTRE COMO LEU, em "observacao": qual documento, qual tabela dentro dele, o que somou e o que deixou de fora.
4. FONTE OBRIGATÓRIA. Sem o endereço, o resultado é descartado: emolumento é preço público e estes números entram num cálculo de deságio.

NÃO INVENTE FAIXA NEM PERCENTUAL. Se a tabela de ${ano} não estiver disponível, use a mais recente vigente e diga a vigência real. Se este ato não estiver neste documento, devolva faixas vazias e explique — a outra chamada cuida do outro ato.

Responda chamando registrar_ato uma única vez, ao final.`
}

// ---------------------------------------------------------------------------
// Chamadas à IA, curtas e com orçamento apertado
// ---------------------------------------------------------------------------

const MODELO = 'claude-opus-5'

/**
 * Uma rodada de conversa com as ferramentas de servidor.
 *
 * Os tetos de `buscas` e `fetches` são o principal controle de tempo que existe
 * aqui: o modelo tende a gastar o orçamento que recebe, e cada busca custa
 * segundos, cada download de PDF custa dezenas. Antes eram 10 e 6 numa única
 * chamada que fazia tudo — e ela não terminava dentro do limite da função.
 */
async function conversar(
  apiKey: string,
  sistema: string,
  ferramenta: { name: string; description: string; input_schema: Record<string, unknown> },
  buscas: number,
  fetches: number,
  maxTokens: number,
): Promise<Record<string, unknown> | null> {
  const anthropic = new Anthropic({ apiKey })
  const mensagens: Anthropic.MessageParam[] = [{ role: 'user', content: sistema }]
  const ferramentas: unknown[] = [ferramenta]
  if (buscas > 0) ferramentas.push({ type: 'web_search_20260209', name: 'web_search', max_uses: buscas })
  if (fetches > 0) ferramentas.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: fetches })

  const pedir = () =>
    anthropic.messages
      .stream({
        model: MODELO,
        max_tokens: maxTokens,
        // 'auto': forçar a ferramenta impediria a busca, e sem busca não há tabela.
        tools: ferramentas as Anthropic.Tool[],
        messages: mensagens,
      })
      .finalMessage()

  let resposta = await pedir()
  // O laço de amostragem do servidor tem teto próprio e devolve 'pause_turn' ao
  // batê-lo; reenviar o turno pausado retoma de onde parou, sem mensagem nova.
  // UMA retomada só: cada uma reenvia todo o contexto acumulado, então a
  // terceira custa muito mais que a primeira. Com a etapa pequena, uma basta.
  for (let i = 0; i < 1 && resposta.stop_reason === 'pause_turn'; i++) {
    mensagens.push({ role: 'assistant', content: resposta.content })
    resposta = await pedir()
  }

  const uso = resposta.content.find((c) => c.type === 'tool_use' && c.name === ferramenta.name)
  return uso && uso.type === 'tool_use' ? (uso.input as Record<string, unknown>) : null
}

// ---------------------------------------------------------------------------
// O levantamento, em etapas curtas encadeadas
// ---------------------------------------------------------------------------
//
// POR QUE EM ETAPAS, e não numa pesquisa só.
//
// A Edge Function tem um TETO DE TEMPO DE PAREDE que nada contorna: 400 s no
// plano pago, 150 s no gratuito. EdgeRuntime.waitUntil deixa o trabalho
// continuar depois da resposta, mas NÃO ESTENDE esse teto — foi o que eu não
// tinha conferido na versão anterior. Uma pesquisa com dez buscas, seis
// downloads de PDF e três retomadas passa dos 400 s com folga: o worker era
// morto no meio, a linha ficava 'levantando', a trava de 8 minutos expirava e a
// tentativa seguinte recomeçava do zero. Um laço que nunca fechava.
//
// Agora cada etapa é uma INVOCAÇÃO NOVA, com o relógio zerado, e faz uma coisa
// pequena:
//
//   achar     -> só busca, sem abrir arquivo: onde está o documento oficial
//   escritura -> abre o documento e lê a tabela da escritura
//   registro  -> lê a tabela do registro
//
// Entre uma etapa e outra só viajam os endereços e o que já foi extraído,
// gravados na linha do estado. É o mesmo encadeamento de invocações que
// advbox-movimentacoes usa para não estourar o limite.

/** Uma linha 'levantando' parada mais que isto é worker morto — pode reiniciar. */
const TRAVA_MINUTOS = 8
/** Não repete uma pesquisa que acabou de falhar; dá tempo de a fonte voltar do ar. */
const REPOUSO_FALHA_MINUTOS = 30
/** Corta laço: 'achar' + dois atos + folga para uma repetição de cada. */
const MAX_PASSOS = 6

type Etapa = 'achar' | 'escritura' | 'registro'

/** O que sobrevive de uma etapa para a seguinte. Mora em emolumentos_uf.progresso. */
interface Progresso {
  etapa: Etapa
  documentos: string[]
  escritura: RegraAto | null
  registro: RegraAto | null
  fontes: string[]
  vigencia: string | null
  observacoes: string[]
  passos: number
}

function progressoInicial(): Progresso {
  return {
    etapa: 'achar', documentos: [], escritura: null, registro: null,
    fontes: [], vigencia: null, observacoes: [], passos: 0,
  }
}

function lerProgresso(bruto: unknown): Progresso {
  const p = (bruto ?? {}) as Partial<Progresso>
  const etapa = p.etapa === 'escritura' || p.etapa === 'registro' ? p.etapa : 'achar'
  return {
    etapa,
    documentos: Array.isArray(p.documentos) ? p.documentos.map(String) : [],
    escritura: p.escritura ?? null,
    registro: p.registro ?? null,
    fontes: Array.isArray(p.fontes) ? p.fontes.map(String) : [],
    vigencia: p.vigencia ?? null,
    observacoes: Array.isArray(p.observacoes) ? p.observacoes.map(String) : [],
    passos: Number(p.passos) || 0,
  }
}

function vazio(uf: string, ano: number, motivo: string): Emolumentos {
  return { uf, ano, regra: null, fontes: [], vigencia: null, observacao: null, origem: 'nenhuma', motivo }
}

function emSegundoPlano(p: Promise<unknown>): void {
  const rt = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
  }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

const minutosDesde = (iso: unknown): number =>
  (Date.now() - new Date(String(iso ?? 0)).getTime()) / 60000

/**
 * Chama a própria função para rodar a próxima etapa, numa invocação NOVA.
 *
 * É isso que zera o relógio. A chamada leva a service_role no Authorization
 * (para passar pelo verify_jwt do gateway) e o segredo de cron no cabeçalho; a
 * função reconhece qualquer um dos dois como chamada interna. Fire-and-forget:
 * o resultado desta invocação não interessa a quem disparou.
 */
function dispararProximaEtapa(uf: string): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gerar-analise-rpv`
  const p = fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
      'x-cron-secret': Deno.env.get('CRON_SECRET') ?? '',
    },
    body: JSON.stringify({ acao: 'emolumentos_passo', uf }),
  }).catch(() => {})
  emSegundoPlano(p)
}

async function gravar(svc: SupabaseClient, uf: string, ano: number, campos: Record<string, unknown>): Promise<void> {
  await svc.from('emolumentos_uf')
    .update({ ...campos, atualizado_em: new Date().toISOString(), atualizado_por: 'gerar-analise-rpv' })
    .eq('uf', uf).eq('ano', ano)
}

/**
 * Roda UMA etapa do levantamento e agenda a seguinte.
 *
 * Chamada pela própria função, numa invocação dedicada. Nunca lança: qualquer
 * erro vira status 'falhou' com motivo, porque uma exceção aqui deixaria a
 * linha em 'levantando' e a tela girando até a trava de 8 minutos, sem dizer
 * nada a ninguém.
 */
export async function executarPasso(
  ufBruta: unknown,
  apiKey: string,
  svc: SupabaseClient,
): Promise<{ etapa: string; proxima: string | null }> {
  const ano = new Date().getFullYear()
  const uf = normalizarUf(ufBruta)
  if (!uf) return { etapa: 'nenhuma', proxima: null }

  const { data } = await svc.from('emolumentos_uf')
    .select('status, progresso').eq('uf', uf).eq('ano', ano).maybeSingle()
  if (!data || String((data as Record<string, unknown>).status) !== 'levantando') {
    // Alguém já terminou (ou cancelou) enquanto esta invocação subia.
    return { etapa: 'nenhuma', proxima: null }
  }

  const p = lerProgresso((data as Record<string, unknown>).progresso)
  p.passos++
  if (p.passos > MAX_PASSOS) {
    await gravar(svc, uf, ano, {
      status: 'falhou', tabela: null, progresso: p,
      motivo: 'o levantamento deu voltas demais sem completar — provavelmente a tabela deste estado não está publicada em formato legível',
    })
    return { etapa: p.etapa, proxima: null }
  }

  try {
    if (p.etapa === 'achar') {
      const r = await conversar(apiKey, promptAchar(uf, ano), FERRAMENTA_ACHAR, 5, 0, 2000)
      const docs = Array.isArray(r?.documentos) ? (r!.documentos as Array<Record<string, unknown>>) : []
      p.documentos = docs.map((d) => String(d?.url ?? '')).filter((u) => /^https?:\/\//i.test(u)).slice(0, 3)
      if (typeof r?.vigencia === 'string') p.vigencia = r.vigencia
      if (typeof r?.observacao === 'string') p.observacoes.push(r.observacao)

      if (p.documentos.length === 0) {
        await gravar(svc, uf, ano, {
          status: 'falhou', tabela: null, progresso: p,
          motivo: `não achei o documento oficial com a tabela de emolumentos de ${uf}${p.observacoes[0] ? ` (${p.observacoes[0]})` : ''}`,
        })
        return { etapa: 'achar', proxima: null }
      }
      p.etapa = 'escritura'
      await gravar(svc, uf, ano, { progresso: p })
      dispararProximaEtapa(uf)
      return { etapa: 'achar', proxima: 'escritura' }
    }

    // Etapas de extração: escritura e depois registro, do mesmo documento.
    const ato = p.etapa
    const r = await conversar(apiKey, promptAto(uf, ano, ato, p.documentos), FERRAMENTA_ATO, 1, 3, 12000)
    const fontes = Array.isArray(r?.fontes)
      ? (r!.fontes as unknown[]).map(String).filter((f) => /^https?:\/\//i.test(f))
      : []
    // Sem fonte o resultado não entra — emolumento é preço público, e número sem
    // procedência num cálculo de deságio é pior que célula vazia.
    const validado = fontes.length > 0 ? validarAto(r, ato) : null
    if (typeof validado !== 'string' && validado) {
      p[ato] = validado
      p.fontes = [...new Set([...p.fontes, ...fontes])]
    }
    if (typeof r?.vigencia === 'string' && !p.vigencia) p.vigencia = r.vigencia
    if (typeof r?.observacao === 'string') p.observacoes.push(`${ato}: ${r.observacao}`)
    if (typeof validado === 'string') p.observacoes.push(`${ato}: descartado (${validado})`)

    if (ato === 'escritura') {
      p.etapa = 'registro'
      await gravar(svc, uf, ano, { progresso: p })
      dispararProximaEtapa(uf)
      return { etapa: 'escritura', proxima: 'registro' }
    }

    // Fim da linha: consolida. Meio custo com origem clara é útil — o motor
    // avisa que falta a outra metade —, mas nenhum dos dois atos é fracasso.
    if (!p.escritura && !p.registro) {
      await gravar(svc, uf, ano, {
        status: 'falhou', tabela: null, progresso: p,
        motivo: `abri o documento de ${uf} e não consegui ler as tabelas${p.observacoes.length ? ` (${p.observacoes.join('; ')})` : ''}`,
      })
      return { etapa: 'registro', proxima: null }
    }
    await gravar(svc, uf, ano, {
      status: 'pronta', motivo: null, progresso: p,
      tabela: {
        regra: { escritura: p.escritura, registro: p.registro },
        observacao: p.observacoes.join(' • ') || null,
      },
      fontes: p.fontes,
      vigencia: p.vigencia,
    })
    return { etapa: 'registro', proxima: null }
  } catch (e) {
    await gravar(svc, uf, ano, {
      status: 'falhou', tabela: null, progresso: p,
      motivo: `a etapa "${p.etapa}" falhou: ${(e as Error)?.message ?? String(e)}`,
    })
    return { etapa: p.etapa, proxima: null }
  }
}

function daLinha(uf: string, ano: number, d: Record<string, unknown>): Emolumentos {
  const guardada = (d.tabela as { regra?: RegraEmolumentos; observacao?: string } | null) ?? null
  return {
    uf,
    ano,
    regra: guardada?.regra ?? null,
    fontes: (d.fontes as string[]) ?? [],
    vigencia: (d.vigencia as string | null) ?? null,
    observacao: guardada?.observacao ?? null,
    origem: guardada?.regra ? 'cache' : 'nenhuma',
    motivo: (d.motivo as string | null) ?? undefined,
  }
}

/** Em que etapa está, em português, para a tela dizer algo melhor que "aguarde". */
function rotuloDaEtapa(bruto: unknown): string {
  const p = lerProgresso(bruto)
  if (p.etapa === 'achar') return 'procurando a tabela oficial do estado'
  if (p.etapa === 'escritura') return 'lendo a tabela da escritura no documento'
  return 'lendo a tabela do registro'
}

/**
 * Consulta o estado do levantamento de uma UF e, se ninguém estiver cuidando
 * dela, dispara a primeira etapa.
 *
 * Devolve na hora, sempre. Quem chama volta a perguntar enquanto for
 * 'levantando'.
 *
 * SEM A TABELA (migração 0053 não rodou) não há levantamento possível: as
 * etapas se comunicam por ela. O motivo diz isso em português, para a falha ser
 * diagnosticável em vez de virar um tempo esgotado sem explicação.
 */
export async function consultarRegra(
  ufBruta: unknown,
  _apiKey: string,
  svc: SupabaseClient,
): Promise<RespostaEmolumentos> {
  const ano = new Date().getFullYear()
  const uf = normalizarUf(ufBruta)
  if (!uf) {
    return {
      estado: 'sem_uf',
      emolumentos: vazio(String(ufBruta ?? ''), ano, 'UF do tribunal não identificada nos autos'),
    }
  }

  let linha: Record<string, unknown> | null
  try {
    const { data, error } = await svc
      .from('emolumentos_uf')
      .select('status, motivo, tabela, fontes, vigencia, atualizado_em, progresso')
      .eq('uf', uf).eq('ano', ano).maybeSingle()
    if (error) throw new Error(error.message)
    linha = (data as Record<string, unknown> | null) ?? null
  } catch (e) {
    return {
      estado: 'falhou',
      emolumentos: vazio(
        uf, ano,
        `o cache de emolumentos não respondeu, e é por ele que as etapas do levantamento conversam (as migrações 0053 e 0054 rodaram?): ${(e as Error)?.message ?? String(e)}`,
      ),
    }
  }

  if (linha) {
    const status = String(linha.status ?? '')
    const idade = minutosDesde(linha.atualizado_em)
    // 'pronta' NÃO BASTA: a linha tem de ter a regra dentro. Uma gravada em
    // formato antigo, ou truncada, devolveria `regra: null` para sempre — a
    // tela diria "não consegui levantar" sem motivo e nada jamais pesquisaria
    // de novo, porque o cache estaria "pronto". Cache envenenado é pior que
    // cache vazio: some sozinho e nunca se corrige.
    const guardada = daLinha(uf, ano, linha)
    if (status === 'pronta' && guardada.regra) return { estado: 'pronta', emolumentos: guardada }
    if (status === 'levantando' && idade < TRAVA_MINUTOS) {
      return { estado: 'levantando', emolumentos: null, reconsultar_em: 8, etapa: rotuloDaEtapa(linha.progresso) }
    }
    if (status === 'falhou' && idade < REPOUSO_FALHA_MINUTOS) {
      return { estado: 'falhou', emolumentos: guardada }
    }
    // 'levantando' velha (worker morreu) ou 'falhou' já descansada: recomeça.
  }

  // A LINHA NASCE ANTES DA PESQUISA, e é ela que serve de trava: duas abas
  // pedindo o mesmo estado ao mesmo tempo não disparam duas pesquisas.
  try {
    const { error } = await svc.from('emolumentos_uf').upsert(
      {
        uf, ano, status: 'levantando', tabela: null, motivo: null,
        progresso: progressoInicial(),
        atualizado_em: new Date().toISOString(), atualizado_por: 'gerar-analise-rpv',
      },
      { onConflict: 'uf,ano' },
    )
    if (error) throw new Error(error.message)
  } catch (e) {
    return {
      estado: 'falhou',
      emolumentos: vazio(uf, ano, `não consegui abrir o levantamento de ${uf}: ${(e as Error)?.message ?? String(e)}`),
    }
  }

  dispararProximaEtapa(uf)
  return { estado: 'levantando', emolumentos: null, reconsultar_em: 8, etapa: 'procurando a tabela oficial do estado' }
}
