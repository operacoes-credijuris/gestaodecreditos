// ============================================================================
// dd-titulares — QUEM É O DONO DA PARCELA QUE ESTAMOS COMPRANDO.
//
// É o passo que faltava antes da diligência. A aba "Processos judiciais" pedia o
// CPF do cedente e a OAB do advogado à mão, de todo card, como se fossem sempre
// os dois — e quem digita não tem os autos abertos ao lado. O título do card já
// diz QUAIS VERBAS estão sendo cedidas; os autos dizem DE QUEM elas são. Juntar
// as duas coisas é o trabalho desta função.
//
// A REGRA DE QUEM APURAR é pura e mora em _shared/titularesDaCessao.ts: o
// principal é do exequente, os honorários são do advogado, e numa cessão só de
// honorários quem cede é o próprio advogado. Aqui só se lê os autos.
//
// NÃO GRAVA NADA. Devolve os candidatos com a EVIDÊNCIA ao lado, e quem confere
// escolhe — o mesmo princípio de cpfNoTexto.ts e dadosNoTexto.ts. Um processo
// tem o CPF do cedente, o do advogado, o do ente devedor e o de cada terceiro;
// adivinhar aqui é despachar a diligência da pessoa errada e pagar por ela.
//
// USO (POST, com sessão):
//   { lead_id, titulo, texto, parcela? }
// `texto` é o dos anexos, que o navegador já leu para a análise. Vem de lá em
// vez de ser buscado de novo: o PDF já está na memória da tela, e uma segunda
// leitura custaria uma consulta à Judit por nada.
//
// DESDE 03/10/2026, O OFÍCIO REQUISITÓRIO DEFINE O TITULAR. Regra do dono: "o
// cedente deve corresponder ao titular do crédito, do precatório, o que precisa
// corresponder ao ofício anexado no kommo". A tela manda os anexos COM o nome
// (`arquivos: [{nome, texto}]`, acréscimo; o `texto` antigo continua aceito);
// _shared/oficioDoCredito.ts acha o ofício e lê o beneficiário de cada verba;
// o ofício vai no topo do pedido à IA; e o titular de cada papel passa a ser o
// do ofício (`imporOficioAosTitulares`) — a leitura dos autos que apontou outra
// pessoa é trocada, com aviso. Título e ofício divergindo, a resposta diz "o
// título do card diz X; o ofício requisitório diz Y", e a tela segura a busca
// PAGA até alguém conferir.
//
// Acréscimos na resposta: `oficio`, `titular_do_oficio` (de quem cede),
// `titulares_do_oficio` (por papel), `divergencia` e `aviso_do_oficio`. O aviso
// de destaque também entra no topo de `avisos`, que a tela antiga mostra.
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
import { cnjDoCard } from '../_shared/nucleo/cnj.ts'
import { MAX_TEXTO_CHARS } from '../_shared/orcamentoLeitura.ts'
import {
  alvosDaCessao,
  lacunasDaLeitura,
  normalizarTitulares,
  type ParcelaCedida,
  type PapelApurado,
} from '../_shared/titularesDaCessao.ts'
import { lerTituloCard } from '../_shared/cadastroDoCard.ts'
import {
  anexosDoCorpo,
  blocoDoOficioParaIA,
  confrontarComOTitulo,
  conferirTitularDaIA,
  imporOficioAosTitulares,
  naturezasDoPapel,
  oficioParaACessao,
  resumoDoOficio,
  type TitularDoOficio,
} from '../_shared/oficioDoCredito.ts'

const CLAUDE_MODEL = 'claude-opus-5-5'

const SISTEMA = `Você lê autos de processo judicial e identifica DE QUEM são as verbas que estão sendo cedidas.

O NEGÓCIO: a Credijuris compra crédito judicial. O card informa quais verbas entram na cessão; você diz quem é o titular de cada uma, com o documento.

QUEM É TITULAR DO QUÊ — isto não se deduz do texto, é regra do direito:
- CRÉDITO PRINCIPAL: o exequente/requerente/autor que ganhou a ação. Pode ser pessoa física ou jurídica, e pode ser espólio ou herdeiros habilitados — nesse caso o titular é quem foi HABILITADO, não o falecido.
- HONORÁRIOS CONTRATUAIS: o ADVOGADO da parte, por força do contrato de honorários. Quando houve destaque (art. 22, §4º da Lei 8.906/94), o titular é o advogado destacado.
- HONORÁRIOS SUCUMBENCIAIS: o ADVOGADO da parte vencedora, pagos pelo vencido.

O QUE DEVOLVER, por titular pedido:
- nome: como está na qualificação dos autos, por extenso;
- documento: CPF (11 dígitos) ou CNPJ (14), só os números. Vazio se os autos não trouxerem;
- oab: só para o advogado, no formato "UF NÚMERO" (ex.: "GO 12345"). Vazio se não houver;
- tipo_pessoa: "PF" ou "PJ";
- evidencia: o TRECHO dos autos de onde você tirou isso, até 300 caracteres, copiado literalmente.

REGRAS DURAS:
- NUNCA invente documento. Documento que você não viu escrito nos autos é string vazia. Um CPF errado manda a diligência procurar dívida de outra pessoa, e a consulta é paga.
- NÃO devolva o CPF do ente devedor (União, Estado, Município, autarquia), do perito, do juiz nem de testemunha. O polo passivo não é titular de nada aqui.
- Havendo VÁRIOS advogados, devolva o que subscreve as petições da parte vencedora ou o que aparece no contrato/destaque de honorários. Um só.
- Havendo VÁRIOS exequentes (litisconsórcio), devolva o que o título do card nomeia; se o título não ajudar, devolva o primeiro do polo ativo e diga isso no campo "aviso".
- Se não achar um dos titulares pedidos, devolva o objeto dele com nome vazio — não omita a linha, e não substitua por outra pessoa.

O OFÍCIO REQUISITÓRIO DEFINE O TITULAR. Quando o pedido trouxer o bloco "OFÍCIO REQUISITÓRIO — define o titular" (RPV ou precatório expedido pelo tribunal), o titular de cada verba é o BENEFICIÁRIO do ofício daquela natureza — mesmo que o título do card nomeie outra pessoa, e mesmo que os autos tenham vários autores. Ofício de honorários (ou o destaque dos contratuais) tem o advogado ou a sociedade de advogados como beneficiário. O requerente, o advogado constituído e o ente devedor que o ofício cita NÃO são beneficiários por isso. Para quem CEDE (o papel pedido em "QUEM CEDE"), devolva também "titular_do_oficio": nome e documento como estão escritos no ofício (só os números), a natureza ("principal", "contratuais", "sucumbenciais" ou "honorarios") e o trecho literal do ofício. Sem o bloco do ofício no pedido, devolva "titular_do_oficio" com tudo vazio.

Responda APENAS com JSON válido, sem markdown e sem texto em volta:
{"titulares":[{"papel":"CEDENTE"|"ADVOGADO","nome":"","documento":"","oab":"","tipo_pessoa":"PF"|"PJ","evidencia":""}],"titular_do_oficio":{"nome":"","documento":"","natureza":"","evidencia":""},"aviso":""}`

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
    // `arquivos` (com o nome de cada anexo) é o campo novo; `texto`, o da tela
    // aberta antes do deploy.
    const { anexos, texto: textoDosAutos } = anexosDoCorpo(body)
    const parcela = String(body.parcela ?? '') as ParcelaCedida

    if (!textoDosAutos) {
      return jsonResponse(
        {
          erro:
            'Sem o texto dos autos não há o que ler. Abra o card com os anexos carregados — ' +
            'processo digitalizado (só imagem) não tem texto para extrair.',
        },
        400,
      )
    }

    const alvos = alvosDaCessao(parcela)
    const cnj = cnjDoCard(titulo)

    // O OFÍCIO REQUISITÓRIO: o beneficiário de cada verba é o titular dela. O
    // nome do título só escolhe entre vários beneficiários da mesma verba.
    const doTitulo = lerTituloCard(titulo).cedente
    const oficio = oficioParaACessao(anexos, parcela, doTitulo)
    const blocoOficio = blocoDoOficioParaIA(oficio.oficios)

    // O TEXTO INTEIRO, até o teto da janela. A qualificação das partes está na
    // inicial (começo) e o contrato de honorários costuma estar no fim — cortar
    // por uma das pontas perde justamente um dos dois titulares. O ofício vai à
    // parte, no topo, e o seu tamanho sai do teto.
    const teto = Math.max(50_000, MAX_TEXTO_CHARS - blocoOficio.length - 4_000)
    const recorte =
      textoDosAutos.length > teto
        ? textoDosAutos.slice(0, teto * 0.6) +
          '\n\n[...trecho do meio omitido por tamanho...]\n\n' +
          textoDosAutos.slice(-Math.floor(teto * 0.4))
        : textoDosAutos

    const doOficioNoPedido = alvos.papeis
      .map((p) => {
        const t = oficio.porPapel[p]?.titular
        return t ? `${p}: ${t.nome}${t.documento ? ` (${t.documento})` : ''}` : ''
      })
      .filter(Boolean)
    const pedido =
      (blocoOficio
        ? `OFÍCIO REQUISITÓRIO — define o titular:\n${blocoOficio}\n\n` +
          (doOficioNoPedido.length > 0
            ? `BENEFICIÁRIOS DO OFÍCIO, por papel: ${doOficioNoPedido.join('; ')}. São estes os titulares — confirme no ofício.\n\n`
            : 'Identifique no ofício o beneficiário de cada verba cedida: são eles os titulares.\n\n')
        : '') +
      `TÍTULO DO CARD: ${titulo || '(não informado)'}\n` +
      (cnj ? `PROCESSO: ${cnj}\n` : '') +
      `VERBAS CEDIDAS: ${alvos.verbas}\n` +
      `TITULARES A IDENTIFICAR: ${alvos.papeis.join(', ')}\n` +
      `QUEM CEDE: ${oficio.papelDoCedente}\n\n` +
      `AUTOS:\n${recorte}\n\n` +
      'Identifique os titulares pedidos.'

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        // 8000, e não 1500: no Opus 5.5 o raciocínio, sempre ligado, conta
        // dentro do teto, e com 1500 ele podia comer o JSON.
        max_tokens: 8000,
        // O padrão do Opus 5 (o do 5.5 é 'medium').
        output_config: { effort: ESFORCO_PADRAO_DO_OPUS },
        system: SISTEMA,
        messages: [{ role: 'user', content: pedido }],
      } satisfies PedidoAoOpus),
    })
    const resposta = await res.json().catch(() => null)
    if (!res.ok) {
      return jsonResponse(
        { erro: `A IA recusou a leitura (HTTP ${res.status}).`, resposta },
        502,
      )
    }

    const bruto = semCercaDeMarkdown(textoDaResposta(resposta?.content))

    let lido: { titulares?: unknown; titular_do_oficio?: unknown; aviso?: unknown }
    try {
      lido = JSON.parse(bruto)
    } catch {
      return jsonResponse(
        { erro: 'A IA não devolveu JSON válido.', texto_bruto: bruto.slice(0, 800) },
        502,
      )
    }

    // SÓ OS PAPÉIS PEDIDOS, conferido aqui e não só pedido no prompt.
    //
    // O campo preenchido na tela é o que autoriza a busca paga: se o modelo
    // devolvesse o advogado numa cessão só do principal, a tela o preencheria
    // e o Refazer procuraria dívida de quem não é parte do negócio. Obediência
    // de modelo não é garantia — a garantia é este filtro.
    const lidos = normalizarTitulares(lido.titulares).filter((t) =>
      alvos.papeis.includes(t.papel),
    )

    // O OFÍCIO POR CIMA. O titular de quem cede é conferido contra o que a IA
    // diz ter lido no ofício (documento escrito nele, dígito válido); o do
    // outro papel é o da leitura determinística.
    const confirmado = conferirTitularDaIA(
      lido.titular_do_oficio,
      oficio.oficios,
      oficio.titular,
      naturezasDoPapel(oficio.papelDoCedente, parcela),
    )
    const doOficio: Partial<Record<PapelApurado, TitularDoOficio | null>> = {}
    for (const p of alvos.papeis) doOficio[p] = oficio.porPapel[p]?.titular ?? null
    // SÓ NO PAPEL QUE A VERBA DELE SERVE: no card que não diz a verba, quem o
    // título nomeia pode ser o advogado — e ele não vira titular do principal.
    const t = confirmado.titular
    const serve = !t || (oficio.papelDoCedente === 'CEDENTE' ? t.natureza === 'principal' : t.natureza !== 'principal')
    if (alvos.papeis.includes(oficio.papelDoCedente) && serve) doOficio[oficio.papelDoCedente] = t
    const imposto = imporOficioAosTitulares(lidos, doOficio)
    const titulares = imposto.titulares.filter((t) => alvos.papeis.includes(t.papel))
    const { divergencia, aviso: avisoDoOficio } = confrontarComOTitulo(
      doTitulo,
      confirmado.titular,
      oficio.oficios,
      oficio.avisoDaEscolha,
    )

    const avisos = lacunasDaLeitura(alvos, titulares)
    avisos.unshift(...imposto.avisos, ...confirmado.avisos)
    // O AVISO DE DESTAQUE NO TOPO: a tela antiga mostra `avisos` (em toast); a
    // nova o mostra à parte, em `aviso_do_oficio`, e o tira desta lista.
    if (avisoDoOficio) avisos.unshift(avisoDoOficio)
    const doModelo = String(lido.aviso ?? '').trim()
    if (doModelo) avisos.push(doModelo)

    return jsonResponse({
      ok: true,
      lead_id: Number(body.lead_id) || null,
      processo: cnj || null,
      parcela: parcela || null,
      verbas: alvos.verbas,
      papeis: alvos.papeis,
      cedente_eh_o_advogado: alvos.cedenteEhOAdvogado,
      porque: alvos.porque,
      titulares,
      avisos,
      oficio: resumoDoOficio(oficio.oficios),
      titular_do_oficio: confirmado.titular,
      titulares_do_oficio: alvos.papeis
        .map((papel) => ({ papel, titular: doOficio[papel] ?? null }))
        .filter((x) => x.titular),
      divergencia,
      aviso_do_oficio: avisoDoOficio,
    })
  } catch (err) {
    return jsonResponse({ erro: (err as Error).message }, 500)
  }
})
