// bullai-certidoes — pede à BullAI as certidões do checklist e traz o que ela
// devolve para dentro dele.
//
// DUAS AÇÕES:
//   { acao: 'pedir', kommo_lead_id, pedidos: [{ sujeito_id, itens: [{ certidao_id,
//     portais }], extras? }] }
//       — um pedido por sujeito (a BullAI recebe UM documento por vez), com os
//         portais que a tela marcou. Nada sai daqui sem esse clique: cada portal
//         gasta uma consulta do plano.
//   { acao: 'atualizar', kommo_lead_id }
//       — pergunta à BullAI em que pé estão os pedidos abertos, baixa os PDFs que
//         chegaram para a pasta do cedente no Drive e põe no checklist o estado e
//         o RESULTADO de cada certidão.
//
// QUEM DECIDE O QUE PEDIR NÃO É ESTA FUNÇÃO. A tela marca os portais a partir do
// checklist da casa (as regras da planilha) pelo `mapaBullai`; aqui só se confere
// que cada portal existe no catálogo, aceita aquele tipo de documento e não é
// presencial — e se pede.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveBullai } from '../_shared/segredos.ts'
import { BASE_BULLAI, ErroBullai, pedirBullai, portaisBullai } from '../_shared/bullai.ts'
import { corpoDoPedido, estadoDoItem, type RodadaDoPortal } from '../_shared/resultadoBullai.ts'
import { lerCadastroDoCard } from '../_shared/cadastroDoCard.ts'
import { garantirPastaDoCedente } from '../_shared/planilhaJuridica.ts'
import { driveFindOrCreateFolder, driveUploadBytes } from '../_shared/credijuris.ts'

type Servico = ReturnType<typeof serviceClient>

interface JobDaBullai {
  jobId: string
  status: string
  isFinal: boolean
  portalRuns: RodadaDoPortal[]
  artifacts: { artifactId: string; fileName: string; sizeBytes: number; portalKey: string }[]
}

/** Um PDF da BullAI já guardado na pasta do cedente. */
interface ArquivoNoDrive {
  artifactId: string
  drive_file_id: string
  drive_link: string | null
  nome: string
}

const limparNome = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150)

// ------------------------------------------------------------------ PEDIR
async function pedir(svc: Servico, chave: string, leadId: number, body: any, criadoPor: string) {
  const pedidos = Array.isArray(body?.pedidos) ? body.pedidos : []
  if (pedidos.length === 0) return jsonResponse({ error: 'Nenhuma certidão marcada para pedir.' }, 400)

  // O CATÁLOGO VIVO, e não o que a tela tinha: portal que saiu do catálogo entre
  // a marcação e o clique não pode ser pedido.
  const catalogo = new Map((await portaisBullai(chave)).map((p) => [p.chave, p]))

  const criados: { job_id: string; sujeito: string; portais: number }[] = []
  const recusados: string[] = []

  for (const p of pedidos) {
    const { data: sujeito } = await svc
      .from('dd_sujeito')
      .select('id, papel, tipo_pessoa, nome, documento, data_nascimento, nome_mae, uf_atual, municipio_atual')
      .eq('id', String(p?.sujeito_id ?? ''))
      .eq('kommo_lead_id', leadId)
      .maybeSingle()
    if (!sujeito) {
      recusados.push('Sujeito não encontrado neste crédito.')
      continue
    }
    const documento = sujeito.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF'

    // O MAPA portal → itens do checklist: é por ele que o resultado de cada
    // portal volta para a linha certa.
    const portais: Record<string, string[]> = {}
    for (const it of Array.isArray(p?.itens) ? p.itens : []) {
      for (const k of Array.isArray(it?.portais) ? it.portais : []) {
        const lista = portais[String(k)] ?? []
        if (it?.certidao_id) lista.push(String(it.certidao_id))
        portais[String(k)] = lista
      }
    }
    for (const k of Array.isArray(p?.extras) ? p.extras : []) portais[String(k)] = portais[String(k)] ?? []

    const invalidos = Object.keys(portais).filter((k) => {
      const c = catalogo.get(k)
      return !c || c.documento !== documento || c.presencial
    })
    for (const k of invalidos) delete portais[k]
    const chaves = Object.keys(portais)
    if (invalidos.length) {
      recusados.push(`${sujeito.nome}: ${invalidos.length} certidão(ões) fora do catálogo ou de outro tipo de documento (${invalidos.join(', ')}).`)
    }
    if (chaves.length === 0) continue

    const montado = corpoDoPedido(sujeito, chaves)
    if (!montado.ok) {
      recusados.push(montado.falta)
      continue
    }

    let job: JobDaBullai
    try {
      job = await pedirBullai<JobDaBullai>(chave, '/jobs', { method: 'POST', body: JSON.stringify(montado.corpo) })
    } catch (e) {
      recusados.push(`${sujeito.nome}: ${(e as Error).message}`)
      // SEM CONSULTAS NÃO ADIANTA TENTAR OS PRÓXIMOS.
      if ((e as ErroBullai).status === 402) break
      continue
    }

    await svc.from('bullai_pedido').insert({
      job_id: job.jobId,
      kommo_lead_id: leadId,
      sujeito_id: sujeito.id,
      documento: String(sujeito.documento),
      tipo_documento: documento,
      portais,
      status: job.status,
      is_final: Boolean(job.isFinal),
      portal_runs: job.portalRuns ?? [],
      artifacts: job.artifacts ?? [],
      criado_por: criadoPor,
    })

    // OS ITENS PASSAM A "EM EMISSÃO" na hora — é o que a tela mostra enquanto a
    // BullAI trabalha, e o que impede alguém de pedir de novo o mesmo item.
    const ids = [...new Set(Object.values(portais).flat())]
    for (const id of ids) {
      const doItem = chaves.filter((k) => portais[k].includes(id))
      await svc
        .from('dd_certidao')
        .update({
          status: 'EM_EMISSAO',
          bullai_job_id: job.jobId,
          bullai_portais: doItem,
          erro_classe: null,
          erro_detalhe: null,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('kommo_lead_id', leadId)
    }
    criados.push({ job_id: job.jobId, sujeito: sujeito.nome, portais: chaves.length })
  }

  return jsonResponse({ ok: criados.length > 0, criados, recusados })
}

// -------------------------------------------------------------- ATUALIZAR
async function atualizar(svc: Servico, chave: string, leadId: number) {
  const { data: pedidos } = await svc
    .from('bullai_pedido')
    .select('*')
    .eq('kommo_lead_id', leadId)
  const abertos = (pedidos ?? []).filter(
    (p: any) => !p.is_final || (Array.isArray(p.artifacts) && p.artifacts.length > (p.baixados?.length ?? 0)),
  )
  if (abertos.length === 0) return jsonResponse({ ok: true, atualizados: 0 })

  // A PASTA DO CEDENTE, a mesma da planilha — e dentro dela, "Certidões".
  let pastaCertidoes: { token: string; id: string } | null = null
  const pasta = async () => {
    if (pastaCertidoes) return pastaCertidoes
    const { data: card } = await svc
      .from('kommo_leads')
      .select('nome, processo_cnj, notas, nota_texto')
      .eq('kommo_lead_id', leadId)
      .maybeSingle()
    const cadastro = lerCadastroDoCard((card ?? {}) as any)
    const { token, pastaId } = await garantirPastaDoCedente({
      originador: cadastro.intermediador,
      cedente: cadastro.cedente,
    })
    await svc.from('kommo_leads').update({ drive_pasta_id: pastaId }).eq('kommo_lead_id', leadId)
    pastaCertidoes = { token, id: await driveFindOrCreateFolder(token, 'Certidões', pastaId) }
    return pastaCertidoes
  }

  const { data: validades } = await svc.from('certidao_catalogo').select('codigo, validade_dias')
  const validadeDe = new Map(((validades ?? []) as any[]).map((v) => [v.codigo, v.validade_dias as number | null]))
  const falhas: string[] = []

  for (const p of abertos as any[]) {
    let job: JobDaBullai
    try {
      job = await pedirBullai<JobDaBullai>(chave, `/jobs/${encodeURIComponent(p.job_id)}`)
    } catch (e) {
      falhas.push(`${p.job_id}: ${(e as Error).message}`)
      continue
    }

    // O QUE JÁ DESCEU em rodadas anteriores mora no próprio anexo, em
    // `artifacts[].drive` — é por ele que reconsultar não baixa de novo.
    const baixados = new Set<string>(p.baixados ?? [])
    const arquivosPorPortal = new Map<string, ArquivoNoDrive[]>()
    for (const a of (Array.isArray(p.artifacts) ? p.artifacts : []) as any[]) {
      if (!a?.drive?.drive_file_id) continue
      const lista = arquivosPorPortal.get(a.portalKey) ?? []
      lista.push({ artifactId: a.artifactId, ...a.drive })
      arquivosPorPortal.set(a.portalKey, lista)
    }
    const { data: sujeito } = await svc.from('dd_sujeito').select('nome').eq('id', p.sujeito_id).maybeSingle()
    for (const art of job.artifacts ?? []) {
      if (baixados.has(art.artifactId)) continue
      try {
        const res = await fetch(
          `${BASE_BULLAI}/jobs/${encodeURIComponent(p.job_id)}/artifacts/${encodeURIComponent(art.artifactId)}/download`,
          { headers: { 'x-api-key': chave } },
        )
        if (!res.ok) throw new Error(`download HTTP ${res.status}`)
        const bytes = new Uint8Array(await res.arrayBuffer())
        const rodada = (job.portalRuns ?? []).find((r) => r.portalKey === art.portalKey)
        const { token, id } = await pasta()
        const nome = limparNome(`${rodada?.portalLabel ?? art.portalKey} - ${sujeito?.nome ?? p.documento}`) + '.pdf'
        const up = await driveUploadBytes(token, nome, id, bytes, 'application/pdf', true)
        const lista = arquivosPorPortal.get(art.portalKey) ?? []
        lista.push({ artifactId: art.artifactId, drive_file_id: up.id, drive_link: up.webViewLink ?? null, nome })
        arquivosPorPortal.set(art.portalKey, lista)
        baixados.add(art.artifactId)
      } catch (e) {
        falhas.push(`${art.fileName}: ${(e as Error).message}`)
      }
    }

    // O PEDIDO, numa gravação só: o estado da BullAI e, em cada anexo, onde
    // ele ficou no Drive.
    await svc
      .from('bullai_pedido')
      .update({
        status: job.status,
        is_final: Boolean(job.isFinal),
        portal_runs: job.portalRuns ?? [],
        artifacts: (job.artifacts ?? []).map((a) => {
          const noDrive = (arquivosPorPortal.get(a.portalKey) ?? []).find((x) => x.artifactId === a.artifactId)
          return noDrive
            ? { ...a, drive: { drive_file_id: noDrive.drive_file_id, drive_link: noDrive.drive_link, nome: noDrive.nome } }
            : a
        }),
        baixados: [...baixados],
        atualizado_em: new Date().toISOString(),
      })
      .eq('job_id', p.job_id)

    // CADA ITEM DO CHECKLIST, pelo que os portais DELE disseram.
    const comArquivo = new Set([...arquivosPorPortal.entries()].filter(([, l]) => l.length > 0).map(([k]) => k))
    const itens = new Set<string>(Object.values((p.portais ?? {}) as Record<string, string[]>).flat())
    for (const id of itens) {
      const doItem = Object.entries((p.portais ?? {}) as Record<string, string[]>)
        .filter(([, ids]) => ids.includes(id))
        .map(([k]) => k)
      const estado = estadoDoItem(doItem, job.portalRuns ?? [], comArquivo)
      const arquivos = doItem.flatMap((k) =>
        (arquivosPorPortal.get(k) ?? []).map((a) => ({ portal: k, ...a })),
      )
      const { data: item } = await svc.from('dd_certidao').select('certidao_codigo').eq('id', id).maybeSingle()
      const hoje = new Date().toISOString().slice(0, 10)
      const dias = validadeDe.get(String(item?.certidao_codigo ?? '')) ?? null
      const validade = dias ? new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10) : null
      const mudanca: Record<string, unknown> = {
        status: estado.status,
        resultado: estado.resultado,
        arquivos,
        atualizado_em: new Date().toISOString(),
      }
      if (estado.status === 'OBTIDA') {
        mudanca.drive_file_id = arquivos[0]?.drive_file_id ?? null
        mudanca.drive_link = arquivos[0]?.drive_link ?? null
        mudanca.emitida_em = hoje
        mudanca.validade_ate = validade
        mudanca.metodo_obtido = 'bullai'
        mudanca.erro_classe = null
        mudanca.erro_detalhe = null
      } else if (estado.status === 'FALHA' || estado.status === 'PENDENTE_MANUAL') {
        mudanca.erro_classe = estado.status === 'FALHA' ? 'bullai' : 'presencial'
        mudanca.erro_detalhe = estado.detalhe
      }
      const { error } = await svc.from('dd_certidao').update(mudanca).eq('id', id)
      if (error) falhas.push(`item ${id}: ${error.message}`)
    }
  }

  return jsonResponse({ ok: true, atualizados: abertos.length, falhas })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const svc = serviceClient()
    const user = await getCallerAtivo(req, svc)
    if (!user) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const body = await req.json().catch(() => ({}))
    const leadId = Number(body?.kommo_lead_id)
    if (!leadId) return jsonResponse({ error: 'kommo_lead_id é obrigatório.' }, 400)
    const chave = await chaveBullai()
    if (!chave) return jsonResponse({ error: 'Chave da BullAI não configurada — grave-a em Configurações.' }, 400)

    if (body?.acao === 'pedir') return await pedir(svc, chave, leadId, body, user.id)
    if (body?.acao === 'atualizar') return await atualizar(svc, chave, leadId)
    return jsonResponse({ error: 'Ação desconhecida.' }, 400)
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500)
  }
})
