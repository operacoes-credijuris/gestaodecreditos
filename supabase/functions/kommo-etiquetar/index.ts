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
//   { "leadId": 15269795, "etiqueta": "Enviado PJus", "acao": "adicionar" }
//
// COM A COTAÇÃO (05/10/2026), só para "Cotado ‹fundo›" e só ao adicionar:
//   { "leadId": 15269795, "etiqueta": "Cotado PX Ativos", "acao": "adicionar",
//     "cotacao": { "propostaCentavos": 85000000,
//                  "comissao": { "modalidade": "limitada", "centavos": 4000000 } } }
// O texto "R$ 850.000,00 / R$ 40.000,00" vai para o campo do fundo no grupo
// "Cotações/propostas" do card, NO MESMO PATCH da etiqueta (ver o passo 1). Sem
// `cotacao`, a função faz exatamente o que fazia — a tela antiga continua só
// pondo a etiqueta.
//
// NO SPREAD (05/10/2026), o valor digitado e o percentual em centésimos (5% = 500):
//     "cotacao": { "propostaCentavos": 85000000,
//                  "comissao": { "modalidade": "spread", "percentualCentesimos": 500 } }
// A FUNÇÃO FAZ A CONTA (`textoDaCotacao`, a mesma da prévia da tela) e grava
// "R$ 807.500,00 / R$ 42.500,00 (Spread de 5%)" — não recebe texto pronto. O
// spread SEM `percentualCentesimos` é o da tela anterior (aba aberta antes do
// deploy): continua aceito e grava o formato antigo, "R$ 850.000,00 / Spread".
//
// A BASE DO SPREAD (06/10/2026) é o VALOR LÍQUIDO VALIDADO, que a tela acha na
// nota de oportunidade do card e a pessoa confere:
//     "cotacao": { "propostaCentavos": 85000000,
//                  "comissao": { "modalidade": "spread", "percentualCentesimos": 500,
//                               "baseCentavos": 80000000 } }
// comissão = líquido × percentual (R$ 40.000,00) e final = proposta − comissão
// (R$ 810.000,00): grava "R$ 810.000,00 / R$ 40.000,00 (Spread de 5%)". A função
// confere e recalcula (`validarCotacao`), e recusa a comissão que alcance a
// proposta. SEM `baseCentavos` é a tela de 05/10/2026, ainda aberta em alguma
// aba: continua aceita, com o percentual sobre o valor da proposta (a conta de
// ontem). A base não cabe no texto do campo: ela fica na nota de registro.
//
// O BTG NÃO TEM SPREAD (07/10/2026): a comissão dele é sempre limitada, e é
// propriedade do fundo (`comissoes` em etiquetasDoFundo.ts). Um "Cotado BTG"
// com spread é recusado com 400 e a mensagem diz para recarregar — é o que
// manda uma aba aberta antes do deploy, e não há tolerância para ela aqui: o
// banco não pratica spread, e gravar um seria registrar o que não existe. O
// spread JÁ GRAVADO num card antigo continua sendo lido como está.
//
// "ENVIADO BTG" (07/10/2026, o crédito de atacado) é uma etiqueta da lista como
// as outras: entra pelo `tags_to_add`, que cria a etiqueta na conta na primeira
// vez em que é aplicada (ver o cabeçalho de etiquetasDoFundo.ts), sem cotação.
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { kommoFetch } from '../_shared/kommoFetch.ts'
import { ERRO_ACESSO, getCallerAtivo, serviceClient } from '../_shared/auth.ts'
import { contaKommo } from '../_shared/segredos.ts'
import {
  ETIQUETAS_DA_PRECIFICACAO,
  etiquetaCanonica,
  etiquetasATirar,
  idDaEtiquetaNaConta,
  irmasDaEtiqueta,
  mesmaEtiqueta,
  datasDasEtiquetas,
} from '../_shared/etiquetasDoFundo.ts'
import { trilhaDoPipeline } from '../_shared/trilhasDoPrecatorio.ts'
import {
  type CampoDoKommo,
  campoDoFundo,
  formatarReais,
  spreadDaCotacao,
  comCotacaoGravada,
  type Cotacao,
  type GrupoDoKommo,
  textoDaCotacao,
  validarCotacao,
  type ValorDeCampo,
} from '../_shared/cotacaoDoFundo.ts'

/** Rótulo exibido no selo da anotação, dentro do card — o mesmo da kommo-mover. */
const SERVICO = 'Operacional'

// ------------------------------------------------------------------ o mapa dos campos
//
// OS CAMPOS DA CONTA, EM CACHE NA INSTÂNCIA. Achar o campo "PX Ativos" exige a
// lista de campos de lead (paginada) e a dos grupos — duas ou três chamadas ao
// Kommo, que tem teto de 7/s e bloqueia o IP de quem abusa. Pedir isso a cada
// clique de "Cotado" seria pagar o mapa inteiro para gravar um texto; ele muda
// quando alguém cria um campo no painel, isto é, quase nunca.
//
// DEZ MINUTOS, e um atalho: campo não achado num mapa com mais de 30 segundos
// faz UMA releitura antes de recusar — é o caso de quem acabou de criar o campo
// no Kommo e clica de novo.
const VALIDADE_DO_MAPA_MS = 10 * 60 * 1000
const RELEITURA_MINIMA_MS = 30 * 1000
let mapaDosCampos: { base: string; em: number; campos: CampoDoKommo[]; grupos: GrupoDoKommo[] } | null = null

/** Lê do Kommo os campos de lead (todas as páginas) e os grupos deles. Lança com o motivo. */
async function lerCamposDaConta(
  base: string,
  headers: Record<string, string>,
): Promise<{ campos: CampoDoKommo[]; grupos: GrupoDoKommo[] }> {
  const campos: CampoDoKommo[] = []
  for (let pagina = 1; pagina <= 20; pagina++) {
    const res = await kommoFetch(`${base}/leads/custom_fields?limit=50&page=${pagina}`, { headers })
    // 204 é "não há (mais) nada" — e o corpo vem vazio, então .json() estouraria.
    if (res.status === 204) break
    if (!res.ok) throw new Error(`Não consegui ler os campos do card no Kommo (HTTP ${res.status}).`)
    const j = (await res.json()) as {
      _embedded?: { custom_fields?: CampoDoKommo[] }
      _links?: { next?: { href?: string } }
    }
    campos.push(...(j._embedded?.custom_fields ?? []))
    if (!j._links?.next?.href) break
  }
  // OS GRUPOS SÃO PREFERÊNCIA, não requisito: sem eles, vale o campo de mesmo
  // nome em qualquer aba (ver `campoDoFundo`). Falhar aqui não impede a cotação.
  let grupos: GrupoDoKommo[] = []
  try {
    const res = await kommoFetch(`${base}/leads/custom_fields/groups`, { headers })
    if (res.ok && res.status !== 204) {
      const j = (await res.json()) as { _embedded?: { custom_field_groups?: GrupoDoKommo[] } }
      grupos = j._embedded?.custom_field_groups ?? []
    }
  } catch { /* segue sem os grupos */ }
  return { campos, grupos }
}

async function camposDaConta(base: string, headers: Record<string, string>, forcar = false) {
  const agora = Date.now()
  if (
    !forcar && mapaDosCampos && mapaDosCampos.base === base &&
    agora - mapaDosCampos.em < VALIDADE_DO_MAPA_MS
  ) {
    return mapaDosCampos
  }
  mapaDosCampos = { base, em: agora, ...(await lerCamposDaConta(base, headers)) }
  return mapaDosCampos
}

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
      cotacao?: unknown
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
    // "enviado pjus" casa com a regra, mas quem vai ao Kommo é "Enviado PJus".
    //
    // TIRAR UMA ETIQUETA DE FORA DA LISTA, PODE (07/10/2026, pedido do dono): o
    // card às vezes chega com etiqueta que nada tem a ver com os fundos, e o "x"
    // ao lado dela a tira. A porta existe contra CRIAR etiqueta; tirar não cria
    // nada, e só vai ao Kommo se o card a tiver (ver `etiquetasATirar`).
    const etiqueta =
      etiquetaCanonica(body.etiqueta) ?? (acao === 'remover' ? String(body.etiqueta ?? '').trim() : null)
    if (!etiqueta) {
      return jsonResponse(
        { error: `Etiqueta não reconhecida: "${String(body.etiqueta ?? '')}".` },
        400,
      )
    }

    // A COTAÇÃO, quando vem: só com "Cotado ‹fundo›" e só ao pôr. É conferida
    // AQUI, antes de qualquer chamada ao Kommo — valor inválido não pode deixar
    // meia gravação no card.
    let cotacao: Cotacao | null = null
    const daLista = ETIQUETAS_DA_PRECIFICACAO.find((e) => e.nome === etiqueta)
    if (body.cotacao !== undefined && body.cotacao !== null) {
      if (acao !== 'adicionar' || daLista?.ato !== 'Cotado') {
        return jsonResponse(
          { error: 'A cotação só acompanha a etiqueta "Cotado" de um fundo, ao pô-la.', gravado: false },
          400,
        )
      }
      // COM O FUNDO: a modalidade precisa ser uma das que ele aceita (o BTG, só limitada).
      const v = validarCotacao(body.cotacao, { fundo: daLista.destino })
      if (!v.ok) return jsonResponse({ error: v.erro, gravado: false }, 400)
      cotacao = v.cotacao
    }

    const svc = serviceClient()

    // O CARD PRECISA SER DE PRECATÓRIO, e o espelho é quem diz de qual funil ele
    // é. Sem esta pergunta, um leadId solto no corpo etiquetaria qualquer card
    // da conta — inclusive os do comercial, que não são desta tela.
    const { data: espelho } = await svc
      .from('kommo_leads')
      // O `raw` (o lead como o sync o leu, uma linha): é ali que moram os campos
      // do card, e é ali que a cotação nova entra no espelho.
      .select('pipeline_id, tags, raw')
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
    // para acrescentar o que já está lá não duplica; para tirar, só se pede o que
    // o card TEM (pedir uma que não existe na conta faz o Kommo recusar tudo,
    // ver `etiquetasATirar`) — idempotente, que é o que um botão de
    // alternar precisa quando o clique chega duas vezes.
    //
    // E A TROCA VAI NO MESMO PATCH: marcar "Reprovado BTG" tira "Cotado BTG",
    // porque o crédito está num dos dois e não nos dois. Duas chamadas fariam a
    // mesma coisa e deixariam um estado intermediário visível — sem etiqueta
    // nenhuma, ou com as duas — se a segunda falhasse.
    //
    // E A COTAÇÃO TAMBÉM: `custom_fields_values` no mesmo PATCH. O Kommo valida
    // a requisição inteira antes de aplicar, então o card fica com as duas
    // coisas ou com nenhuma — a etiqueta "Cotado" não aparece sem o valor, nem o
    // valor sem a etiqueta. E o PATCH de `custom_fields_values` só toca os
    // campos que leva: os outros campos do card ficam como estão, assim como as
    // outras etiquetas com `tags_to_add`.
    //
    // O CAMPO É ACHADO ANTES, pelo nome do fundo (ver `campoDoFundo`). Não achado,
    // ou de tipo que não aceita texto: nada vai ao card, e a resposta diz qual
    // campo falta — a janela da tela fica aberta, com o que foi digitado.
    let campo: CampoDoKommo | null = null
    let textoDoCampo: string | null = null
    if (cotacao && daLista) {
      try {
        let mapa = await camposDaConta(base, headers)
        let achado = campoDoFundo(daLista.destino, mapa.campos, mapa.grupos)
        if (!achado.ok && Date.now() - mapa.em > RELEITURA_MINIMA_MS) {
          mapa = await camposDaConta(base, headers, true)
          achado = campoDoFundo(daLista.destino, mapa.campos, mapa.grupos)
        }
        if (!achado.ok) {
          return jsonResponse(
            { error: `${achado.erro} A etiqueta não foi posta.`, codigo: 'campo-da-cotacao', gravado: false },
            400,
          )
        }
        campo = achado.campo
      } catch (e) {
        return jsonResponse(
          { error: `${(e as Error).message} Nada foi gravado no card.`, gravado: false },
          502,
        )
      }
      textoDoCampo = textoDaCotacao(cotacao)
    }

    // AS ETIQUETAS QUE O CARD TEM AGORA, lidas do Kommo: só elas podem sair
    // (ver `etiquetasATirar` — tirar uma que não existe na conta faz o Kommo
    // recusar o PATCH inteiro). Do Kommo, e não do espelho, porque a etiqueta
    // que o comercial pôs há dez minutos ainda não chegou aqui pelo sync. Se a
    // leitura falhar, vale o espelho.
    let doCard = (espelho.tags ?? []) as string[]
    // O ID DE CADA ETIQUETA DO CARD, pelo nome como o Kommo o devolve: é por ele
    // que se tira (08/10/2026). Pelo nome, o "&" que a API devolve como "&amp;"
    // ("Cotado K &amp; WC Ativos") podia não casar com a etiqueta da conta.
    const idDaEtiqueta = new Map<string, number>()
    try {
      const resAntes = await kommoFetch(`${base}/leads/${leadId}`, { headers })
      if (resAntes.ok) {
        const antes = (await resAntes.json()) as { _embedded?: { tags?: { id?: number; name?: string }[] } }
        const lidas = antes?._embedded?.tags
        if (Array.isArray(lidas)) {
          doCard = lidas.map((t) => String(t?.name ?? '').trim()).filter(Boolean)
          for (const t of lidas) if (t?.name && Number(t?.id) > 0) idDaEtiqueta.set(String(t.name).trim(), Number(t.id))
        }
      }
    } catch {
      /* rede: fica o espelho */
    }
    const irmas = acao === 'adicionar' ? irmasDaEtiqueta(etiqueta) : []
    const aTirar = etiquetasATirar(acao, etiqueta, doCard)
    const paraTirar = aTirar.map((name) => (idDaEtiqueta.has(name) ? { id: idDaEtiqueta.get(name)! } : { name }))
    // A ETIQUETA JÁ ESTÁ NO CARD — o caso do lápis, que só ALTERA a cotação
    // (08/10/2026, pedido do dono): a etiqueta não é reposta. Repô-la deixava no
    // histórico do Kommo a etiqueta tirada e posta de novo, a nota dizia
    // "aplicada" e o "há N dias" voltava a "hoje". Só o campo muda.
    const jaTem = acao === 'adicionar' && doCard.some((t) => mesmaEtiqueta(t, etiqueta))
    // PÔR PELO ID DA ETIQUETA QUE A CONTA JÁ TEM, em qualquer grafia (ver
    // `idDaEtiquetaNaConta` — o caso da PJus). A busca é pelo ato ("Cotado"),
    // que traz todas as grafias de todos os fundos; falhando, vai pelo nome.
    let paraPor: { id: number } | { name: string } = { name: etiqueta }
    if (acao === 'adicionar' && !jaTem) {
      try {
        const termo = encodeURIComponent(etiqueta.split(/\s+/)[0] ?? etiqueta)
        const resConta = await kommoFetch(`${base}/leads/tags?query=${termo}&limit=250`, { headers })
        if (resConta.ok && resConta.status !== 204) {
          const j = (await resConta.json().catch(() => null)) as { _embedded?: { tags?: { id?: number; name?: string }[] } } | null
          const id = idDaEtiquetaNaConta(j?._embedded?.tags ?? [], etiqueta)
          if (id) paraPor = { id }
        }
      } catch {
        /* rede: vai pelo nome, como sempre */
      }
    }
    const patch = acao === 'adicionar'
      ? {
        ...(jaTem ? {} : { tags_to_add: [paraPor] }),
        ...(paraTirar.length > 0 ? { tags_to_delete: paraTirar } : {}),
        ...(campo && textoDoCampo
          ? { custom_fields_values: [{ field_id: campo.id, values: [{ value: textoDoCampo }] }] }
          : {}),
      }
      : { tags_to_delete: paraTirar }
    // TIRAR O QUE O CARD NÃO TEM, ou PÔR O QUE ELE JÁ TEM sem cotação nova, é não
    // fazer nada: sem PATCH, segue para a releitura.
    // O PATCH É IDEMPOTENTE (pôr o que já está, tirar o que já saiu, gravar o
    // mesmo texto no campo): pode ser repetido depois de 429 ou 5xx.
    const res = Object.keys(patch).length === 0 || (acao === 'remover' && aTirar.length === 0)
      ? new Response(null, { status: 204 })
      : await kommoFetch(
        `${base}/leads/${leadId}`,
        { method: 'PATCH', headers, body: JSON.stringify(patch) },
        { idempotente: true },
      )
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return jsonResponse(
        {
          error: campo
            ? `Kommo recusou a cotação e a etiqueta (HTTP ${res.status}); nada foi gravado no card.`
            : `Kommo recusou a etiqueta (HTTP ${res.status}).`,
          detalhe: txt.slice(0, 300),
          ...(campo ? { gravado: false } : {}),
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
    // Os campos do card relidos (só com cotação): o que a tela põe no cache.
    let campos: ValorDeCampo[] | null = null
    let aviso: string | null = null
    try {
      const resLead = await kommoFetch(`${base}/leads/${leadId}`, { headers })
      if (resLead.ok) {
        const lead = (await resLead.json()) as {
          _embedded?: { tags?: { name?: string }[] }
          custom_fields_values?: ValorDeCampo[] | null
        }
        const lidas = lead?._embedded?.tags
        if (Array.isArray(lidas)) {
          tags = lidas.map((t) => String(t?.name ?? '').trim()).filter(Boolean)
        }
        // `null` no Kommo é "card sem campo preenchido" — aqui não acontece, porque
        // acabamos de preencher um; o [] só protege a forma.
        if (campo) campos = Array.isArray(lead?.custom_fields_values) ? lead.custom_fields_values : []
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
    //
    // COM COTAÇÃO, os campos do card vão para o `raw` — é de lá que a janela
    // "Escolher proposta" lê, e sem isto ela mostraria o valor antigo até o
    // próximo sync. Sem a releitura, troca-se só o campo gravado.
    const rawAntes = ((espelho as { raw?: Record<string, unknown> | null }).raw ?? {}) as {
      custom_fields_values?: ValorDeCampo[] | null
    }
    if (campo && textoDoCampo && !campos) {
      campos = comCotacaoGravada(rawAntes.custom_fields_values, campo, textoDoCampo)
    }
    const { error: eEspelho } = await svc
      .from('kommo_leads')
      .update(campo && campos ? { tags, raw: { ...rawAntes, custom_fields_values: campos } } : { tags })
      .eq('kommo_lead_id', leadId)
    // A DATA DA ETIQUETA, na hora (migração 0074): é o "hoje" que aparece ao
    // lado dela. Gravação à parte e sem aviso se falhar — sem a coluna, a
    // etiqueta continua certa e o sync preenche a data depois.
    try {
      const { data: comDatas } = await svc
        .from('kommo_leads')
        .select('tags_em')
        .eq('kommo_lead_id', leadId)
        .maybeSingle()
      if (comDatas) {
        const antes = (comDatas.tags_em ?? {}) as Record<string, string | null>
        // A ETIQUETA QUE JÁ ESTAVA (só a cotação mudou) guarda a data dela.
        const agora = acao === 'adicionar' && !jaTem ? { [etiqueta]: new Date().toISOString() } : {}
        const tags_em = datasDasEtiquetas({
          tags: tags,
          antes: jaTem
            ? antes
            : { ...Object.fromEntries(Object.entries(antes).filter(([k]) => !mesmaEtiqueta(k, etiqueta))), ...agora },
        })
        await svc.from('kommo_leads').update({ tags_em }).eq('kommo_lead_id', leadId)
      }
    } catch { /* o sync preenche */ }

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
    // card. Só entra a que o card de fato tinha (lida do Kommo antes do PATCH).
    const substituidas = irmas.filter((i) =>
      doCard.some((t) => mesmaEtiqueta(t, i)),
    )
    // NO SPREAD, A BASE VAI JUNTO: o texto do campo não a diz, e é este registro
    // que conta, depois, sobre quanto o percentual incidiu.
    const doSpread = cotacao ? spreadDaCotacao(cotacao) : null
    const sobre = doSpread
      ? `, sobre o ${doSpread.sobreLiquido ? 'valor líquido validado' : 'valor da proposta'} de ` +
        formatarReais(doSpread.baseCentavos)
      : ''
    const comCotacao = textoDoCampo ? ` Cotação: ${textoDoCampo}${sobre}.` : ''
    // SÓ A COTAÇÃO MUDOU (o lápis): a nota diz isso, e não "etiqueta aplicada".
    const doFundo = daLista?.destino ?? etiqueta.replace(/^Cotado\s+/i, '')
    const texto = jaTem
      ? textoDoCampo
        ? `Cotação ${doFundo} alterada por ${autor}: ${textoDoCampo}${sobre}.`
        : ''
      : (acao === 'adicionar'
        ? substituidas.length > 0
          ? `Etiqueta "${etiqueta}" aplicada por ${autor}, no lugar de ${
            substituidas.map((t) => `"${t}"`).join(', ')
          }.`
          : `Etiqueta "${etiqueta}" aplicada por ${autor}.`
        : `Etiqueta "${etiqueta}" removida por ${autor}.`) + comCotacao
    // Nada mudou no card (pôr o que já estava, sem cotação): nada a registrar.
    if (texto) try {
      // POST: só se repete com 429 (não processado) — ver kommoFetch.
      const resNota = await kommoFetch(`${base}/leads/notes`, {
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
      mensagem: jaTem
        ? (textoDoCampo ? `Cotação alterada: ${textoDoCampo}.` : `A etiqueta "${etiqueta}" já estava no card.`)
        : acao === 'adicionar'
          ? `Etiqueta "${etiqueta}" aplicada${textoDoCampo ? `, com a cotação ${textoDoCampo}` : ''}.`
          : `Etiqueta "${etiqueta}" removida.`,
      // SÓ COM COTAÇÃO — campos novos e opcionais, que a tela antiga ignora.
      ...(campo && textoDoCampo
        ? { cotacao: { texto: textoDoCampo, campo: { id: campo.id, name: campo.name, type: campo.type } }, campos }
        : {}),
    })
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
