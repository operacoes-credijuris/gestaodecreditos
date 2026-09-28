// ============================================================================
// dd-qualificacao — O CADASTRO DO CEDENTE, lido dos autos pela IA.
//
// É o primeiro passo da aba Certidões. O checklist sai das regras da planilha
// modelo aplicadas às PESSOAS do crédito — quem cede, onde mora e já morou, se é
// casado —, e até aqui quem abria a aba tinha de catar isso no processo à mão.
// Esta função lê os anexos do card e devolve o cadastro pronto para conferir.
//
// NÃO GRAVA NADA. Devolve cada campo com o TRECHO dos autos de onde saiu, e a
// tela preenche o formulário; quem confere grava. E o que a IA devolve passa por
// `normalizarQualificacao` antes de sair daqui: CPF que não está escrito nos
// autos não chega à tela.
//
// USO (POST, com sessão):
//   { lead_id, titulo, texto, parcela? }
// `texto` é o dos anexos, que o navegador já leu — o mesmo de dd-titulares.
// ============================================================================

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'
import { MAX_TEXTO_CHARS } from '../_shared/orcamentoLeitura.ts'
import { alvosDaCessao, type ParcelaCedida } from '../_shared/titularesDaCessao.ts'
import { normalizarQualificacao } from '../_shared/qualificacaoDoCedente.ts'

const CLAUDE_MODEL = 'claude-opus-5'

const SISTEMA = `Você lê autos de processo judicial e extrai a QUALIFICAÇÃO de quem está cedendo o crédito, para montar o checklist de certidões da due diligence.

O QUE CADA CAMPO DECIDE — por isso a precisão importa mais que a completude:
- CPF e data de nascimento: são os dados com que cada certidão é pedida. CPF errado faz todo portal responder "nada consta" sobre outra pessoa.
- Residências (UF e município, a atual e as anteriores): cada estado e cada município onde a pessoa morou exige certidões próprias.
- Estado civil: casado ou em união estável exige as certidões do cônjuge também.

ONDE PROCURAR: a qualificação das partes na petição inicial, procurações, contratos (de honorários, de cessão), documentos pessoais anexados, declarações de hipossuficiência, comprovantes de residência. Endereços em peças mais recentes indicam a residência ATUAL; endereços diferentes em peças antigas são residências ANTERIORES.

REGRAS DURAS:
- NUNCA invente. Campo que você não viu escrito nos autos é string vazia. Não deduza CPF, não complete data.
- O CPF devolvido tem de estar ESCRITO nos autos exatamente com esses dígitos.
- NÃO confunda com o advogado (salvo quando o cedente É o advogado), o ente devedor, o perito, o juiz, testemunhas ou outros litisconsortes.
- Endereço do escritório de advocacia, do fórum ou do órgão público NÃO é residência do cedente.
- Estado civil: um de "solteiro", "casado", "divorciado", "viuvo", "separado", "uniao_estavel" — ou vazio. Se a qualificação disser "casada", é "casado".
- Cônjuge: só se o estado civil for casado ou união estável, e só com o que estiver escrito (nome, CPF, nascimento).
- Datas no formato AAAA-MM-DD.
- Cada evidência é o TRECHO literal de onde você tirou o dado, até 250 caracteres.
- Havendo dúvida relevante (dois CPFs possíveis, dois endereços atuais, qualificação contraditória), diga no campo "aviso".

Responda APENAS com JSON válido, sem markdown e sem texto em volta:
{"cedente":{"nome":"","cpf":"","nascimento":"","nome_mae":"","evidencia_nome":"","evidencia_cpf":"","evidencia_nascimento":"","evidencia_nome_mae":""},
 "estado_civil":{"valor":"","evidencia":""},
 "conjuge":{"nome":"","cpf":"","nascimento":"","evidencia":""},
 "residencias":[{"uf":"","municipio":"","atual":true,"evidencia":""}],
 "aviso":""}`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const svc = serviceClient()
    const usuario = await getCallerAtivo(req, svc)
    if (!usuario) return jsonResponse({ erro: ERRO_ACESSO }, 401)

    const chave = await chaveAnthropic()
    if (!chave) return jsonResponse({ erro: 'Chave da Anthropic não configurada.' }, 400)

    const body = await req.json().catch(() => ({}))
    const titulo = String(body.titulo ?? '').trim()
    const textoDosAutos = String(body.texto ?? '').trim()
    const parcela = String(body.parcela ?? '') as ParcelaCedida
    if (!textoDosAutos) {
      return jsonResponse(
        { erro: 'Os anexos deste card não têm texto para ler — processo digitalizado só tem imagem.' },
        400,
      )
    }

    const alvos = alvosDaCessao(parcela)

    // AS DUAS PONTAS, como em dd-titulares: a qualificação está na inicial, e o
    // endereço atualizado costuma estar nas peças do fim.
    const recorte =
      textoDosAutos.length > MAX_TEXTO_CHARS
        ? textoDosAutos.slice(0, MAX_TEXTO_CHARS * 0.6) +
          '\n\n[...trecho do meio omitido por tamanho...]\n\n' +
          textoDosAutos.slice(-Math.floor(MAX_TEXTO_CHARS * 0.4))
        : textoDosAutos

    const pedido =
      `TÍTULO DO CARD: ${titulo || '(não informado)'}\n` +
      `VERBAS CEDIDAS: ${alvos.verbas}\n` +
      `QUEM CEDE: ${
        alvos.cedenteEhOAdvogado
          ? 'o ADVOGADO titular dos honorários (é dele a qualificação que interessa)'
          : 'o exequente/autor titular do crédito principal (se houver vários, o que o título do card nomeia)'
      }\n\n` +
      `AUTOS:\n${recorte}\n\n` +
      'Extraia a qualificação de quem cede.'

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2000,
        system: SISTEMA,
        messages: [{ role: 'user', content: pedido }],
      }),
    })
    const resposta = await res.json().catch(() => null)
    if (!res.ok) return jsonResponse({ erro: `A IA recusou a leitura (HTTP ${res.status}).` }, 502)

    const bruto = ((resposta?.content ?? []) as { type?: string; text?: string }[])
      .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
      .join('')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()

    let lido: unknown
    try {
      lido = JSON.parse(bruto)
    } catch {
      return jsonResponse({ erro: 'A IA não devolveu JSON válido.' }, 502)
    }

    // CONFERIDO CONTRA O MESMO TEXTO QUE A IA LEU — é o recorte, e não o texto
    // inteiro, que ela viu.
    return jsonResponse({ ok: true, ...normalizarQualificacao(lido, recorte) })
  } catch (err) {
    return jsonResponse({ erro: (err as Error).message }, 500)
  }
})
