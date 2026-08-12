// Busca SELIC e IPCA acumulados em 12 meses no Banco Central e grava os parâmetros
// de atualização monetária da carteira.
//
// POR QUE EXISTE: esses dois números eram digitados à mão, e a projeção de valor e a
// TIR de TODA a carteira dependem deles. Esquecer de atualizar não dá erro — só
// envelhece todos os números em silêncio, que é a pior forma de estar errado.
//
// AS DUAS SÉRIES NÃO SÃO SIMÉTRICAS, e é o detalhe que decide a corretude:
//
//   IPCA  — série 13522 já É "acumulado em 12 meses". Uma leitura, valor pronto.
//   SELIC — não existe série pronta de acumulado 12 meses. A 4390 dá a Selic
//           acumulada de CADA mês, e o acumulado do ano se obtém COMPONDO doze
//           delas: (Π(1 + v/100) − 1) × 100. Somar daria menos que o correto,
//           porque juro sobre juro não é soma.
//
// E O MÊS CORRENTE VEM INCOMPLETO na 4390 — em 12 de agosto ela devolvia 0,36% para
// agosto, contra ~1,2% de um mês fechado. Compor incluindo esse mês subestimaria a
// taxa de forma sistemática, todo mês, sem nada na tela indicando. Por isso o mês
// corrente é DESCARTADO e a composição usa os doze meses fechados anteriores.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'

const BASE = 'https://api.bcb.gov.br/dados/serie'
const SERIE_SELIC_MES = 4390 // Selic acumulada no mês, % a.m.
const SERIE_IPCA_12M = 13522 // IPCA acumulado em 12 meses, %

/**
 * Limites de sanidade. Este valor multiplica a projeção de todos os créditos da
 * carteira, então número absurdo gravado aqui não estraga um registro: estraga o
 * relatório inteiro. Fora da faixa, prefere-se NÃO gravar e avisar.
 */
const FAIXA = { selic: [0, 100], ipca: [-50, 100] }

interface Ponto {
  ano: number
  mes: number
  valor: number
}

/** Converte a resposta do BCB ("01/08/2026", "0.36") em pontos utilizáveis. */
function pontos(json: unknown): Ponto[] {
  const arr = Array.isArray(json) ? json : []
  const out: Ponto[] = []
  for (const r of arr as { data?: string; valor?: string }[]) {
    const [dd, mm, yyyy] = String(r.data ?? '').split('/')
    const valor = Number(String(r.valor ?? '').replace(',', '.'))
    if (!dd || !mm || !yyyy || !Number.isFinite(valor)) continue
    out.push({ ano: Number(yyyy), mes: Number(mm), valor })
  }
  // Do mais antigo para o mais novo, para a composição e o corte não dependerem da
  // ordem em que a API devolveu.
  return out.sort((a, b) => a.ano - b.ano || a.mes - b.mes)
}

async function bcb(serie: number, quantos: number): Promise<unknown> {
  const url = `${BASE}/bcdata.sgs.${serie}/dados/ultimos/${quantos}?formato=json`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`série ${serie} → HTTP ${res.status}`)
  return await res.json()
}

const arred2 = (n: number) => Math.round(n * 100) / 100

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    // Cron (semanal) ou pessoa (botão "Buscar agora"). Mesmo padrão das outras
    // sincronizações: a função valida os dois caminhos.
    const cronSecret = Deno.env.get('CRON_SECRET')
    const autorizadoPorCron =
      !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    const svc = serviceClient()
    if (!autorizadoPorCron) {
      const caller = await getCallerAtivo(req, svc)
      if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)
    }

    const avisos: string[] = []
    const hoje = new Date()
    const anoAtual = hoje.getUTCFullYear()
    const mesAtual = hoje.getUTCMonth() + 1

    // ---------- SELIC: compor 12 meses FECHADOS ----------
    let selic: number | null = null
    let compSelic: Ponto | null = null
    try {
      // 13 e não 12: o mês corrente costuma vir na lista e vai ser descartado.
      const serie = pontos(await bcb(SERIE_SELIC_MES, 13)).filter(
        (p) => !(p.ano === anoAtual && p.mes === mesAtual),
      )
      const doze = serie.slice(-12)
      if (doze.length < 12) {
        avisos.push(
          `SELIC: só ${doze.length} meses fechados disponíveis, precisa de 12 — não gravei.`,
        )
      } else {
        const fator = doze.reduce((f, p) => f * (1 + p.valor / 100), 1)
        const calculado = arred2((fator - 1) * 100)
        if (calculado < FAIXA.selic[0] || calculado > FAIXA.selic[1]) {
          avisos.push(`SELIC calculada fora da faixa esperada (${calculado}%) — não gravei.`)
        } else {
          selic = calculado
          compSelic = doze[doze.length - 1]
        }
      }
    } catch (e) {
      avisos.push(`SELIC: ${(e as Error).message}`)
    }

    // ---------- IPCA: série já acumulada ----------
    let ipca: number | null = null
    let compIpca: Ponto | null = null
    try {
      const serie = pontos(await bcb(SERIE_IPCA_12M, 1))
      const ultimo = serie[serie.length - 1]
      if (!ultimo) avisos.push('IPCA: série vazia — não gravei.')
      else if (ultimo.valor < FAIXA.ipca[0] || ultimo.valor > FAIXA.ipca[1]) {
        avisos.push(`IPCA fora da faixa esperada (${ultimo.valor}%) — não gravei.`)
      } else {
        ipca = arred2(ultimo.valor)
        compIpca = ultimo
      }
    } catch (e) {
      avisos.push(`IPCA: ${(e as Error).message}`)
    }

    // NUNCA GRAVA NULO POR CIMA DE VALOR REAL. Só entra no update o que foi lido com
    // sucesso: falha de rede não pode apagar a SELIC que estava certa e parar a
    // projeção da carteira toda.
    const mudancas: Record<string, unknown> = {}
    if (selic != null) mudancas.selic_aa = selic
    if (ipca != null) mudancas.ipca_12m_aa = ipca

    // Competência: o mês mais recente que os DOIS índices já fecharam. Usar o mais
    // novo dos dois faria a data prometer um fechamento que um deles ainda não tem.
    const comps = [compSelic, compIpca].filter(Boolean) as Ponto[]
    if (comps.length) {
      const menor = comps.reduce((a, b) => (a.ano * 12 + a.mes <= b.ano * 12 + b.mes ? a : b))
      // Último dia do mês de competência: dia 0 do mês seguinte.
      const fim = new Date(Date.UTC(menor.ano, menor.mes, 0))
      mudancas.data_referencia = fim.toISOString().slice(0, 10)
    }

    if (Object.keys(mudancas).length === 0) {
      return jsonResponse({ ok: false, avisos, gravado: false }, 502)
    }

    mudancas.atualizado_em = new Date().toISOString()
    const { error } = await svc
      .from('parametros_atualizacao')
      .update(mudancas)
      .eq('id', 1)
    if (error) throw new Error(error.message)

    return jsonResponse({
      ok: true,
      gravado: true,
      selic_aa: selic,
      ipca_12m_aa: ipca,
      data_referencia: mudancas.data_referencia ?? null,
      // Quantos meses entraram na conta da SELIC, para dar como conferir o número
      // contra o boletim do Banco Central.
      selic_meses_compostos: selic != null ? 12 : 0,
      avisos,
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
