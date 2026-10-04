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
//         chegaram para a pasta da ANÁLISE do card no Drive (subpasta
//         "Certidões") e põe no checklist o estado e o RESULTADO de cada certidão.
//         A resposta traz, quando a pasta foi aberta, `pasta_certidoes_url` e
//         `pasta_analise_url` — campos novos de 03/10/2026, para a tela dar o link.
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
import { driveUploadBytes } from '../_shared/credijuris.ts'
// A PASTA É A DA ANÁLISE DO CARD (03/10/2026) — ver _shared/pastaDaAnalise.ts.
import { pastaDasCertidoesDoCard } from '../_shared/pastaDoCard.ts'
import { urlDaPasta } from '../_shared/pastaDaAnalise.ts'
// A RESERVA ATÔMICA DOS ITENS ANTES DE PEDIR (03/10/2026) — ver o módulo.
import {
  itemPedivel,
  type ItemDoChecklist,
  pedidoRepetido,
  pedidosSemRegistro,
  PREFIXO_RESERVA,
  portaisDosReservados,
  RESERVA_VENCE_MIN,
  reservaVencida,
} from '../_shared/reservaBullai.ts'

type Servico = ReturnType<typeof serviceClient>

interface JobDaBullai {
  jobId: string
  status: string
  isFinal: boolean
  portalRuns: RodadaDoPortal[]
  artifacts: { artifactId: string; fileName: string; sizeBytes: number; portalKey: string }[]
}

/** Um PDF da BullAI já guardado na pasta das certidões. */
interface ArquivoNoDrive {
  artifactId: string
  drive_file_id: string
  drive_link: string | null
  nome: string
  /**
   * A pasta "Certidões" onde o PDF caiu (03/10/2026). Vai para
   * `dd_certidao.arquivos` (jsonb, sem migração): é por ela que a tela abre a
   * pasta certa sem perguntar ao Drive. Arquivos de antes não a têm.
   */
  pasta_id?: string
}

const limparNome = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150)

// ------------------------------------------------------------------ PEDIR
/** Violação de chave única: o registro do pedido já existe (outra tentativa gravou). */
const ehDuplicado = (e: { code?: string | null; message?: string | null } | null) =>
  !!e && (e.code === '23505' || /duplicate key/i.test(String(e.message ?? '')))

/**
 * Devolve os itens reservados ao estado em que estavam, quando o pedido não
 * saiu. CONDICIONAL AO TOKEN: item que outra coisa já mexeu não é tocado.
 * Devolve a primeira falha, ou null.
 */
async function liberarReserva(
  svc: Servico,
  leadId: number,
  reserva: string,
  antes: Map<string, ItemDoChecklist>,
  ids: string[],
): Promise<string | null> {
  let falha: string | null = null
  for (const id of ids) {
    const a = antes.get(id)
    if (!a) continue
    const { error } = await svc
      .from('dd_certidao')
      .update({
        status: a.status,
        bullai_job_id: a.bullai_job_id ?? null,
        bullai_portais: a.bullai_portais ?? [],
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('kommo_lead_id', leadId)
      .eq('bullai_job_id', reserva)
    if (error && !falha) falha = error.message
  }
  return falha
}

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

    // O MAPA portal → itens do checklist, COMO A TELA PEDIU: é por ele que o
    // resultado de cada portal volta para a linha certa. Depois da reserva ele
    // encolhe para os itens que esta chamada conseguiu travar.
    const pedidosDoMapa: Record<string, string[]> = {}
    for (const it of Array.isArray(p?.itens) ? p.itens : []) {
      for (const k of Array.isArray(it?.portais) ? it.portais : []) {
        const lista = pedidosDoMapa[String(k)] ?? []
        if (it?.certidao_id) lista.push(String(it.certidao_id))
        pedidosDoMapa[String(k)] = lista
      }
    }
    for (const k of Array.isArray(p?.extras) ? p.extras : []) {
      pedidosDoMapa[String(k)] = pedidosDoMapa[String(k)] ?? []
    }

    const invalidos = Object.keys(pedidosDoMapa).filter((k) => {
      const c = catalogo.get(k)
      return !c || c.documento !== documento || c.presencial
    })
    for (const k of invalidos) delete pedidosDoMapa[k]
    if (invalidos.length) {
      recusados.push(`${sujeito.nome}: ${invalidos.length} certidão(ões) fora do catálogo ou de outro tipo de documento (${invalidos.join(', ')}).`)
    }
    if (Object.keys(pedidosDoMapa).length === 0) continue

    // O CADASTRO ANTES DA RESERVA: CPF inválido ou nascimento faltando recusam o
    // pedido inteiro (não dependem dos portais), e não há por que travar itens.
    const conferido = corpoDoPedido(sujeito, Object.keys(pedidosDoMapa))
    if (!conferido.ok) {
      recusados.push(conferido.falta)
      continue
    }

    // ------------------------------------------------------------ A RESERVA
    // Ver `_shared/reservaBullai.ts`. Lê o estado dos itens e reserva com um
    // UPDATE CONDICIONAL ao status lido: de duas abas, só uma vê a linha mudar,
    // e só o que mudou segue para a BullAI.
    const pedidosIds = [...new Set(Object.values(pedidosDoMapa).flat())]
    const reserva = PREFIXO_RESERVA + crypto.randomUUID()
    const antes = new Map<string, ItemDoChecklist>()
    const reservados = new Set<string>()
    if (pedidosIds.length > 0) {
      const { data: lidos, error: eLeitura } = await svc
        .from('dd_certidao')
        .select('id, status, erro_classe, bullai_job_id, bullai_portais')
        .in('id', pedidosIds)
        .eq('kommo_lead_id', leadId)
      if (eLeitura) {
        recusados.push(`${sujeito.nome}: não consegui ler o checklist (${eLeitura.message}); nada foi pedido.`)
        continue
      }
      for (const l of (lidos ?? []) as ItemDoChecklist[]) antes.set(l.id, l)
      const porStatus = new Map<string, string[]>()
      for (const l of antes.values()) {
        if (itemPedivel(l)) porStatus.set(l.status, [...(porStatus.get(l.status) ?? []), l.id])
      }
      let falhaDaReserva: string | null = null
      for (const [status, ids] of porStatus) {
        const { data: mudaram, error } = await svc
          .from('dd_certidao')
          .update({ status: 'EM_EMISSAO', bullai_job_id: reserva, atualizado_em: new Date().toISOString() })
          .in('id', ids)
          .eq('kommo_lead_id', leadId)
          .eq('status', status)
          .select('id')
        if (error) {
          falhaDaReserva = error.message
          break
        }
        for (const m of (mudaram ?? []) as { id: string }[]) reservados.add(m.id)
      }
      if (falhaDaReserva) {
        await liberarReserva(svc, leadId, reserva, antes, [...reservados])
        recusados.push(`${sujeito.nome}: não consegui reservar os itens (${falhaDaReserva}); nada foi pedido.`)
        continue
      }
    }
    if (pedidoRepetido(pedidosIds.length, reservados.size)) {
      recusados.push(
        `${sujeito.nome}: as certidões marcadas já estão em emissão (pedidas por outra aba ou por um clique anterior); nada foi pedido de novo.`,
      )
      continue
    }
    const portais = portaisDosReservados(pedidosDoMapa, reservados)
    const chaves = Object.keys(portais)
    if (chaves.length === 0) {
      await liberarReserva(svc, leadId, reserva, antes, [...reservados])
      continue
    }
    const deFora = pedidosIds.length - reservados.size
    if (deFora > 0) {
      recusados.push(`${sujeito.nome}: ${deFora} certidão(ões) já em emissão ou fora de estado de pedido ficaram de fora.`)
    }
    const montado = corpoDoPedido(sujeito, chaves)
    if (!montado.ok) {
      await liberarReserva(svc, leadId, reserva, antes, [...reservados])
      recusados.push(montado.falta)
      continue
    }

    let job: JobDaBullai
    try {
      job = await pedirBullai<JobDaBullai>(chave, '/jobs', { method: 'POST', body: JSON.stringify(montado.corpo) })
    } catch (e) {
      // O PEDIDO NÃO SAIU: os itens voltam ao que eram, e podem ser pedidos de novo.
      const falhaDaVolta = await liberarReserva(svc, leadId, reserva, antes, [...reservados])
      recusados.push(
        `${sujeito.nome}: ${(e as Error).message}` +
          (falhaDaVolta ? ` (os itens ficaram reservados e voltam a FALHA em ${RESERVA_VENCE_MIN} min)` : ''),
      )
      // SEM CONSULTAS NÃO ADIANTA TENTAR OS PRÓXIMOS.
      if ((e as ErroBullai).status === 402) break
      continue
    }

    // DAQUI EM DIANTE O PEDIDO ESTÁ PAGO. Nenhuma falha de banco volta atrás
    // nele: cada uma é dita, e a 'atualizar' sabe recompor o que faltar.
    const registro = {
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
    }
    let { error: eRegistro } = await svc.from('bullai_pedido').insert(registro)
    if (eRegistro && !ehDuplicado(eRegistro)) {
      ;({ error: eRegistro } = await svc.from('bullai_pedido').insert(registro))
    }
    if (ehDuplicado(eRegistro)) eRegistro = null
    if (eRegistro) {
      console.error('[bullai-certidoes] registro do pedido', job.jobId, eRegistro.message)
      recusados.push(
        `${sujeito.nome}: o pedido saiu na BullAI (job ${job.jobId}), mas não foi registrado (${eRegistro.message}). ` +
          'A próxima atualização o recompõe pelos itens do checklist.',
      )
    }

    // OS ITENS PASSAM A "EM EMISSÃO" com o id do job — é o que a tela mostra
    // enquanto a BullAI trabalha, e o que a 'atualizar' usa para recompor o
    // registro se o insert acima falhou. Condicional ao token desta reserva.
    const naoLigados: string[] = []
    for (const id of reservados) {
      const doItem = chaves.filter((k) => portais[k].includes(id))
      const { error } = await svc
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
        .eq('bullai_job_id', reserva)
      if (error) naoLigados.push(error.message)
    }
    if (naoLigados.length) {
      console.error('[bullai-certidoes] itens do pedido', job.jobId, naoLigados)
      recusados.push(
        `${sujeito.nome}: ${naoLigados.length} item(ns) não foram ligados ao job ${job.jobId} (${naoLigados[0]}).` +
          (eRegistro
            ? ` Sem o registro do pedido, eles voltam a FALHA em ${RESERVA_VENCE_MIN} min.`
            : ' A atualização os acerta pelo registro do pedido.'),
      )
    }
    criados.push({ job_id: job.jobId, sujeito: sujeito.nome, portais: chaves.length })
  }

  return jsonResponse({ ok: criados.length > 0, criados, recusados })
}

// -------------------------------------------------------------- ATUALIZAR
/**
 * O QUE A AÇÃO 'pedir' PODE TER DEIXADO PELA METADE — ver `_shared/reservaBullai.ts`:
 *   - pedido pago sem linha em `bullai_pedido`: recomposto pelos itens, que
 *     guardam o id do job e os portais;
 *   - reserva sem pedido, vencida: o item volta a FALHA, com o motivo, e pode
 *     ser pedido de novo.
 * Devolve quantos itens/pedidos mudaram e as falhas, para a tela.
 */
async function recomporPedidos(
  svc: Servico,
  leadId: number,
  pedidos: any[],
): Promise<{ mudou: number; falhas: string[]; novos: any[] }> {
  const falhas: string[] = []
  const novos: any[] = []
  let mudou = 0
  const { data: itens, error } = await svc
    .from('dd_certidao')
    .select('id, status, sujeito_id, bullai_job_id, bullai_portais, atualizado_em')
    .eq('kommo_lead_id', leadId)
    .eq('status', 'EM_EMISSAO')
  if (error) return { mudou, falhas: [`checklist: ${error.message}`], novos }
  const lista = (itens ?? []) as ItemDoChecklist[]

  for (const r of pedidosSemRegistro(lista, new Set(pedidos.map((p) => String(p.job_id))))) {
    const { data: sujeito } = await svc
      .from('dd_sujeito')
      .select('documento, tipo_pessoa')
      .eq('id', String(r.sujeitoId ?? ''))
      .maybeSingle()
    if (!sujeito?.documento) {
      falhas.push(`job ${r.jobId}: sem o sujeito do pedido no checklist, não há como recompor o registro.`)
      continue
    }
    const linha = {
      job_id: r.jobId,
      kommo_lead_id: leadId,
      sujeito_id: r.sujeitoId,
      documento: String(sujeito.documento),
      tipo_documento: sujeito.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF',
      portais: r.portais,
    }
    const { data: criado, error: eIns } = await svc.from('bullai_pedido').insert(linha).select('*').single()
    if (eIns) {
      if (!ehDuplicado(eIns)) falhas.push(`job ${r.jobId}: registro não recomposto (${eIns.message})`)
      continue
    }
    novos.push(criado)
    mudou++
  }

  // RESERVA VENCIDA que nenhum pedido registrado cobre: a função que a fez
  // morreu antes de pedir (ou o pedido falhou e a devolução também).
  const cobertos = new Set<string>(
    [...pedidos, ...novos].flatMap((p) => Object.values((p.portais ?? {}) as Record<string, string[]>).flat()),
  )
  const agora = Date.now()
  for (const i of lista) {
    if (!reservaVencida(i, agora) || cobertos.has(i.id)) continue
    const { data: soltos, error: eSolta } = await svc
      .from('dd_certidao')
      .update({
        status: 'FALHA',
        erro_classe: 'bullai',
        erro_detalhe:
          `O pedido à BullAI não chegou a ser confirmado (reserva de mais de ${RESERVA_VENCE_MIN} min sem pedido). ` +
          'Pode pedir de novo.',
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', i.id)
      .eq('status', 'EM_EMISSAO')
      .eq('bullai_job_id', String(i.bullai_job_id))
      .select('id')
    if (eSolta) falhas.push(`item ${i.id}: ${eSolta.message}`)
    else mudou += (soltos ?? []).length
  }
  return { mudou, falhas, novos }
}

async function atualizar(svc: Servico, chave: string, leadId: number) {
  const { data: lidos, error: ePedidos } = await svc
    .from('bullai_pedido')
    .select('*')
    .eq('kommo_lead_id', leadId)
  // SEM A LISTA DE PEDIDOS NÃO SE RECOMPÕE NADA: todo item pareceria órfão.
  if (ePedidos) return jsonResponse({ ok: false, atualizados: 0, falhas: [`bullai_pedido: ${ePedidos.message}`] })
  const recomposicao = await recomporPedidos(svc, leadId, lidos ?? [])
  const pedidos = [...(lidos ?? []), ...recomposicao.novos]
  const abertos = pedidos.filter(
    (p: any) => !p.is_final || (Array.isArray(p.artifacts) && p.artifacts.length > (p.baixados?.length ?? 0)),
  )
  if (abertos.length === 0) {
    return jsonResponse({ ok: true, atualizados: recomposicao.mudou, falhas: recomposicao.falhas })
  }

  // A PASTA DA ANÁLISE DO CARD — e dentro dela, "Certidões".
  //
  // ERA RECALCULADA AQUI, sempre em "Precatórios" e pelo nome do título, e
  // GRAVADA no card: no RPV os PDFs iam para a categoria errada e o atalho do
  // card para a análise passava a apontar para eles; no precatório, um nome
  // mudado no título abria outra pasta. Agora é a pasta gravada no card, e só
  // na falta dela o caminho pela categoria do funil — gravado no card só se ele
  // estava sem pasta. Aberta uma vez por chamada, e só se houver PDF a subir.
  type PastaAberta = { token: string; id: string; analiseId: string }
  let pastaCertidoes: PastaAberta | null = null
  const pasta = async () => {
    if (pastaCertidoes) return pastaCertidoes
    const p = await pastaDasCertidoesDoCard(svc, leadId)
    pastaCertidoes = { token: p.token, id: p.pastaId, analiseId: p.pastaDaAnaliseId }
    return pastaCertidoes
  }

  const { data: validades } = await svc.from('certidao_catalogo').select('codigo, validade_dias')
  const validadeDe = new Map(((validades ?? []) as any[]).map((v) => [v.codigo, v.validade_dias as number | null]))
  const falhas: string[] = [...recomposicao.falhas]

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
        lista.push({
          artifactId: art.artifactId,
          drive_file_id: up.id,
          drive_link: up.webViewLink ?? null,
          nome,
          pasta_id: id,
        })
        arquivosPorPortal.set(art.portalKey, lista)
        baixados.add(art.artifactId)
      } catch (e) {
        falhas.push(`${art.fileName}: ${(e as Error).message}`)
      }
    }

    // O PEDIDO, numa gravação só: o estado da BullAI e, em cada anexo, onde
    // ele ficou no Drive.
    const { error: ePedido } = await svc
      .from('bullai_pedido')
      .update({
        status: job.status,
        is_final: Boolean(job.isFinal),
        portal_runs: job.portalRuns ?? [],
        artifacts: (job.artifacts ?? []).map((a) => {
          const noDrive = (arquivosPorPortal.get(a.portalKey) ?? []).find((x) => x.artifactId === a.artifactId)
          return noDrive
            ? {
                ...a,
                drive: {
                  drive_file_id: noDrive.drive_file_id,
                  drive_link: noDrive.drive_link,
                  nome: noDrive.nome,
                  ...(noDrive.pasta_id ? { pasta_id: noDrive.pasta_id } : {}),
                },
              }
            : a
        }),
        baixados: [...baixados],
        atualizado_em: new Date().toISOString(),
      })
      .eq('job_id', p.job_id)
    if (ePedido) falhas.push(`pedido ${p.job_id}: ${ePedido.message}`)

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

  // A PASTA NA RESPOSTA, quando foi aberta: a tela põe o link "Abrir pasta no
  // Drive" ao lado do resultado. Campos novos — quem não os lê segue igual.
  // (O elenco: o TypeScript não enxerga a atribuição feita dentro de `pasta()`.)
  const aberta = pastaCertidoes as PastaAberta | null
  return jsonResponse({
    ok: true,
    atualizados: abertos.length,
    falhas,
    ...(aberta
      ? {
          pasta_certidoes_url: urlDaPasta(aberta.id),
          pasta_analise_url: urlDaPasta(aberta.analiseId),
        }
      : {}),
  })
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
