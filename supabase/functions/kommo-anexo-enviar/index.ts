// kommo-anexo-enviar — sobe ao card do Kommo um arquivo escolhido no computador,
// com uma anotação.
//
// O PRIMEIRO USO é o memorando de negociação (29/09/2026): o comercial consegue
// o memorando assinado, alguém o escolhe no computador pela plataforma ("Anexar"),
// e o card recebe o arquivo e a anotação "Memorando assinado." — a tela, em
// seguida, move o card para a remessa aos fundos (pela kommo-mover).
//
// O NAVEGADOR NÃO FALA COM O KOMMO: o envio das partes ao drive exige o token de
// administrador. O arquivo passa por aqui.
//
// SEM GUARDAR O ARQUIVO INTEIRO: ele chega como o CORPO da requisição (não como
// formulário) e sai para o Kommo em partes de 512 KB, à medida que chega. É o
// que deixa o teto em 100 MB sem encostar nos 256 MB de memória da função — e,
// de quebra, o Kommo já está recebendo enquanto o navegador ainda envia.
//
// NO CARD FICAM DUAS NOTAS, nesta ordem: a de ARQUIVO (tipo `attachment`, que o
// Kommo mostra com o nome e o link) e a de TEXTO, com o nome de quem enviou no
// rodapé. A nota de arquivo do Kommo não leva texto — é da documentação.
//
// CADA NOTA NO SEU PEDIDO: o Kommo recusa o lote inteiro quando uma nota dele
// é recusada, e a nota de arquivo derrubava junto a de texto — que é a que o
// comercial lê.
//
// USO (POST, com sessão): o arquivo no corpo, e nos cabeçalhos
//   x-lead-id, x-nome (encodeURIComponent), x-texto (encodeURIComponent) e
//   x-tamanho (bytes). O TAMANHO VAI EM CABEÇALHO PRÓPRIO porque o Content-Length
//   pode não chegar até aqui: no caminho do navegador à função o corpo pode ser
//   reenviado em blocos, e sem tamanho a sessão do Kommo não abre.
import { kommoFetch } from '../_shared/kommoFetch.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { contaKommo } from '../_shared/segredos.ts'
import { marcarComoDePessoa } from '../_shared/notaCredijuris.ts'
import { urlDoDriveDaConta } from '../_shared/driveDoKommo.ts'

/** Teto do arquivo (pedido de 29/09/2026). */
const MAX_BYTES = 100 * 1024 * 1024

// OS CABEÇALHOS PRÓPRIOS entram no CORS desta função: sem isso o navegador nem
// chega a enviar.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-lead-id, x-nome, x-texto, x-tamanho',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const limparNome = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180)
const decodificar = (s: string | null) => {
  try {
    return decodeURIComponent(s ?? '')
  } catch {
    return s ?? ''
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return responder({ erro: ERRO_ACESSO }, 401)

    const leadId = Number(req.headers.get('x-lead-id'))
    const nome = limparNome(decodificar(req.headers.get('x-nome')) || 'arquivo')
    const texto = decodificar(req.headers.get('x-texto')).trim()
    const tamanho = Number(req.headers.get('x-tamanho')) || Number(req.headers.get('content-length'))
    const mime = req.headers.get('content-type') || 'application/octet-stream'
    if (!leadId) return responder({ erro: 'lead_id é obrigatório.' }, 400)
    if (!tamanho || !req.body) {
      return responder({ erro: 'Nenhum arquivo recebido (a função não soube o tamanho do arquivo).' }, 400)
    }
    if (tamanho > MAX_BYTES) {
      return responder({ erro: `Arquivo grande demais (${Math.round(tamanho / 1048576)} MB; o limite é 100 MB).` }, 413)
    }

    // SÓ CARD QUE A PLATAFORMA CONHECE: um id solto anexaria arquivo a qualquer
    // card da conta.
    const { data: espelho } = await svc
      .from('kommo_leads')
      .select('kommo_lead_id')
      .eq('kommo_lead_id', leadId)
      .maybeSingle()
    if (!espelho) return responder({ erro: 'Card não encontrado no espelho local.' }, 404)

    const conta = await contaKommo()
    if (!conta) return responder({ erro: 'Kommo não configurado.' }, 500)
    const auth = { Authorization: `Bearer ${conta.token}` }
    const base = `https://${conta.subdominio}.kommo.com/api/v4`

    // 1. A SESSÃO DE ENVIO no drive do Kommo, com o tamanho declarado.
    const drive = await urlDoDriveDaConta(base, auth)
    const s = await fetch(`${drive}/v1.0/sessions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: nome, file_size: tamanho, content_type: mime }),
    })
    if (!s.ok) {
      return responder({ erro: `O drive do Kommo recusou o envio (HTTP ${s.status}): ${(await s.text()).slice(0, 160)}` }, 502)
    }
    const sessao = (await s.json()) as { upload_url?: string; max_part_size?: number; max_file_size?: number }
    if (sessao.max_file_size && tamanho > Number(sessao.max_file_size)) {
      return responder({ erro: `O Kommo aceita até ${Math.round(Number(sessao.max_file_size) / 1048576)} MB por arquivo.` }, 413)
    }
    const parte = Number(sessao.max_part_size) || 524_288
    let url: string | null = sessao.upload_url ?? null
    let uuid: string | null = null
    let versao: string | null = null

    const enviarParte = async (bytes: Uint8Array<ArrayBuffer>) => {
      if (!url) throw new Error('o drive do Kommo não devolveu o endereço da próxima parte')
      // O TIPO DO ARQUIVO em cada parte, como na receita oficial do Kommo.
      const r = await fetch(url, { method: 'POST', headers: { ...auth, 'Content-Type': mime }, body: bytes })
      if (!r.ok) throw new Error(`o drive do Kommo recusou uma parte (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}`)
      const j = (await r.json().catch(() => ({}))) as { uuid?: string; version_uuid?: string; next_url?: string }
      if (j?.uuid) uuid = String(j.uuid)
      if (j?.version_uuid) versao = String(j.version_uuid)
      url = j?.next_url ?? null
    }

    // 2. O CORPO, PARTE A PARTE: acumula até o tamanho da parte e manda. Enquanto
    // uma parte vai ao Kommo, a leitura espera — e o navegador também, que é o
    // que faz a barra de progresso andar no ritmo de verdade.
    const leitor = req.body.getReader()
    const buffer = new Uint8Array(parte)
    let cheio = 0
    let recebidos = 0
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      recebidos += value.byteLength
      if (recebidos > MAX_BYTES) throw new Error('o arquivo passou do limite de 100 MB')
      let pos = 0
      while (pos < value.byteLength) {
        const n = Math.min(parte - cheio, value.byteLength - pos)
        buffer.set(value.subarray(pos, pos + n), cheio)
        cheio += n
        pos += n
        if (cheio === parte) {
          await enviarParte(buffer.slice(0, cheio))
          cheio = 0
        }
      }
    }
    if (cheio > 0) await enviarParte(buffer.slice(0, cheio))
    if (recebidos !== tamanho) throw new Error(`o arquivo chegou incompleto (${recebidos} de ${tamanho} bytes)`)
    if (!uuid) throw new Error('o drive do Kommo terminou o envio sem devolver o arquivo')

    // 3. O ARQUIVO no card.
    const rAnexo = await kommoFetch(`${base}/leads/${leadId}/files`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ file_uuid: uuid }]),
    }, { idempotente: true /* vincular o mesmo arquivo de novo não duplica */ })
    if (!rAnexo.ok) {
      return responder({ erro: `O arquivo subiu, mas o Kommo recusou anexá-lo ao card (HTTP ${rAnexo.status}).` }, 502)
    }

    // 4. AS NOTAS: a do arquivo e, se houver, a do texto — com quem enviou.
    const { data: perfil } = await svc.from('profiles').select('nome, email').eq('id', caller.id).maybeSingle()
    const autor = perfil?.nome?.trim() || perfil?.email || caller.email || null
    const gravarNota = async (nota: Record<string, unknown>): Promise<string | null> => {
      const r = await kommoFetch(`${base}/leads/notes`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ entity_id: leadId, ...nota }]),
      })
      // O MOTIVO DO KOMMO vai junto: "HTTP 400" sozinho não diz o que corrigir.
      return r.ok ? null : `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`
    }
    const falhas: string[] = []
    const falhaDoArquivo = await gravarNota({
      note_type: 'attachment',
      params: { file_uuid: uuid, file_name: nome, ...(versao ? { version_uuid: versao } : {}) },
    })
    if (falhaDoArquivo) falhas.push(`a nota do arquivo não subiu (${falhaDoArquivo})`)
    if (texto) {
      const falhaDoTexto = await gravarNota({
        note_type: 'common',
        params: { text: marcarComoDePessoa(texto, autor) },
        is_need_to_trigger_digital_pipeline: false,
      })
      if (falhaDoTexto) falhas.push(`a anotação de texto não subiu (${falhaDoTexto})`)
    }
    const aviso = falhas.length ? `O arquivo foi anexado ao card, mas ${falhas.join('; ')}.` : null

    return responder({ ok: true, file_uuid: uuid, nome, aviso })
  } catch (e) {
    return responder({ erro: (e as Error).message }, 500)
  }
})
