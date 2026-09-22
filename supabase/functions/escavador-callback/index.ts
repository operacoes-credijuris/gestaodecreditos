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
  caminhoDoDocumento,
  chaveDoEvento,
  cnjDoEvento,
  documentosDaLista,
  nomeDoEvento,
  pedidoBemSucedido,
} from '../_shared/autosDoEscavador.ts'

/** O balde dos PDFs (migração 0068). Privado: quem entrega é URL assinada. */
const BALDE = 'autos-escavador'

/** Teto por documento. Um PDF de autos passa longe disso; um absurdo, não. */
const MAX_BYTES = 80 * 1024 * 1024

interface Resposta {
  status: number
  corpo: unknown
  centavos: number
}

async function pedirAoEscavador(chave: string, caminho: string): Promise<Resposta> {
  const res = await fetch(`${BASE_ESCAVADOR}${caminho}`, {
    headers: { Authorization: `Bearer ${chave}`, Accept: 'application/json' },
  })
  const centavos = Number(res.headers.get('Creditos-Utilizados') ?? 0) || 0
  const txt = await res.text()
  let corpo: unknown = txt
  try {
    corpo = JSON.parse(txt)
  } catch { /* corpo que não é JSON já diz muito pelo status */ }
  return { status: res.status, corpo, centavos }
}

/**
 * O trabalho pesado: confirmar o estado, listar os documentos e baixá-los.
 *
 * SEPARADO DA RESPOSTA porque a recomendação deles é "responda rapidamente a
 * requisição e processe tarefas pesadas de forma assíncrona" — e porque demorar
 * faz o Escavador reenviar o mesmo evento, que é como um download vira dois.
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

  let centavos = 0
  const anotarErro = async (erro: string) => {
    await svc.from('escavador_callback').update({ erro }).eq('uuid', uuidEvento)
  }

  // 1. O ESTADO DE VERDADE vem da API, não do corpo do evento.
  const st = await pedirAoEscavador(chave, `/processos/numero_cnj/${numeroCnj}/status-atualizacao`)
  centavos += st.centavos
  const verificacao = (st.corpo as { ultima_verificacao?: Record<string, unknown> } | null)
    ?.ultima_verificacao ?? {}
  const pedidoId = Number(verificacao.id ?? 0) || null
  const status = String(verificacao.status ?? '').trim() || 'DESCONHECIDO'

  if (pedidoId) {
    // UPSERT, e não insert: o pedido já existe se foi esta plataforma que o fez.
    // Se foi feito pelo painel do Escavador, nasce aqui — um pedido que ninguém
    // registrou ainda assim rendeu documentos, e perdê-los seria o pior desfecho.
    await svc.from('escavador_pedido').upsert({
      id: pedidoId,
      numero_cnj: numeroCnj,
      status,
      motivo_erro: (verificacao.motivo_erro as string | null) ?? null,
      concluido_em: (verificacao.concluido_em as string | null) ?? null,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'id' })
  }

  if (!pedidoBemSucedido(status)) {
    // NÃO É ERRO NOSSO, e é informação: um `NAO_ENCONTRADO` diz que o processo é
    // físico, sigiloso ou arquivado; um `ERRO` diz que o robô não conseguiu
    // entrar. Fica registrado no pedido, e o callback se encerra tratado.
    await svc.from('escavador_callback')
      .update({ tratado_em: new Date().toISOString() })
      .eq('uuid', uuidEvento)
    return
  }

  // 2. OS DOCUMENTOS. Tenta os autos; se a permissão não abriu, cai nos
  // públicos — que é exatamente a diferença entre ter e não ter certificado
  // válido naquele processo, e não um defeito.
  let lista = await pedirAoEscavador(chave, `/processos/numero_cnj/${numeroCnj}/autos?limit=100`)
  centavos += lista.centavos
  let origem = 'autos'
  if (lista.status !== 200) {
    lista = await pedirAoEscavador(
      chave,
      `/processos/numero_cnj/${numeroCnj}/documentos-publicos?limit=100`,
    )
    centavos += lista.centavos
    origem = 'documentos_publicos'
  }
  if (lista.status !== 200) {
    await anotarErro(`Nenhuma lista de documentos disponível (HTTP ${lista.status}).`)
    return
  }

  const documentos = documentosDaLista(lista.corpo)

  // 3. O QUE JÁ ESTÁ EM CASA NÃO DESCE DE NOVO. Reenvio de callback é previsto
  // pela documentação deles, e cada download pode custar.
  const { data: existentes } = await svc
    .from('escavador_documento')
    .select('chave, caminho')
    .eq('numero_cnj', numeroCnj)
  const jaBaixado = new Set(
    (existentes ?? []).filter((d) => d.caminho).map((d) => String(d.chave)),
  )

  for (const doc of documentos) {
    if (jaBaixado.has(doc.chave)) continue

    // A linha nasce ANTES do download: documento listado e não baixado é um
    // estado que precisa existir no banco, senão a falha é muda.
    await svc.from('escavador_documento').upsert({
      numero_cnj: numeroCnj,
      pedido_id: pedidoId,
      chave: doc.chave,
      nome: doc.nome,
      tipo: doc.tipo,
    }, { onConflict: 'numero_cnj,chave' })

    try {
      const res = await fetch(
        `${BASE_ESCAVADOR}/processos/numero_cnj/${numeroCnj}/documentos/${doc.chave}`,
        { headers: { Authorization: `Bearer ${chave}` } },
      )
      centavos += Number(res.headers.get('Creditos-Utilizados') ?? 0) || 0
      if (!res.ok) {
        await svc.from('escavador_documento')
          .update({ erro: `download HTTP ${res.status}` })
          .eq('numero_cnj', numeroCnj).eq('chave', doc.chave)
        continue
      }
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.byteLength > MAX_BYTES) {
        await svc.from('escavador_documento')
          .update({ erro: `arquivo grande demais (${bytes.byteLength} bytes)` })
          .eq('numero_cnj', numeroCnj).eq('chave', doc.chave)
        continue
      }
      const caminho = caminhoDoDocumento(numeroCnj, doc.chave)
      const { error: eUp } = await svc.storage.from(BALDE).upload(caminho, bytes, {
        contentType: 'application/pdf',
        upsert: true,
      })
      if (eUp) {
        await svc.from('escavador_documento')
          .update({ erro: `balde: ${String(eUp.message).slice(0, 160)}` })
          .eq('numero_cnj', numeroCnj).eq('chave', doc.chave)
        continue
      }
      await svc.from('escavador_documento').update({
        caminho,
        bytes: bytes.byteLength,
        erro: null,
        baixado_em: new Date().toISOString(),
      }).eq('numero_cnj', numeroCnj).eq('chave', doc.chave)
    } catch (e) {
      await svc.from('escavador_documento')
        .update({ erro: String((e as Error)?.message ?? e).slice(0, 160) })
        .eq('numero_cnj', numeroCnj).eq('chave', doc.chave)
    }
  }

  // 4. O QUE ISSO CUSTOU. A API é paga por requisição e estamos em período de
  // teste: "quanto custa trazer os autos de um processo" precisa ter resposta
  // antes de a rotina virar automática de verdade.
  if (centavos > 0) {
    await svc.from('escavador_consumo').insert({
      operacao: origem === 'autos' ? 'autos' : 'documentos_publicos',
      alvo: numeroCnj,
      centavos,
      requisicoes: documentos.length + 2,
      processos: 1,
    })
  }
  if (pedidoId && centavos > 0) {
    const { data: antes } = await svc
      .from('escavador_pedido').select('centavos').eq('id', pedidoId).maybeSingle()
    await svc.from('escavador_pedido')
      .update({ centavos: (Number(antes?.centavos ?? 0) || 0) + centavos })
      .eq('id', pedidoId)
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
