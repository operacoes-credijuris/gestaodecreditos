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
//
// E, AINDA EM 03/10/2026, O TITULAR É O DO OFÍCIO REQUISITÓRIO. Regra do dono:
// "o cedente deve corresponder ao titular do crédito, do precatório, o que
// precisa corresponder ao ofício anexado no kommo". O título do card é escrito
// à mão; o ofício é o documento do tribunal que diz a quem o dinheiro vai. Então:
//   - a tela manda os anexos COM o nome (`arquivos: [{nome, texto}]`, acréscimo;
//     o `texto` antigo continua aceito para a aba aberta antes do deploy);
//   - _shared/oficioDoCredito.ts acha o ofício (nome do arquivo e conteúdo) e
//     lê o beneficiário da verba cedida;
//   - o texto do ofício vai NO TOPO do pedido, em destaque, e o alvo da leitura
//     passa a ser o beneficiário dele (nome e documento);
//   - a IA confirma o titular no ofício (`titular_do_oficio`), e o documento é
//     conferido aqui: escrito no ofício, dígito válido;
//   - título (ou nome digitado) e ofício divergindo, vale o ofício, e a resposta
//     diz "o título do card diz X; o ofício requisitório diz Y".
// Acréscimos na resposta: `oficio`, `titular_do_oficio`, `divergencia`,
// `aviso_do_oficio` e `alvo.origem`. O aviso de destaque também entra no topo de
// `avisos`, que é o que a tela antiga mostra.
// ============================================================================

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'
import {
  ESFORCO_PADRAO_DO_OPUS,
  semCercaDeMarkdown,
  textoDaResposta,
  type PedidoAoOpus,
} from '../_shared/respostaDoClaude.ts'
import { MAX_TEXTO_CHARS } from '../_shared/orcamentoLeitura.ts'
import { alvosDaCessao, type ParcelaCedida } from '../_shared/titularesDaCessao.ts'
import { lerTituloCard } from '../_shared/cadastroDoCard.ts'
import { MARCA_DE_CORTE, recortarAutos, tipoPessoaPeloNome } from '../_shared/focoNoCedente.ts'
import { normalizarQualificacao } from '../_shared/qualificacaoDoCedente.ts'
import {
  alinharQualificacaoAoOficio,
  anexosDoCorpo,
  blocoDoOficioParaIA,
  confrontarComOTitulo,
  conferirTitularDaIA,
  formatarDocumento,
  mesmaPessoa,
  naturezasDoPapel,
  oficioParaACessao,
  resumoDoOficio,
  ROTULO_DA_NATUREZA,
} from '../_shared/oficioDoCredito.ts'

const CLAUDE_MODEL = 'claude-opus-5-5'

const SISTEMA = `Você lê autos de processo judicial e extrai a QUALIFICAÇÃO de UMA pessoa — a que está cedendo o crédito, cujo nome o pedido informa — para montar o checklist de certidões da due diligence.

O QUE CADA CAMPO DECIDE — por isso a precisão importa mais que a completude:
- CPF (ou CNPJ) e data de nascimento: são os dados com que cada certidão é pedida. Documento de OUTRA pessoa faz todo portal responder "nada consta" sobre quem não cede nada — o pior erro possível aqui.
- Residências (UF e município, a atual e as anteriores): cada estado e cada município onde a pessoa morou exige certidões próprias.
- Estado civil: casado ou em união estável exige as certidões do cônjuge também.

QUEM É O CEDENTE: a pessoa com o nome informado em "O CEDENTE É". Os autos qualificam muita gente — outros autores e litisconsortes, o advogado, o réu, o ente devedor, peritos, testemunhas, herdeiros. Devolva SÓ os dados da pessoa com aquele nome (aceite a grafia dos autos: maiúsculas, acentos, nome do meio abreviado ou por extenso). De qualquer outra pessoa, NADA — nem para "ajudar". O advogado só interessa quando ele É o cedente informado.
Se você não achar com segurança, nos autos, a pessoa com aquele nome, responda "encontrado": false e deixe todo o resto vazio, explicando no "aviso". Nunca devolva os dados de outra pessoa no lugar.
Se o pedido não informar o nome, o cedente é quem o pedido descrever em "QUEM CEDE"; havendo vários candidatos, diga no "aviso".

O OFÍCIO REQUISITÓRIO DEFINE O TITULAR. Quando o pedido trouxer o bloco "OFÍCIO REQUISITÓRIO — define o titular" (RPV ou precatório expedido pelo tribunal), o cedente é o BENEFICIÁRIO desse ofício para a verba cedida — e não quem o título do card nomeia, se divergirem. Confirme no ofício e devolva em "titular_do_oficio":
- nome: como está no campo do beneficiário/credor do ofício;
- documento: o CPF ou CNPJ do beneficiário ESCRITO no ofício, só os números (vazio se o ofício não trouxer);
- natureza: "principal", "contratuais", "sucumbenciais" ou "honorarios" (honorários sem dizer quais) — é a verba de que ele é beneficiário naquele ofício, e não a natureza alimentar/comum do crédito;
- evidencia: o TRECHO LITERAL do ofício com o nome e o documento, até 250 caracteres.
O ofício costuma trazer também o requerente, o advogado e o ente devedor: só o beneficiário da verba cedida é o titular. Sem o bloco do ofício no pedido, devolva "titular_do_oficio" com tudo vazio. A qualificação (cedente, estado civil, residências) continua sendo a do titular, lida nos autos e no ofício.

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
 "titular_do_oficio":{"nome":"","documento":"","natureza":"","evidencia":""},
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
    // `arquivos` (com o nome de cada anexo) é o campo novo; `texto` é o da tela
    // aberta antes do deploy — vira um anexo sem nome, e o ofício é achado pelo
    // conteúdo.
    const { anexos, texto: textoDosAutos } = anexosDoCorpo(body)
    const parcela = String(body.parcela ?? '') as ParcelaCedida
    if (!textoDosAutos) {
      return jsonResponse(
        { erro: 'Os anexos deste card não têm texto para ler — processo digitalizado só tem imagem.' },
        400,
      )
    }

    const alvos = alvosDaCessao(parcela)

    // O NOME QUE O CARD DÁ A QUEM CEDE. O que a tela já leu do card vence (ela
    // lê a anotação "CEDENTE:" também); a tela antiga não manda, e aí vale o
    // título — pela MESMA leitura que a tela usa, para as duas não divergirem.
    const doTitulo = lerTituloCard(titulo).cedente
    const digitado = String(body.cedente ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const nomeDoCard = digitado || doTitulo

    // O OFÍCIO REQUISITÓRIO: o titular da verba cedida é o beneficiário dele.
    // O nome do card só escolhe entre vários beneficiários da mesma verba.
    const oficio = oficioParaACessao(anexos, parcela, nomeDoCard)
    const blocoOficio = blocoDoOficioParaIA(oficio.oficios)
    const det = oficio.titular
    const verbaDoTitular = det ? ROTULO_DA_NATUREZA[det.natureza] : alvos.verbas

    // O ALVO DA LEITURA: o beneficiário do ofício; sem ele, o nome do card.
    const nomeDoCedente = det?.nome || nomeDoCard
    const tipoPeloNome = nomeDoCedente ? tipoPessoaPeloNome(nomeDoCedente) : null

    // O RECORTE: em volta do cedente, mais as duas pontas (a qualificação está
    // na inicial, e o endereço atualizado costuma estar nas peças do fim). Sem
    // nome, as duas pontas, como sempre foi. O OFÍCIO VAI À PARTE, no topo, e o
    // seu tamanho sai do teto dos autos.
    const recorte = recortarAutos(
      textoDosAutos,
      nomeDoCedente,
      Math.max(50_000, MAX_TEXTO_CHARS - blocoOficio.length - 4_000),
    )

    const pedido =
      (blocoOficio
        ? `OFÍCIO REQUISITÓRIO — define o titular:\n${blocoOficio}\n\n` +
          (det
            ? `O BENEFICIÁRIO DESTE OFÍCIO (${verbaDoTitular}) É: ${det.nome}` +
              (det.documento
                ? ` — ${det.documento.length === 14 ? 'CNPJ' : 'CPF'} ${formatarDocumento(det.documento)}`
                : '') +
              '. Ele é o cedente' +
              (doTitulo && !mesmaPessoa(doTitulo, det.nome, [det.sucede])
                ? ` — o título do card diz ${doTitulo}, mas vale o ofício`
                : '') +
              '. Confirme no ofício e devolva em "titular_do_oficio".\n\n'
            : `Identifique no ofício o beneficiário de ${alvos.verbas}: ele é o cedente. Devolva-o em ` +
              '"titular_do_oficio" e extraia a qualificação dele.\n\n')
        : '') +
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
        // 8000, e não 2000: no Opus 5.5 o raciocínio, sempre ligado, conta
        // dentro do teto, e com 2000 ele podia comer o JSON.
        max_tokens: 8000,
        // O padrão do Opus 5 (o do 5.5 é 'medium').
        output_config: { effort: ESFORCO_PADRAO_DO_OPUS },
        system: SISTEMA,
        messages: [{ role: 'user', content: pedido }],
      } satisfies PedidoAoOpus),
    })
    const resposta = await res.json().catch(() => null)
    if (!res.ok) return jsonResponse({ erro: `A IA recusou a leitura (HTTP ${res.status}).` }, 502)

    const bruto = semCercaDeMarkdown(textoDaResposta(resposta?.content))

    let lido: unknown
    try {
      lido = JSON.parse(bruto)
    } catch {
      return jsonResponse({ erro: 'A IA não devolveu JSON válido.' }, 502)
    }

    // O TITULAR DO OFÍCIO, conferido: o documento que a IA der tem de estar
    // escrito no ofício e ter dígito válido; o campo do beneficiário, quando
    // lido, vence a IA.
    const confirmado = conferirTitularDaIA(
      (lido as { titular_do_oficio?: unknown } | null)?.titular_do_oficio,
      oficio.oficios,
      det,
      naturezasDoPapel(oficio.papelDoCedente, parcela),
    )
    const titular = confirmado.titular
    const alvoFinal = titular?.nome || nomeDoCedente
    // A DIVERGÊNCIA É COM O TÍTULO (sem nome no título, com o digitado), e com
    // o titular FINAL. A tela nova pré-preenche o cadastro com o nome do ofício
    // e o manda como `cedente`: comparar com ele esconderia o título errado.
    const { divergencia, aviso: avisoDoOficio } = confrontarComOTitulo(
      doTitulo || digitado,
      titular,
      oficio.oficios,
      oficio.avisoDaEscolha,
    )

    // CONFERIDO CONTRA O MESMO TEXTO QUE A IA LEU — o ofício em destaque e o
    // recorte, e não o texto inteiro. A marca de corte entre os dois impede que
    // a proximidade de um nome no ofício "alcance" um número nos autos.
    const textoLido = blocoOficio ? `${blocoOficio}\n\n${MARCA_DE_CORTE}\n\n${recorte.texto}` : recorte.texto
    const q = normalizarQualificacao(lido, textoLido, new Date(), { nomeDoCedente: alvoFinal })
    alinharQualificacaoAoOficio(q, titular)
    q.avisos.push(...confirmado.avisos)
    if (titular && digitado && digitado !== doTitulo && !mesmaPessoa(digitado, titular.nome, [titular.sucede])) {
      q.avisos.unshift(
        `O nome no cadastro (${digitado}) não é o do ofício requisitório (${titular.nome}) — a leitura seguiu o ofício.`,
      )
    }
    if (!alvoFinal) {
      q.avisos.unshift(
        'O card não diz o nome do cedente (nem no título, nem na anotação) — a leitura não teve em quem ' +
          'se concentrar e pode ter escolhido outra pessoa do processo. Confira cada campo com cuidado redobrado.',
      )
    }
    // O AVISO DE DESTAQUE NO TOPO DOS AVISOS: é o que a tela antiga mostra. A
    // tela nova o mostra à parte, em `aviso_do_oficio`, e o tira desta lista.
    if (avisoDoOficio) q.avisos.unshift(avisoDoOficio)
    return jsonResponse({
      ok: true,
      ...q,
      alvo: {
        nome: alvoFinal,
        ocorrencias: recorte.ocorrencias,
        focado: recorte.focado,
        origem: titular ? 'oficio' : digitado ? 'cadastro' : alvoFinal ? 'titulo' : '',
      },
      oficio: resumoDoOficio(oficio.oficios),
      titular_do_oficio: titular,
      divergencia,
      aviso_do_oficio: avisoDoOficio,
    })
  } catch (err) {
    return jsonResponse({ erro: (err as Error).message }, 500)
  }
})
