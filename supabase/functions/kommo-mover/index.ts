// Move um card do Kommo para outra coluna e registra no próprio card quem fez a
// movimentação e por quê.
//
// Por que a anotação é indispensável: escrita via API aparece no histórico do
// Kommo como "Integração com a Plataforma", sem identificar a pessoa (o evento
// sai com created_by = 0). Verificado na conta real. Sem a anotação, o comercial
// veria um card mudar de coluna sem saber quem decidiu nem com que fundamento.
//
// Detalhes da API respeitados aqui:
//   - PATCH /api/v4/leads/{id} com { status_id } basta para mover dentro do
//     mesmo funil; pipeline_id só é necessário ao cruzar funis.
//   - A resposta do PATCH traz SÓ id/updated_at/_links, nunca o lead completo.
//   - A anotação usa note_type service_message, que o sync ignora (ele filtra
//     note_type=common). Sem isso, nosso registro de auditoria seria lido como
//     dado do crédito na próxima sincronização.
//   - Não existe forma de suprimir as automações do Kommo num PATCH de lead:
//     mover pelo app dispara o Digital Pipeline configurado no funil.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getCaller, serviceClient } from '../_shared/auth.ts'

/** Rótulo exibido no selo da anotação, dentro do card. */
const SERVICO = 'Operacional'

/** Colunas do Funil Geral RPV para as quais o app permite mover. */
const COLUNAS: Record<number, string> = {
  107272803: 'Análise Jurídica-Econômico',
  107272807: 'Revisão e Decisão do Pedro',
  107830027: 'Diligência',
  107830035: 'Apresentação de Proposta',
  107830031: 'Reprovados Operacional',
}

// Nenhum destino exige justificativa. A análise — inclusive o motivo de uma
// eventual reprovação — é produzida na etapa de Pendentes; a de Validação apenas
// ratifica o que já foi escrito. Pedir o motivo aqui seria perguntar à pessoa
// errada, no momento errado. O comentário segue aceito, mas é opcional.

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const caller = await getCaller(req)
    if (!caller) return jsonResponse({ error: 'Não autenticado.' }, 401)

    const body = (await req.json().catch(() => ({}))) as {
      leadId?: number
      statusId?: number
      comentario?: string
    }
    const leadId = Number(body.leadId)
    const statusId = Number(body.statusId)
    const comentario = (body.comentario ?? '').trim()

    if (!leadId || !statusId) {
      return jsonResponse({ error: 'Informe leadId e statusId.' }, 400)
    }
    if (!COLUNAS[statusId]) {
      return jsonResponse(
        { error: 'Coluna de destino não reconhecida.' },
        400,
      )
    }
    const svc = serviceClient()

    const { data: secret } = await svc
      .from('integracao_kommo_secret')
      .select('token, subdominio')
      .eq('id', 1)
      .maybeSingle()
    if (!secret?.token || !secret?.subdominio) {
      return jsonResponse({ error: 'Kommo não configurado.' }, 400)
    }

    // Coluna de origem: vem do espelho local, para a anotação dizer de onde
    // saiu. Se o espelho estiver defasado o texto sai sem a origem, o que é
    // melhor do que falhar a movimentação por causa do registro.
    const { data: espelho } = await svc
      .from('kommo_leads')
      .select('status_id')
      .eq('kommo_lead_id', leadId)
      .maybeSingle()
    const origem = espelho?.status_id ? COLUNAS[espelho.status_id] : null

    // Nome de quem está movendo — é a informação que o Kommo não registra.
    const { data: perfil } = await svc
      .from('profiles')
      .select('nome, email')
      .eq('id', caller.id)
      .maybeSingle()
    const autor = perfil?.nome?.trim() || perfil?.email || caller.email || 'usuário do sistema'

    const base = `https://${secret.subdominio}.kommo.com/api/v4`
    const headers = {
      Authorization: `Bearer ${secret.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    // 1. Move o card. Vem primeiro de propósito: se a anotação falhasse antes
    // do PATCH, o card teria registro de uma movimentação que não aconteceu.
    const resMove = await fetch(`${base}/leads/${leadId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status_id: statusId }),
    })
    if (!resMove.ok) {
      const txt = await resMove.text().catch(() => '')
      return jsonResponse(
        {
          error: `Kommo recusou a movimentação (HTTP ${resMove.status}). ${txt.slice(0, 300)}`,
        },
        502,
      )
    }

    // 2. Registra no card quem moveu e por quê.
    const linhas = [
      origem
        ? `Movido de "${origem}" para "${COLUNAS[statusId]}" por ${autor}.`
        : `Movido para "${COLUNAS[statusId]}" por ${autor}.`,
    ]
    if (comentario) linhas.push(comentario)

    let avisoNota: string | null = null
    const resNota = await fetch(`${base}/leads/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify([
        {
          entity_id: leadId,
          note_type: 'service_message',
          params: { service: SERVICO, text: linhas.join('\n') },
          // Não dispara os gatilhos do Digital Pipeline por causa do registro
          // de auditoria — o PATCH acima já disparou o que havia para disparar.
          is_need_to_trigger_digital_pipeline: false,
        },
      ]),
    })
    if (!resNota.ok) {
      // O card JÁ foi movido. Falhar aqui não desfaz nada, então reporta como
      // aviso em vez de erro — reverter seria pior (duas movimentações no
      // histórico por causa de um registro que não gravou).
      avisoNota = `O card foi movido, mas a anotação não foi registrada (HTTP ${resNota.status}).`
    }

    // 3. Espelho local: atualiza o status e descarta a marcação interna, que só
    // vale enquanto o card está na coluna de análise. Sem isso a UI mostraria a
    // coluna antiga até o próximo sync.
    await svc
      .from('kommo_leads')
      .update({ status_id: statusId })
      .eq('kommo_lead_id', leadId)
    await svc
      .from('kommo_analise_interna')
      .delete()
      .eq('kommo_lead_id', leadId)

    return jsonResponse({
      ok: true,
      aviso: avisoNota,
      mensagem: avisoNota ?? `Card movido para "${COLUNAS[statusId]}".`,
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
