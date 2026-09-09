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
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'

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

/**
 * Os destinos do funil de PRECATÓRIOS, pelo NOME da coluna.
 *
 * Por nome porque os ids desse funil não existem em lugar nenhum do código: são
 * lidos do espelho (kommo_etapa), como a tela faz para montar as abas. Colar
 * aqui números copiados da URL do Kommo é o erro que a migration 0044 existe
 * para evitar — um dígito trocado aponta para outra coluna existente, e o card
 * vai parar nela sem erro nenhum.
 *
 * SÓ OS DOIS QUE INTERROMPEM. "Apresentação de Proposta" fica de fora: qual
 * coluna significa "aprovado" no Precatório ninguém definiu, e a lista aqui
 * precisa espelhar exatamente o que a tela oferece — um destino a mais é uma
 * porta que só se descobre pelo card que passou por ela.
 */
const DESTINOS_PRECATORIO = ['Diligência', 'Reprovados Operacional']

const FUNIL_PRECATORIO = 13971995

/** Acento, caixa e espaço a mais não podem decidir se o card move. */
const normalizar = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()

// Nenhum destino exige justificativa. A análise — inclusive o motivo de uma
// eventual reprovação — é produzida na etapa de Pendentes; a de Validação apenas
// ratifica o que já foi escrito. Pedir o motivo aqui seria perguntar à pessoa
// errada, no momento errado. O comentário segue aceito, mas é opcional.

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const caller = await getCallerAtivo(req, serviceClient())
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

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
    const svc = serviceClient()

    // O DESTINO PRECISA SER UM DOS QUE O APP OFERECE, e não qualquer coluna do
    // CRM: um statusId solto no corpo da requisição moveria o card para
    // 'Nutrição' ou 'Venda perdida', que são colunas do comercial.
    //
    // DUAS LISTAS porque os dois funis se identificam de formas diferentes. RPV
    // tem os ids escritos aqui desde sempre e continua respondendo sem tocar no
    // banco. O Precatório numera as MESMAS colunas com outros ids, que só o
    // espelho conhece (migration 0044) — é por nome que se pergunta, como a tela
    // faz para montar as abas.
    const { data: destino } = await svc
      .from('kommo_etapa')
      .select('pipeline_id, nome')
      .eq('status_id', statusId)
      .limit(20)
    const nomeDoDestino =
      COLUNAS[statusId] ??
      (destino ?? []).find(
        (e) =>
          Number(e.pipeline_id) === FUNIL_PRECATORIO &&
          DESTINOS_PRECATORIO.some((d) => normalizar(d) === normalizar(e.nome)),
      )?.nome
    if (!nomeDoDestino) {
      return jsonResponse({ error: 'Coluna de destino não reconhecida.' }, 400)
    }

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
    const origem = espelho?.status_id
      ? (COLUNAS[espelho.status_id] ??
        (
          await svc
            .from('kommo_etapa')
            .select('nome')
            .eq('status_id', espelho.status_id)
            .limit(1)
            .maybeSingle()
        ).data?.nome ??
        null)
      : null

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
        ? `Movido de "${origem}" para "${nomeDoDestino}" por ${autor}.`
        : `Movido para "${nomeDoDestino}" por ${autor}.`,
    ]
    if (comentario) linhas.push(comentario)

    /** O fetch da nota, que nunca rejeita: devolve o não-ok ou o motivo. */
    const fetchDaNota = async (url: string, init: RequestInit) => {
      try {
        return await fetch(url, init)
      } catch (e) {
        return { ok: false, status: 0, motivo: (e as Error)?.message ?? String(e) } as
          { ok: false; status: number; motivo: string }
      }
    }
    let avisoNota: string | null = null
    // O FETCH PODE REJEITAR, e não só devolver não-ok: rede, DNS, timeout. A
    // rejeição subia ao catch geral e a função respondia 500 DEPOIS de o PATCH
    // já ter movido o card — e sem rodar o passo 3, deixando o espelho na coluna
    // antiga sem explicação. Falha de nota é aviso, nunca erro.
    const resNota = await fetchDaNota(`${base}/leads/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify([
        {
          entity_id: leadId,
          note_type: 'service_message',
          // LINHA EM BRANCO entre os blocos, e não quebra simples: o feed do
          // Kommo ignora o \n sozinho e cola a linha de auditoria no motivo,
          // num parágrafo corrido. Verificado no card — a anotação da análise,
          // que usa \n\n, mantém a quebra; esta, que usava \n, não mantinha.
          params: { service: SERVICO, text: linhas.join('\n\n') },
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
      const _porque = 'motivo' in resNota && resNota.motivo
        ? `falha de rede: ${resNota.motivo}`
        : `HTTP ${resNota.status}`
      avisoNota = `O card foi movido, mas a anotação não foi registrada (${_porque}).`
    }

    // 3. Espelho local: atualiza o status e descarta a marcação interna, que só
    // vale enquanto o card está na coluna de análise. Sem isso a UI mostraria a
    // coluna antiga até o próximo sync — e era exatamente o que acontecia em
    // SILÊNCIO quando o update falhava: supabase-js não lança, devolve
    // { error }, e o retorno era descartado sem ninguém ler. A coluna ficava
    // errada na tela até alguém sincronizar, sem explicação.
    const { error: eEspelho } = await svc
      .from('kommo_leads')
      .update({ status_id: statusId })
      .eq('kommo_lead_id', leadId)
    const { error: eSelo } = await svc
      .from('kommo_analise_interna')
      .delete()
      .eq('kommo_lead_id', leadId)
    if (eEspelho || eSelo) {
      console.error('[kommo-mover] espelho', leadId, eEspelho ?? eSelo)
      const _falha = 'O card foi movido no Kommo, mas o espelho local não atualizou (' +
        String((eEspelho ?? eSelo)?.message ?? '').slice(0, 120) + '); a coluna corrige no próximo sync.'
      avisoNota = avisoNota ? avisoNota + ' ' + _falha : _falha
    }

    return jsonResponse({
      ok: true,
      aviso: avisoNota,
      mensagem: avisoNota ?? `Card movido para "${COLUNAS[statusId]}".`,
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
