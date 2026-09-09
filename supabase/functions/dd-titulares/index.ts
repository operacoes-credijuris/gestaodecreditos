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
// ============================================================================

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { chaveAnthropic } from '../_shared/segredos.ts'
import { cnjDoCard } from '../_shared/nucleo/cnj.ts'
import { MAX_TEXTO_CHARS } from '../_shared/orcamentoLeitura.ts'
import {
  alvosDaCessao,
  lacunasDaLeitura,
  normalizarTitulares,
  type ParcelaCedida,
} from '../_shared/titularesDaCessao.ts'

const CLAUDE_MODEL = 'claude-opus-5'

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

Responda APENAS com JSON válido, sem markdown e sem texto em volta:
{"titulares":[{"papel":"CEDENTE"|"ADVOGADO","nome":"","documento":"","oab":"","tipo_pessoa":"PF"|"PJ","evidencia":""}],"aviso":""}`

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

    // O TEXTO INTEIRO, até o teto da janela. A qualificação das partes está na
    // inicial (começo) e o contrato de honorários costuma estar no fim — cortar
    // por uma das pontas perde justamente um dos dois titulares.
    const recorte =
      textoDosAutos.length > MAX_TEXTO_CHARS
        ? textoDosAutos.slice(0, MAX_TEXTO_CHARS * 0.6) +
          '\n\n[...trecho do meio omitido por tamanho...]\n\n' +
          textoDosAutos.slice(-Math.floor(MAX_TEXTO_CHARS * 0.4))
        : textoDosAutos

    const pedido =
      `TÍTULO DO CARD: ${titulo || '(não informado)'}\n` +
      (cnj ? `PROCESSO: ${cnj}\n` : '') +
      `VERBAS CEDIDAS: ${alvos.verbas}\n` +
      `TITULARES A IDENTIFICAR: ${alvos.papeis.join(', ')}\n\n` +
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
        max_tokens: 1500,
        system: SISTEMA,
        messages: [{ role: 'user', content: pedido }],
      }),
    })
    const resposta = await res.json().catch(() => null)
    if (!res.ok) {
      return jsonResponse(
        { erro: `A IA recusou a leitura (HTTP ${res.status}).`, resposta },
        502,
      )
    }

    const bruto = ((resposta?.content ?? []) as { type?: string; text?: string }[])
      .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
      .join('')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()

    let lido: { titulares?: unknown; aviso?: unknown }
    try {
      lido = JSON.parse(bruto)
    } catch {
      return jsonResponse(
        { erro: 'A IA não devolveu JSON válido.', texto_bruto: bruto.slice(0, 800) },
        502,
      )
    }

    const titulares = normalizarTitulares(lido.titulares)
    const avisos = lacunasDaLeitura(alvos, titulares)
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
    })
  } catch (err) {
    return jsonResponse({ erro: (err as Error).message }, 500)
  }
})
