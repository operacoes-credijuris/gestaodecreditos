// AS ETIQUETAS QUE A PLATAFORMA PODE PÔR E TIRAR DE UM CARD DO KOMMO.
//
// Uma lista fechada, e é este o ponto do arquivo. A API do Kommo CRIA a etiqueta
// quando recebe um nome que ainda não existe na conta — mandar texto livre daqui
// faria nascer "Enviado PJus ", "enviado pjus" e "Enviado Pjus" como três
// etiquetas distintas, cada uma com a sua cor, e a coluna do comercial ficaria
// com uma sujeira que a API não sabe desfazer: o Kommo não tem endpoint para
// renomear nem para apagar etiqueta (verificado em 22/09/2026 na referência
// v4 — só listar, criar, vincular e desvincular).
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, então o mesmo arquivo roda no vitest
// do site, no navegador (importado por caminho relativo) e na Edge Function. A
// tela desenha o seletor a partir desta lista, e a `kommo-etiquetar` decide o
// que aceita a partir DELA TAMBÉM: foi a lição das trilhas, onde duas listas que
// precisavam concordar divergiram no primeiro dia.

/** Os atos de uma etiqueta, na ordem do percurso — as posições fixas do seletor, nesta ordem. */
export const ATOS_DA_PRECIFICACAO = ['Enviado', 'Cotado', 'Reprovado'] as const
export type AtoDaPrecificacao = (typeof ATOS_DA_PRECIFICACAO)[number]

/**
 * O ERRO DA PLATAFORMA DO FUNDO (07/10/2026, pedido do dono): às vezes a
 * plataforma do BTG ou da PJus falha — o crédito não foi enviado nem reprovado,
 * e a casa não pode ficar esperando o fundo para mudar de fase. "Erro BTG" e
 * "Erro PJus" fazem o check na remessa, em âmbar.
 *
 * UMA DO LADO DA OUTRA, E UMA SÓ POR FUNDO (pedido do dono): no seletor é a
 * quarta coluna (`COLUNAS_DO_SELETOR`), e é irmã das outras — marcar "Cotado
 * BTG" depois tira o "Erro BTG". Só os dois fundos de plataforma a têm; nos
 * outros o lugar fica em branco. Fora de `ATOS_DA_PRECIFICACAO` por isso: lá
 * estão os atos que TODO fundo tem.
 */
export type AtoDaEtiqueta = AtoDaPrecificacao | 'Erro'

/** As colunas do seletor de etiquetas, na ordem da tela. */
export const COLUNAS_DO_SELETOR: readonly AtoDaEtiqueta[] = [...ATOS_DA_PRECIFICACAO, 'Erro']

/** Uma etiqueta da casa, e o destino de que ela fala. */
export interface EtiquetaDoFundo {
  /** O nome EXATO como está escrito no Kommo — é ele que vai no PATCH. */
  nome: string
  /** O que aconteceu naquele fundo: a coluna da grade em que ela aparece ("Erro" não tem coluna). */
  ato: AtoDaEtiqueta
  /**
   * O destino a que a etiqueta se refere: o fundo, ou a pessoa que negocia.
   *
   * AGRUPA E EXCLUI. As etiquetas de um destino são os fins possíveis daquela
   * mesma tentativa — passou adiante, ou voltou recusada —, e o crédito está num
   * deles, não em dois: marcar "Reprovado BTG" tira "Cotado BTG" do card. Quem
   * opera pediu assim em 22/09/2026, depois de ver as duas conviverem.
   *
   * ENTRE DESTINOS NÃO HÁ EXCLUSÃO NENHUMA: o mesmo crédito pode estar cotado no
   * BTG e reprovado no PJus, e é exatamente isso que a fila precisa mostrar.
   */
  destino: string
  /**
   * Quando usar a etiqueta, em poucas palavras — o seletor a mostra discreta ao
   * lado: o "Enviado BTG" é "só para atacado" (07/10/2026).
   */
  observacao?: string
}

/** As modalidades de comissão de uma cotação (ver `Comissao` em cotacaoDoFundo.ts). */
export const MODALIDADES_DA_COMISSAO = ['limitada', 'spread'] as const
export type ModalidadeDaComissao = (typeof MODALIDADES_DA_COMISSAO)[number]

interface FundoDaCasa {
  destino: string
  atos: readonly AtoDaPrecificacao[]
  artigo: 'do' | 'da'
  /** As modalidades de comissão que o fundo aceita na cotação, na ordem do seletor. */
  comissoes: readonly ModalidadeDaComissao[]
  /** Uma observação curta junto de um ato, no seletor (ver `EtiquetaDoFundo.observacao`). */
  observacoes?: Partial<Record<AtoDaPrecificacao, string>>
  /** O fundo tem plataforma própria, que pode falhar: ganha a etiqueta "Erro ‹fundo›". */
  erroDePlataforma?: boolean
}

/**
 * OS FUNDOS EM QUE A CASA COTA, na ordem da tela — ditados por quem opera em
 * 29/09/2026. Eram PJus, BTG e Luiz; o Luiz saiu e entraram cinco fundos.
 *
 * O BTG GANHOU O "ENVIADO" EM 07/10/2026 — MUDOU DE PROPÓSITO. Até então ali o
 * crédito não ficava esperando: subia na plataforma do banco e voltava cotado
 * ou recusado na hora (o VAREJO). Acima de uns R$ 10 milhões o BTG cota no
 * ATACADO, com análise personalizada: a casa manda por e-mail e espera, como na
 * PJus. É esse caso que o "Enviado BTG" marca — e só ele (ver `observacoes`).
 *
 * A COMISSÃO DO BTG É SEMPRE LIMITADA (07/10/2026): o banco diz quanto paga, e
 * não há spread. É propriedade do fundo (`comissoes`), e não um `if` na tela:
 * vale para toda janela que pede a cotação e para a porta do servidor
 * (`validarCotacao` com o `fundo`).
 *
 * "PJus", E NÃO "PJUS" (01/10/2026): é como a gestora escreve o nome. As
 * etiquetas antigas, com "PJUS", continuam no Kommo — ele não renomeia nem
 * apaga etiqueta —, e contam como as novas: a comparação ignora maiúsculas
 * (ver `mesmaEtiqueta`). A tela mostra o nome novo, e a kommo-etiquetar tira a
 * grafia antiga quando troca a etiqueta de fundo.
 */
const FUNDOS: readonly FundoDaCasa[] = [
  {
    destino: 'PJus',
    atos: ATOS_DA_PRECIFICACAO,
    artigo: 'da',
    comissoes: MODALIDADES_DA_COMISSAO,
    erroDePlataforma: true,
  },
  {
    destino: 'BTG',
    atos: ATOS_DA_PRECIFICACAO,
    artigo: 'do',
    comissoes: ['limitada'],
    observacoes: { Enviado: 'só para atacado' },
    erroDePlataforma: true,
  },
  { destino: 'PX Ativos', atos: ATOS_DA_PRECIFICACAO, artigo: 'da', comissoes: MODALIDADES_DA_COMISSAO },
  { destino: 'Invest Precatórios', atos: ATOS_DA_PRECIFICACAO, artigo: 'da', comissoes: MODALIDADES_DA_COMISSAO },
  { destino: 'K & WC Ativos', atos: ATOS_DA_PRECIFICACAO, artigo: 'da', comissoes: MODALIDADES_DA_COMISSAO },
  { destino: 'Precatur', atos: ATOS_DA_PRECIFICACAO, artigo: 'da', comissoes: MODALIDADES_DA_COMISSAO },
  { destino: 'Carbon', atos: ATOS_DA_PRECIFICACAO, artigo: 'da', comissoes: MODALIDADES_DA_COMISSAO },
]

/** Os fundos, na ordem da tela — é entre eles que se escolhe a proposta. */
export const FUNDOS_DA_PRECIFICACAO: readonly string[] = FUNDOS.map((f) => f.destino)

/**
 * AS MODALIDADES DE COMISSÃO QUE O FUNDO ACEITA, na ordem do seletor: o BTG só
 * a limitada (07/10/2026); os outros, limitada e spread. Fundo fora da lista (ou
 * nenhum) aceita as duas — o comportamento de antes desta propriedade.
 */
export function comissoesDoFundo(destino: unknown): readonly ModalidadeDaComissao[] {
  return FUNDOS.find((f) => mesmaEtiqueta(f.destino, destino))?.comissoes ?? MODALIDADES_DA_COMISSAO
}

/**
 * A nota do card quando a casa escolhe a proposta: "Seguir com a proposta da PX
 * Ativos." O artigo é do fundo — o BTG é "o banco", os outros são "a gestora".
 */
export function mensagemDaProposta(destino: string): string {
  const f = FUNDOS.find((x) => mesmaEtiqueta(x.destino, destino))
  return `Seguir com a proposta ${f?.artigo ?? 'do(a)'} ${f?.destino ?? destino}.`
}

/**
 * AS ETIQUETAS DA ABA "EM PRECIFICAÇÃO": "‹ato› ‹fundo›", como as que o
 * comercial já usava no kanban ("Enviado PJus", "Cotado BTG") — o mesmo molde,
 * para as dos fundos novos casarem com o vocabulário que está lá.
 *
 * CUIDADO AO MUDAR UM NOME: o Kommo cria a etiqueta na primeira vez que ela é
 * aplicada, e depois não a renomeia nem a apaga. Nome novo aqui é etiqueta nova
 * na conta, para sempre.
 *
 * A ORDEM É A DO PERCURSO dentro de cada fundo: enviado, a cotação que voltou, e
 * por fim a recusa. Como só uma vale por fundo, marcar outra apaga a anterior —
 * "Cotado PJus" substituindo "Enviado PJus" é a notícia de que o fundo respondeu.
 */
export const ETIQUETAS_DA_PRECIFICACAO: readonly EtiquetaDoFundo[] = FUNDOS.flatMap((f) => [
  ...f.atos.map((ato) => ({
    destino: f.destino,
    ato,
    nome: `${ato} ${f.destino}`,
    ...(f.observacoes?.[ato] ? { observacao: f.observacoes[ato] } : {}),
  })),
  // O ERRO POR ÚLTIMO: é o desfecho que não é do fundo, e sim da plataforma dele.
  ...(f.erroDePlataforma ? [{ destino: f.destino, ato: 'Erro' as const, nome: `Erro ${f.destino}` }] : []),
])

/**
 * O "&" QUE O KOMMO DEVOLVE COMO "&amp;" (07/10/2026): o campo da K & WC Ativos
 * vem no card como "K &amp; WC Ativos", e a comparação o perdia — a proposta
 * dela não aparecia, e a cotação não achava o campo. Desfaz as entidades HTML
 * antes de comparar (só as que aparecem em nome: &amp; &lt; &gt; &quot; &#39;
 * e as numéricas).
 */
export function semEntidadesHtml(texto: string): string {
  return texto
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

/** Acento, caixa, espaço a mais e "&amp;" não podem decidir se duas etiquetas são a mesma. */
export function normalizarEtiqueta(nome: unknown): string {
  return semEntidadesHtml(String(nome ?? ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** As duas são a mesma etiqueta, escrita de jeitos diferentes? */
export function mesmaEtiqueta(a: unknown, b: unknown): boolean {
  return normalizarEtiqueta(a) === normalizarEtiqueta(b)
}

/**
 * O nome CANÔNICO da etiqueta, ou null se ela não é uma das que a casa oferece.
 *
 * DEVOLVE O NOME DESTA LISTA, e não o que chegou na requisição — é o que impede
 * um "enviado pjus" digitado noutra caixa de virar etiqueta nova lá dentro. E é
 * a lista de permissão do servidor: fora dela, a função recusa.
 */
export function etiquetaCanonica(nome: unknown): string | null {
  return ETIQUETAS_DA_PRECIFICACAO.find((e) => mesmaEtiqueta(e.nome, nome))?.nome ?? null
}

/**
 * As OUTRAS etiquetas do mesmo destino — as que saem quando esta entra.
 *
 * É AQUI QUE A EXCLUSÃO MORA, e não na tela, porque quem a executa é o servidor:
 * a troca vai num PATCH só (`tags_to_add` com a nova, `tags_to_delete` com as
 * irmãs), e não em duas chamadas. Duas deixariam o card num estado intermediário
 * visível — sem etiqueta nenhuma, ou com as duas — se a segunda falhasse.
 *
 * DEVOLVE TODAS AS IRMÃS, tenha o card alguma ou não: pedir ao Kommo que
 * desvincule uma etiqueta que não está lá não é erro, e perguntar antes custaria
 * uma consulta para evitar coisa nenhuma.
 */
export function irmasDaEtiqueta(
  nome: unknown,
  etiquetas: readonly EtiquetaDoFundo[] = ETIQUETAS_DA_PRECIFICACAO,
): string[] {
  const dela = etiquetas.find((e) => mesmaEtiqueta(e.nome, nome))
  if (!dela) return []
  return etiquetas
    .filter((e) => e.destino === dela.destino && !mesmaEtiqueta(e.nome, dela.nome))
    .map((e) => e.nome)
}

/**
 * A ETIQUETA DA CONTA QUE JÁ É ESTA, em qualquer grafia (09/10/2026): o id para
 * pôr pelo id, em vez de pelo nome.
 *
 * O CASO DA PJUS: a conta tem "Cotado PJUS" (de antes de 01/10/2026) e "Cotado
 * PJus". Pôr pelo NOME uma grafia que só difere em maiúsculas da que existe dá
 * ao Kommo a escolha de recusar ou de criar mais uma etiqueta — e "às vezes dá
 * erro com a PJus" era isso. Pelo id não há o que decidir. O mesmo vale para o
 * "&" que a API devolve como "&amp;" (K & WC Ativos).
 *
 * PREFERE A GRAFIA EXATA da casa; sem ela, a mais antiga (menor id) entre as
 * equivalentes. Nenhuma: null — e aí vai pelo nome, que cria a etiqueta.
 */
export function idDaEtiquetaNaConta(
  daConta: readonly { id?: unknown; name?: unknown }[],
  etiqueta: string,
): number | null {
  const iguais = daConta
    .map((t) => ({ id: Number(t?.id), name: String(t?.name ?? '') }))
    .filter((t) => Number.isFinite(t.id) && t.id > 0 && mesmaEtiqueta(t.name, etiqueta))
  if (iguais.length === 0) return null
  const exata = iguais.find((t) => t.name.trim() === etiqueta)
  return (exata ?? iguais.sort((a, b) => a.id - b.id)[0]).id
}

/**
 * O QUE O PATCH TIRA DO CARD: só as etiquetas que o card TEM, na grafia que ele
 * tem — as irmãs, ao pôr; a própria, ao tirar.
 *
 * SÓ AS QUE ESTÃO NO CARD (07/10/2026): pedir ao Kommo para tirar uma etiqueta
 * que ainda NÃO EXISTE NA CONTA faz ele recusar o PATCH inteiro. Foi o que
 * travou o "Reprovado PJus" no dia em que o "Erro PJus" entrou na lista: o
 * pedido levava `tags_to_delete` com "Erro PJus", que ninguém tinha usado ainda.
 *
 * NA GRAFIA DO CARD: "Enviado PJUS", de antes de 01/10/2026, sai pelo nome que
 * tem lá, e não pelo canônico.
 */
export function etiquetasATirar(
  acao: 'adicionar' | 'remover',
  etiqueta: string,
  doCard: readonly string[],
  etiquetas: readonly EtiquetaDoFundo[] = ETIQUETAS_DA_PRECIFICACAO,
): string[] {
  const alvo = acao === 'adicionar' ? irmasDaEtiqueta(etiqueta, etiquetas) : [etiqueta]
  return [...new Set(doCard.filter((t) => alvo.some((n) => mesmaEtiqueta(t, n))))]
}

/**
 * As etiquetas de um card NA ORDEM DA CASA: a dos fundos na lista (PJus, BTG,
 * PX Ativos…).
 *
 * A ORDEM QUE VINHA ERA A DO KOMMO — isto é, a ordem em que alguém etiquetou —,
 * e ela muda de card para card. Numa coluna de trinta, isso obriga a LER cada
 * linha: o mesmo fundo aparece ora no começo, ora no fim. Com a ordem fixa, a
 * posição vira informação: a primeira etiqueta é sempre a do PJus, e a ausência
 * dela se nota pelo que não está ali.
 *
 * É A MESMA ORDEM DO SELETOR, e de propósito: quem marca e quem lê veem a mesma
 * sequência. Sai da lista, então basta reordenar lá para a tela acompanhar.
 *
 * O QUE NÃO É DA CASA VAI PARA O FIM, guardando a ordem em que veio — é etiqueta
 * de quem a pôs, e inventar posição para ela seria fingir que a conhecemos.
 */
export function ordenarEtiquetas(
  nomes: readonly string[],
  etiquetas: readonly EtiquetaDoFundo[] = ETIQUETAS_DA_PRECIFICACAO,
): string[] {
  const posicao = (nome: string) => {
    const i = etiquetas.findIndex((e) => mesmaEtiqueta(e.nome, nome))
    return i === -1 ? etiquetas.length : i
  }
  return nomes
    .map((nome, entrada) => ({ nome, entrada, ordem: posicao(nome) }))
    // O DESEMPATE PELA ENTRADA mantém estável o que a lista não ordena: duas
    // etiquetas de fora saem na ordem em que o Kommo as devolveu, sempre.
    .sort((a, b) => a.ordem - b.ordem || a.entrada - b.entrada)
    .map((x) => x.nome)
}

/** As etiquetas agrupadas por destino, na ordem da lista — como o seletor as mostra. */
export function etiquetasPorDestino(
  etiquetas: readonly EtiquetaDoFundo[] = ETIQUETAS_DA_PRECIFICACAO,
): { destino: string; etiquetas: EtiquetaDoFundo[] }[] {
  const grupos: { destino: string; etiquetas: EtiquetaDoFundo[] }[] = []
  for (const e of etiquetas) {
    const grupo = grupos.find((g) => g.destino === e.destino)
    if (grupo) grupo.etiquetas.push(e)
    else grupos.push({ destino: e.destino, etiquetas: [e] })
  }
  return grupos
}

// ------------------------------------------------------------------ desde quando

/** Um `entity_tag_added` do Kommo, nos campos que usamos. */
export interface EventoDeEtiqueta {
  entity_id: number
  created_at: number
  value_after?: { tag?: { name?: string } }[]
}

/**
 * DESDE QUANDO CADA ETIQUETA DA CASA ESTÁ NO CARD: nome → data (ISO), ou null
 * quando o Kommo já foi perguntado e não guarda o evento (etiqueta mais antiga
 * que o histórico dele).
 *
 * É O QUE RESPONDE "HÁ QUANTO TEMPO ESTÁ DEMORANDO": "Enviado PJus" há 9 dias é
 * fundo que não respondeu; "Cotado BTG" há 2, cotação fresca. Pedido de quem
 * opera em 29/09/2026.
 *
 * AS REGRAS:
 *   - só as etiquetas da casa, e só as que o card TEM agora — a que saiu some do
 *     mapa, e se voltar é contada de novo, da volta;
 *   - vale o evento MAIS RECENTE da etiqueta: tirada e posta de novo, conta a
 *     segunda vez;
 *   - sem evento novo, fica a data que já se sabia;
 *   - perguntado e sem evento, null — que é o que impede de perguntar de novo a
 *     cada sincronização por uma data que o Kommo não tem.
 */
export function datasDasEtiquetas(o: {
  tags: readonly string[]
  antes?: Record<string, string | null> | null
  eventos?: readonly EventoDeEtiqueta[]
  perguntado?: boolean
}): Record<string, string | null> {
  const fora: Record<string, string | null> = {}
  const antes = o.antes ?? {}
  for (const t of o.tags) {
    const nome = etiquetaCanonica(t)
    if (!nome) continue
    let quando: number | null = null
    for (const e of o.eventos ?? []) {
      if ((e.value_after ?? []).some((v) => mesmaEtiqueta(v?.tag?.name, nome))) {
        if (quando === null || e.created_at > quando) quando = e.created_at
      }
    }
    const jaSabida = Object.keys(antes).find((k) => mesmaEtiqueta(k, nome))
    if (quando !== null) fora[nome] = new Date(quando * 1000).toISOString()
    else if (jaSabida !== undefined) fora[nome] = antes[jaSabida]
    else if (o.perguntado) fora[nome] = null
  }
  return fora
}

/** O card tem etiqueta da casa cuja data ainda não se perguntou ao Kommo? */
export function faltaDataDeEtiqueta(
  tags: readonly string[],
  datas: Record<string, string | null> | null | undefined,
): boolean {
  const chaves = Object.keys(datas ?? {})
  return tags.some((t) => {
    const nome = etiquetaCanonica(t)
    return nome !== null && !chaves.some((k) => mesmaEtiqueta(k, nome))
  })
}

/** Desde quando o card tem esta etiqueta, ou null se não se sabe. */
export function desdeQuandoAEtiqueta(
  datas: Record<string, string | null> | null | undefined,
  nome: string,
): string | null {
  const k = Object.keys(datas ?? {}).find((x) => mesmaEtiqueta(x, nome))
  return k ? (datas![k] ?? null) : null
}
