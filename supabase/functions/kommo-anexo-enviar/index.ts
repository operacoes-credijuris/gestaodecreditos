// kommo-anexo-enviar — sobe ao card do Kommo um arquivo escolhido no computador,
// com uma anotação.
//
// O PRIMEIRO USO é o memorando de negociação (29/09/2026): o comercial consegue
// o memorando assinado, alguém o escolhe no computador pela plataforma, e o card
// recebe o arquivo e a anotação "Memorando assinado." — a tela, em seguida, move
// o card para a remessa aos fundos (pela kommo-mover, que já sabe fazer isso).
//
// O NAVEGADOR NÃO FALA COM O KOMMO: a API dele não tem CORS e o token é de
// administrador. O arquivo passa por aqui.
//
// NO CARD FICAM DUAS NOTAS, nesta ordem: a de ARQUIVO (tipo `attachment`, que o
// Kommo mostra com o nome e o link) e a de TEXTO, com o nome de quem enviou no
// rodapé. A nota de arquivo do Kommo não leva texto — é da documentação.
//
// USO (POST multipart, com sessão): lead_id, texto, arquivo.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { contaKommo } from '../_shared/segredos.ts'
import { marcarComoDePessoa } from '../_shared/notaCredijuris.ts'
import { subirAoDriveDoKommo, urlDoDriveDaConta } from '../_shared/driveDoKommo.ts'

/** Teto do arquivo. Um memorando é um PDF de poucas páginas; isto é folga, não meta. */
const MAX_BYTES = 25 * 1024 * 1024

const limparNome = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return jsonResponse({ erro: ERRO_ACESSO }, 401)

    const form = await req.formData().catch(() => null)
    if (!form) return jsonResponse({ erro: 'Envie o arquivo como formulário (multipart).' }, 400)
    const leadId = Number(form.get('lead_id'))
    const texto = String(form.get('texto') ?? '').trim()
    const arquivo = form.get('arquivo')
    if (!leadId) return jsonResponse({ erro: 'lead_id é obrigatório.' }, 400)
    if (!(arquivo instanceof File) || arquivo.size === 0) {
      return jsonResponse({ erro: 'Nenhum arquivo recebido.' }, 400)
    }
    if (arquivo.size > MAX_BYTES) {
      return jsonResponse({ erro: `Arquivo grande demais (${Math.round(arquivo.size / 1048576)} MB; o limite é 25 MB).` }, 413)
    }

    // SÓ CARD QUE A PLATAFORMA CONHECE: um id solto no formulário anexaria
    // arquivo a qualquer card da conta.
    const { data: espelho } = await svc
      .from('kommo_leads')
      .select('kommo_lead_id')
      .eq('kommo_lead_id', leadId)
      .maybeSingle()
    if (!espelho) return jsonResponse({ erro: 'Card não encontrado no espelho local.' }, 404)

    const conta = await contaKommo()
    if (!conta) return jsonResponse({ erro: 'Kommo não configurado.' }, 500)
    const auth = { Authorization: `Bearer ${conta.token}` }
    const base = `https://${conta.subdominio}.kommo.com/api/v4`

    // 1. O ARQUIVO no drive do Kommo, e anexado ao card.
    const nome = limparNome(arquivo.name || 'arquivo')
    const drive = await urlDoDriveDaConta(base, auth)
    const uuid = await subirAoDriveDoKommo({
      drive,
      auth,
      nome,
      bytes: new Uint8Array(await arquivo.arrayBuffer()),
      mime: arquivo.type || 'application/octet-stream',
    })
    const rAnexo = await fetch(`${base}/leads/${leadId}/files`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ file_uuid: uuid }]),
    })
    if (!rAnexo.ok) {
      return jsonResponse({ erro: `O arquivo subiu, mas o Kommo recusou anexá-lo ao card (HTTP ${rAnexo.status}).` }, 502)
    }

    // 2. AS NOTAS: a do arquivo e, se houver, a do texto — com quem enviou.
    const { data: perfil } = await svc.from('profiles').select('nome, email').eq('id', caller.id).maybeSingle()
    const autor = perfil?.nome?.trim() || perfil?.email || caller.email || null
    const notas: unknown[] = [
      { entity_id: leadId, note_type: 'attachment', params: { file_uuid: uuid, file_name: nome } },
    ]
    if (texto) {
      notas.push({
        entity_id: leadId,
        note_type: 'common',
        params: { text: marcarComoDePessoa(texto, autor) },
        is_need_to_trigger_digital_pipeline: false,
      })
    }
    const rNotas = await fetch(`${base}/leads/notes`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(notas),
    })
    const aviso = rNotas.ok
      ? null
      : `O arquivo foi anexado ao card, mas a anotação não subiu (HTTP ${rNotas.status}).`

    return jsonResponse({ ok: true, file_uuid: uuid, nome, aviso })
  } catch (e) {
    return jsonResponse({ erro: (e as Error).message }, 500)
  }
})
