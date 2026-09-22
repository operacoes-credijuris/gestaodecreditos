// kommo-etiquetar — põe e tira as etiquetas da casa num card do Kommo, sem
// encostar em nenhuma outra que o card tenha.
//
// O QUE ELA TOCA, exatamente: a etiqueta pedida e — ao aplicar — as do MESMO
// destino, que são alternativas dela (ver `irmasDaEtiqueta`). Tudo o mais que
// estiver no card fica onde está, inclusive etiqueta que a plataforma não
// conhece: ela é de quem a pôs.
//
// POR QUE NÃO É UM PATCH DE `_embedded.tags`. Esse é o caminho óbvio, e é uma
// armadilha: a documentação é literal — "all entity tags should be passed. If
// already attached tags are not passed, they will be detached from the entity".
// Ou seja, ele SUBSTITUI a lista inteira. Usá-lo para acrescentar uma etiqueta
// obrigaria a ler as atuais, juntar e devolver todas — e entre a leitura e a
// escrita cabe o comercial etiquetando pelo Kommo, cuja etiqueta sumiria sem
// deixar rastro. Pior: com o espelho local servindo de fonte da lista, bastaria
// ele estar defasado para apagarmos etiquetas que nunca vimos.
//
// `tags_to_add` e `tags_to_delete` são incrementais — o Kommo é que soma e
// subtrai do lado dele — e é por isso que esta função existe em vez de um campo
// a mais na kommo-mover. Referência v4 (Update lead), conferida em 22/09/2026:
// "Array of tags to add. You need to pass either name or ID of the tag."
//
// O QUE ESTA FUNÇÃO NÃO FAZ, porque a API do Kommo não faz: renomear uma
// etiqueta e apagá-la da conta. `tags_to_delete` desfaz o vínculo com ESTE card;
// a etiqueta continua viva na conta e nos outros cards. Limpar a conta é ação de
// administrador, no painel — o próprio Kommo não renomeia etiqueta nem por lá.
//
// USO (POST, com sessão logada):
//   { "leadId": 15269795, "etiqueta": "Enviado PJUS", "acao": "adicionar" }
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { contaKommo } from '../_shared/segredos.ts'
import {
  etiquetaCanonica,
  irmasDaEtiqueta,
  mesmaEtiqueta,
} from '../_shared/etiquetasDoFundo.ts'
import { trilhaDoPipeline } from '../_shared/trilhasDoPrecatorio.ts'

/** Rótulo exibido no selo da anotação, dentro do card — o mesmo da kommo-mover. */
const SERVICO = 'Operacional'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ATIVO, e não só autenticado: desativar alguém em Configurações não revoga
    // o JWT dele, e esta função escreve num card que o comercial lê.
    const caller = await getCallerAtivo(req, serviceClient())
    if (!caller) return jsonResponse({ error: ERRO_ACESSO }, 401)

    const body = (await req.json().catch(() => ({}))) as {
      leadId?: number
      etiqueta?: string
      acao?: string
    }
    const leadId = Number(body.leadId)
    const acao = String(body.acao ?? '')
    if (!leadId) return jsonResponse({ error: 'Informe leadId.' }, 400)
    if (acao !== 'adicionar' && acao !== 'remover') {
      return jsonResponse({ error: 'A ação precisa ser "adicionar" ou "remover".' }, 400)
    }

    // A LISTA DE PERMISSÃO, e o motivo de ela existir: o Kommo CRIA a etiqueta
    // quando recebe um nome que ainda não existe. Sem esta porta, um nome
    // digitado errado em qualquer ponto do caminho viraria etiqueta nova na
    // conta do comercial — e a API não tem como renomeá-la nem apagá-la depois.
    //
    // E O NOME QUE SEGUE É O DA LISTA, nunca o que chegou na requisição:
    // "enviado pjus" casa com a regra, mas quem vai ao Kommo é "Enviado PJUS".
    const etiqueta = etiquetaCanonica(body.etiqueta)
    if (!etiqueta) {
      return jsonResponse(
        { error: `Etiqueta não reconhecida: "${String(body.etiqueta ?? '')}".` },
        400,
      )
    }

    const svc = serviceClient()

    // O CARD PRECISA SER DE PRECATÓRIO, e o espelho é quem diz de qual funil ele
    // é. Sem esta pergunta, um leadId solto no corpo etiquetaria qualquer card
    // da conta — inclusive os do comercial, que não são desta tela.
    const { data: espelho } = await svc
      .from('kommo_leads')
      .select('pipeline_id, tags')
      .eq('kommo_lead_id', leadId)
      .maybeSingle()
    if (!espelho) {
      return jsonResponse({ error: 'Card não encontrado no espelho local.' }, 404)
    }
    if (!trilhaDoPipeline(Number(espelho.pipeline_id))) {
      return jsonResponse({ error: 'Este card não é de um funil de precatório.' }, 400)
    }

    const conta = await contaKommo()
    if (!conta) return jsonResponse({ error: 'Kommo não configurado.' }, 400)
    const base = `https://${conta.subdominio}.kommo.com/api/v4`
    const headers = {
      Authorization: `Bearer ${conta.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    // 1. A ESCRITA INCREMENTAL. Um nome só, e o Kommo resolve o resto: pedir
    // para acrescentar o que já está lá não duplica, e pedir para tirar o que
    // não está não é erro — as duas são idempotentes, que é o que um botão de
    // alternar precisa quando o clique chega duas vezes.
    //
    // E A TROCA VAI NO MESMO PATCH: marcar "Reprovado BTG" tira "Cotado BTG",
    // porque o crédito está num dos dois e não nos dois. Duas chamadas fariam a
    // mesma coisa e deixariam um estado intermediário visível — sem etiqueta
    // nenhuma, ou com as duas — se a segunda falhasse.
    const irmas = acao === 'adicionar' ? irmasDaEtiqueta(etiqueta) : []
    const patch = acao === 'adicionar'
      ? {
        tags_to_add: [{ name: etiqueta }],
        ...(irmas.length > 0 ? { tags_to_delete: irmas.map((name) => ({ name })) } : {}),
      }
      : { tags_to_delete: [{ name: etiqueta }] }
    const res = await fetch(`${base}/leads/${leadId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return jsonResponse(
        {
          error: `Kommo recusou a etiqueta (HTTP ${res.status}).`,
          detalhe: txt.slice(0, 300),
        },
        502,
      )
    }

    // 2. A LISTA DE VERDADE VEM DO KOMMO, relendo o card. A resposta do PATCH
    // traz só id/updated_at/_links — e somar a etiqueta ao que o espelho tinha
    // seria gravar no espelho uma lista que ninguém conferiu. Relendo, o que a
    // tela mostra em seguida é o que o Kommo tem, inclusive a etiqueta que o
    // comercial pôs há dez minutos e o nosso sync ainda não trouxe.
    let tags: string[] | null = null
    let aviso: string | null = null
    try {
      const resLead = await fetch(`${base}/leads/${leadId}`, { headers })
      if (resLead.ok) {
        const lead = (await resLead.json()) as {
          _embedded?: { tags?: { name?: string }[] }
        }
        const lidas = lead?._embedded?.tags
        if (Array.isArray(lidas)) {
          tags = lidas.map((t) => String(t?.name ?? '').trim()).filter(Boolean)
        }
      }
    } catch {
      /* rede: cai no cálculo local, e o aviso abaixo explica */
    }
    if (!tags) {
      // A ETIQUETA JÁ FOI GRAVADA — falhar aqui seria mentir sobre o que
      // aconteceu. Calcula o provável a partir do espelho, e diz que é provável.
      const antes = (espelho.tags ?? []) as string[]
      const saiu = (t: string) =>
        mesmaEtiqueta(t, etiqueta) || irmas.some((i) => mesmaEtiqueta(t, i))
      tags = acao === 'adicionar'
        ? [...antes.filter((t) => !saiu(t)), etiqueta]
        : antes.filter((t) => !mesmaEtiqueta(t, etiqueta))
      aviso =
        'A etiqueta foi gravada no Kommo, mas não consegui reler o card: a lista ' +
        'aqui pode estar incompleta até a próxima sincronização.'
    }

    // 3. O ESPELHO. Sem isto a tela mostraria a lista antiga até o próximo sync
    // — e o defeito seria mudo, porque supabase-js devolve { error } em vez de
    // lançar, e retorno que ninguém lê é falha que ninguém vê.
    const { error: eEspelho } = await svc
      .from('kommo_leads')
      .update({ tags })
      .eq('kommo_lead_id', leadId)
    if (eEspelho) {
      console.error('[kommo-etiquetar] espelho', leadId, eEspelho)
      const _falha =
        'A etiqueta mudou no Kommo, mas o espelho local não atualizou (' +
        String(eEspelho.message ?? '').slice(0, 120) +
        '); corrige no próximo sync.'
      aviso = aviso ? `${aviso} ${_falha}` : _falha
    }

    // 4. QUEM FOI. Escrita por API, a mudança aparece no histórico do Kommo como
    // "Integração com a Plataforma", sem pessoa nenhuma — é a mesma razão que
    // faz a kommo-mover anotar cada movimentação. Etiqueta de fundo é ato de
    // operação: quem pôs "Reprovado BTG" precisa estar escrito no card.
    const { data: perfil } = await svc
      .from('profiles')
      .select('nome, email')
      .eq('id', caller.id)
      .maybeSingle()
    const autor = perfil?.nome?.trim() || perfil?.email || caller.email || 'usuário do sistema'
    // A QUE SAIU ENTRA NO TEXTO, quando saiu: "aplicada" sozinha esconderia que
    // a outra do mesmo destino caiu junto, e é ela que o comercial tinha lido no
    // card. Só entra a que o card de fato tinha — a lista de irmãs vai inteira
    // ao Kommo, mas nem toda estava lá.
    const substituidas = irmas.filter((i) =>
      ((espelho.tags ?? []) as string[]).some((t) => mesmaEtiqueta(t, i)),
    )
    const texto =
      acao === 'adicionar'
        ? substituidas.length > 0
          ? `Etiqueta "${etiqueta}" aplicada por ${autor}, no lugar de ${
            substituidas.map((t) => `"${t}"`).join(', ')
          }.`
          : `Etiqueta "${etiqueta}" aplicada por ${autor}.`
        : `Etiqueta "${etiqueta}" removida por ${autor}.`
    try {
      const resNota = await fetch(`${base}/leads/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify([
          {
            entity_id: leadId,
            // service_message, que o kommo-sync ignora: registro de auditoria
            // não pode voltar como se fosse dado do crédito escrito pelo
            // comercial. Ver o cabeçalho da kommo-anotar.
            note_type: 'service_message',
            params: { service: SERVICO, text: texto },
            is_need_to_trigger_digital_pipeline: false,
          },
        ]),
      })
      if (!resNota.ok) {
        aviso =
          (aviso ? aviso + ' ' : '') +
          `A etiqueta mudou, mas o registro de quem a mudou não gravou (HTTP ${resNota.status}).`
      }
    } catch (e) {
      aviso =
        (aviso ? aviso + ' ' : '') +
        'A etiqueta mudou, mas o registro de quem a mudou não gravou (falha de rede: ' +
        ((e as Error)?.message ?? String(e)).slice(0, 120) +
        ').'
    }

    return jsonResponse({
      ok: true,
      tags,
      aviso,
      mensagem:
        acao === 'adicionar'
          ? `Etiqueta "${etiqueta}" aplicada.`
          : `Etiqueta "${etiqueta}" removida.`,
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
