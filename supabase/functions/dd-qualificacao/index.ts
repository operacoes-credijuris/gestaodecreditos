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
// `normalizarQualificacao` antes de sair daqui: documento que não está escrito
// nos autos, ou que está mas na qualificação de OUTRA pessoa, não chega à tela.
//
// DESDE 03/10/2026, A LEITURA SABE DE QUEM SE TRATA. Antes ela recebia o título
// do card e "o exequente/autor titular", e escolhia sozinha entre os autores, o
// advogado e o réu — às vezes errado (pedido do dono: "a IA deve identificar os
// dados pessoais específicos do cedente que estamos almejando, e ninguém
// mais"). Agora o nome do cedente vai explícito no pedido, o recorte dos autos
// é montado em volta dele (focoNoCedente.ts), e o cedente pode ser pessoa
// jurídica — aí a resposta traz razão social, CNPJ e os endereços da sede.
//
// USO (POST, com sessão):
//   { lead_id, titulo, texto, parcela?, cedente? }
// `texto` é o dos anexos, que o navegador já leu — o mesmo de dd-titulares.
// `cedente` (acréscimo de 03/10/2026) é o nome que a tela já leu do card,
// anotação incluída; sem ele (tela antiga), o nome sai do título.
//
// A RESPOSTA SÓ GANHOU CAMPOS: `cedente.tipo_pessoa`, `cedente.cnpj` e `alvo`.
// A tela antiga, aberta nas abas da equipe durante o deploy, lê os de sempre.
// ============================================================================

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'
import { MAX_TEXTO_CHARS } from '../_shared/orcamentoLeitura.ts'
import { alvosDaCessao, type ParcelaCedida } from '../_shared/titularesDaCessao.ts'
import { lerTituloCard } from '../_shared/cadastroDoCard.ts'
import { recortarAutos, tipoPessoaPeloNome } from '../_shared/focoNoCedente.ts'
import { normalizarQualificacao } from '../_shared/qualificacaoDoCedente.ts'

const CLAUDE_MODEL = 'claude-opus-5'

const SISTEMA = `Você lê autos de processo judicial e extrai a QUALIFICAÇÃO de UMA pessoa — a que está cedendo o crédito, cujo nome o pedido informa — para montar o checklist de certidões da due diligence.

O QUE CADA CAMPO DECIDE — por isso a precisão importa mais que a completude:
- CPF (ou CNPJ) e data de nascimento: são os dados com que cada certidão é pedida. Documento de OUTRA pessoa faz todo portal responder "nada consta" sobre quem não cede nada — o pior erro possível aqui.
- Residências (UF e município, a atual e as anteriores): cada estado e cada município onde a pessoa morou exige certidões próprias.
- Estado civil: casado ou em união estável exige as certidões do cônjuge também.

QUEM É O CEDENTE: a pessoa com o nome informado em "O CEDENTE É". Os autos qualificam muita gente — outros autores e litisconsortes, o advogado, o réu, o ente devedor, peritos, testemunhas, herdeiros. Devolva SÓ os dados da pessoa com aquele nome (aceite a grafia dos autos: maiúsculas, acentos, nome do meio abreviado ou por extenso). De qualquer outra pessoa, NADA — nem para "ajudar". O advogado só interessa quando ele É o cedente informado.
Se você não achar com segurança, nos autos, a pessoa com aquele nome, responda "encontrado": false e deixe todo o resto vazio, explicando no "aviso". Nunca devolva os dados de outra pessoa no lugar.
Se o pedido não informar o nome, o cedente é quem o pedido descrever em "QUEM CEDE"; havendo vários candidatos, diga no "aviso".

PESSOA FÍSICA OU JURÍDICA: decida pelo nome (LTDA, S/A, EIRELI, ME, EPP, "Sociedade de Advogados", "Associados" etc. são de empresa) e pelos autos ("pessoa jurídica de direito privado", "inscrita no CNPJ"). Em "tipo_pessoa", "PF" ou "PJ".
- PF: CPF, data de nascimento, nome da mãe, estado civil, cônjuge e residências.
- PJ: razão social (em "nome"), CNPJ e os endereços da SEDE em "residencias" (a atual e as anteriores, se os autos mostrarem mudança de sede). Para PJ, deixe vazios cpf, nascimento, nome_mae, estado_civil e conjuge — CPF de sócio ou representante NÃO é o documento da empresa.

ONDE PROCURAR: a qualificação das partes na petição inicial, procurações, contratos (de honorários, de cessão), documentos pessoais anexados, contrato social, declarações de hipossuficiência, comprovantes de residência. Endereços em peças mais recentes indicam o endereço ATUAL; endereços diferentes em peças antigas são ANTERIORES.

REGRAS DURAS:
- NUNCA invente. Campo que você não viu escrito nos autos é string vazia. Não deduza documento, não complete data.
- O CPF/CNPJ devolvido tem de estar ESCRITO nos autos exatamente com esses dígitos, NA QUALIFICAÇÃO DO CEDENTE (depois do nome dele, antes do nome da próxima pessoa qualificada).
- Endereço do escritório de advocacia, do fórum ou do órgão público NÃO é residência do cedente.
- Estado civil: um de "solteiro", "casado", "divorciado", "viuvo", "separado", "uniao_estavel" — ou vazio. Se a qualificação disser "casada", é "casado".
- Cônjuge: só se o estado civil for casado ou união estável, e só com o que estiver escrito (nome, CPF, nascimento).
- Datas no formato AAAA-MM-DD.
- Cada evidência é o TRECHO LITERAL dos autos de onde você tirou o dado, copiado sem reescrever, até 250 caracteres — e, sempre que estiver na mesma frase, incluindo o nome do cedente. Trecho que não estiver nos autos faz o dado ser descartado.
- Havendo dúvida relevante (dois documentos possíveis, dois endereços atuais, qualificação contraditória, homônimo), diga no campo "aviso".

Responda APENAS com JSON válido, sem markdown e sem texto em volta:
{"cedente":{"encontrado":true,"tipo_pessoa":"PF","nome":"","cpf":"","cnpj":"","nascimento":"","nome_mae":"","evidencia_nome":"","evidencia_cpf":"","evidencia_cnpj":"","evidencia_nascimento":"","evidencia_nome_mae":""},
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

    // O NOME DE QUEM CEDE. O que a tela já leu do card vence (ela lê a anotação
    // "CEDENTE:" também); a tela antiga não manda, e aí vale o título — pela
    // MESMA leitura que a tela usa, para as duas não divergirem.
    const nomeDoCedente = String(body.cedente ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) ||
      lerTituloCard(titulo).cedente
    const tipoPeloNome = nomeDoCedente ? tipoPessoaPeloNome(nomeDoCedente) : null

    // O RECORTE: em volta do cedente, mais as duas pontas (a qualificação está
    // na inicial, e o endereço atualizado costuma estar nas peças do fim). Sem
    // nome, as duas pontas, como sempre foi.
    const recorte = recortarAutos(textoDosAutos, nomeDoCedente, MAX_TEXTO_CHARS)

    const pedido =
      `TÍTULO DO CARD: ${titulo || '(não informado)'}\n` +
      (nomeDoCedente
        ? `O CEDENTE É: ${nomeDoCedente}` +
          (tipoPeloNome === 'PJ' ? ' (pelo nome, PESSOA JURÍDICA)' : '') +
          '\nDevolva SÓ os dados desta pessoa. De qualquer outra — outros autores, advogado, réu, terceiros — nada.\n'
        : 'O CEDENTE É: (o card não diz o nome — identifique pelo papel abaixo e avise no "aviso")\n') +
      `VERBAS CEDIDAS: ${alvos.verbas}\n` +
      `QUEM CEDE: ${
        alvos.cedenteEhOAdvogado
          ? 'o ADVOGADO titular dos honorários (pessoa física ou a sociedade de advogados)'
          : 'o exequente/autor titular do crédito principal'
      }\n\n` +
      `AUTOS${recorte.focado && recorte.texto.length < textoDosAutos.length ? ' (trechos em volta do cedente, mais o começo e o fim)' : ''}:\n` +
      `${recorte.texto}\n\n` +
      (nomeDoCedente
        ? `Extraia a qualificação de ${nomeDoCedente} — e só dela.`
        : 'Extraia a qualificação de quem cede.')

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
    const q = normalizarQualificacao(lido, recorte.texto, new Date(), { nomeDoCedente })
    if (!nomeDoCedente) {
      q.avisos.unshift(
        'O card não diz o nome do cedente (nem no título, nem na anotação) — a leitura não teve em quem ' +
          'se concentrar e pode ter escolhido outra pessoa do processo. Confira cada campo com cuidado redobrado.',
      )
    }
    return jsonResponse({
      ok: true,
      ...q,
      alvo: { nome: nomeDoCedente, ocorrencias: recorte.ocorrencias, focado: recorte.focado },
    })
  } catch (err) {
    return jsonResponse({ erro: (err as Error).message }, 500)
  }
})
