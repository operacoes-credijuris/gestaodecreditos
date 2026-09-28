// escavador-autos-rotina — os autos do processo, do tribunal para o card do Kommo.
//
// O QUE ELA FAZ, a cada volta (cron de 10 minutos, e encadeada enquanto houver
// documento descendo):
//
//   1. PEDE. Card que chegou na primeira coluna do Operacional (RPV, precatório
//      interno e externo) ou na NOVOS do funil geral, e ainda não tem linha em
//      `escavador_autos_card` — um card que passa da NOVOS para um funil de
//      trabalho é pedido uma vez só: acha
//      o CNJ (título do card; na falta, anotações — é o `processo_cnj` do sync) e
//      pede os autos ao Escavador, com o certificado digital. R$ 1,34 por
//      processo, com cota diária. Autos já trazidos nos últimos 30 dias, por
//      este ou por outro card, não se pedem de novo.
//   2. ACOMPANHA. O robô do Escavador leva horas no tribunal (2h15 no teste de
//      22/09). O aviso deles chega pela `escavador-callback`; aqui, de meia em
//      meia hora e sem custo, confere-se o estado — é o que cobre o aviso que
//      não chegou.
//   3. ANEXA. Pronto o pedido, lista os documentos (todas as páginas da lista),
//      baixa cada PDF do Escavador e o sobe DIRETO como anexo do card, na ordem
//      do processo: "Autos 001 - 09-06-2020 - Petição Inicial.pdf". Nada fica
//      guardado na plataforma além do registro do que já subiu.
//
// POR QUE EM VOLTAS, e não tudo de uma vez: um processo grande são 206 PDFs e
// 336 MB, e uma Edge Function tem teto de tempo. Cada volta trabalha ~100 s e,
// sobrando documento, chama a próxima. A trava por card (`trabalhando_ate`)
// impede duas voltas de subirem o mesmo arquivo.
//
// AUTORIZAÇÃO: x-cron-secret (o cron) ou JWT de usuário ativo. Com JWT, aceita
// `{ lead_id }` para trabalhar só aquele card, agora — é o teste de um card sem
// esperar o cron.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveEscavador, contaKommo } from '../_shared/segredos.ts'
import { BASE_ESCAVADOR } from '../_shared/escavador.ts'
import { cnjDoCard, digitosDoCnj, mascaraCnj } from '../_shared/nucleo/cnj.ts'
import { assinarNota } from '../_shared/notaCredijuris.ts'
import {
  documentosDosAutos,
  emOrdemDosAutos,
  entradasDoOperacional,
  fatias,
  FUNIS_DE_ENTRADA_POR_NOME,
  motivoDoEstado,
  nomeDoAnexo,
  notaDeFalha,
  notaDosAutos,
} from '../_shared/autosParaOKommo.ts'

type Servico = ReturnType<typeof serviceClient>

/** Quanto uma volta trabalha antes de passar a vez. */
const ORCAMENTO_MS = 100_000
/** Pedidos novos ao Escavador por dia (R$ 1,34 cada). Protege de uma enxurrada de cards. */
const LIMITE_PEDIDOS_DIA = 40
/** De quanto em quanto se confere um pedido em aberto (a consulta não custa). */
const REVER_MIN = 30
/** Pedido parado há mais que isto é dado como perdido. */
const DESISTIR_H = 72
/** Autos trazidos há menos que isto servem sem pedir de novo. */
const REUSO_DIAS = 30
/**
 * Posse de pedido (PEDINDO) parada há mais que isto: a volta que a tomou morreu
 * no meio. Antes de pedir de novo, pergunta-se ao Escavador se o pedido saiu.
 */
const PEDINDO_PARADO_MS = 5 * 60_000
/** Tentativas por documento antes de desistir dele. */
const MAX_TENTATIVAS = 3
/** Voltas encadeadas no máximo, por disparo do cron. */
const MAX_ENCADEADAS = 12
/** Teto por PDF: o drive do Kommo aceita até 300 MB. */
const MAX_BYTES = 300 * 1024 * 1024

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
const agora = () => new Date().toISOString()

interface Card {
  kommo_lead_id: number
  numero_cnj: string | null
  estado: string
  pedido_id: number | null
  total_documentos: number
  anexados: number
  paginas: number
  chaves_anexadas: string[]
  verificado_em: string | null
  criado_em: string
  atualizado_em: string
}

// ------------------------------------------------------------------ Escavador
async function escavador(chave: string, caminho: string, init: RequestInit = {}) {
  const res = await fetch(caminho.startsWith('http') ? caminho : `${BASE_ESCAVADOR}${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${chave}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const centavos = Number(res.headers.get('Creditos-Utilizados') ?? 0) || 0
  const txt = await res.text()
  let corpo: any = txt
  try {
    corpo = JSON.parse(txt)
  } catch { /* o status conta a história */ }
  return { status: res.status, corpo, centavos }
}

/** A última atualização do processo no Escavador (consulta gratuita). */
async function ultimaVerificacao(chave: string, cnj: string): Promise<Record<string, any> | null> {
  const r = await escavador(chave, `/processos/numero_cnj/${cnj}/status-atualizacao`)
  return r.status === 200 ? (r.corpo?.ultima_verificacao ?? null) : null
}

// ------------------------------------------------------------------ Kommo
function clienteKommo(token: string, subdominio: string) {
  const auth = { Authorization: `Bearer ${token}` }
  const base = `https://${subdominio}.kommo.com/api/v4`
  let ultima = 0
  let drive: string | null = null
  // O TETO DO KOMMO É 7 REQUISIÇÕES POR SEGUNDO, e violá-lo bloqueia o IP.
  const api = async (caminho: string, init: RequestInit = {}) => {
    const espera = 160 - (Date.now() - ultima)
    if (espera > 0) await dormir(espera)
    ultima = Date.now()
    return fetch(`${base}${caminho}`, {
      ...init,
      headers: { ...auth, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    })
  }
  return {
    async urlDoDrive(): Promise<string> {
      if (drive) return drive
      const r = await api('/account?with=drive_url')
      const u = ((await r.json().catch(() => ({}))) as any)?.drive_url
      if (!u) throw new Error('não consegui descobrir o drive da conta Kommo')
      drive = String(u)
      return drive
    },
    /** Sobe um PDF ao drive do Kommo, em partes, e devolve o uuid do arquivo. */
    async subir(nome: string, bytes: Uint8Array): Promise<string> {
      const d = await this.urlDoDrive()
      const s = await fetch(`${d}/v1.0/sessions`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: nome, file_size: bytes.byteLength, content_type: 'application/pdf' }),
      })
      if (!s.ok) throw new Error(`o drive do Kommo recusou a sessão (HTTP ${s.status}): ${(await s.text()).slice(0, 160)}`)
      const sessao = (await s.json()) as any
      if (sessao.max_file_size && bytes.byteLength > Number(sessao.max_file_size)) {
        throw new Error(`arquivo maior que o limite do Kommo (${bytes.byteLength} bytes)`)
      }
      let url: string | null = sessao.upload_url
      for (const [a, b] of fatias(bytes.byteLength, Number(sessao.max_part_size) || 524_288)) {
        if (!url) throw new Error('o drive do Kommo não devolveu o endereço da próxima parte')
        const r = await fetch(url, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/octet-stream' },
          body: bytes.slice(a, b),
        })
        if (!r.ok) throw new Error(`o drive do Kommo recusou uma parte (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}`)
        const j = (await r.json().catch(() => ({}))) as any
        if (j?.uuid) return String(j.uuid)
        url = j?.next_url ?? null
      }
      throw new Error('o drive do Kommo terminou o envio sem devolver o arquivo')
    },
    async anexar(leadId: number, uuids: string[]) {
      const r = await api(`/leads/${leadId}/files`, {
        method: 'PUT',
        body: JSON.stringify(uuids.map((file_uuid) => ({ file_uuid }))),
      })
      if (!r.ok) throw new Error(`o Kommo recusou o anexo (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}`)
    },
    async anotar(leadId: number, texto: string) {
      await api('/leads/notes', {
        method: 'POST',
        body: JSON.stringify([
          {
            entity_id: leadId,
            note_type: 'common',
            params: { text: assinarNota(texto) },
            is_need_to_trigger_digital_pipeline: false,
          },
        ]),
      }).catch(() => null)
    },
  }
}
type Kommo = ReturnType<typeof clienteKommo>

// ------------------------------------------------------------------ 1. PEDIR
async function pedirNovos(
  svc: Servico,
  chave: string,
  soEste: number | null,
  avisos: string[],
  clienteDaNota: Kommo,
) {
  const { data: etapas } = await svc
    .from('kommo_etapa')
    .select('pipeline_id, status_id, nome')
    .in('pipeline_id', FUNIS_DE_ENTRADA_POR_NOME)
  const entradas = entradasDoOperacional((etapas ?? []) as any[])

  let consulta = svc.from('kommo_leads').select('kommo_lead_id, pipeline_id, status_id, nome, processo_cnj')
  consulta = soEste
    ? consulta.eq('kommo_lead_id', soEste)
    : consulta.in('status_id', entradas.map((e) => e.status_id))
  const { data: leads } = await consulta
  const naEntrada = ((leads ?? []) as any[]).filter(
    (l) => soEste || entradas.some((e) => e.pipeline_id === Number(l.pipeline_id) && e.status_id === Number(l.status_id)),
  )
  if (naEntrada.length === 0) return

  const { data: linhas } = await svc
    .from('escavador_autos_card')
    .select('*')
    .in('kommo_lead_id', naEntrada.map((l) => l.kommo_lead_id))
  const porLead = new Map(((linhas ?? []) as Card[]).map((c) => [Number(c.kommo_lead_id), c]))

  // A COTA DO DIA, no fuso de Brasília.
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const { count } = await svc
    .from('escavador_consumo')
    .select('id', { count: 'exact', head: true })
    .eq('operacao', 'autos_pedido')
    .gte('criado_em', `${hoje}T03:00:00Z`)
  let pedidosHoje = count ?? 0

  for (const l of naEntrada) {
    const leadId = Number(l.kommo_lead_id)
    const linha = porLead.get(leadId)
    // UM PEDIDO POR CARD, PARA SEMPRE. Card com linha já foi pedido (ou
    // reaproveitou o pedido de outro) e não se pede de novo — nem quando muda de
    // coluna, nem quando o sync o apaga e o traz de volta. Só volta a ser olhado
    // quem ainda não custou nada: sem CNJ, na fila da cota, sem saldo — e a posse
    // que ficou parada porque a volta que a tomou morreu no meio.
    const retomavel = linha && ['SEM_CNJ', 'FILA', 'SEM_SALDO'].includes(linha.estado)
    const posseParada =
      linha?.estado === 'PEDINDO' && Date.now() - Date.parse(linha.atualizado_em) > PEDINDO_PARADO_MS
    if (linha && !retomavel && !posseParada) continue
    // NA FILA DA COTA, com a cota ainda cheia, nem se pergunta ao Escavador: a
    // consulta é de graça, mas uma por card a cada volta enche o log da conta.
    if (linha?.estado === 'FILA' && pedidosHoje >= LIMITE_PEDIDOS_DIA) continue

    const digitos = digitosDoCnj(l.processo_cnj || cnjDoCard(l.nome))
    if (digitos.length !== 20) {
      if (!linha) {
        // Chave primária: se outra volta já gravou, este insert só falha.
        await svc.from('escavador_autos_card').insert({
          kommo_lead_id: leadId,
          estado: 'SEM_CNJ',
          detalhe: 'Sem número de processo no título nem nas anotações do card.',
        })
      }
      continue
    }
    const cnj = mascaraCnj(digitos)

    // A POSSE DO CARD, ANTES DE QUALQUER CHAMADA PAGA. O cron, o sync e o aviso
    // do Escavador podem acordar a rotina ao mesmo tempo, e as duas voltas
    // leriam o mesmo card como "sem pedido". Quem pede é quem conseguiu gravar
    // PEDINDO — pela chave primária (card novo) ou por um update condicionado ao
    // estado que ela leu (card retomado). A outra volta encontra a posse tomada
    // e segue adiante.
    if (!linha) {
      const { error } = await svc
        .from('escavador_autos_card')
        .insert({ kommo_lead_id: leadId, numero_cnj: cnj, estado: 'PEDINDO', atualizado_em: agora() })
      if (error) continue
    } else {
      const { data: tomei } = await svc
        .from('escavador_autos_card')
        .update({ estado: 'PEDINDO', numero_cnj: cnj, atualizado_em: agora() })
        .eq('kommo_lead_id', leadId)
        .eq('estado', linha.estado)
        .eq('atualizado_em', linha.atualizado_em)
        .select('kommo_lead_id')
      if (!tomei?.length) continue
    }
    const gravar = (m: Record<string, unknown>) =>
      svc.from('escavador_autos_card').upsert(
        { kommo_lead_id: leadId, numero_cnj: cnj, atualizado_em: agora(), ...m },
        { onConflict: 'kommo_lead_id' },
      )

    // O MESMO PROCESSO EM OUTRO CARD: segue o pedido dele. Se o outro está no
    // meio do pedido, este espera a próxima volta em vez de pedir junto.
    const { data: irmao } = await svc
      .from('escavador_autos_card')
      .select('estado, pedido_id')
      .eq('numero_cnj', cnj)
      .in('estado', ['PEDINDO', 'AGUARDANDO', 'ANEXANDO', 'CONCLUIDO'])
      .neq('kommo_lead_id', leadId)
      .limit(1)
      .maybeSingle()
    if (irmao?.estado === 'PEDINDO') {
      await gravar({ estado: 'FILA', detalhe: 'Outro card deste processo está fazendo o pedido.' })
      continue
    }
    if (irmao?.pedido_id) {
      await gravar({
        estado: irmao.estado === 'AGUARDANDO' ? 'AGUARDANDO' : 'ANEXANDO',
        pedido_id: irmao.pedido_id,
        detalhe: 'O mesmo processo já foi pedido por outro card.',
      })
      continue
    }

    // AUTOS RECENTES NO ESCAVADOR não se pedem de novo — a consulta é de graça
    // e o pedido não. É também o que socorre a posse parada: se a volta que
    // morreu chegou a pedir, o pedido aparece aqui como PENDENTE e é adotado.
    const v = await ultimaVerificacao(chave, cnj)
    const comAutos = v?.opcoes?.autos === true
    const recente =
      v?.concluido_em && Date.now() - Date.parse(String(v.concluido_em)) < REUSO_DIAS * 86_400_000
    if (comAutos && v?.status === 'SUCESSO' && recente) {
      await registrarPedido(svc, Number(v.id), cnj, leadId, v)
      await gravar({ estado: 'ANEXANDO', pedido_id: Number(v.id), detalhe: 'Autos já trazidos recentemente.' })
      continue
    }
    if (comAutos && v?.status === 'PENDENTE') {
      await registrarPedido(svc, Number(v.id), cnj, leadId, v)
      await gravar({ estado: 'AGUARDANDO', pedido_id: Number(v.id), verificado_em: agora() })
      continue
    }

    if (pedidosHoje >= LIMITE_PEDIDOS_DIA) {
      await gravar({ estado: 'FILA', detalhe: `Cota de ${LIMITE_PEDIDOS_DIA} pedidos por dia atingida; pede amanhã.` })
      continue
    }

    const r = await escavador(chave, `/processos/numero_cnj/${cnj}/solicitar-atualizacao`, {
      method: 'POST',
      body: JSON.stringify({ autos: 1, utilizar_certificado: 1, enviar_callback: 1 }),
    })
    if (r.status === 402) {
      await gravar({ estado: 'SEM_SALDO', detalhe: 'O Escavador recusou o pedido por falta de crédito.' })
      avisos.push('Escavador sem saldo: os pedidos de autos param até a recarga.')
      break
    }
    const pedidoId = Number(r.corpo?.id ?? 0)
    if (r.status >= 300 || !pedidoId) {
      const detalhe = `O Escavador recusou o pedido (HTTP ${r.status}): ${String(r.corpo?.message ?? '').slice(0, 200)}`
      // RECUSA DEFINITIVA NÃO SE REPETE a cada volta — seria o log da conta
      // cheio de novo, como no primeiro teste. Só o erro do lado deles (5xx)
      // volta para a fila.
      // A RECUSA PODE SER "JÁ HÁ PEDIDO EM ANDAMENTO": outra volta, ou outra
      // pessoa pelo painel, pediu este processo entre a consulta e o POST. Aí o
      // card adota aquele pedido — é o mesmo processo, e ele já foi pago.
      const depois = r.status < 500 ? await ultimaVerificacao(chave, cnj) : null
      if (depois?.opcoes?.autos === true && depois?.status === 'PENDENTE') {
        await registrarPedido(svc, Number(depois.id), cnj, leadId, depois)
        await gravar({ estado: 'AGUARDANDO', pedido_id: Number(depois.id), verificado_em: agora(), detalhe: null })
      } else if (r.status >= 500) {
        await gravar({ estado: 'FILA', detalhe })
      } else {
        await gravar({ estado: 'FALHOU', detalhe })
        await clienteDaNota.anotar(leadId, notaDeFalha(cnj, detalhe.replace(/^O Escavador/, 'o Escavador')))
      }
      continue
    }
    pedidosHoje++
    await registrarPedido(svc, pedidoId, cnj, leadId, r.corpo)
    await svc.from('escavador_consumo').insert({
      kommo_lead_id: leadId,
      operacao: 'autos_pedido',
      alvo: cnj,
      centavos: r.centavos,
      requisicoes: 1,
      processos: 1,
    })
    await gravar({ estado: 'AGUARDANDO', pedido_id: pedidoId, verificado_em: agora(), detalhe: null })
  }
}

async function registrarPedido(svc: Servico, id: number, cnj: string, leadId: number, v: Record<string, any>) {
  await svc.from('escavador_pedido').upsert(
    {
      id,
      numero_cnj: cnj,
      kommo_lead_id: leadId,
      tipo: 'autos',
      status: String(v?.status ?? 'PENDENTE'),
      motivo_erro: v?.motivo_erro ?? null,
      concluido_em: v?.concluido_em ?? null,
      atualizado_em: agora(),
    },
    { onConflict: 'id' },
  )
}

// ------------------------------------------------------------------ 2. ACOMPANHAR
async function acompanhar(svc: Servico, chave: string, kommo: Kommo, soEste: number | null) {
  let q = svc.from('escavador_autos_card').select('*').eq('estado', 'AGUARDANDO')
  if (soEste) q = q.eq('kommo_lead_id', soEste)
  const { data } = await q
  const limite = Date.now() - REVER_MIN * 60_000
  for (const c of (data ?? []) as Card[]) {
    if (!soEste && c.verificado_em && Date.parse(c.verificado_em) > limite) continue
    const v = await ultimaVerificacao(chave, String(c.numero_cnj))
    const status = String(v?.status ?? 'PENDENTE').toUpperCase()
    const doPedido = v && (Number(v.id) === Number(c.pedido_id) || Date.parse(String(v.criado_em)) >= Date.parse(c.criado_em))
    if (v && doPedido) await registrarPedido(svc, Number(v.id), String(c.numero_cnj), c.kommo_lead_id, v)

    if (doPedido && status === 'SUCESSO') {
      await svc.from('escavador_autos_card')
        .update({ estado: 'ANEXANDO', verificado_em: agora(), atualizado_em: agora(), detalhe: null })
        .eq('kommo_lead_id', c.kommo_lead_id)
    } else if (doPedido && status !== 'PENDENTE') {
      const motivo = motivoDoEstado(status, v?.motivo_erro ?? null)
      await svc.from('escavador_autos_card')
        .update({ estado: 'FALHOU', detalhe: motivo, verificado_em: agora(), atualizado_em: agora() })
        .eq('kommo_lead_id', c.kommo_lead_id)
      await kommo.anotar(c.kommo_lead_id, notaDeFalha(String(c.numero_cnj), motivo))
    } else if (Date.now() - Date.parse(c.criado_em) > DESISTIR_H * 3_600_000) {
      const motivo = `o tribunal não respondeu em ${DESISTIR_H} horas`
      await svc.from('escavador_autos_card')
        .update({ estado: 'FALHOU', detalhe: motivo, atualizado_em: agora() })
        .eq('kommo_lead_id', c.kommo_lead_id)
      await kommo.anotar(c.kommo_lead_id, notaDeFalha(String(c.numero_cnj), motivo))
    } else {
      await svc.from('escavador_autos_card').update({ verificado_em: agora() }).eq('kommo_lead_id', c.kommo_lead_id)
    }
  }
}

// ------------------------------------------------------------------ 3. ANEXAR
/** A lista inteira dos autos, seguindo as páginas; com a dos públicos na falta de permissão. */
async function listarAutos(svc: Servico, chave: string, cnj: string, pedidoId: number | null) {
  const docs: ReturnType<typeof documentosDosAutos> = []
  for (const rota of ['autos', 'documentos-publicos']) {
    let url: string | null = `/processos/numero_cnj/${cnj}/${rota}?limit=100`
    let ok = false
    for (let i = 0; url && i < 60; i++) {
      const r = await escavador(chave, url)
      if (r.status !== 200) break
      ok = true
      docs.push(...documentosDosAutos(r.corpo))
      url = r.corpo?.links?.next ?? null
    }
    if (ok && docs.length) break
  }
  const vistos = new Set<string>()
  const unicos = emOrdemDosAutos(docs.filter((d) => !vistos.has(d.chave) && vistos.add(d.chave)))
  for (let i = 0; i < unicos.length; i += 100) {
    await svc.from('escavador_documento').upsert(
      unicos.slice(i, i + 100).map((d, j) => ({
        numero_cnj: cnj,
        pedido_id: pedidoId,
        chave: d.chave,
        nome: d.titulo,
        tipo: d.tipo,
        data_documento: d.data ? `${d.data}Z` : null,
        paginas: d.paginas,
        ordem: i + j + 1,
      })),
      { onConflict: 'numero_cnj,chave' },
    )
  }
  return unicos
}

async function anexar(svc: Servico, chave: string, kommo: Kommo, soEste: number | null, resta: () => number) {
  let q = svc.from('escavador_autos_card').select('*').eq('estado', 'ANEXANDO').order('atualizado_em')
  if (soEste) q = q.eq('kommo_lead_id', soEste)
  const { data } = await q
  let sobrou = false

  for (const c of (data ?? []) as Card[]) {
    if (resta() < 20_000) {
      sobrou = true
      break
    }
    // A TRAVA: só um trabalha neste card por vez.
    const { data: peguei } = await svc
      .from('escavador_autos_card')
      .update({ trabalhando_ate: new Date(Date.now() + 3 * 60_000).toISOString() })
      .eq('kommo_lead_id', c.kommo_lead_id)
      .or(`trabalhando_ate.is.null,trabalhando_ate.lt."${agora()}"`)
      .select('kommo_lead_id')
    if (!peguei?.length) continue

    const cnj = String(c.numero_cnj)
    try {
      let { data: docs } = await svc
        .from('escavador_documento')
        .select('*')
        .eq('numero_cnj', cnj)
        .order('ordem', { ascending: true })
      if (!docs?.length || c.total_documentos === 0) {
        const lista = await listarAutos(svc, chave, cnj, c.pedido_id)
        if (lista.length === 0) {
          const motivo = 'o Escavador concluiu, mas não entregou documento nenhum'
          await svc.from('escavador_autos_card')
            .update({ estado: 'FALHOU', detalhe: motivo, trabalhando_ate: null, atualizado_em: agora() })
            .eq('kommo_lead_id', c.kommo_lead_id)
          await kommo.anotar(c.kommo_lead_id, notaDeFalha(cnj, motivo))
          continue
        }
        const paginas = lista.reduce((t, d) => t + d.paginas, 0)
        await svc.from('escavador_autos_card')
          .update({ total_documentos: lista.length, paginas })
          .eq('kommo_lead_id', c.kommo_lead_id)
        c.total_documentos = lista.length
        c.paginas = paginas
        ;({ data: docs } = await svc
          .from('escavador_documento')
          .select('*')
          .eq('numero_cnj', cnj)
          .order('ordem', { ascending: true }))
      }

      const feitas = new Set(c.chaves_anexadas ?? [])
      const todos = (docs ?? []) as any[]
      // O DISJUNTOR: cinco falhas seguidas sem nenhum acerto nesta volta é defeito
      // do caminho (token sem acesso ao drive, cota do Kommo cheia), e não do
      // documento — insistir queimaria as tentativas dos 206 PDFs.
      let seguidas = 0
      let acertos = 0
      let ultimoErro = ''
      for (const d of todos) {
        if (seguidas >= 5 && acertos === 0) break
        if (feitas.has(d.chave) || Number(d.tentativas) >= MAX_TENTATIVAS) continue
        if (resta() < 20_000) {
          sobrou = true
          break
        }
        try {
          let uuid: string | null = d.kommo_file_uuid ?? null
          if (!uuid) {
            // OUTRO CARD DO MESMO PROCESSO pode ter subido este PDF enquanto
            // esta volta trabalhava: pergunta de novo antes de baixar.
            const { data: fresco } = await svc
              .from('escavador_documento')
              .select('kommo_file_uuid')
              .eq('id', d.id)
              .maybeSingle()
            uuid = fresco?.kommo_file_uuid ?? null
          }
          if (!uuid) {
            const res = await fetch(`${BASE_ESCAVADOR}/processos/numero_cnj/${cnj}/documentos/${d.chave}`, {
              headers: { Authorization: `Bearer ${chave}` },
            })
            if (!res.ok) throw new Error(`o Escavador recusou o download (HTTP ${res.status})`)
            const bytes = new Uint8Array(await res.arrayBuffer())
            if (bytes.byteLength > MAX_BYTES) throw new Error(`arquivo grande demais (${bytes.byteLength} bytes)`)
            const nome = nomeDoAnexo(Number(d.ordem) || 1, c.total_documentos, {
              titulo: String(d.nome ?? ''),
              data: d.data_documento ? String(d.data_documento).slice(0, 19) : null,
            })
            uuid = await kommo.subir(nome, bytes)
            await svc.from('escavador_documento')
              .update({ kommo_file_uuid: uuid, bytes: bytes.byteLength, baixado_em: agora(), erro: null })
              .eq('id', d.id)
          }
          await kommo.anexar(c.kommo_lead_id, [uuid])
          feitas.add(d.chave)
          await svc.from('escavador_documento').update({ anexado_em: agora() }).eq('id', d.id)
          acertos++
          seguidas = 0
          await svc.from('escavador_autos_card')
            .update({
              chaves_anexadas: [...feitas],
              anexados: feitas.size,
              trabalhando_ate: new Date(Date.now() + 3 * 60_000).toISOString(),
              atualizado_em: agora(),
            })
            .eq('kommo_lead_id', c.kommo_lead_id)
        } catch (e) {
          await svc.from('escavador_documento')
            .update({ tentativas: Number(d.tentativas) + 1, erro: String((e as Error).message).slice(0, 300) })
            .eq('id', d.id)
          d.tentativas = Number(d.tentativas) + 1
          d.erro = String((e as Error).message).slice(0, 300)
          seguidas++
          ultimoErro = String((e as Error).message)
        }
      }

      if (seguidas >= 5 && acertos === 0) {
        const motivo = `os PDFs não sobem para o Kommo: ${ultimoErro.slice(0, 200)}`
        await svc.from('escavador_autos_card')
          .update({ estado: 'FALHOU', detalhe: motivo, trabalhando_ate: null, atualizado_em: agora() })
          .eq('kommo_lead_id', c.kommo_lead_id)
        await kommo.anotar(c.kommo_lead_id, notaDeFalha(cnj, motivo))
        continue
      }

      const faltam = todos.filter((d) => !feitas.has(d.chave) && Number(d.tentativas) < MAX_TENTATIVAS)
      if (faltam.length === 0) {
        const falhas = todos.filter((d) => !feitas.has(d.chave)).map((d) => `${d.nome} (${d.erro ?? 'erro'})`)
        const datas = todos.map((d) => d.data_documento).filter(Boolean).sort()
        await svc.from('escavador_autos_card')
          .update({
            estado: 'CONCLUIDO',
            concluido_em: agora(),
            trabalhando_ate: null,
            detalhe: falhas.length ? `${falhas.length} documento(s) não desceram.` : null,
            atualizado_em: agora(),
          })
          .eq('kommo_lead_id', c.kommo_lead_id)
        await kommo.anotar(
          c.kommo_lead_id,
          notaDosAutos({
            cnj,
            anexados: feitas.size,
            total: todos.length,
            paginas: c.paginas,
            primeiro: datas[0] ?? null,
            ultimo: datas.at(-1) ?? null,
            falhas,
          }),
        )
      } else {
        sobrou = true
        await svc.from('escavador_autos_card').update({ trabalhando_ate: null }).eq('kommo_lead_id', c.kommo_lead_id)
      }
    } catch (e) {
      sobrou = true
      await svc.from('escavador_autos_card')
        .update({ trabalhando_ate: null, detalhe: String((e as Error).message).slice(0, 300), atualizado_em: agora() })
        .eq('kommo_lead_id', c.kommo_lead_id)
    }
  }
  return sobrou
}

/** A próxima volta, numa invocação separada — nenhuma passa do teto de tempo. */
function proximaVolta(volta: number, soEste: number | null) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/escavador-autos-rotina`
  const p = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': Deno.env.get('CRON_SECRET') ?? '' },
    body: JSON.stringify({ volta: volta + 1, lead_id: soEste }),
  }).catch(() => {})
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(p)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const inicio = Date.now()
  const resta = () => ORCAMENTO_MS - (Date.now() - inicio)
  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    const porCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret
    if (!porCron) {
      const caller = await getCallerAtivo(req, serviceClient())
      if (!caller) return jsonResponse({ erro: ERRO_ACESSO }, 401)
    }
    const body = (await req.json().catch(() => ({}))) as { lead_id?: number; volta?: number }
    const soEste = Number(body.lead_id) || null
    const volta = Number(body.volta) || 0

    const svc = serviceClient()
    const chave = await chaveEscavador()
    const conta = await contaKommo()
    if (!chave) return jsonResponse({ erro: 'Token do Escavador não configurado.' }, 400)
    if (!conta) return jsonResponse({ erro: 'Kommo não configurado.' }, 400)
    const kommo = clienteKommo(conta.token, conta.subdominio)
    const avisos: string[] = []

    // A primeira volta pede e acompanha; as encadeadas só continuam anexando.
    if (volta === 0) {
      await pedirNovos(svc, chave, soEste, avisos, kommo)
      await acompanhar(svc, chave, kommo, soEste)
    }
    const sobrou = await anexar(svc, chave, kommo, soEste, resta)
    if (sobrou && volta < MAX_ENCADEADAS) proximaVolta(volta, soEste)

    let q = svc.from('escavador_autos_card').select('kommo_lead_id, numero_cnj, estado, anexados, total_documentos, detalhe')
    if (soEste) q = q.eq('kommo_lead_id', soEste)
    const { data: cards } = await q.order('atualizado_em', { ascending: false }).limit(soEste ? 1 : 20)
    return jsonResponse({ ok: true, volta, continua: sobrou, avisos, cards: cards ?? [] })
  } catch (e) {
    return jsonResponse({ erro: (e as Error).message }, 500)
  }
})
