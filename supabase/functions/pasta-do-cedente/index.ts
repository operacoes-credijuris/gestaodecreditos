// pasta-do-cedente — cria (ou acha) a pasta do cedente no Drive e liga o card a
// ela, no instante do "Executar análise".
//
// A IDEIA É DA EQUIPE (28/09/2026): o título do card já vira link para a pasta
// quando a análise é salva — mas só na RPV; no precatório a planilha ia para o
// Drive e o card nunca ganhava o atalho. E, mais do que isso, a pasta só nascia
// no FIM. Criando-a no clique, quem abre a conversa com o Claude já tem, no
// próprio card, o caminho para onde o resultado vai — e qualquer arquivo da
// análise tem casa antes de existir.
//
// O MESMO CAMINHO DA PLANILHA: A. Análises de crédito / Precatórios /
// {originador} / {cedente}, pela mesma função (`pastaDaAnaliseDoCard`). Dois
// cálculos do caminho abririam duas pastas para o mesmo cedente, e a planilha
// cairia na que o link não aponta.
//
// USO (POST, com sessão logada): { kommo_lead_id, originador, cedente }
//   -> { pasta_id, drive_folder_url }
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { ligarPastaAoCard } from '../_shared/planilhaJuridica.ts'
import { pastaDaAnaliseDoCard } from '../_shared/pastaDoCard.ts'
import { driveExistePasta } from '../_shared/credijuris.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const body = (await req.json().catch(() => ({}))) as {
      kommo_lead_id?: number
      originador?: string
      cedente?: string
    }
    const leadId = Number(body.kommo_lead_id)
    if (!leadId) return jsonResponse({ error: 'kommo_lead_id é obrigatório.' }, 400)
    // SEM CEDENTE NÃO HÁ PASTA: "Sem cedente" é o nome de reserva da gravação,
    // para não perder um arquivo — mas criar de antemão uma pasta com esse nome
    // juntaria nela os cards de título incompleto.
    if (!String(body.cedente ?? '').trim()) {
      return jsonResponse({ error: 'O card não diz o cedente — sem ele não há nome para a pasta.' }, 400)
    }

    // NO PRECATÓRIO EXTERNO NÃO SE CRIA PASTA no "Executar análise" (decisão do
    // dono, 06/10/2026): ela só nasce quando a BullAI emite certidão. Resposta
    // neutra (200, sem pasta), para a aba aberta antes da mudança não avisar erro.
    const { data: card } = await svc.from('kommo_leads').select('pipeline_id').eq('kommo_lead_id', leadId).maybeSingle()
    if (Number((card as { pipeline_id?: number } | null)?.pipeline_id) === 14439516) {
      return jsonResponse({ ok: true, pasta_id: null, ignorado: 'precatorio-externo' })
    }

    // A PASTA QUE O CARD JÁ TEM FICA (auditoria de bugs, 09/10/2026). Era
    // recalculada pelo nome e gravada no card SEM CONDIÇÃO: com a lista da tela
    // desatualizada (a guarda era só dela) e o título mudado, o card passava a
    // apontar para uma pasta nova e vazia, e a planilha e as certidões seguintes
    // iam para ela — os arquivos divididos em duas pastas. Agora é a mesma regra
    // das certidões e da planilha (`pastaDaAnaliseDoCard`): a gravada, se ainda
    // existe; senão o caminho calculado, gravado só se o card estava sem pasta.
    const analise = await pastaDaAnaliseDoCard(svc, leadId, { originador: body.originador, cedente: body.cedente })
    let pastaId = analise.pastaId
    if (analise.origem === 'calculada' && !analise.gravadaNoCard) {
      // O card tinha uma pasta que sumiu (lixeira) — ou outra aba acabou de
      // gravar a dela. Esta vence só se a do card não existe mais.
      const { data: agora } = await svc.from('kommo_leads').select('drive_pasta_id').eq('kommo_lead_id', leadId).maybeSingle()
      const doCard = String((agora as { drive_pasta_id?: string | null } | null)?.drive_pasta_id ?? '').trim()
      if (doCard && doCard !== pastaId && (await driveExistePasta(analise.token, doCard)) !== false) pastaId = doCard
      else await ligarPastaAoCard(svc, leadId, pastaId)
    }
    return jsonResponse({
      ok: true,
      pasta_id: pastaId,
      drive_folder_url: `https://drive.google.com/drive/folders/${pastaId}`,
    })
  } catch (e) {
    return jsonResponse(
      { error: 'Não consegui criar a pasta no Drive: ' + (e instanceof Error ? e.message : String(e)) },
      500,
    )
  }
})
