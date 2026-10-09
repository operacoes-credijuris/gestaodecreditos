// A JUNÇÃO DOS AUTOS — a parte da rotina que fala com o Escavador e o Kommo.
//
// Cada processo pronto (estado ANEXANDO) passa por quatro passos, que
// atravessam invocações; o estado mora na coluna `juntada` (migração 0077):
//
//   1. LISTAR os documentos (a lista é a mesma de antes: escavador_documento).
//   2. MEDIR o tamanho de cada um — de graça no Escavador: só o cabeçalho da
//      resposta, sem baixar o corpo. É o que deixa o plano das partes ser
//      fixado ANTES de a primeira subir, e o "parte 1 de 3" sair certo.
//   3. MONTAR UMA PARTE por invocação: baixar os documentos dela, juntar com o
//      pdf-lib, subir ao drive do Kommo e ligar ao card. Os bytes da parte não
//      cabem no banco, então ela começa e termina na mesma invocação.
//   4. FECHAR: a nota de anexo de cada parte no chat do card (é o que a equipe
//      vê), e a nota dos autos dizendo o que foi reunido e onde está.
//
// O QUE PODE DERRUBAR A INVOCAÇÃO no meio de uma parte — memória (256 MB),
// CPU, relógio — não tem como ser pego. A tentativa conta ANTES de começar, e
// a parte que caiu duas vezes encolhe pela metade (ver `antesDaParte`).

import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { BASE_ESCAVADOR } from '../_shared/escavador.ts'
import { criarJuntador } from '../_shared/juntarPdfs.ts'
import { ArquivoGrandeDemaisParaOKommo, type ArquivoNoDrive } from '../_shared/driveDoKommo.ts'
import type { DocumentoDosAutos } from '../_shared/autosParaOKommo.ts'
import { notaDeFalha } from '../_shared/autosParaOKommo.ts'
import {
  antesDaParte,
  depoisDaParte,
  type DocDaJuntada,
  faltaMedir,
  type Juntada,
  juntadaInicial,
  lerJuntada,
  MAX_PASSAGEIRAS,
  MAX_TENTATIVAS_MEDIR,
  type NaoJuntado,
  nomeDaParte,
  notaDaJuntadaQueFalhou,
  notaDosAutosJuntos,
  type ParteFeita,
  type PartePlanejada,
  proximoPasso,
  registrarParte,
  tempoDaTentativa,
} from '../_shared/autosJuntos.ts'
import { ehPdf, erroPassageiro, falhaPassageira, MAX_BYTES_NA_MEMORIA, semAcessoAoKommo } from '../_shared/falhasDosAutos.ts'

// deno-lint-ignore no-explicit-any
type Servico = any

/** O que a junção pede do cliente do Kommo da rotina. */
export interface KommoDaJuntada {
  subirComVersao(nome: string, bytes: Uint8Array): Promise<ArquivoNoDrive>
  anexar(leadId: number, uuids: string[]): Promise<void>
  versaoDoArquivo(uuid: string): Promise<string | null>
  /** A nota de anexo no chat. Devolve null se entrou, ou o erro ("HTTP 400: …"). */
  anotarAnexo(leadId: number, a: { uuid: string; versao: string | null; nome: string }): Promise<string | null>
  anotar(leadId: number, texto: string): Promise<void>
}

interface Linha {
  kommo_lead_id: number
  numero_cnj: string
  rotulo: string
  pedido_id: number | null
  total_documentos: number
  paginas: number
  anexados: number
  juntada: unknown
}

/** A trava de uma volta num processo: o bastante para uma parte inteira. */
const TRAVA_MS = 7 * 60_000
/** Abaixo disto de tempo, nem se começa um processo. */
const MINIMO_PARA_COMECAR_MS = 45_000
const TEMPO_DOWNLOAD_MS = 90_000
const TEMPO_MEDIR_MS = 30_000
/** Downloads em paralelo do Escavador (por invocação). */
const PARALELOS = 3
/** Bytes baixados à frente da junção, no máximo — é memória que soma com a parte. */
const JANELA_BYTES = 24 * 1024 * 1024
/** Velocidades de reserva enquanto nenhuma foi medida (bytes/s). */
const BPS_SUBIDA_PADRAO = 700 * 1024
const BPS_DESCIDA_PADRAO = 2 * 1024 * 1024

const agora = () => new Date().toISOString()
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Falha que passa: a parte não teve culpa, e a tentativa volta. */
class Passageira extends Error {}
/** O tempo da volta não dá para terminar a parte: conta, e a parte encolhe se repetir. */
class SemTempo extends Error {}

/** O tempo que uma parte deve levar, pelo que já se mediu. */
export function tempoDaParte(bytes: number, bpsSubida: number | null): number {
  return Math.round((bytes / BPS_DESCIDA_PADRAO + bytes / (bpsSubida || BPS_SUBIDA_PADRAO)) * 1000) + 20_000
}

type Download = { ok: true; bytes: Uint8Array } | { ok: false; motivo: string }

/**
 * Um documento do Escavador. Recusa definitiva volta como motivo; a passageira lança.
 *
 * NUNCA PASSA DO `prazoFinal` (ver `tempoDaTentativa` em autosJuntos.ts): a
 * tentativa que levaria a invocação à morte vira falha passageira antes.
 */
async function baixar(chave: string, cnj: string, d: DocDaJuntada, prazoFinal = Infinity): Promise<Download> {
  let ultimo = ''
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    if (tentativa) await dormir(1500 * tentativa)
    const tempo = tempoDaTentativa(prazoFinal, Date.now(), TEMPO_DOWNLOAD_MS)
    if (tempo === null) throw new Passageira(ultimo || 'o tempo da volta acabou antes do download')
    let res: Response
    try {
      res = await fetch(`${BASE_ESCAVADOR}/processos/numero_cnj/${cnj}/documentos/${d.chave}`, {
        headers: { Authorization: `Bearer ${chave}` },
        signal: AbortSignal.timeout(tempo),
      })
    } catch (e) {
      ultimo = `o Escavador não respondeu ao download (${(e as Error)?.message ?? e})`
      continue
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      ultimo = `o Escavador recusou o download (HTTP ${res.status})`
      // TOKEN E LIMITE SÃO DA CONTA, não do documento: passam.
      if (falhaPassageira(res.status) || res.status === 401 || res.status === 403) continue
      return { ok: false, motivo: ultimo.replace(/^o Escavador/, 'Escavador') }
    }
    const tamanho = Number(res.headers.get('content-length') ?? 0) || 0
    if (tamanho > MAX_BYTES_NA_MEMORIA) {
      await res.body?.cancel().catch(() => {})
      return { ok: false, motivo: `grande demais (${Math.round(tamanho / 1_048_576)} MB)` }
    }
    try {
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (!ehPdf(bytes)) return { ok: false, motivo: 'o Escavador não devolveu um PDF' }
      return { ok: true, bytes }
    } catch (e) {
      ultimo = `o download caiu no meio (${(e as Error)?.message ?? e})`
    }
  }
  throw new Passageira(ultimo)
}

/**
 * O tamanho de um documento, sem guardá-lo: o cabeçalho basta; sem ele, o
 * corpo é contado em pedaços e jogado fora, sem nunca ficar inteiro na memória.
 */
async function medir(chave: string, cnj: string, d: DocDaJuntada): Promise<{ bytes: number } | { motivo: string } | { passageira: string }> {
  let res: Response
  try {
    res = await fetch(`${BASE_ESCAVADOR}/processos/numero_cnj/${cnj}/documentos/${d.chave}`, {
      headers: { Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(TEMPO_MEDIR_MS),
    })
  } catch (e) {
    return { passageira: `sem resposta (${(e as Error)?.message ?? e})` }
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    if (falhaPassageira(res.status) || res.status === 401 || res.status === 403) return { passageira: `HTTP ${res.status}` }
    return { motivo: `Escavador recusou o download (HTTP ${res.status})` }
  }
  const tamanho = Number(res.headers.get('content-length') ?? 0) || 0
  if (tamanho > 0) {
    await res.body?.cancel().catch(() => {})
    return { bytes: tamanho }
  }
  try {
    let total = 0
    const leitor = res.body!.getReader()
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      total += value.byteLength
    }
    return total > 0 ? { bytes: total } : { motivo: 'documento vazio' }
  } catch (e) {
    return { passageira: `o download caiu no meio (${(e as Error)?.message ?? e})` }
  }
}

export async function juntarProcessos(o: {
  svc: Servico
  chave: string
  kommo: KommoDaJuntada
  soEste: number | null
  resta: () => number
  /** O tempo inteiro da volta (ms): a parte que pede mais que isto começa mesmo assim, numa volta nova. */
  orcamento: number
  /** A lista dos autos, gravada em escavador_documento (a mesma da rotina antiga). */
  listar: (cnj: string, pedidoId: number | null) => Promise<DocumentoDosAutos[]>
}): Promise<boolean> {
  const { svc } = o
  let q = svc.from('escavador_autos_processo').select('*').eq('estado', 'ANEXANDO').order('atualizado_em')
  if (o.soEste) q = q.eq('kommo_lead_id', o.soEste)
  const { data } = await q
  let sobrou = false
  for (const p of (data ?? []) as Linha[]) {
    if (o.resta() < MINIMO_PARA_COMECAR_MS) {
      sobrou = true
      break
    }
    const { data: peguei } = await svc
      .from('escavador_autos_processo')
      .update({ trabalhando_ate: new Date(Date.now() + TRAVA_MS).toISOString() })
      .eq('kommo_lead_id', p.kommo_lead_id)
      .eq('numero_cnj', p.numero_cnj)
      .eq('estado', 'ANEXANDO')
      .or(`trabalhando_ate.is.null,trabalhando_ate.lt."${agora()}"`)
      .select('*')
    if (!peguei?.length) continue
    Object.assign(p, peguei[0])
    const r = await trabalhar(o, p)
    if (r === 'parte') {
      // UMA PARTE POR INVOCAÇÃO: é a CPU (2 s por pedido na Edge Function) que
      // manda, e juntar 48 MB já gasta uns 0,5 s. A próxima volta continua.
      sobrou = true
      break
    }
    if (r === 'continua') sobrou = true
  }
  return sobrou
}

async function lerDocs(svc: Servico, cnj: string): Promise<DocDaJuntada[]> {
  const fora: DocDaJuntada[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await svc
      .from('escavador_documento')
      .select('ordem, chave, nome, data_documento, paginas, bytes')
      .eq('numero_cnj', cnj)
      .not('ordem', 'is', null)
      .order('ordem', { ascending: true })
      .range(de, de + 999)
    if (error) throw new Error(`não consegui ler a lista dos autos: ${String(error.message).slice(0, 160)}`)
    for (const d of (data ?? []) as any[]) {
      fora.push({
        ordem: Number(d.ordem),
        chave: String(d.chave),
        nome: String(d.nome ?? '') || 'Documento',
        data: d.data_documento ? String(d.data_documento).slice(0, 19) : null,
        paginas: Number(d.paginas) || 0,
        bytes: d.bytes == null ? null : Number(d.bytes),
      })
    }
    if ((data ?? []).length < 1000) break
  }
  return fora
}

async function trabalhar(
  o: Parameters<typeof juntarProcessos>[0],
  p: Linha,
): Promise<'parte' | 'continua' | 'fim'> {
  const { svc, kommo } = o
  const cnj = p.numero_cnj
  const leadId = Number(p.kommo_lead_id)
  const gravar = async (m: Record<string, unknown>) => {
    const { error } = await svc
      .from('escavador_autos_processo')
      .update({ atualizado_em: agora(), ...m })
      .eq('kommo_lead_id', leadId)
      .eq('numero_cnj', cnj)
    if (error) throw new Error(`não consegui gravar o andamento da junção: ${String(error.message).slice(0, 160)}`)
  }
  // O processo que já tinha documentos soltos no card (antes de 07/10/2026) é
  // "rejuntado": a nota avisa que os soltos continuam lá.
  const j: Juntada = lerJuntada(p.juntada) ?? juntadaInicial(Number(p.anexados) > 0 ? 'rejuntar' : 'novo')
  const trava = () => new Date(Date.now() + TRAVA_MS).toISOString()
  const salvar = (m: Record<string, unknown> = {}) => gravar({ juntada: j, trabalhando_ate: trava(), ...m })

  try {
    // 1. A LISTA
    let docs = await lerDocs(svc, cnj)
    if (!docs.length || Number(p.total_documentos) === 0) {
      const lista = await o.listar(cnj, p.pedido_id)
      if (lista.length === 0) {
        const motivo = 'o Escavador concluiu, mas não entregou documento nenhum'
        await gravar({ estado: 'FALHOU', detalhe: motivo, trabalhando_ate: null, juntada: j })
        await kommo.anotar(leadId, notaDeFalha(cnj, motivo, p.rotulo))
        return 'fim'
      }
      const paginas = lista.reduce((t, d) => t + d.paginas, 0)
      await gravar({ total_documentos: lista.length, paginas })
      p.total_documentos = lista.length
      docs = await lerDocs(svc, cnj)
      if (!docs.length) throw new Error('a lista dos autos não ficou gravada; continua na próxima volta')
    }

    // 2. MEDIR
    if (faltaMedir(docs, j).length) {
      const completo = await medirTodos(o, cnj, docs, j)
      await salvar()
      if (!completo) {
        await gravar({ trabalhando_ate: null, detalhe: 'Medindo os documentos para planejar os PDFs; continua na próxima volta.' })
        return 'continua'
      }
      docs = await lerDocs(svc, cnj)
    }

    // 3. A PARTE
    const passo = proximoPasso(docs, j)
    if (passo.passo === 'medir') {
      await gravar({ trabalhando_ate: null, juntada: j })
      return 'continua'
    }
    if (passo.passo === 'parte') {
      // TEMPO PARA A PARTE INTEIRA, ou nem começa: a parte que não termina se
      // perde inteira. Uma parte maior que qualquer volta começa mesmo assim, numa
      // volta nova — e, se não couber, encolhe.
      const precisa = Math.min(tempoDaParte(passo.parte.bytes, j.bps), o.orcamento * 0.8)
      if (o.resta() < precisa) {
        await gravar({ trabalhando_ate: null, juntada: j })
        return 'continua'
      }
      if (antesDaParte(j) === 'desistir') {
        await falhar(o, p, j, gravar, 'nem partes de 4 MB conseguiram subir ao Kommo — o problema não é o tamanho')
        return 'fim'
      }
      await salvar({ detalhe: `Montando a parte ${passo.n} de ${passo.total}.` })
      const r = await montarEEnviar(o, p, docs, passo.parte, passo.n, passo.total, j, salvar)
      depoisDaParte(j, r.resultado)
      // SEM ACESSO AO DRIVE (token sem o escopo de arquivos) não passa sozinho.
      if (r.resultado !== 'ok' && semAcessoAoKommo(r.erro ?? '')) {
        await falhar(o, p, j, gravar, `os PDFs não sobem para o Kommo: ${r.erro}`)
        return 'fim'
      }
      const juntados = j.partes.reduce((t, x) => t + x.documentos, 0)
      await gravar({
        juntada: j,
        trabalhando_ate: null,
        ...(j.modo === 'novo' && juntados > 0 ? { anexados: juntados } : {}),
        detalhe: r.resultado === 'ok' ? `Parte ${passo.n} de ${passo.total} no card.` : `Parte ${passo.n}: ${r.erro} — tento de novo na próxima volta.`,
      })
      return 'parte'
    }

    // 4. FECHAR
    return await fechar(o, p, docs, j, gravar)
  } catch (e) {
    await gravar({ trabalhando_ate: null, juntada: j, detalhe: String((e as Error).message).slice(0, 300) }).catch(() => {})
    return 'continua'
  }
}

/** Mede os documentos que faltam, de PARALELOS em PARALELOS. true = todos medidos (ou fora). */
async function medirTodos(
  o: Parameters<typeof juntarProcessos>[0],
  cnj: string,
  docs: DocDaJuntada[],
  j: Juntada,
): Promise<boolean> {
  const faltam = faltaMedir(docs, j)
  const medidos: { numero_cnj: string; chave: string; bytes: number }[] = []
  const gravarMedidos = async () => {
    for (let i = 0; i < medidos.length; i += 100) {
      const { error } = await o.svc
        .from('escavador_documento')
        .upsert(medidos.slice(i, i + 100), { onConflict: 'numero_cnj,chave' })
      if (error) throw new Error(`não consegui gravar o tamanho dos documentos: ${String(error.message).slice(0, 160)}`)
    }
    medidos.length = 0
  }
  let i = 0
  let seguidas = 0
  let algumRespondeu = false
  const falharam: DocDaJuntada[] = []
  while (i < faltam.length) {
    if (o.resta() < 30_000) break
    // DISJUNTOR: o Escavador fora do ar não pode tirar documento nenhum da junção.
    if (seguidas >= 3 * PARALELOS) break
    const lote = faltam.slice(i, i + PARALELOS)
    i += lote.length
    const res = await Promise.all(lote.map((d) => medir(o.chave, cnj, d)))
    lote.forEach((d, k) => {
      const r = res[k]
      if ('bytes' in r) {
        medidos.push({ numero_cnj: cnj, chave: d.chave, bytes: r.bytes })
        seguidas = 0
        algumRespondeu = true
      } else if ('motivo' in r) {
        j.naoJuntados.push({ ordem: d.ordem, nome: d.nome, data: d.data, motivo: r.motivo })
        seguidas = 0
        algumRespondeu = true
      } else {
        seguidas++
        falharam.push(d)
      }
    })
    if (medidos.length >= 100) await gravarMedidos()
  }
  // A FALHA DE PASSAGEM SÓ CONTA CONTRA O DOCUMENTO quando os outros desceram
  // (ou quando ele é dos últimos): com o Escavador fora do ar, contar tiraria da
  // junção documentos que não tiveram culpa.
  if (algumRespondeu || faltam.length <= PARALELOS) {
    for (const d of falharam) {
      const n = (j.tentativasMedir[String(d.ordem)] ?? 0) + 1
      j.tentativasMedir[String(d.ordem)] = n
      if (n >= MAX_TENTATIVAS_MEDIR) {
        j.naoJuntados.push({ ordem: d.ordem, nome: d.nome, data: d.data, motivo: 'o Escavador não entregou o documento' })
      }
    }
  }
  await gravarMedidos()
  return faltaMedir(await lerDocs(o.svc, cnj), j).length === 0
}

/** Monta uma parte e sobe ao card. Nunca lança: o resultado diz como foi. */
async function montarEEnviar(
  o: Parameters<typeof juntarProcessos>[0],
  p: Linha,
  docs: DocDaJuntada[],
  plano: PartePlanejada,
  n: number,
  total: number,
  j: Juntada,
  salvar: (m?: Record<string, unknown>) => Promise<void>,
): Promise<{ resultado: 'ok' | 'passageira' | 'falha'; erro?: string }> {
  const cnj = p.numero_cnj
  const leadId = Number(p.kommo_lead_id)
  const ordens = new Set(plano.ordens)
  const daParte = docs.filter((d) => ordens.has(d.ordem)).sort((a, b) => a.ordem - b.ordem)
  const fora: NaoJuntado[] = []
  const recusar = (d: DocDaJuntada, motivo: string) => fora.push({ ordem: d.ordem, nome: d.nome, data: d.data, motivo })
  // A RECUSA É DEFINITIVA (404, cifrado, não é PDF): vale mesmo que a parte caia
  // depois — baixar de novo daria o mesmo.
  const guardarRecusas = () => {
    const ja = new Set(j.naoJuntados.map((d) => d.ordem))
    for (const d of fora) if (!ja.has(d.ordem)) j.naoJuntados.push(d)
  }

  let bytes: Uint8Array | null = null
  let paginas = 0
  const juntados: DocDaJuntada[] = []
  // O PRAZO DOS DOWNLOADS é o fim do orçamento da volta: nenhuma tentativa
  // começa ou dura além dele (ver `baixar`).
  const prazoDosDownloads = Date.now() + o.resta()
  try {
    if (daParte.length === 1) {
      // UM DOCUMENTO SÓ (o grande, que não cabe com outros): sobe como veio, sem
      // passar pelo pdf-lib — metade da memória, e o PDF cifrado não se perde.
      const d = daParte[0]
      const r = await baixar(o.chave, cnj, d, prazoDosDownloads)
      if (r.ok) {
        bytes = r.bytes
        paginas = d.paginas
        juntados.push(d)
      } else recusar(d, r.motivo)
    } else {
      const juntador = await criarJuntador({ PDFDocument })
      // OS DOWNLOADS VÃO À FRENTE, numa janela limitada em bytes: a junção é
      // sequencial (a ordem do processo), o download não precisa ser.
      const fila = [...daParte]
      const emVoo: { d: DocDaJuntada; p: Promise<Download> }[] = []
      let naJanela = 0
      const encher = () => {
        while (fila.length && emVoo.length < PARALELOS && (emVoo.length === 0 || naJanela + (fila[0].bytes ?? 0) <= JANELA_BYTES)) {
          const d = fila.shift()!
          naJanela += d.bytes ?? 0
          const pr = baixar(o.chave, cnj, d, prazoDosDownloads)
          pr.catch(() => {}) // a rejeição é lida na vez dele
          emVoo.push({ d, p: pr })
        }
      }
      encher()
      while (emVoo.length) {
        // O TEMPO DE SUBIR TEM DE SOBRAR: a parte que não sobe se perde inteira.
        if (o.resta() < plano.bytes / (j.bps || BPS_SUBIDA_PADRAO) * 1000 + 15_000) {
          throw new SemTempo('o tempo da volta não deu para baixar e subir a parte inteira')
        }
        const { d, p: pr } = emVoo.shift()!
        let r: Download
        try {
          r = await pr
        } finally {
          naJanela -= d.bytes ?? 0
        }
        encher()
        if (!r.ok) {
          recusar(d, r.motivo)
          continue
        }
        const jr = await juntador.juntar(r.bytes)
        if (jr.ok) {
          paginas += jr.paginas
          juntados.push(d)
        } else recusar(d, jr.motivo)
      }
      if (juntador.documentos > 0) bytes = await juntador.fechar()
    }
  } catch (e) {
    guardarRecusas()
    const erro = String((e as Error).message).slice(0, 200)
    return { resultado: e instanceof Passageira ? 'passageira' : 'falha', erro }
  }
  guardarRecusas()
  // NADA DA PARTE ABRIU: os documentos dela já estão entre os não juntados, e o
  // plano da próxima volta passa por cima deles.
  if (!bytes) return { resultado: 'ok' }

  const nome = nomeDaParte(p.rotulo, cnj, n, total)
  let arquivo: ArquivoNoDrive
  try {
    const t0 = Date.now()
    arquivo = await o.kommo.subirComVersao(nome, bytes)
    const s = (Date.now() - t0) / 1000
    if (s > 2) j.bps = Math.round(bytes.byteLength / s)
  } catch (e) {
    if (e instanceof ArquivoGrandeDemaisParaOKommo) {
      j.maxKommo = e.limite
      if (juntados.length === 1) {
        // UM DOCUMENTO SÓ, maior que o teto do Kommo: encolher não resolve.
        const d = juntados[0]
        j.naoJuntados.push({ ordem: d.ordem, nome: d.nome, data: d.data, motivo: 'maior que o limite de arquivo do Kommo' })
        return { resultado: 'ok' }
      }
      return { resultado: 'falha', erro: e.message }
    }
    const erro = String((e as Error).message).slice(0, 200)
    return { resultado: erroPassageiro(erro) ? 'passageira' : 'falha', erro }
  }
  const datas = juntados.map((d) => d.data).filter((d): d is string => !!d).sort()
  const parte: ParteFeita = {
    n,
    de: plano.ordens[0],
    ate: plano.ordens[plano.ordens.length - 1],
    nome,
    uuid: arquivo.uuid,
    versao: arquivo.versao,
    bytes: bytes.byteLength,
    paginas,
    documentos: juntados.length,
    primeiro: datas[0] ?? null,
    ultimo: datas.at(-1) ?? null,
    ligada: false,
    nota: 'pendente',
  }
  registrarParte(j, parte)
  // GRAVADA ANTES DE LIGAR: se a volta cair aqui, a parte não sobe de novo — só
  // a ligação ao card é refeita, no fechamento.
  await salvar()
  try {
    await o.kommo.anexar(leadId, [arquivo.uuid])
    parte.ligada = true
  } catch { /* o fechamento tenta de novo */ }
  return { resultado: 'ok' }
}

/** As notas de anexo no chat e a nota dos autos; o processo fica CONCLUIDO. */
async function fechar(
  o: Parameters<typeof juntarProcessos>[0],
  p: Linha,
  docs: DocDaJuntada[],
  j: Juntada,
  gravar: (m: Record<string, unknown>) => Promise<void>,
): Promise<'continua' | 'fim'> {
  const leadId = Number(p.kommo_lead_id)
  if (j.partes.length === 0) {
    const motivo = `nenhum dos ${docs.length} documento(s) pôde ser juntado (${j.naoJuntados.slice(0, 3).map((d) => d.motivo).join('; ')})`
    await falhar(o, p, j, gravar, motivo)
    return 'fim'
  }
  const pendente = await notasDeAnexo(o, p, j, gravar)
  if (pendente) return 'continua'
  if (!j.notaFinal) {
    await o.kommo.anotar(
      leadId,
      notaDosAutosJuntos({
        cnj: p.numero_cnj,
        rotulo: p.rotulo,
        modo: j.modo,
        partes: j.partes,
        totalDocumentos: docs.length,
        naoJuntados: [...j.naoJuntados].sort((a, b) => a.ordem - b.ordem),
      }),
    )
    j.notaFinal = true
  }
  j.concluida = true
  await gravar({
    estado: 'CONCLUIDO',
    concluido_em: agora(),
    trabalhando_ate: null,
    juntada: j,
    detalhe: j.naoJuntados.length ? `${j.naoJuntados.length} documento(s) não juntados.` : null,
  })
  return 'fim'
}

/**
 * Liga ao card a parte que ficou sem ligar e escreve a nota de anexo de cada
 * parte no chat. true = algo passageiro ficou para a próxima volta.
 */
async function notasDeAnexo(
  o: Parameters<typeof juntarProcessos>[0],
  p: Linha,
  j: Juntada,
  gravar: (m: Record<string, unknown>) => Promise<void>,
): Promise<boolean> {
  const leadId = Number(p.kommo_lead_id)
  for (const parte of j.partes) {
    if (!parte.ligada) {
      try {
        await o.kommo.anexar(leadId, [parte.uuid])
        parte.ligada = true
      } catch (e) {
        const erro = String((e as Error).message)
        depoisDaParte(j, 'passageira')
        if (erroPassageiro(erro) && j.passageiras <= MAX_PASSAGEIRAS) {
          await gravar({ juntada: j, trabalhando_ate: null, detalhe: `Ligando as partes ao card: ${erro.slice(0, 200)}` })
          return true
        }
        // Não liga de jeito nenhum: a nota de anexo no chat ainda o mostra.
      }
    }
    if (parte.nota === 'pendente') {
      const versao = parte.versao ?? (await o.kommo.versaoDoArquivo(parte.uuid).catch(() => null))
      parte.versao = versao
      const erro = await o.kommo.anotarAnexo(leadId, { uuid: parte.uuid, versao, nome: parte.nome })
      if (!erro) parte.nota = 'feita'
      else if (erroPassageiro(erro) && j.passageiras < MAX_PASSAGEIRAS) {
        depoisDaParte(j, 'passageira')
        await gravar({ juntada: j, trabalhando_ate: null, detalhe: `Nota de anexo no chat: ${erro.slice(0, 200)}` })
        return true
      } else parte.nota = 'recusada'
    }
    await gravar({ juntada: j, trabalhando_ate: new Date(Date.now() + TRAVA_MS).toISOString() })
  }
  return false
}

/** A junção não chega ao fim: o que subiu aparece no chat, e a nota diz o que faltou. */
async function falhar(
  o: Parameters<typeof juntarProcessos>[0],
  p: Linha,
  j: Juntada,
  gravar: (m: Record<string, unknown>) => Promise<void>,
  motivo: string,
): Promise<void> {
  // As partes que subiram aparecem no chat mesmo assim: são autos de verdade.
  j.passageiras = MAX_PASSAGEIRAS + 1
  if (j.partes.length) await notasDeAnexo(o, p, j, gravar).catch(() => false)
  // O REJUNTADO VOLTA A CONCLUIDO: o card continua com os documentos soltos de
  // antes, e a junção que não terminou não os substitui na análise.
  await gravar({
    estado: j.modo === 'rejuntar' ? 'CONCLUIDO' : 'FALHOU',
    detalhe: `${j.modo === 'rejuntar' ? 'Rejuntar falhou: ' : ''}${motivo}`.slice(0, 300),
    trabalhando_ate: null,
    juntada: j,
  })
  await o.kommo.anotar(
    Number(p.kommo_lead_id),
    notaDaJuntadaQueFalhou({ cnj: p.numero_cnj, rotulo: p.rotulo, partes: j.partes, motivo, modo: j.modo }),
  )
}
