// Sincroniza as INTIMAÇÕES do DJEN para o cache public.djen_publicacoes.
// Critério (interseção): publicações dos PROCESSOS CADASTRADOS
// (Créditos/Requerimentos/Apensos) que foram expedidas EM NOME das OAB(s)
// cadastradas em integracoes.djen. Janela: últimos `dias` (default 30).
// A página lê do banco; esta função roda em 2º plano.
//
// ⚠️ ESTA FUNÇÃO PRESTA CONTAS, e isso não é enfeite.
//
// Ela passou dias devolvendo `ok: true` com um punhado de linhas, e de fora não
// havia como distinguir "não há intimação nova" de "a consulta falhou em oitenta
// processos". Foram necessários seis dias e uma comparação com a plataforma antiga
// para alguém notar — em intimação, seis dias é prazo. Agora toda etapa que
// descarta algo é CONTADA e volta em `diagnostico`, e a tela mostra o resumo.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Uma página da API, com a contagem total que ela informa. */
async function fetchPagina(
  url: string,
  tries = 3,
): Promise<{ items: Record<string, unknown>[]; count: number }> {
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      // Erro que não é de tentar de novo (400, 403, 404): não há o que insistir,
      // mas TAMBÉM não é vazio legítimo — lança, para o chamador contar a falha.
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      return {
        items: (j?.items ?? []) as Record<string, unknown>[],
        count: Number(j?.count ?? 0),
      }
    } catch (e) {
      if (a === tries) throw e
      await sleep(600 * a)
    }
  }
  return { items: [], count: 0 }
}

const POR_PAGINA = 100
/** 30 páginas = 3.000 comunicações de uma OAB em 30 dias. Medido: 76 a 86. */
const MAX_PAGINAS = 30

/**
 * Todas as comunicações de UMA OAB na janela, paginando até o fim.
 *
 * POR QUE A BUSCA É POR OAB, e não processo por processo como antes.
 *
 * O critério do produto é o mesmo dos dois jeitos — intimação de processo
 * cadastrado E em nome de alguma OAB cadastrada —, mas o caminho para chegar nele
 * muda tudo na prática:
 *
 *   • por processo: ~100 requisições, uma por crédito. Cada uma é um ponto de
 *     falha, e a falha de uma some com as intimações daquele processo. Medido em
 *     produção: o cache tinha 22 intimações de 17 processos, quando a busca por
 *     OAB encontrava 140 na mesma janela. Quatro créditos confirmados no banco
 *     não tinham nenhuma das suas intimações capturadas.
 *   • por OAB: 5 requisições. Toda intimação endereçada à casa vem, por
 *     construção — não há como uma escapar por falha de uma requisição entre cem.
 *     O recorte para os processos cadastrados passa a ser feito aqui, com a lista
 *     que já está em memória.
 *
 * O conjunto final é idêntico. O que deixa de existir é a chance de perder.
 */
async function buscarPorOab(
  oab: string,
  janela: string,
): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const [numero, uf] = oab.split('/')
  const items: Record<string, unknown>[] = []
  let total = 0
  for (let p = 1; p <= MAX_PAGINAS; p++) {
    const r = await fetchPagina(
      `${DJEN}?numeroOab=${numero}&ufOab=${uf}${janela}` +
        `&itensPorPagina=${POR_PAGINA}&pagina=${p}`,
    )
    total = r.count
    items.push(...r.items)
    if (r.items.length < POR_PAGINA || items.length >= total) return { items, total }
  }
  // Teto batido: melhor falhar alto do que devolver metade parecendo completo.
  throw new Error(
    `OAB ${oab}: mais de ${MAX_PAGINAS * POR_PAGINA} comunicações na janela — não li até o fim.`,
  )
}

/** As 27 UFs. Serve para não aceitar "OAB" como se fosse estado. */
const UFS = new Set(
  ('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO')
    .split(' '),
)

/**
 * Lê uma OAB escrita à mão e devolve "numero/UF", ou null quando não dá para ler.
 *
 * O parse anterior era um `match(/(\d+)\s*\/?\s*([A-Za-z]{2})/)` e errava calado
 * em dois modos, os dois medidos:
 *   • "MG 230939", "MG/230939", "OAB/MG 230939" e "230939-MG" não casavam, e a
 *     OAB era DESCARTADA sem aviso — a intimação em nome dela nunca era guardada;
 *   • "230.939/MG" casava com o PEDAÇO errado e virava "939/MG", uma OAB que não
 *     existe, o que é pior que descartar porque parece cadastrado e funcionando.
 *
 * Agora: ponto e espaço saem, aceita-se número antes ou UF antes, e a UF é
 * conferida contra a lista real — senão "OAB 230939" produziria a UF "AB".
 */
export function lerOab(bruto: unknown): string | null {
  const t = String(bruto ?? '')
    .toUpperCase()
    .replace(/[.\s]/g, '')
  const numeroPrimeiro = t.match(/(\d{2,7})[/\-]?([A-Z]{2})/)
  if (numeroPrimeiro && UFS.has(numeroPrimeiro[2])) {
    return `${onlyDigits(numeroPrimeiro[1])}/${numeroPrimeiro[2]}`
  }
  const ufPrimeiro = t.match(/([A-Z]{2})[/\-]?(\d{2,7})/)
  if (ufPrimeiro && UFS.has(ufPrimeiro[1])) {
    return `${onlyDigits(ufPrimeiro[2])}/${ufPrimeiro[1]}`
  }
  return null
}

// A publicação está em nome de alguma OAB cadastrada?
function temOabCadastrada(it: Record<string, unknown>, oabSet: Set<string>): boolean {
  if (oabSet.size === 0) return true // sem OAB cadastrada: não filtra por OAB
  const advs = it.destinatarioadvogados
  if (!Array.isArray(advs)) return false
  for (const a of advs) {
    const adv = (a as { advogado?: { numero_oab?: string; uf_oab?: string } })?.advogado
    if (!adv) continue
    const num = onlyDigits(adv.numero_oab)
    const uf = String(adv.uf_oab ?? '').toUpperCase()
    if (num && oabSet.has(`${num}/${uf}`)) return true
  }
  return false
}

type Svc = ReturnType<typeof serviceClient>

/**
 * TODAS as linhas de uma coluna, em páginas, com a contagem exata para conferir.
 *
 * Duas correções em relação ao `select` solto que havia aqui:
 *
 *   1. O `error` é CHECADO. Antes era `proc.data ?? []`: consulta que falhasse
 *      deixava a lista de processos vazia ou parcial, e a sincronização seguia
 *      adiante reportando sucesso — exatamente a armadilha do supabase-js, que
 *      não lança, devolve `{ data, error }`.
 *   2. O corte do PostgREST não passa em silêncio. Ele tem limite próprio de
 *      linhas por resposta (`max-rows`), independente do que o código pede; sem
 *      paginar, a partir daquele número os processos seguintes simplesmente não
 *      seriam consultados, e nada na resposta indicaria isso.
 */
async function lerColuna(
  rotulo: string,
  campo: string,
  buscar: (
    de: number,
    ate: number,
  ) => Promise<{
    data: unknown[] | null
    error: { message: string } | null
    count: number | null
  }>,
): Promise<{ valores: string[]; total: number }> {
  const PAGINA = 1000
  const valores: string[] = []
  let total = 0
  for (let de = 0; ; de += PAGINA) {
    const { data, error, count } = await buscar(de, de + PAGINA - 1)
    if (error) throw new Error(`Falha ao ler ${rotulo}: ${error.message}`)
    if (count != null) total = count
    for (const r of data ?? []) {
      valores.push(String((r as Record<string, unknown>)[campo] ?? ''))
    }
    if (!data || data.length < PAGINA || valores.length >= total) break
  }
  return { valores, total }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // Autorização: JWT de usuário (chamada do app) OU segredo de cron.
    const cronSecret = Deno.env.get('CRON_SECRET')
    const headerSecret = req.headers.get('x-cron-secret')
    const autorizadoPorCron = !!cronSecret && headerSecret === cronSecret
    if (!autorizadoPorCron) {
      const caller = await getCallerAtivo(req, serviceClient())
      if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)
    }

    const svc: Svc = serviceClient()
    const [proc, ap, reqs, integ] = await Promise.all([
      lerColuna('os créditos', 'numero_cnj', async (de, ate) =>
        await svc.from('processos').select('numero_cnj', { count: 'exact' }).range(de, ate),
      ),
      lerColuna('os apensos', 'numero', async (de, ate) =>
        await svc.from('apensos').select('numero', { count: 'exact' }).range(de, ate),
      ),
      lerColuna('os requerimentos', 'numero_protocolo', async (de, ate) =>
        await svc
          .from('requerimentos')
          .select('numero_protocolo', { count: 'exact' })
          .range(de, ate),
      ),
      svc.from('integracoes').select('config').eq('servico', 'djen').maybeSingle(),
    ])
    if (integ.error) throw new Error(`Falha ao ler a configuração do DJEN: ${integ.error.message}`)

    // Números curtos são contados, não ignorados calados: número de processo
    // incompleto no cadastro é dado errado, e a intimação dele nunca vai chegar.
    const numeros = new Set<string>()
    let curtos = 0
    for (const bruto of [...proc.valores, ...ap.valores, ...reqs.valores]) {
      const d = onlyDigits(bruto)
      if (d.length >= 15) numeros.add(d)
      else if (d.length > 0) curtos++
    }

    const cfg = (integ.data?.config ?? {}) as {
      oabs?: string[]
      dias_retroativos?: number
    }
    // Conjunto de OABs cadastradas, normalizado como "numero/UF". O que não der
    // para ler volta na resposta: OAB ilegível é intimação perdida em silêncio.
    const oabSet = new Set<string>()
    const oabsIlegiveis: string[] = []
    for (const o of cfg.oabs ?? []) {
      const lida = lerOab(o)
      if (lida) oabSet.add(lida)
      else oabsIlegiveis.push(String(o))
    }
    const dias = Number(cfg.dias_retroativos ?? 30)
    const fim = new Date().toISOString().slice(0, 10)
    const ini = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
    const janela = `&dataDisponibilizacaoInicio=${ini}&dataDisponibilizacaoFim=${fim}`

    // Sem OAB cadastrada o critério não existe: é ela que define "em nome da
    // casa". Antes isso caía num "não filtra por OAB" que, com a busca por OAB,
    // não tem sequer o que consultar. Falha alto, com o que fazer na mensagem.
    if (oabSet.size === 0) {
      throw new Error(
        'Nenhuma OAB legível cadastrada em Configurações → DJEN. ' +
          'Sem ela não há como saber quais intimações são da casa.',
      )
    }

    // Busca POR OAB, uma por vez em paralelo (são poucas). Ver buscarPorOab.
    const porId = new Map<string, Record<string, unknown>>()
    const falhas: { item: string; erro: string }[] = []
    const porOab: Record<string, number> = {}
    await Promise.all(
      [...oabSet].map(async (oab) => {
        try {
          const r = await buscarPorOab(oab, janela)
          porOab[oab] = r.total
          for (const it of r.items) if (it?.id != null) porId.set(String(it.id), it)
        } catch (e) {
          falhas.push({ item: oab, erro: String((e as Error)?.message ?? e) })
        }
      }),
    )

    // O RECORTE: intimação + processo cadastrado + em nome de OAB cadastrada.
    // Cada descarte é contado, para a resposta dizer POR QUE o número final é o
    // que é. `foraDasOabs` deveria ser sempre zero agora — a busca já é por OAB —,
    // e é justamente por isso que ele fica: se subir de zero, a API mudou de
    // comportamento e é melhor saber.
    const items: Record<string, unknown>[] = []
    let naoIntimacao = 0
    let processoNaoCadastrado = 0
    let foraDasOabs = 0
    for (const it of porId.values()) {
      if (!String(it.tipoComunicacao ?? '').toLowerCase().includes('intima')) {
        naoIntimacao++
        continue
      }
      const numero = onlyDigits(
        (it.numeroprocessocommascara as string) ?? (it.numero_processo as string),
      )
      if (!numeros.has(numero)) {
        processoNaoCadastrado++
        continue
      }
      if (!temOabCadastrada(it, oabSet)) {
        foraDasOabs++
        continue
      }
      items.push(it)
    }

    const agora = new Date().toISOString()
    const rows = items
      .filter((it) => it.id != null)
      .map((it) => ({
        id: Number(it.id),
        data_disponibilizacao: (it.data_disponibilizacao as string) ?? null,
        numero_processo:
          (it.numeroprocessocommascara as string) ??
          (it.numero_processo as string) ??
          null,
        sigla_tribunal: (it.siglaTribunal as string) ?? null,
        tipo_comunicacao: (it.tipoComunicacao as string) ?? null,
        raw: it,
        sincronizado_em: agora,
      }))

    let gravados = 0
    const chunk = 500
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk)
      const { error } = await svc
        .from('djen_publicacoes')
        .upsert(slice, { onConflict: 'id' })
      if (error) throw new Error(error.message)
      gravados += slice.length
    }

    // Remove do cache o que saiu da janela de 30 dias, COM UM DIA DE FOLGA.
    //
    // A folga existe porque os dois lados calculam a janela em fusos diferentes:
    // a Edge Function roda em UTC e a tela usa horário local. Depois das 21h de
    // Brasília o UTC já virou o dia, então a poda apagava a publicação de um dia
    // que a tela ainda pedia — e intimação sem o selo "tratada" desaparecia da
    // lista um dia antes do previsto, sem deixar rastro. Guardar um dia a mais
    // custa quase nada; perder intimação custa prazo.
    const podaAte = new Date(`${ini}T00:00:00Z`)
    podaAte.setUTCDate(podaAte.getUTCDate() - 1)
    await svc
      .from('djen_publicacoes')
      .delete()
      .lt('data_disponibilizacao', podaAte.toISOString().slice(0, 10))

    const diagnostico = {
      janela: `${ini} a ${fim}`,
      creditos_no_banco: proc.total,
      creditos_lidos: proc.valores.length,
      apensos_lidos: ap.valores.length,
      requerimentos_lidos: reqs.valores.length,
      numeros_curtos_ignorados: curtos,
      processos_cadastrados: numeros.size,
      oabs_ativas: [...oabSet],
      oabs_ilegiveis: oabsIlegiveis,
      /** Quantas comunicações o DJEN tem por OAB na janela. Zero = OAB errada. */
      comunicacoes_por_oab: porOab,
      buscas_falharam: falhas.length,
      exemplos_de_falha: falhas,
      comunicacoes_recebidas: porId.size,
      descartadas_nao_intimacao: naoIntimacao,
      descartadas_processo_nao_cadastrado: processoNaoCadastrado,
      descartadas_fora_das_oabs: foraDasOabs,
    }
    const resumo =
      `${oabSet.size} OABs` +
      (falhas.length ? ` · ${falhas.length} BUSCA(S) FALHARAM` : '') +
      ` · ${porId.size} comunicações` +
      ` · ${numeros.size} processos cadastrados` +
      ` · ${items.length} intimações da casa` +
      ` · ${gravados} gravadas` +
      (processoNaoCadastrado
        ? ` · ${processoNaoCadastrado} de processos fora da plataforma`
        : '') +
      (oabsIlegiveis.length ? ` · ${oabsIlegiveis.length} OAB ilegível` : '')

    return jsonResponse({ ok: true, total: items.length, gravados, resumo, diagnostico })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
