// escavador-callback — recebe o aviso do Escavador de que um processo terminou
// de atualizar, e traz os documentos para casa.
//
// POR QUE ISTO EXISTE. Pedir os autos ao Escavador é assíncrono: a solicitação
// volta em `PENDENTE` e o robô só depois entra no tribunal com o certificado
// digital. Perguntar de trinta em trinta segundos "já foi?" é o que fizemos à
// mão no primeiro teste, e encheu o log da conta com centenas de requisições sem
// acelerar nada. O mecanismo certo é o inverso: eles avisam.
//
//   "A API envia uma requisição HTTP para a URL cadastrada, com os dados do
//    evento. Sua aplicação processa a notificação e retorna uma resposta HTTP
//    de sucesso."
//
// A URL se cadastra no painel deles (api.escavador.com/callbacks) e o que prova
// a procedência é um token gerado lá, que eles mandam no header Authorization —
// é ele que esta função confere, e é a razão de ela poder ser pública.
//
// ELA NÃO CONFIA NO CORPO DO EVENTO. O formato do callback de atualização de
// processo não está documentado (a documentação mostra o de monitoramento), e
// construir em cima de um formato suposto é construir em cima de nada. O que a
// função faz é extrair o número do processo — que tem forma inconfundível — e
// PERGUNTAR À API qual é o estado de verdade. O corpo é guardado cru, para
// apertarmos essa leitura quando virmos um evento real.
//
// VERIFY_JWT = FALSE, como a kommo-sync e a djen-publicacoes: quem chama é de
// fora e não tem JWT nosso. A autorização é conferida aqui dentro.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/auth.ts'
import { chaveEscavador } from '../_shared/segredos.ts'
import { BASE_ESCAVADOR } from '../_shared/escavador.ts'
import {
  chaveDoEvento,
  cnjDoEvento,
  nomeDoEvento,
  pedidoEncerrado,
} from '../_shared/autosDoEscavador.ts'

interface Resposta {
  status: number
  corpo: unknown
}

async function pedirAoEscavador(chave: string, caminho: string): Promise<Resposta> {
  const res = await fetch(`${BASE_ESCAVADOR}${caminho}`, {
    headers: { Authorization: `Bearer ${chave}`, Accept: 'application/json' },
  })
  const txt = await res.text()
  let corpo: unknown = txt
  try {
    corpo = JSON.parse(txt)
  } catch { /* corpo que não é JSON já diz muito pelo status */ }
  return { status: res.status, corpo }
}

/**
 * Confirma o estado na API, registra o pedido e ACORDA A ROTINA.
 *
 * OS PDFs NÃO PASSAM POR AQUI desde 28/09/2026: eles vão direto para o card do
 * Kommo, e quem os leva é a `escavador-autos-rotina` — em voltas, porque um
 * processo grande são centenas de arquivos e esta função tem teto de tempo. O
 * aviso só faz a rotina olhar agora, e não na próxima meia hora.
 */
async function recolher(numeroCnj: string, uuidEvento: string) {
  const svc = serviceClient()
  const chave = await chaveEscavador()
  if (!chave) {
    await svc.from('escavador_callback').update({
      erro: 'Token do Escavador não configurado.',
    }).eq('uuid', uuidEvento)
    return
  }

  // 1. O ESTADO DE VERDADE vem da API, não do corpo do evento.
  const st = await pedirAoEscavador(chave, `/processos/numero_cnj/${numeroCnj}/status-atualizacao`)
  const verificacao = (st.corpo as { ultima_verificacao?: Record<string, unknown> } | null)
    ?.ultima_verificacao ?? {}
  const pedidoId = Number(verificacao.id ?? 0) || null
  const status = String(verificacao.status ?? '').trim() || 'DESCONHECIDO'

  if (pedidoId) {
    // UPSERT, e não insert: o pedido já existe se foi esta plataforma que o fez.
    await svc.from('escavador_pedido').upsert({
      id: pedidoId,
      numero_cnj: numeroCnj,
      status,
      motivo_erro: (verificacao.motivo_erro as string | null) ?? null,
      concluido_em: (verificacao.concluido_em as string | null) ?? null,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'id' })
  }

  // 2. OS CARDS DESTE PROCESSO que esperavam: a rotina os confere na hora.
  if (pedidoEncerrado(status)) {
    await svc.from('escavador_autos_card')
      .update({ verificado_em: null })
      .eq('numero_cnj', numeroCnj)
      .eq('estado', 'AGUARDANDO')
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/escavador-autos-rotina`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': Deno.env.get('CRON_SECRET') ?? '' },
      body: '{}',
    }).catch(() => null)
  }

  await svc.from('escavador_callback')
    .update({ tratado_em: new Date().toISOString() })
    .eq('uuid', uuidEvento)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()

    // A PORTA. O token é gerado no painel do Escavador e vem no Authorization.
    // Sem ele configurado, a função RECUSA tudo em vez de aceitar tudo: endpoint
    // público que não valida nada é um convite a qualquer um mandar evento.
    const { data: segredo } = await svc
      .from('integracao_escavador_secret')
      .select('callback_token')
      .eq('id', 1)
      .maybeSingle()
    const esperado = String(segredo?.callback_token ?? '').trim()
    if (!esperado) {
      return jsonResponse(
        { erro: 'Callback do Escavador não configurado (falta o token em Configurações).' },
        503,
      )
    }
    const veio = String(req.headers.get('Authorization') ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim()
    if (veio !== esperado) return jsonResponse({ erro: 'Não autorizado.' }, 401)

    const payload = await req.json().catch(() => ({}))
    const uuid = chaveDoEvento(payload)
    const numeroCnj = cnjDoEvento(payload)

    // REGISTRA PRIMEIRO, e é o que torna o reenvio inofensivo: a chave é única,
    // então o segundo POST do mesmo evento não cria linha nova. Quando ele já
    // veio e já foi tratado, respondemos ok sem refazer download nenhum.
    const { data: jaVisto } = await svc
      .from('escavador_callback')
      .select('uuid, tratado_em')
      .eq('uuid', uuid)
      .maybeSingle()
    if (jaVisto?.tratado_em) {
      return jsonResponse({ ok: true, repetido: true })
    }
    if (!jaVisto) {
      await svc.from('escavador_callback').insert({
        uuid,
        evento: nomeDoEvento(payload),
        numero_cnj: numeroCnj,
        payload,
      })
    }

    if (!numeroCnj) {
      // Evento que não fala de processo nenhum (ou de formato que não soubemos
      // ler): fica guardado cru, que é como saberemos o que é.
      await svc.from('escavador_callback')
        .update({ erro: 'Sem número CNJ reconhecível no evento.' })
        .eq('uuid', uuid)
      return jsonResponse({ ok: true, ignorado: true })
    }

    // RESPONDE JÁ, RECOLHE DEPOIS. `waitUntil` mantém a função viva após a
    // resposta; onde ele não existir, o recolhimento vai embutido — mais lento,
    // mas nunca perdido.
    const runtime = (globalThis as {
      EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void }
    }).EdgeRuntime
    const trabalho = recolher(numeroCnj, uuid).catch(async (e) => {
      await svc.from('escavador_callback')
        .update({ erro: String((e as Error)?.message ?? e).slice(0, 300) })
        .eq('uuid', uuid)
    })
    if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(trabalho)
    else await trabalho

    return jsonResponse({ ok: true, processo: numeroCnj })
  } catch (err) {
    return jsonResponse({ erro: (err as Error).message }, 500)
  }
})
