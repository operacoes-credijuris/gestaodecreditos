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
// A extração
// ---------------------------------------------------------------------------

const FAIXA_SCHEMA = {
  type: 'array',
  description:
    'As linhas da tabela, na ordem. Copie TODAS as faixas que cubram valores de R$ 1.000 a R$ 500.000 — é a janela em que as cessões caem.',
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
  description:
    'Taxas que incidem POR CIMA do emolumento e que o balcão soma: TSNR, taxa de fiscalização, selo, fundos estaduais. Lista vazia se a tabela já traz tudo embutido no valor da faixa.',
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
1. AS FAIXAS. Copie as linhas da tabela na janela de valores que interessa — de R$ 1.000 a R$ 500.000, que é onde as cessões caem. Cada linha vira uma entrada com "de" e "ate" (os limites impressos) e "valor" (o emolumento). As tabelas brasileiras aparecem em três formas, e o formato aceita as três:
   (a) VALOR FIXO por faixa — o caso mais comum. Preencha "valor".
   (b) PERCENTUAL sobre o valor do ato. Preencha "percentual" como fração, com "minimo" e "maximo" se a tabela declarar piso e teto.
   (c) PARCELA FIXA MAIS PERCENTUAL SOBRE O EXCEDENTE — "R$ 500,00 acrescidos de 0,5% sobre o que exceder R$ 50.000,00". Preencha "fixo" (500), "percentual" (0.005), "de" (50000) e marque "sobre_excedente": true. NÃO marque sobre_excedente quando o percentual incidir sobre o valor inteiro — a diferença entre as duas leituras chega a 45% do emolumento.
2. OS ACRÉSCIMOS. Muitas tabelas cobram, por cima do emolumento, uma taxa de fiscalização, selo ou fundo estadual — e é isso que o balcão soma. Devolva cada uma em "acrescimos". Pode ser PERCENTUAL (campo "percentual", dizendo em "base" se incide sobre o valor do ato ou sobre o emolumento) ou VALOR FIXO por ato (campo "valor") — o selo digital de vários estados é fixo. Se a lei disser que a taxa não pode superar o próprio emolumento do ato, marque "teto_emolumento". Se a tabela já traz tudo embutido no valor da faixa, devolva lista vazia e diga isso em "observacao".
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
// Levantamento em segundo plano + cache
// ---------------------------------------------------------------------------
//
// POR QUE ISTO NÃO É UMA CHAMADA SÍNCRONA. Achar o provimento do estado, abrir
// o PDF anexo e ler as linhas numéricas leva de dois a cinco minutos — é uma
// pesquisa de verdade, com até dez buscas e seis downloads. A primeira versão
// esperava esse tempo dentro da requisição, e a tela mostrava "o levantamento
// passou de 140s". Nenhum ajuste de timeout resolve isso: o problema é a
// pesquisa estar no caminho crítico de quem está olhando a tela.
//
// Agora a requisição só CONSULTA e, se for o caso, DISPARA. O trabalho corre em
// segundo plano (EdgeRuntime.waitUntil) e deposita o resultado na tabela; a
// tela volta a perguntar a cada poucos segundos. E como o que se guarda é a
// REGRA, e não um custo para um preço, isso acontece uma vez por estado no ano.

/** Uma linha 'levantando' parada mais que isto é worker morto — pode reiniciar. */
const TRAVA_MINUTOS = 8
/** Não repete uma pesquisa que acabou de falhar; dá tempo de a fonte voltar do ar. */
const REPOUSO_FALHA_MINUTOS = 30

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

/** A pesquisa em si, já gravando o desfecho. Roda fora da requisição. */
async function levantarEGravar(uf: string, ano: number, apiKey: string, svc: SupabaseClient): Promise<void> {
  let campos: Record<string, unknown>
  try {
    const achado = await extrairRegra(uf, ano, apiKey)
    campos = achado.regra
      ? {
          status: 'pronta',
          motivo: null,
          tabela: { regra: achado.regra, observacao: achado.observacao },
          fontes: achado.fontes,
          vigencia: achado.vigencia,
        }
      : {
          status: 'falhou',
          tabela: null,
          motivo: achado.motivo ?? 'a pesquisa terminou sem achar a tabela',
          fontes: achado.fontes,
          vigencia: achado.vigencia,
        }
  } catch (e) {
    // O erro TEM de ser gravado. Sem isto a linha fica 'levantando' para sempre,
    // e a tela roda em círculo até bater a trava de 8 minutos sem dizer por quê.
    campos = { status: 'falhou', tabela: null, motivo: `a pesquisa falhou: ${(e as Error)?.message ?? String(e)}` }
  }
  try {
    await svc.from('emolumentos_uf')
      .update({ ...campos, atualizado_em: new Date().toISOString(), atualizado_por: 'gerar-analise-rpv' })
      .eq('uf', uf).eq('ano', ano)
  } catch { /* worker morrendo; a trava de 8 min libera a próxima tentativa */ }
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

/**
 * Consulta o estado do levantamento de uma UF e, se ninguém estiver cuidando
 * dela, dispara a pesquisa em segundo plano.
 *
 * Devolve na hora, sempre. Quem chama volta a perguntar enquanto for
 * 'levantando'.
 *
 * SEM A TABELA (migração 0053 não rodou) cai no modo antigo: pesquisa dentro da
 * própria requisição, com tudo que isso tem de ruim. O motivo diz isso em
 * português, para a falha ser diagnosticável em vez de virar "passou de 140s".
 */
export async function consultarRegra(
  ufBruta: unknown,
  apiKey: string,
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
      .select('status, motivo, tabela, fontes, vigencia, atualizado_em')
      .eq('uf', uf).eq('ano', ano).maybeSingle()
    if (error) throw new Error(error.message)
    linha = (data as Record<string, unknown> | null) ?? null
  } catch {
    // Modo degradado: sem onde depositar o resultado não há segundo plano
    // possível. Pesquisa aqui mesmo, e provavelmente estoura o tempo.
    return await semCache(uf, ano, apiKey)
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
      return { estado: 'levantando', emolumentos: null, reconsultar_em: 8 }
    }
    if (status === 'falhou' && idade < REPOUSO_FALHA_MINUTOS) {
      return { estado: 'falhou', emolumentos: daLinha(uf, ano, linha) }
    }
    // 'levantando' velha (worker morreu) ou 'falhou' já descansada: recomeça.
  }

  // A LINHA NASCE ANTES DA PESQUISA, e é ela que serve de trava: duas abas
  // pedindo o mesmo estado ao mesmo tempo não disparam duas pesquisas.
  try {
    const { error } = await svc.from('emolumentos_uf').upsert(
      {
        uf, ano, status: 'levantando', tabela: null, motivo: null,
        atualizado_em: new Date().toISOString(), atualizado_por: 'gerar-analise-rpv',
      },
      { onConflict: 'uf,ano' },
    )
    if (error) throw new Error(error.message)
  } catch {
    return await semCache(uf, ano, apiKey)
  }

  emSegundoPlano(levantarEGravar(uf, ano, apiKey, svc))
  return { estado: 'levantando', emolumentos: null, reconsultar_em: 8 }
}

/** Modo degradado, sem a migração 0053: pesquisa dentro da requisição. */
async function semCache(uf: string, ano: number, apiKey: string): Promise<RespostaEmolumentos> {
  try {
    const achado = await extrairRegra(uf, ano, apiKey)
    if (!achado.regra) {
      return {
        estado: 'falhou',
        emolumentos: {
          uf, ano, regra: null, fontes: achado.fontes, vigencia: achado.vigencia,
          observacao: achado.observacao, origem: 'nenhuma', motivo: achado.motivo,
        },
      }
    }
    return {
      estado: 'pronta',
      emolumentos: {
        uf, ano, regra: achado.regra, fontes: achado.fontes, vigencia: achado.vigencia,
        observacao: achado.observacao, origem: 'busca',
      },
    }
  } catch (e) {
    return {
      estado: 'falhou',
      emolumentos: vazio(
        uf, ano,
        `o cache de emolumentos não respondeu (a migração 0053 rodou?), então a pesquisa teve de ser feita dentro da requisição e não coube no tempo: ${(e as Error)?.message ?? String(e)}`,
      ),
    }
  }
}
