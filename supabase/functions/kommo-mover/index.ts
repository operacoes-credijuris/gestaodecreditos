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
import { destinoPermitido } from '../_shared/trilhasDoPrecatorio.ts'
// AS COLUNAS DO RPV moram em `_shared/colunasRpv.ts`, para o teste as prender.
import { COLUNAS } from '../_shared/colunasRpv.ts'
// O SELO DA ANOTAÇÃO ("Operacional" ou "Comercial") sai do DESTINO, decidido
// aqui no servidor — ver `_shared/servicoDaNota.ts`. Era a constante
// 'Operacional' até 02/10/2026, quando o desfecho da Negociação (ato do
// comercial) passou a ser aceito.
import { servicoDaNota } from '../_shared/servicoDaNota.ts'
// A CONFERÊNCIA DE ORIGEM do desfecho da Negociação (02/10/2026).
import { recusaDaOrigem } from '../_shared/desfechoDaNegociacao.ts'

/**
 * Os destinos do Precatório saem de `_shared/trilhasDoPrecatorio.ts`, por trilha.
 *
 * ESTA LISTA JÁ FOI ESCRITA À MÃO AQUI, e o defeito que isso causou é o motivo
 * de ela ter mudado de lugar. Eram dois nomes do funil antigo — "Diligência" e
 * "Reprovados Operacional" — mais o id daquele funil. Quando as trilhas
 * migraram para pipelines próprios (14/09 e 16/09/2026), a tela passou a
 * oferecer saídas que esta função recusava com "Coluna de destino não
 * reconhecida": o botão existia, o card não se movia, e nada no caminho dizia
 * que a culpa era de duas listas que precisavam concordar.
 *
 * PELO ID DESDE 29/09/2026, com o nome de reserva (ver `destinoPermitido`): pelo
 * nome, renomear uma coluna no Kommo fazia o botão da tela mover para uma coluna
 * que esta função não reconhecia mais. Os ids vêm do espelho (consulta de
 * 29/09/2026), e os testes os prendem ao nome daquele dia.
 */

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
    // banco. O Precatório numera as MESMAS colunas com outros ids, e a pergunta é
    // a mesma das abas: pelo id declarado na trilha, e pelo nome de reserva.
    const { data: destino } = await svc
      .from('kommo_etapa')
      .select('pipeline_id, nome')
      .eq('status_id', statusId)
      .limit(20)
    // NO RPV, O NOME QUE VAI NA NOTA É O DO KOMMO DE HOJE (kommo_etapa), e não o
    // de COLUNAS: as colunas foram renomeadas ("Revisão e Decisão do Pedro" virou
    // "Revisão") e a nota de auditoria saía com o nome velho. COLUNAS continua
    // decidindo a PERMISSÃO do RPV; o nome dela fica só de reserva, para o
    // espelho sem a etapa. O status_id é único na conta, então a linha é uma.
    const linhaDoPrecatorio = (destino ?? []).find((e) =>
      // Funil que não é de precatório devolve lista vazia, e nada casa: é o
      // que mantém a coluna do comercial fora do alcance de um statusId solto.
      // PELO ID DA COLUNA, e pelo nome de reserva: renomear a coluna no Kommo
      // não tira a permissão de mover para ela.
      destinoPermitido(Number(e.pipeline_id), Number(statusId), String(e.nome ?? '')),
    )
    const nomeDoDestino =
      (COLUNAS[statusId] !== undefined
        ? String((destino ?? [])[0]?.nome ?? '').trim() || COLUNAS[statusId]
        : undefined) ?? linhaDoPrecatorio?.nome
    if (!nomeDoDestino) {
      return jsonResponse({ error: 'Coluna de destino não reconhecida.' }, 400)
    }
    // O SELO DA NOTA, pelo destino que ACABOU DE SER AUTORIZADO: no RPV pelo id,
    // no Precatório pelo funil e pelo nome da linha que passou em
    // `destinoPermitido`. Nunca pelo corpo da requisição.
    const servico = servicoDaNota(
      linhaDoPrecatorio ? Number(linhaDoPrecatorio.pipeline_id) : null,
      statusId,
      linhaDoPrecatorio ? String(linhaDoPrecatorio.nome ?? '') : null,
    )

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
    // O FUNIL VEM JUNTO para a conferência de origem do desfecho da Negociação
    // (abaixo), que pergunta se a Negociação é a do MESMO funil.
    const { data: espelho } = await svc
      .from('kommo_leads')
      .select('status_id, pipeline_id')
      .eq('kommo_lead_id', leadId)
      .maybeSingle()
    // O nome do Kommo primeiro, pelo mesmo motivo do destino; COLUNAS é reserva.
    const origem = espelho?.status_id
      ? ((
          await svc
            .from('kommo_etapa')
            .select('nome')
            .eq('status_id', espelho.status_id)
            .limit(1)
            .maybeSingle()
        ).data?.nome ??
        COLUNAS[espelho.status_id] ??
        null)
      : null

    // O DESFECHO DA NEGOCIAÇÃO SÓ SAI DA NEGOCIAÇÃO DO MESMO FUNIL — ver
    // `_shared/desfechoDaNegociacao.ts`. ANTES DO PATCH, de propósito: mover para
    // "Fechados" dispara as automações de negócio fechado, e isso não se desfaz.
    // Os outros destinos passam direto (a função devolve null), como sempre.
    // Card fora do espelho: recusa, porque não há como saber de onde ele sai.
    const recusa = recusaDaOrigem(
      {
        pipelineId: linhaDoPrecatorio ? Number(linhaDoPrecatorio.pipeline_id) : null,
        statusId,
        nome: nomeDoDestino,
      },
      espelho?.status_id
        ? {
            statusId: Number(espelho.status_id),
            pipelineId: espelho.pipeline_id == null ? null : Number(espelho.pipeline_id),
            nome: origem,
          }
        : null,
    )
    if (recusa) return jsonResponse({ error: recusa }, 400)

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
          params: { service: servico, text: linhas.join('\n\n') },
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
      // O NOME QUE AUTORIZOU O MOVIMENTO: `COLUNAS` só tem as colunas do RPV, e
      // no Precatório a mensagem saía como `Card movido para "undefined".`
      mensagem: avisoNota ?? `Card movido para "${nomeDoDestino}".`,
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
