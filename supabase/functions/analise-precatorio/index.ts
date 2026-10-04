// analise-precatorio — preenche a aba "Análise Jurídica" do modelo de precatórios.
//
// SEPARADA DA gerar-analise-rpv de propósito, e não por organização de arquivos.
// Aquela função é o motor de RPV: template Modelo_Analise_de_RPV.xlsx, cenários
// "RPV expedida / não expedida", prazo tirado do convênio de 60 dias do TJGO e um
// prompt que se apresenta como "especializado em créditos RPV". Rodá-la num
// precatório entregava parecer e planilha errados sem nenhum sinal na tela — foi
// o defeito que originou esta função. Precatório tem regime, fila, LOA e EC
// 136/2025; nada disso cabe como remendo lá.
//
// PREENCHE SÓ A ABA "ANÁLISE JURÍDICA". As abas Precificação e Indicadores da
// operação ficam para a etapa de Precificação (a coluna "Análise
// Econômico-Financeira (TIER 1)" do Kommo) — decisão do dono. Elas dependem de
// PRAZO DE RESGATE e DESÁGIO, que no modelo são campos DIGITADOS, sem fórmula:
// não há o que derivar do processo.
//
// O QUESTIONÁRIO VEM DO PRÓPRIO TEMPLATE, não de uma constante aqui. O template é
// baixado do Storage, lido com ExcelJS, e as perguntas da coluna A viram o
// questionário do prompt. Assim a planilha é a única fonte de verdade: mudar uma
// pergunta lá muda o que a IA responde, sem deploy. A alternativa — copiar as
// ~85 perguntas para cá — cria duas verdades que divergem no primeiro ajuste.
//
// TRÊS FONTES, UMA POR BLOCO, e a regra de cada uma está no prompt:
//
//   Dados Básicos (L4-22)         o PDF do processo
//   Histórico do Cedente (28-81)  O BANCO — é o checklist de certidões da
//                                 plataforma (dd_sujeito/dd_certidao), não a IA
//   Saúde financeira (85-101)     BUSCA WEB, com link obrigatório
//   Caderno Processual (105-137)  o PDF do processo
//   Fechamento (138-139)          o PDF do processo
//
// CÉLULA QUE JÁ TEM CONTEÚDO NUNCA É ESCRITA. É o guard que impede o maior risco
// desta função: escrever a resposta na célula errada produz planilha que PARECE
// preenchida e está errada. Ele já pegou três casos reais — B93, B94 e B95
// (Mora/RCL, % de repasse da EC 136/2025 e valor do repasse) contêm FÓRMULAS que
// a planilha calcula sozinha a partir de B91 e B92. Escrever ali apagaria a conta.
//
// A DECISÃO NÃO É AUTOMÁTICA. O bloco "Critérios de Aceitação e Recusa"
// (L141-150) do modelo já vem escrito e não é preenchido: ele é a régua que uma
// pessoa aplica. O motor entrega o parecer e os avisos; aprovar ou reprovar
// segue sendo clique de gente, diferente do RPV, que tem portão automático.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic, segredoGoogle } from '../_shared/segredos.ts'
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
// O QUESTIONÁRIO, AS REGRAS E A GRAVAÇÃO moram nos módulos compartilhados
// desde 28/09/2026: a planilha passou a nascer também da conversa do Claude
// (ver `planilha-juridica`), e duas cópias desta lógica divergiriam.
import {
  aplicarRespostas,
  ESQUEMA_DA_SAIDA,
  montarQuestionario,
  REGRAS_DA_PLANILHA,
  type SaidaDaPlanilha,
} from '../_shared/questionarioJuridico.ts'
import {
  abrirModelo,
  checklistEmTexto,
  preencherCertidoesDoChecklist,
  salvarPlanilhaNoDrive,
} from '../_shared/planilhaJuridica.ts'

/**
 * OPUS 5, e não Sonnet.
 *
 * Mesmo raciocínio da extrair-credito: roda UMA VEZ por crédito e o trabalho é
 * discriminação jurídica — separar homologação de trânsito em julgado, cessão
 * noticiada de cessão homologada, penhora requerida de penhora deferida. Errar
 * sai mais caro que o token, porque a resposta errada entra numa planilha que a
 * pessoa vai ler como conferida.
 */
const MODELO = 'claude-opus-5'


/** Teto do texto do processo mandado ao modelo. Corta o MEIO, mantendo pontas. */
const MAX_CHARS = 380_000
/**
 * Buscas web e retomadas.
 *
 * As duas existem pelo mesmo motivo: a Edge Function tem teto de tempo de
 * parede. Uma varredura sem limite estoura o teto e o usuário recebe erro de
 * rede em vez de análise. 8 buscas cobrem RCL, estoque de mora, regime, ordem
 * cronológica e editais; 3 retomadas cobrem o laço de amostragem do servidor.
 */
const MAX_BUSCAS = 8
const MAX_RETOMADAS = 3

// ---------------------------------------------------------------------------
// A ferramenta e o prompt
// ---------------------------------------------------------------------------

const FERRAMENTA = {
  name: 'preencher_analise_juridica',
  description:
    'Devolve as respostas do questionário da aba "Análise Jurídica", uma por linha da planilha.',
  input_schema: ESQUEMA_DA_SAIDA,
}

function montarSistema(qtdLinhas: number): string {
  return (
    `Você é analista jurídico da Credijuris e faz a ANÁLISE JURÍDICA de um precatório para aquisição. Preenche um questionário de ${qtdLinhas} linhas que é o modelo interno da casa. O texto do processo e o checklist de certidões vêm abaixo.\n\n` +
    REGRAS_DA_PLANILHA +
    '\n\nResponda chamando a ferramenta preencher_analise_juridica uma única vez, ao final.'
  )
}
/** Corta o meio, preservando início e fim: a inicial abre, a homologação fecha. */
function cortarTexto(t: string): { texto: string; cortou: boolean } {
  if (t.length <= MAX_CHARS) return { texto: t, cortou: false }
  const cabeca = Math.floor(MAX_CHARS * 0.55)
  return {
    texto:
      t.slice(0, cabeca) +
      '\n\n[...TRECHO INTERMEDIÁRIO OMITIDO POR TAMANHO...]\n\n' +
      t.slice(t.length - (MAX_CHARS - cabeca)),
    cortou: true,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const svc = serviceClient()
    const caller = await getCallerAtivo(req, svc)
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const body = (await req.json().catch(() => ({}))) as {
      kommo_lead_id?: number
      texto?: string
      numero_processo?: string
      cedente?: string
      originador?: string
      /** O que está sendo cedido, do título do card. Ver lerTituloCard/classificarParcelaCedida. */
      tipo_aquisicao?: string
      /** % dos honorários contratuais que o comercial cadastrou, em pontos. */
      honorarios_pct?: string | number | null
    }
    const leadId = Number(body.kommo_lead_id)
    const bruto = String(body.texto ?? '')
    if (!leadId) return jsonResponse({ error: 'kommo_lead_id é obrigatório.' }, 400)
    if (bruto.trim().length < 500) {
      return jsonResponse(
        {
          error:
            'O texto do processo veio vazio ou curto demais para analisar. ' +
            'Confira se o PDF do card tem texto selecionável (processo digitalizado não serve).',
        },
        400,
      )
    }

    const chave = await chaveAnthropic()
    if (!chave) {
      return jsonResponse(
        { error: 'Chave da Anthropic não configurada. Veja Configurações → Anthropic.' },
        500,
      )
    }
    const google = await segredoGoogle()
    if (!google) {
      return jsonResponse(
        { error: 'Credenciais do Google não configuradas — sem elas não dá para salvar no Drive.' },
        500,
      )
    }

    // 1. O modelo do Storage, que é também a fonte do questionário.
    const { wb, ws, path: templatePath, linhas, comFormula } = await abrirModelo(svc)

    // 2. O que a plataforma já sabe sobre os sujeitos e as certidões.
    const checklist = await checklistEmTexto(svc, leadId)

    // 3. A leitura.
    const { texto, cortou } = cortarTexto(bruto)
    const anthropic = new Anthropic({ apiKey: chave })
    const mensagens: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content:
          `QUESTIONÁRIO (responda pelo número da linha):\n${montarQuestionario(linhas)}\n\n` +
          `CHECKLIST DE CERTIDÕES DA PLATAFORMA:\n${checklist.texto}\n\n` +
          `O QUE JÁ SE SABE DO CARD:\n` +
          `Número do processo: ${body.numero_processo || '(não informado)'}\n` +
          `Cedente: ${body.cedente || '(não informado)'}\n` +
          `Originador: ${body.originador || '(não informado)'}\n\n` +
          `TEXTO DO PROCESSO:\n${texto}`,
      },
    ]

    let resposta = await (async () => {
      let atual = await anthropic.messages
        .stream({
          model: MODELO,
          max_tokens: 24000,
          system: [
            {
              type: 'text',
              text: montarSistema(linhas.length),
              cache_control: { type: 'ephemeral' },
            },
          ],
          // Ferramenta NOSSA + busca web da Anthropic. `tool_choice` fica em
          // 'auto' (o padrão) de propósito: forçar a ferramenta impediria o
          // modelo de pesquisar antes de responder, e o bloco da saúde
          // financeira do ente depende exatamente disso.
          tools: [
            FERRAMENTA,
            { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS },
          ],
          messages: mensagens,
        })
        .finalMessage()

      // O laço de amostragem do servidor tem teto próprio; ao bater nele a
      // resposta volta com stop_reason 'pause_turn'. Reenviar o turno pausado
      // faz o servidor retomar de onde parou — e NÃO se acrescenta mensagem de
      // usuário nenhuma, o próprio bloco de server_tool_use sinaliza a retomada.
      for (let i = 0; i < MAX_RETOMADAS && atual.stop_reason === 'pause_turn'; i++) {
        mensagens.push({ role: 'assistant', content: atual.content })
        atual = await anthropic.messages
          .stream({
            model: MODELO,
            max_tokens: 24000,
            system: [
              {
                type: 'text',
                text: montarSistema(linhas.length),
                cache_control: { type: 'ephemeral' },
              },
            ],
            tools: [
              FERRAMENTA,
              { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS },
            ],
            messages: mensagens,
          })
          .finalMessage()
      }
      return atual
    })()

    const uso = resposta.content.find(
      (c) => c.type === 'tool_use' && c.name === FERRAMENTA.name,
    )
    if (!uso || uso.type !== 'tool_use') {
      const texto = resposta.content
        .filter((c) => c.type === 'text')
        .map((c) => (c as { text: string }).text)
        .join(' ')
        .slice(0, 400)
      return jsonResponse(
        {
          error:
            'O modelo não devolveu o questionário preenchido' +
            (resposta.stop_reason === 'pause_turn'
              ? ' — a pesquisa não terminou dentro do limite de retomadas.'
              : '.') +
            (texto ? ` Ele disse: "${texto}"` : ''),
        },
        502,
      )
    }
    const saida = uso.input as SaidaDaPlanilha

    // 4. Preenchimento, com os guards, e a ficha que volta ao card — as mesmas
    // regras de sempre, agora no módulo que a `planilha-juridica` também usa.
    // As certidões primeiro, do banco — ver preencherCertidoesDoChecklist.
    const doChecklist = await preencherCertidoesDoChecklist(svc, leadId, ws, linhas)
    const { escritas, avisos, ficha, verbasNome } = aplicarRespostas(ws, linhas, comFormula, saida, {
      numero_processo: body.numero_processo,
      cedente: body.cedente,
      tipo_aquisicao: body.tipo_aquisicao,
      honorarios_pct: body.honorarios_pct,
      temChecklist: checklist.temChecklist,
      cortou,
    })
    avisos.push(...doChecklist.avisos)

    // 5. Drive: a pasta da análise do card (ou A. Análises de crédito /
    // Precatórios / {originador} / {cedente}, na falta dela)
    // A PASTA DA ANÁLISE DO CARD (03/10/2026): a gravada nele, e só na falta
    // dela o caminho calculado — que então vira o link do título. Uma pasta já
    // gravada não é trocada (ver _shared/pastaDaAnalise.ts).
    const drive = await salvarPlanilhaNoDrive(
      wb,
      { originador: body.originador, cedente: body.cedente, numero_processo: body.numero_processo, verbasNome },
      { svc, leadId },
    )

    return jsonResponse({
      ok: true,
      resumo: saida.resumo ?? null,
      linhas_no_questionario: linhas.length,
      linhas_preenchidas: escritas + doChecklist.escritas,
      linhas_do_checklist: doChecklist.escritas,
      avisos,
      ficha,
      template: templatePath,
      drive_file_url: drive.drive_file_url,
      drive_folder_url: drive.drive_folder_url,
      pasta_id: drive.pasta_id,
    })
  } catch (e) {
    return jsonResponse(
      { error: 'Falha na análise jurídica: ' + (e instanceof Error ? e.message : String(e)) },
      500,
    )
  }
})
