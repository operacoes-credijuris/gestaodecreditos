// planilha-juridica — preenche a planilha da análise jurídica com as respostas
// que o CLAUDE escreveu na conversa da qualificação.
//
// POR QUE ESTA FUNÇÃO EXISTE, se a `analise-precatorio` já preenche a mesma
// planilha. Aquela lê os autos de novo, com outro modelo, numa chamada à parte —
// e a equipe apontou o defeito disso: a planilha "perde o contexto que está sendo
// desenvolvido no desktop". Qualificação e planilha saíam de duas leituras
// diferentes, e podiam discordar.
//
// Agora o conector entrega à conversa, junto com os autos, o questionário da
// planilha (lido do modelo em vigor) e as mesmas regras do motor antigo. O
// Claude faz a qualificação e, na mesma resposta, devolve um bloco JSON com as
// respostas. Quem opera copia esse bloco e cola na plataforma — e é aqui que ele
// vira planilha, pelo MESMO código de gravação do motor antigo: célula com
// conteúdo nunca é escrita, número de orçamento público sem link não entra, a
// ficha do card sai pela mesma tabela de verbas.
//
// NÃO CHAMA IA NENHUMA. Tudo o que precisava ser lido já foi, na conversa.
// Isto é só a mecânica do arquivo: abrir o modelo, escrever, salvar no Drive.
//
// POR QUE COLAR, e não o conector gravar sozinho: uma ferramenta de GRAVAÇÃO no
// conector pediria reconectá-lo e, conforme a configuração da organização, a
// aprovação do administrador. Colar funciona hoje. Quando a ferramenta existir,
// ela chama este mesmo caminho — nada daqui se perde.
//
// USO (POST, com sessão logada):
//   { kommo_lead_id, colado, numero_processo, cedente, originador,
//     tipo_aquisicao, honorarios_pct }
//   -> o mesmo formato da analise-precatorio (resumo, linhas, avisos, ficha,
//      drive_file_url, drive_folder_url)
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { aplicarRespostas, extrairSaidaColada } from '../_shared/questionarioJuridico.ts'
import { abrirModelo, checklistEmTexto, salvarPlanilhaNoDrive } from '../_shared/planilhaJuridica.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const body = (await req.json().catch(() => ({}))) as {
      kommo_lead_id?: number
      colado?: string
      numero_processo?: string
      cedente?: string
      originador?: string
      tipo_aquisicao?: string
      honorarios_pct?: string | number | null
    }
    const leadId = Number(body.kommo_lead_id)
    if (!leadId) return jsonResponse({ error: 'kommo_lead_id é obrigatório.' }, 400)

    // O BLOCO PRIMEIRO, antes de abrir planilha e Drive: colar a coisa errada é
    // o engano mais provável aqui, e ele merece a resposta mais rápida.
    const extraido = extrairSaidaColada(body.colado)
    if (!extraido.ok) return jsonResponse({ error: extraido.erro }, 400)
    const saida = extraido.saida

    const { wb, ws, path, linhas, comFormula } = await abrirModelo(svc)
    // O CHECKLIST SÓ PARA O AVISO: quem respondeu o "Histórico do Cedente" foi a
    // conversa, com o checklist que o conector lhe entregou. Aqui ele diz apenas
    // se havia o que responder — sem sujeito cadastrado, o bloco fica em branco
    // e a pessoa precisa saber por quê.
    const { temChecklist } = await checklistEmTexto(svc, leadId)

    const { escritas, avisos, ficha, verbasNome } = aplicarRespostas(ws, linhas, comFormula, saida, {
      numero_processo: body.numero_processo,
      cedente: body.cedente,
      tipo_aquisicao: body.tipo_aquisicao,
      honorarios_pct: body.honorarios_pct,
      temChecklist,
    })

    // PLANILHA SEM RESPOSTA NENHUMA NÃO VAI AO DRIVE. Um arquivo com o nome de
    // análise e as células vazias seria lido como análise feita.
    if (escritas === 0) {
      return jsonResponse(
        {
          error:
            'O bloco colado não preencheu nenhuma linha da planilha. Confira se é o bloco da ' +
            'planilha desta análise — as linhas precisam ser as do questionário (L4, L5…).',
          avisos,
        },
        400,
      )
    }

    const drive = await salvarPlanilhaNoDrive(wb, {
      originador: body.originador,
      cedente: body.cedente,
      numero_processo: body.numero_processo,
      verbasNome,
    })

    return jsonResponse({
      ok: true,
      origem: 'conversa',
      resumo: saida.resumo ?? null,
      linhas_no_questionario: linhas.length,
      linhas_preenchidas: escritas,
      avisos,
      ficha,
      template: path,
      drive_file_url: drive.drive_file_url,
      drive_folder_url: drive.drive_folder_url,
    })
  } catch (e) {
    return jsonResponse(
      { error: 'Falha ao preencher a planilha: ' + (e instanceof Error ? e.message : String(e)) },
      500,
    )
  }
})
