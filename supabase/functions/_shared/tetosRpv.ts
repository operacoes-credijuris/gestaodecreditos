// O teto da RPV do ente devedor — cache no banco, pesquisa pela IA quando falta.
//
// Mesmo desenho de emolumentos.ts, e pelo mesmo motivo: a resposta muda por
// estado, muda todo ano, e descobri-la é uma pesquisa de verdade que não cabe
// dentro da requisição que a pessoa espera na tela. Então a análise LÊ o cache,
// e quando não há linha ela dispara a pesquisa em segundo plano e diz que o teto
// ainda não foi conferido — em vez de devolver silêncio, que se lê como "está
// dentro do teto".
//
// A DIFERENÇA PARA OS EMOLUMENTOS É O TAMANHO. Lá são faixas, acréscimos e
// documentos em PDF, em etapas encadeadas para caber no relógio de parede. Aqui
// é UM NÚMERO: uma busca, uma leitura, uma gravação. Cabe numa invocação só.
//
// ANTES DA MIGRAÇÃO 0057 (e se ela falhar) o módulo cai em TETOS_SEMENTE, que é
// exatamente o mapa que vivia no código. Nada quebra; só não há pesquisa.
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

export type EsferaTeto = 'federal' | 'estadual' | 'municipal'

/** Opus: o valor decide se um crédito é reprovado, e a fonte tem de ser lida certo. */
const MODELO = 'claude-opus-5'
const MAX_BUSCAS = 5
const MAX_FETCHES = 2

/** Pesquisa parada há mais que isto está morta (worker derrubado no meio). */
const TRAVA_MINUTOS = 5

/**
 * Repouso crescente entre tentativas, em minutos.
 *
 * Estado cuja lei a IA não acha não pode ser pesquisado a cada análise, para
 * sempre — foi o defeito que os emolumentos já tiveram. A quarta falha em diante
 * espera um dia.
 */
const REPOUSO_POR_FALHAS = [30, 180, 1440]
const repouso = (falhas: number) =>
  REPOUSO_POR_FALHAS[Math.min(Math.max(falhas, 1) - 1, REPOUSO_POR_FALHAS.length - 1)]

/**
 * O mapa que vivia em gerar-analise-rpv, exercício 2026.
 *
 * SÓ REDE DE SEGURANÇA: vale enquanto a tabela não existir, e o valor devolvido
 * vem marcado com origem 'semente' para o aviso poder dizer que não foi
 * conferido este ano.
 */
export const TETOS_SEMENTE: Record<string, { est: number | null; mun: number | null }> = {
  PE: { est: 64840.0, mun: 48630.0 }, PA: { est: 48630.0, mun: 48630.0 },
  AM: { est: 32420.0, mun: 24315.0 }, DF: { est: 32420.0, mun: null },
  MA: { est: 32420.0, mun: 8475.55 }, RJ: { est: 32420.0, mun: 16210.0 },
  RN: { est: 32420.0, mun: 16210.0 }, MS: { est: 27655.5, mun: 10099.18 },
  RR: { est: 27557.0, mun: 24315.0 }, MG: { est: 27345.69, mun: 8475.55 },
  MT: { est: 26010.0, mun: 8475.55 }, PR: { est: 24782.81, mun: 8537.55 },
  ES: { est: 21827.28, mun: 48630.0 }, SP: { est: 16913.0, mun: 31667.41 },
  AP: { est: 16210.0, mun: 48630.0 }, BA: { est: 16210.0, mun: 11010.97 },
  GO: { est: 16210.0, mun: 48630.0 }, PB: { est: 16210.0, mun: 8475.55 },
  RS: { est: 16210.0, mun: 48630.0 }, RO: { est: 16210.0, mun: 16210.0 },
  SC: { est: 16210.0, mun: 8475.55 }, TO: { est: 16210.0, mun: 24315.0 },
  CE: { est: 15746.8, mun: 8475.55 }, AC: { est: 11347.0, mun: 16210.0 },
  AL: { est: 8475.55, mun: 21073.0 }, PI: { est: 8475.55, mun: 11347.0 },
  SE: { est: 8475.55, mun: 8475.55 },
}
/** 60 salários mínimos de 2026 (Lei 10.259/2001, art. 17, §1º). */
export const TETO_FEDERAL_SEMENTE = 97260

export interface TetoConsultado {
  estado: 'pronto' | 'pesquisando' | 'falhou' | 'sem_uf'
  /** O teto em reais. null com estado 'pronto' = este ente não tem teto próprio. */
  valor: number | null
  fonte: string | null
  vigencia: string | null
  /** 'seed' | 'busca' | 'manual' | 'capital' | 'semente' (a tabela não existe) */
  origem: string | null
  motivo: string | null
  ano: number
  /**
   * DE QUEM é o teto que veio.
   *
   *   'proprio'  do ente do crédito — o que se quer
   *   'capital'  do município-capital do estado, usado como REFERÊNCIA enquanto
   *              o do município do crédito não foi apurado
   *
   * A distinção existe porque o teto municipal é de cada município (CF, art.
   * 100, §4º) e o mapa herdado guardava só o da capital. Sem este campo o aviso
   * afirmaria como apurado um número que é palpite informado.
   */
  escopo: 'proprio' | 'capital'
  /** O município a que o teto se refere, quando é municipal. */
  municipio: string | null
}

const vazio = (ano: number, estado: TetoConsultado['estado'], motivo?: string): TetoConsultado => ({
  estado, valor: null, fonte: null, vigencia: null, origem: null, motivo: motivo ?? null, ano,
  escopo: 'proprio', municipio: null,
})

/**
 * A chave de comparação do município: sem acento e sem caixa.
 *
 * Espelha a coluna gerada `municipio_chave` (migração 0058). As duas TÊM de
 * concordar: se divergirem, a consulta nunca acha a linha que a pesquisa
 * acabou de gravar e o estado é pesquisado para sempre.
 */
export const chaveDoMunicipio = (m: string | null | undefined): string =>
  String(m ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** A UF que a linha usa. O teto federal é do país, não de um estado. */
export const chaveUf = (uf: string | null | undefined, esfera: EsferaTeto): string =>
  esfera === 'federal' ? 'BR' : String(uf ?? '').toUpperCase().trim()

function daSemente(uf: string, esfera: EsferaTeto, ano: number, municipio: string | null): TetoConsultado {
  const base = { estado: 'pronto' as const, fonte: null, origem: 'semente', ano, escopo: 'proprio' as const, municipio }
  if (esfera === 'federal') {
    return { ...base, valor: TETO_FEDERAL_SEMENTE, municipio: null,
      vigencia: 'Lei 10.259/2001, art. 17, §1º — 60 salários mínimos', motivo: null }
  }
  const t = TETOS_SEMENTE[uf]
  if (!t) return vazio(ano, 'falhou', `não há teto conhecido para ${uf || 'a UF não identificada'}`)
  const v = esfera === 'municipal' ? t.mun : t.est
  return {
    ...base, valor: v, vigencia: null,
    // O número municipal da semente é o da CAPITAL — nunca o do município do
    // crédito, que a semente não conhece.
    escopo: esfera === 'municipal' ? 'capital' : 'proprio',
    motivo: v == null ? 'o mapa herdado não trazia valor para esta esfera' : null,
  }
}

const minutosDesde = (iso: unknown): number =>
  (Date.now() - new Date(String(iso ?? 0)).getTime()) / 60000

function emSegundoPlano(p: Promise<unknown>): void {
  const rt = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
  }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

/**
 * Chama a própria função numa invocação NOVA — é o que zera o relógio de parede.
 * Fire-and-forget: quem disparou não espera nem se importa com o resultado.
 */
function dispararPesquisa(uf: string, esfera: EsferaTeto, ano: number, municipio: string): void {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gerar-analise-rpv`
  const p = fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
      'x-cron-secret': Deno.env.get('CRON_SECRET') ?? '',
    },
    body: JSON.stringify({ acao: 'teto_passo', uf, esfera, ano, municipio }),
  }).catch(() => {})
  emSegundoPlano(p)
}

/**
 * O teto deste ente, do cache — disparando a pesquisa quando não houver.
 *
 * NUNCA LANÇA e nunca espera pela pesquisa. Tabela ausente cai na semente;
 * pesquisa em curso devolve 'pesquisando', e quem chama transforma isso num
 * aviso honesto em vez de num silêncio que se lê como aprovação.
 *
 * O MUNICÍPIO FAZ PARTE DA PERGUNTA. Cada município fixa o próprio teto (CF,
 * art. 100, §4º), e quem nunca legislou segue o piso do ADCT, art. 87 — 30
 * salários mínimos. O número que o sistema herdou é o da CAPITAL de cada estado,
 * e usá-lo para o Município de Anápolis é comparar com a lei errada. Então:
 *
 *   1. procura o teto DAQUELE município;
 *   2. não achando, dispara a pesquisa dele e devolve a REFERÊNCIA DA CAPITAL,
 *      marcada como referência (`escopo: 'capital'`), para a análise sair com um
 *      número dito em vez de nenhum número;
 *   3. a análise seguinte daquele município já sai com o teto dele.
 */
export async function consultarTeto(
  svc: SupabaseClient,
  uf: string | null | undefined,
  esfera: EsferaTeto,
  ano: number = new Date().getFullYear(),
  /** O município devedor, quando a esfera é municipal. Ver municipioDoEnte. */
  municipio?: string | null,
): Promise<TetoConsultado> {
  const chave = chaveUf(uf, esfera)
  if (!chave || chave.length !== 2) return vazio(ano, 'sem_uf', 'UF do crédito não identificada')
  // Só a esfera municipal tem município; nas outras a coluna é '' por desenho.
  const mun = esfera === 'municipal' ? (String(municipio ?? '').trim() || '') : ''

  try {
    const proprio = await lerLinha(svc, chave, esfera, ano, mun)

    if (proprio?.status === 'pronto') return montar(proprio, ano, mun || null, 'proprio')

    if (proprio?.status === 'pesquisando') {
      // Viva: outra análise (ou outra aba) já está pesquisando. Morta: o worker
      // caiu no meio, e reabrir é o único jeito de destravar.
      if (minutosDesde(proprio.pesquisa_desde) >= TRAVA_MINUTOS) {
        if (await reabrir(svc, chave, esfera, ano, mun, 'pesquisando')) dispararPesquisa(chave, esfera, ano, mun)
      }
      return await enquantoPesquisa(svc, chave, esfera, ano, mun)
    }

    if (proprio?.status === 'falhou') {
      if (minutosDesde(proprio.pesquisa_desde) < repouso(proprio.falhas)) {
        // Em repouso: não insiste, mas ainda entrega a referência da capital, se
        // houver — melhor um número com a origem dita do que campo vazio.
        const ref = await referenciaDaCapital(svc, chave, esfera, ano, mun)
        if (ref) return ref
        return { ...vazio(ano, 'falhou', proprio.motivo ?? 'a pesquisa do teto não achou a norma'), origem: proprio.origem }
      }
      if (await reabrir(svc, chave, esfera, ano, mun, 'falhou')) dispararPesquisa(chave, esfera, ano, mun)
      return await enquantoPesquisa(svc, chave, esfera, ano, mun)
    }

    // Não há linha: cria e dispara. `ignoreDuplicates` é a trava — duas análises
    // do mesmo ente ao mesmo tempo, só uma cria e só ela dispara.
    const { data: criada, error: e2 } = await svc
      .from('rpv_tetos')
      .upsert(
        { uf: chave, esfera, ano, municipio: mun, status: 'pesquisando',
          pesquisa_desde: new Date().toISOString(),
          motivo: 'pesquisa em curso', atualizado_por: 'consultarTeto' },
        { onConflict: 'uf,esfera,municipio_chave,ano', ignoreDuplicates: true },
      )
      .select('uf')
    if (e2) throw new Error(e2.message)
    if (criada && criada.length > 0) dispararPesquisa(chave, esfera, ano, mun)
    return await enquantoPesquisa(svc, chave, esfera, ano, mun)
  } catch (_) {
    // Tabela ausente, RLS, rede: a análise não pode parar por causa de um aviso.
    return daSemente(chave, esfera, ano, mun || null)
  }
}

interface LinhaTeto {
  valor: number | null; status: string; motivo: string | null; fonte: string | null
  vigencia: string | null; origem: string | null; pesquisa_desde: string | null; falhas: number
  municipio: string | null
}

const COLUNAS = 'valor, em_salarios, status, motivo, fonte, vigencia, origem, pesquisa_desde, falhas, municipio'

async function lerLinha(
  svc: SupabaseClient, uf: string, esfera: EsferaTeto, ano: number, municipio: string,
): Promise<LinhaTeto | null> {
  // Pela chave NORMALIZADA (coluna gerada), e não pelo nome cru: "Anápolis" e
  // "ANAPOLIS" são o mesmo município, e a IA escreve dos dois jeitos.
  const chaveMun = chaveDoMunicipio(municipio)
  const { data, error } = await svc
    .from('rpv_tetos').select(COLUNAS)
    .eq('uf', uf).eq('esfera', esfera).eq('ano', ano).eq('municipio_chave', chaveMun)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as LinhaTeto | null
}

function montar(l: LinhaTeto, ano: number, municipio: string | null, escopo: 'proprio' | 'capital'): TetoConsultado {
  return {
    estado: 'pronto', valor: l.valor == null ? null : Number(l.valor),
    fonte: l.fonte, vigencia: l.vigencia, origem: l.origem, motivo: l.motivo, ano,
    escopo, municipio,
  }
}

/**
 * O que devolver enquanto a pesquisa do município corre.
 *
 * Para um MUNICÍPIO específico existe a referência da capital, que é melhor que
 * nada e é honesta desde que dita. Para as outras esferas não há substituto:
 * devolve 'pesquisando' e quem chama avisa.
 */
async function enquantoPesquisa(
  svc: SupabaseClient, uf: string, esfera: EsferaTeto, ano: number, municipio: string,
): Promise<TetoConsultado> {
  const ref = await referenciaDaCapital(svc, uf, esfera, ano, municipio)
  return ref ?? vazio(ano, 'pesquisando')
}

/** A linha `municipio = ''` daquela UF: o número da capital, servindo de régua. */
async function referenciaDaCapital(
  svc: SupabaseClient, uf: string, esfera: EsferaTeto, ano: number, municipio: string,
): Promise<TetoConsultado | null> {
  if (esfera !== 'municipal' || !municipio) return null
  try {
    const base = await lerLinha(svc, uf, esfera, ano, '')
    if (!base || base.status !== 'pronto' || base.valor == null) return null
    return montar(base, ano, municipio, 'capital')
  } catch (_) {
    return null
  }
}

/** Reabre uma linha travada/falhada. Devolve true só para quem ganhou a corrida. */
async function reabrir(
  svc: SupabaseClient, uf: string, esfera: EsferaTeto, ano: number, municipio: string, de: string,
): Promise<boolean> {
  const chaveMun = chaveDoMunicipio(municipio)
  const { data } = await svc
    .from('rpv_tetos')
    .update({ status: 'pesquisando', pesquisa_desde: new Date().toISOString(), atualizado_por: 'consultarTeto' })
    .eq('uf', uf).eq('esfera', esfera).eq('ano', ano).eq('municipio_chave', chaveMun).eq('status', de)
    .select('uf')
  return !!data && data.length > 0
}

// ---------------------------------------------------------------------------
// A pesquisa
// ---------------------------------------------------------------------------

const FERRAMENTA = {
  name: 'registrar_teto',
  description: 'Registra o teto de RPV apurado na fonte oficial.',
  input_schema: {
    type: 'object' as const,
    properties: {
      existe: {
        type: 'boolean',
        description: 'Existe teto próprio para este ente? Falso quando a esfera não se aplica (o DF não tem municípios) ou quando o ente segue o teto federal.',
      },
      valor_reais: {
        type: ['number', 'null'],
        description: 'O teto em REAIS, para o ano pedido. Null quando existe=false ou quando a lei só fixa em salários mínimos e você não sabe o mínimo do ano.',
      },
      em_salarios_minimos: {
        type: ['number', 'null'],
        description: 'Quando a lei fixa em salários mínimos, o número de salários (ex.: 40). Null quando fixa em reais.',
      },
      fonte: { type: 'string', description: 'A URL da fonte oficial consultada.' },
      vigencia: { type: 'string', description: 'A norma, com número e ano (ex.: "Lei estadual nº 12.345/2024, art. 2º").' },
      observacao: {
        type: 'string',
        description: 'Uma linha: o que você achou e o que ficou em dúvida. Quando existe=false, diga por quê.',
      },
    },
    required: ['existe', 'fonte', 'vigencia', 'observacao'],
  },
}

const NOME_ESFERA: Record<EsferaTeto, string> = {
  federal: 'da União (Justiça Federal)',
  estadual: 'do Estado',
  municipal: 'dos Municípios',
}

function pergunta(uf: string, esfera: EsferaTeto, ano: number, municipio: string): string {
  const onde = esfera === 'federal'
    ? 'da União'
    : esfera === 'municipal' && municipio
      ? `do MUNICÍPIO DE ${municipio.toUpperCase()} (${uf})`
      : `de ${uf}`
  return (
    `Qual é o TETO DA REQUISIÇÃO DE PEQUENO VALOR (RPV) ${
      esfera === 'municipal' && municipio ? '' : NOME_ESFERA[esfera] + ' '
    }${onde}, vigente em ${ano}?\n\n` +
    'CONTEXTO JURÍDICO, para você não confundir as três coisas:\n' +
    '• O teto federal é de 60 salários mínimos (Lei 10.259/2001, art. 17, §1º).\n' +
    '• Estados, Distrito Federal e Municípios fixam o SEU PRÓPRIO teto por lei local (CF, art. 100, §4º). ' +
    'Enquanto não legislarem, vale o piso do ADCT, art. 87 — 40 salários mínimos para Estados e DF, 30 para Municípios.\n' +
    '• O que se pede aqui é o teto do ENTE DEVEDOR, não o do tribunal onde o processo tramita: ' +
    'um município executado na Justiça Federal segue o teto municipal dele.\n\n' +
    (esfera === 'municipal' && municipio
      ? `É O TETO DESTE MUNICÍPIO que se pede — ${municipio}/${uf} —, e NÃO o da capital do estado. ` +
        'Procure a LEI DO PRÓPRIO MUNICÍPIO (lei ordinária, lei orgânica ou lei de diretrizes orçamentárias). ' +
        'Se ele NUNCA fixou teto próprio, a resposta não é "não existe": vale o piso do ADCT, art. 87, II — 30 salários mínimos —, ' +
        `e é esse o valor a devolver, dizendo em "vigencia" que é o piso do ADCT por falta de lei municipal. ` +
        'Só devolva existe=false se nem a lei local nem o piso se aplicarem, e explique por quê.\n\n'
      : esfera === 'municipal'
        ? `Para ${uf}, procure o teto da CAPITAL do estado — é a referência que usamos quando o município do crédito não foi identificado. Diga em "observacao" de qual município é o valor.\n\n`
        : '') +
    'ONDE PROCURAR, nesta ordem: a lei estadual/municipal específica; o site do Tribunal de Justiça ou do TRF; ' +
    'resolução do próprio tribunal que divulga o valor do exercício; a Procuradoria do ente.\n\n' +
    'REGRAS. Use a busca web e confirme na FONTE OFICIAL — não aceite valor de blog, escritório ou notícia sem a norma. ' +
    'Se a lei fixa em salários mínimos, devolva o número de salários E o valor em reais do ano pedido. ' +
    `Se você não conseguir confirmar em fonte oficial, chame a ferramenta assim mesmo com existe=false e explique em "observacao" o que procurou — ` +
    'inventar um teto reprova crédito bom ou aprova crédito que precisa de renúncia.\n\n' +
    'Responda chamando registrar_teto uma única vez.'
  )
}

/**
 * Uma pesquisa completa, numa invocação própria (ação 'teto_passo').
 *
 * Grava sempre — 'pronto' com o que achou, ou 'falhou' com o motivo. Deixar a
 * linha em 'pesquisando' é o que produz estado travado, e a trava de tempo
 * acima só existe porque worker morto acontece.
 */
export async function executarPesquisaTeto(
  uf: string, esfera: EsferaOuTexto, ano: number, apiKey: string, svc: SupabaseClient,
  /** O município devedor, quando municipal. Vazio = a referência da capital. */
  municipio = '',
): Promise<{ ok: boolean; motivo?: string }> {
  const esf = (['federal', 'estadual', 'municipal'] as const).find((e) => e === esfera)
  const chave = String(uf ?? '').toUpperCase().trim()
  if (!esf || chave.length !== 2) return { ok: false, motivo: 'uf ou esfera inválida' }
  // Só a esfera municipal tem município; nas outras a linha é a de chave vazia.
  const mun = esf === 'municipal' ? String(municipio ?? '').trim() : ''
  if (!apiKey) {
    await gravarFalha(svc, chave, esf, ano, mun, 'a chave da Anthropic não está configurada')
    return { ok: false, motivo: 'sem chave' }
  }

  try {
    const anthropic = new Anthropic({ apiKey })
    const resposta = await anthropic.messages
      .stream({
        model: MODELO,
        max_tokens: 4000,
        tools: [
          FERRAMENTA,
          { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: MAX_FETCHES },
        ] as Anthropic.Tool[],
        messages: [{ role: 'user', content: pergunta(chave, esf, ano, mun) }],
      })
      .finalMessage()

    const uso = resposta.content.find((c) => c.type === 'tool_use' && c.name === FERRAMENTA.name)
    if (!uso || uso.type !== 'tool_use') {
      await gravarFalha(svc, chave, esf, ano, mun, 'a pesquisa terminou sem registrar um teto')
      return { ok: false, motivo: 'sem ferramenta' }
    }
    const r = uso.input as {
      existe?: boolean; valor_reais?: number | null; em_salarios_minimos?: number | null
      fonte?: string; vigencia?: string; observacao?: string
    }

    const valor = Number(r.valor_reais)
    const temValor = r.existe === true && Number.isFinite(valor) && valor > 0
    // existe=true sem valor é resposta incompleta, não é resposta: gravar
    // 'pronto' com valor nulo faria o motor tratar como "não tem teto".
    if (r.existe === true && !temValor) {
      await gravarFalha(svc, chave, esf, ano, mun,
        `a pesquisa afirmou que há teto mas não trouxe o valor (${String(r.observacao ?? '').slice(0, 200)})`)
      return { ok: false, motivo: 'sem valor' }
    }

    await svc.from('rpv_tetos').update({
      status: 'pronto',
      valor: temValor ? Number(valor.toFixed(2)) : null,
      em_salarios: Number.isFinite(Number(r.em_salarios_minimos)) ? Number(r.em_salarios_minimos) : null,
      fonte: String(r.fonte ?? '').slice(0, 500) || null,
      vigencia: String(r.vigencia ?? '').slice(0, 300) || null,
      motivo: temValor ? String(r.observacao ?? '').slice(0, 500) || null
        : `não há teto próprio: ${String(r.observacao ?? 'sem detalhe').slice(0, 400)}`,
      origem: 'busca',
      atualizado_em: new Date().toISOString(),
      atualizado_por: 'teto_passo',
    }).eq('uf', chave).eq('esfera', esf).eq('ano', ano).eq('municipio_chave', chaveDoMunicipio(mun))

    return { ok: true }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    await gravarFalha(svc, chave, esf, ano, mun, msg.slice(0, 300))
    return { ok: false, motivo: msg }
  }
}

/** Tipo frouxo na fronteira: a ação vem do corpo de uma requisição. */
type EsferaOuTexto = EsferaTeto | string

async function gravarFalha(
  svc: SupabaseClient, uf: string, esfera: EsferaTeto, ano: number, municipio: string, motivo: string,
): Promise<void> {
  try {
    const { data } = await svc.from('rpv_tetos').select('falhas')
      .eq('uf', uf).eq('esfera', esfera).eq('ano', ano).maybeSingle()
    const falhas = Number((data as { falhas?: number } | null)?.falhas ?? 0) + 1
    await svc.from('rpv_tetos').update({
      status: 'falhou', motivo, falhas,
      // O repouso conta da FALHA, não do começo da pesquisa.
      pesquisa_desde: new Date().toISOString(),
      atualizado_em: new Date().toISOString(), atualizado_por: 'teto_passo',
    }).eq('uf', uf).eq('esfera', esfera).eq('ano', ano)
  } catch (_) { /* a análise não para por causa disto */ }
}
