// ============================================================================
// redigir-desfecho — a anotação que registra, no card, por que o crédito parou.
//
// SAIU DE DENTRO DA gerar-analise-rpv, e a mudança não é arrumação: a redação
// não tem nada de RPV. Ela nasceu ali porque só a análise de RPV tinha desfecho;
// agora o precatório interno também reprova e diligencia, e a recusa por due
// diligence — em qualquer funil — precisa da mesma anotação. Deixá-la onde
// estava obrigaria a chamar o motor de RPV para escrever um parágrafo.
//
// QUEM LÊ É O COMERCIAL, que vai falar com o cedente e com o advogado. Ele não
// tem a análise à frente, não fez a conta, e vai agir a partir do que estiver
// escrito. Daí a forma ser fixa e os termos técnicos ficarem — trocá-los por
// linguagem coloquial tira precisão de um registro que pode ser cobrado depois.
//
// TRÊS BLOCOS, sempre:
//
//   Crédito Recusado          o título, exato, para a coluna do CRM ficar
//                             legível de cima a baixo
//   [o motivo, em texto       corrido, nomeando o que o sustenta — os achados
//    corrido + a lista]       da análise ou os processos da diligência
//   [o impacto]               por que aquilo alcança ESTA operação
//
// O TERCEIRO BLOCO É O QUE FALTAVA. Listar "execução fiscal 0801234-56" não diz
// nada a quem não é do jurídico; o que decide é a frase seguinte — que uma
// execução em curso contra o cedente pode alcançar o crédito cedido por fraude à
// execução. Sem ela a anotação é um índice, não uma razão.
//
// NÃO ESCREVE SOZINHA: devolve a redação, a tela mostra, a pessoa edita e só
// então confirma. O texto vai para o card sob o nome dela.
// ============================================================================

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'
import { TITULO_DO_DESFECHO, garantirTitulo, type Desfecho } from '../_shared/desfecho.ts'

const CLAUDE_MODEL = 'claude-opus-5'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const usuario = await getCallerAtivo(req, serviceClient())
    if (!usuario) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const chave = await chaveAnthropic()
    if (!chave) return jsonResponse({ error: 'Chave da Anthropic não configurada.' }, 400)

    const body = await req.json().catch(() => ({}))
    const desfecho = String(body.desfecho ?? '').toLowerCase() as Desfecho
    // O TÍTULO PODE VIR DE FORA, e só a recusa parcial o manda: quando cai UMA
    // verba e a outra segue, a anotação abre nomeando qual — "Crédito Principal
    // Recusado" — porque quem varre o funil precisa distinguir isso de relance
    // do card recusado inteiro.
    const doPedido = String(body.titulo ?? '').trim().slice(0, 80)
    const titulo = doPedido || TITULO_DO_DESFECHO[desfecho] || TITULO_DO_DESFECHO.validacao

    const itens: string[] = (Array.isArray(body.itens) ? body.itens : [])
      .map((i: unknown) => String(i ?? '').trim())
      .filter(Boolean)
      .slice(0, 20)
    const livre = String(body.texto ?? '').trim().slice(0, 2000)
    const sintese = String(body.sintese ?? '').trim().slice(0, 2000)
    if (!itens.length && !livre) {
      return jsonResponse(
        { error: 'Nada para redigir: marque ao menos um item ou escreva o motivo.' },
        400,
      )
    }

    // DE ONDE VIERAM OS ITENS muda o que eles SÃO, e portanto o que o segundo e
    // o terceiro blocos dizem. Achado de análise é defeito DESTE processo;
    // processo de diligência é dívida de OUTRO, que ameaça este por ricochete —
    // e é justamente essa ponte que a anotação precisa explicar.
    const daDiligencia = String(body.origem ?? '') === 'diligencia'
    const cabeca = [
      body.cedente ? `Cedente: ${String(body.cedente).slice(0, 120)}` : null,
      body.numero_processo ? `Processo: ${String(body.numero_processo).slice(0, 40)}` : null,
    ]
      .filter(Boolean)
      .join(' · ')

    const oQueSaoOsItens = daDiligencia
      ? 'OS ITENS SÃO OUTROS PROCESSOS, achados na due diligence em nome do cedente ou do ' +
        'advogado. Eles não são defeitos deste crédito: são dívidas de terceiro que podem ' +
        'alcançá-lo. Cite cada um pelo número e diga em uma oração o que é.'
      : 'OS ITENS SÃO ACHADOS DA ANÁLISE deste próprio processo — divergência de conta, ' +
        'documento faltante, requisito não atendido.'

    const oQueEhImpacto = daDiligencia
      ? 'COMO ELES ALCANÇAM A OPERAÇÃO: execução em curso contra o cedente pode levar à ' +
        'penhora do crédito cedido ou à anulação da cessão por fraude à execução ' +
        '(art. 792 do CPC); insolvência ou falência arrasta o crédito para a massa; cessão ' +
        'anterior do mesmo crédito o torna indisponível. Diga qual desses é o risco aqui, e ' +
        'por quê. Se um dos processos NÃO ameaça a operação, não o transforme em risco.'
      : 'O QUE O ACHADO CUSTA À OPERAÇÃO: quanto o crédito encolhe, que requisito falha, ' +
        'ou o que impede o pagamento. Quando o obstáculo for removível, diga o que teria de ' +
        'mudar para o crédito voltar a ser viável.'

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        // Teto curto: a saída são três blocos curtos, e teto alto só dá margem
        // para o modelo escrever mais do que alguém vai ler.
        max_tokens: 900,
        system:
          'Você redige a anotação que registra, no CRM, o desfecho de um crédito judicial em análise. ' +
          'QUEM LÊ é o comercial que vai falar com o cedente e com o advogado. Ele NÃO tem a análise à frente, ' +
          'não fez a conta, e vai agir a partir do que você escrever. ' +
          'MANTENHA OS TERMOS TÉCNICOS — "fraude à execução", "honorários sucumbenciais", "termo inicial dos juros", ' +
          '"teto da RPV" —, porque trocá-los por linguagem coloquial tira precisão de um registro que pode ser ' +
          'cobrado depois. MAS EXPLIQUE: ao lado do termo, a consequência em uma oração curta. ' +
          'FORMA — TRÊS BLOCOS, nesta ordem, e nada antes nem depois deles. ' +
          `(1) A primeira linha é só o título — copie exatamente estes caracteres, sem ponto final e sem negrito: ${titulo} — e nada mais nela. ` +
          '(2) O MOTIVO, em TEXTO CORRIDO, nomeando dentro do texto o que o sustenta. ' +
          'Quando houver mais de um item, liste-os depois do parágrafo, um por linha, cada um começando com "* " ' +
          'e terminando em ponto e vírgula. Com um item só, ele cabe no próprio parágrafo e não vira lista. ' +
          `${oQueSaoOsItens} ` +
          '(3) O IMPACTO NA OPERAÇÃO, em até quatro linhas de texto corrido, sem lista. ' +
          `${oQueEhImpacto} ` +
          'SEPARE OS BLOCOS — E TAMBÉM UM ITEM DO OUTRO — COM LINHA EM BRANCO. O feed do CRM ignora a quebra ' +
          'de linha simples: sem a linha em branco tudo chega colado num parágrafo corrido, que é exatamente o ' +
          'que esta estrutura existe para evitar. ' +
          'Sem saudação, sem despedida, sem assinatura — o CRM já registra quem escreveu. ' +
          'No máximo 250 palavras. NÃO INVENTE NADA: use só o que vier na entrada, e o que a pessoa escreveu ' +
          'livremente tem precedência sobre a sua redação — ela está com o processo aberto. ' +
          'Responda com o texto da anotação e nada mais.',
        messages: [
          {
            role: 'user',
            content:
              `DESFECHO: ${titulo}\n` +
              (cabeca ? `${cabeca}\n` : '') +
              (sintese ? `\nSÍNTESE DO PROCESSO (contexto, não repita inteira):\n${sintese}\n` : '') +
              (itens.length
                ? `\n${daDiligencia ? 'PROCESSOS APONTADOS NA DILIGÊNCIA' : 'ACHADOS MARCADOS NA ANÁLISE'}:\n` +
                  itens.map((i) => `- ${i}`).join('\n') +
                  '\n'
                : '') +
              (livre ? `\nO QUE QUEM DECIDIU ESCREVEU:\n${livre}\n` : '') +
              '\nRedija a anotação.',
          },
        ],
      }),
    })
    const resposta = await res.json().catch(() => null)
    if (!res.ok) {
      return jsonResponse({ error: `A IA recusou a redação (HTTP ${res.status}).`, resposta }, 502)
    }

    const texto = ((resposta?.content ?? []) as { type?: string; text?: string }[])
      .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
      .join('\n')
      .trim()
    if (!texto) return jsonResponse({ error: 'A IA não devolveu texto para a anotação.' }, 502)

    return jsonResponse({ ok: true, mensagem: garantirTitulo(texto, titulo) })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
