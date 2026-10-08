// A PESQUISA EM FRENTES PARALELAS E RESUMÍVEIS da justificativa técnica.
//
// O PROBLEMA (relato do dono, 05/10/2026): com o prompt dele — posição na fila,
// editais de acordo direto de três anos, atas do comitê gestor, RGF Anexo 2,
// EC 136/2025, limite de RPV, dedução da LOA e a conta de anos até o pagamento —
// a geração passava de 7 minutos e estourava. A pesquisa rodava numa invocação
// só da Edge Function, com 340 s de orçamento (o teto de parede é 400 s), e o
// trabalho não cabia: a chamada era abortada, ou a geração dada como morta.
//
// O DESENHO NOVO, etapa por etapa (cada uma numa invocação própria — o relógio
// de parede zera a cada uma):
//
//   1. PLANEJAMENTO: uma chamada curta, sem ferramenta e com esforço 'low', lê o
//      prompt da casa e o card e devolve de 3 a 4 FRENTES independentes (título,
//      perguntas, o que trazer e os dados do card de que a frente precisa), em
//      saída estruturada. Falhou? Uma frente única com o prompt inteiro — o
//      comportamento de antes, mas agora resumível.
//   2. FRENTES EM PARALELO: cada frente na sua invocação, esforço 'medium', com
//      os tetos próprios de busca e de página e o seu dossiê com fontes. Perto
//      do fim do relógio da invocação, a frente SALVA A CONVERSA (os blocos de
//      `server_tool_use` e os resultados, intactos — a API exige) e dispara uma
//      invocação nova que continua de onde parou. Teto total por frente
//      (TETO_DA_FRENTE_MIN, MAX_INVOCACOES_DA_FRENTE): atingido, a frente
//      escreve o dossiê com o que já achou.
//   3. A ÚLTIMA FRENTE A TERMINAR dispara a redação — uma vez só: a marca entra
//      na mesma gravação condicional que fecha a frente.
//   4. REDAÇÃO, esforço 'high', com os dossiês juntos e as fontes renumeradas
//      de forma global, sem repetição.
//
// O ESTADO MORA NO JSONB `pesquisa` QUE JÁ EXISTE (sem migração), em formato com
// versão (`versao: 2`) e com um contador `rev`. A gravação é CONDICIONAL ao `rev`
// lido (o PostgREST filtra por `pesquisa->>rev`): se outra frente gravou no
// meio, ninguém perde nada — relê, reaplica a mudança e tenta de novo
// (gravarComVersao). É assim que as frentes paralelas dividem a linha.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, como justificativaTecnica.ts: roda no
// vitest, no navegador (a janela lê o andamento) e na Edge Function.

import {
  CONSUMO_ZERO,
  type ConsumoDaJustificativa,
  dossieDaResposta,
  type FaseDaGeracao,
  type FonteDaJustificativa,
  NAO_INFORMADO,
  TRAVA_GERACAO_MIN,
} from './justificativaTecnica.ts'

// ------------------------------------------------------------------ os tetos

/**
 * OS TETOS DE CADA FRENTE. Antes eram 8 buscas e 3 páginas para a pesquisa
 * INTEIRA; agora são 6 e 4 por frente — com 4 frentes, até 24 buscas e 16
 * páginas, o que o prompt do dono pede (três anos de editais, atas, RGF, LOA).
 */
export const MAX_BUSCAS_POR_FRENTE = 6
export const MAX_PAGINAS_POR_FRENTE = 4
/** A frente única (o plano falhou) faz a pesquisa toda: tetos maiores. */
export const MAX_BUSCAS_FRENTE_UNICA = 12
export const MAX_PAGINAS_FRENTE_UNICA = 6
/** Teto do texto de cada página aberta: decreto e LOA têm centenas de páginas. */
export const MAX_TOKENS_DA_PAGINA = 20_000

/** Quantas frentes o plano pode ter. */
export const MIN_FRENTES = 2
export const MAX_FRENTES = 4

/**
 * O RELÓGIO DE UMA INVOCAÇÃO. O teto REAL deste projeto é 150 s de parede (o do
 * plano do Supabase em uso), e não os 400 s do plano pago que a primeira versão
 * supôs: medido em produção em 07/10/2026, a frente que passava de ~2 min era
 * derrubada pela plataforma SEM salvar nada, e a geração esperava até dar "o
 * servidor parou de dar sinal". Aos ORCAMENTO_DA_INVOCACAO_MS a chamada em curso
 * é interrompida e o que já chegou inteiro é salvo, com folga para gravar e
 * disparar a próxima (a mesma margem da rotina do Escavador, que usa 100 s).
 */
export const ORCAMENTO_DA_INVOCACAO_MS = 115_000
/** Abaixo disto, não vale começar outra chamada: cede para uma invocação nova. */
export const FOLGA_PARA_NOVA_CHAMADA_MS = 25_000
/** O teto de relógio de uma frente, somadas as invocações. */
export const TETO_DA_FRENTE_MIN = 15
/** O teto de invocações de uma frente (a rede de segurança do teto de tempo). */
export const MAX_INVOCACOES_DA_FRENTE = 6
/** Duas interrupções seguidas sem nada salvo: a frente encerra com o que tem. */
export const MAX_INTERRUPCOES_SEM_AVANCO = 2

/**
 * O LIMITE DE TAXA DA CASA, agora em FRENTES. Cada geração viva ocupa vagas: as
 * frentes ainda pesquisando (enquanto planeja, reserva o máximo), uma enquanto
 * redige. Uma geração nova precisa de MAX_FRENTES vagas livres. Com 10 vagas,
 * cabem duas gerações inteiras pesquisando ao mesmo tempo e uma terceira assim
 * que alguma frente termina — as 3 de antes, sem 12 streams do Opus de uma vez.
 */
export const VAGAS_DE_PESQUISA = 10

// ------------------------------------------------------------------ o plano

/** Uma frente de pesquisa, como o planejamento a devolve. */
export interface FrenteDoPlano {
  titulo: string
  perguntas: string[]
  trazer: string
  /** Os dados do card de que a frente precisa (ano da LOA, datas, natureza…). */
  contexto: string
}

/**
 * O ESQUEMA DA SAÍDA DO PLANEJAMENTO (`output_config.format`). As regras do
 * esquema estruturado valem aqui como em extracaoDoCredito.ts: todo objeto com
 * `additionalProperties: false` e sem `maxItems` — o 3 a 4 vai na instrução e
 * é conferido em planoDaSaida.
 */
export const ESQUEMA_DO_PLANO = {
  type: 'object',
  additionalProperties: false,
  properties: {
    frentes: {
      type: 'array',
      description: 'De 3 a 4 frentes de pesquisa independentes.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          titulo: { type: 'string', description: 'Título curto da frente, até 60 caracteres.' },
          perguntas: {
            type: 'array',
            items: { type: 'string' },
            description: 'As perguntas concretas que a frente responde, com nomes, anos e órgãos.',
          },
          trazer: { type: 'string', description: 'O que a frente devolve: números com data, documentos, fontes.' },
          contexto: {
            type: 'string',
            description: 'Os dados do card de que esta frente precisa (ente, tribunal, natureza, ano da LOA, datas), lidos ou deduzidos do card.',
          },
        },
        required: ['titulo', 'perguntas', 'trazer', 'contexto'],
      },
    },
  },
  required: ['frentes'],
} as const

export const SISTEMA_PLANEJAMENTO =
  'Você planeja a pesquisa de uma justificativa técnica da Credijuris, empresa que compra precatórios e RPVs. ' +
  'Abaixo vêm o PEDIDO DA CASA (o prompt que a redação vai seguir) e os DADOS DO CARD (dados extraídos, título e notas). ' +
  'Divida o que o pedido manda PESQUISAR NA INTERNET em 3 ou 4 FRENTES independentes. Cada frente roda em paralelo, com um pesquisador próprio que não conversa com os outros e só lê o que você escrever para ela. ' +
  'Agrupe por assunto, sem sobreposição: por exemplo posição e andamento da fila; ritmo de pagamento, repasses, normas recentes e limite de RPV; situação fiscal e acordo direto; peculiaridades e orçamento. ' +
  'Não crie frente para o que não exige pesquisa (redigir, fazer contas com os dados do card). ' +
  'Em cada frente: um título curto; as perguntas concretas, já com o ente, o tribunal e os anos certos; o que trazer de volta; e, em "contexto", só os dados do card de que ela precisa (ente devedor e a fila a que pertence, tribunal, natureza do crédito, ano de orçamento lido ou deduzido, datas), sem nome de pessoa, de fundo nem comissão. ' +
  'Leve para as perguntas os cuidados de método do pedido (onde procurar quando a lista do tribunal não abre, o que não confundir).'

/** O pedido ao planejamento: o prompt da casa e o card inteiro. */
export function pedidoDoPlanejamento(instrucao: string, dadosDoCard: string): string {
  return `PEDIDO DA CASA:\n\n${instrucao.trim()}\n\nDADOS DO CARD:\n\n${dadosDoCard.trim()}\n\nDevolva o plano das frentes.`
}

const limpo = (x: unknown, teto: number) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, teto)

/**
 * O PLANO DA SAÍDA, conferido: 2 a 4 frentes com título e pelo menos uma
 * pergunta. Mais de 4: as perguntas das que sobram vão para a última, para nada
 * do que o planejamento viu se perder. Menos de 2, ou nada legível: null — e
 * quem chama cai na frente única (planoDeReserva).
 */
export function planoDaSaida(valor: unknown): FrenteDoPlano[] | null {
  const brutas = (valor as { frentes?: unknown } | null)?.frentes
  if (!Array.isArray(brutas)) return null
  const frentes: FrenteDoPlano[] = []
  for (const b of brutas) {
    const o = (b ?? {}) as Record<string, unknown>
    const titulo = limpo(o.titulo, 80)
    const perguntas = (Array.isArray(o.perguntas) ? o.perguntas : [])
      .map((p) => limpo(p, 600))
      .filter(Boolean)
      .slice(0, 12)
    if (!titulo || perguntas.length === 0) continue
    frentes.push({ titulo, perguntas, trazer: limpo(o.trazer, 1200), contexto: String(o.contexto ?? '').trim().slice(0, 2000) })
  }
  if (frentes.length < MIN_FRENTES) return null
  const ultima = frentes[Math.min(frentes.length, MAX_FRENTES) - 1]
  for (const sobra of frentes.splice(MAX_FRENTES)) {
    ultima.perguntas.push(...sobra.perguntas.map((p) => `(${sobra.titulo}) ${p}`))
    if (sobra.trazer) ultima.trazer = [ultima.trazer, sobra.trazer].filter(Boolean).join(' ')
  }
  return frentes
}

/** O título da frente única, quando o plano falha. */
export const TITULO_FRENTE_UNICA = 'Pesquisa completa'

// ------------------------------------------------------------------ o pedido de cada frente

export const SISTEMA_FRENTE =
  'Você é pesquisador da Credijuris, empresa que compra precatórios e RPVs. Você cuida de UMA FRENTE de uma pesquisa maior, que embasa a justificativa técnica do preço de uma proposta; outras frentes, em paralelo, cuidam dos outros assuntos — não as pesquise. ' +
  'Use a busca na web e, quando a busca só resumir um documento oficial que importa (edital, ata, relatório fiscal, lei), abra-o. ' +
  'Prefira fontes oficiais e recentes; diga a data de cada informação. Não invente nada: o que não achar, diga que não achou. ' +
  'Responda com um DOSSIÊ em tópicos curtos, em português, organizado pelas perguntas da frente, e termine com "NÃO ENCONTRADO:" listando o que procurou e não achou. ' +
  'Cada fato precisa vir da busca ou da página aberta, para a citação acompanhá-lo. ' +
  'Escreva o dossiê INTEIRO na resposta final, depois de terminar as buscas: o que você anotar entre uma busca e outra não chega a quem redige.'

/**
 * O SISTEMA DA FRENTE ÚNICA (o plano falhou): o de antes, que pesquisa a tarefa
 * inteira — só que agora resumível.
 */
export const SISTEMA_FRENTE_UNICA =
  'Você é pesquisador da Credijuris, empresa que compra precatórios e RPVs. Abaixo vem a TAREFA: o pedido de uma justificativa técnica do preço de uma proposta, com os dados do crédito. ' +
  'NESTA ETAPA VOCÊ SÓ PESQUISA — outra etapa redige. Use a busca na web (e, quando a busca só resumir um documento oficial que importa, abra-o) para levantar o que a tarefa pede pesquisar. ' +
  'Prefira fontes oficiais e recentes; diga a data de cada informação. Não invente nada: o que não achar, diga que não achou. ' +
  'Responda com um DOSSIÊ em tópicos curtos, em português, organizado nos assuntos da tarefa, e termine com "NÃO ENCONTRADO:" listando o que procurou e não achou. ' +
  'Cada fato precisa vir da busca, para a citação acompanhá-lo. ' +
  'Escreva o dossiê INTEIRO na resposta final, depois de terminar as buscas: o que você anotar entre uma busca e outra não chega a quem redige.'

/** Os rótulos do pouco do card que toda frente recebe (sem pessoa, fundo nem comissão). */
const DADOS_DA_FRENTE: readonly [string, string][] = [
  ['funil', 'Tipo'],
  ['ente_devedor', 'Ente devedor'],
  ['tribunal', 'Tribunal'],
  ['processo', 'Processo'],
  ['parcela_cedida', 'Parcela cedida'],
  ['valor_atualizado', 'Valor atualizado'],
  ['prazo_estimado', 'Prazo estimado de pagamento'],
  ['teto_rpv', 'Teto de RPV do ente (só RPV)'],
  ['data_hoje', 'Data de hoje'],
]

/**
 * O QUE A FRENTE LÊ: o propósito (o pedido da casa, como contexto de método), a
 * frente dela, o contexto do card que o planejamento separou e o mínimo do
 * crédito. Sem as notas inteiras, sem o cedente, sem fundo e sem comissão: a
 * frente pesquisa o ente e a fila, não o negócio.
 */
export function pedidoDaFrente(
  frente: FrenteDoPlano,
  valores: Readonly<Record<string, string | null | undefined>>,
  instrucao: string,
): string {
  const v = (nome: string) => String(valores[nome] ?? '').trim() || NAO_INFORMADO
  const dados = DADOS_DA_FRENTE.map(([nome, rotulo]) => `- ${rotulo}: ${v(nome)}`).join('\n')
  return [
    `SUA FRENTE: ${frente.titulo}`,
    '',
    'PERGUNTAS:',
    ...frente.perguntas.map((p, i) => `${i + 1}. ${p}`),
    '',
    `O QUE TRAZER DE VOLTA: ${frente.trazer || 'as respostas, com número, data e fonte.'}`,
    '',
    'DADOS DO CRÉDITO:',
    dados,
    ...(frente.contexto.trim() ? ['', 'DO CARD (separado pelo planejamento):', frente.contexto.trim()] : []),
    '',
    'PARA ENTENDER O PROPÓSITO (o pedido completo da casa; pesquise só a SUA frente):',
    instrucao.trim(),
  ].join('\n')
}

/** A frase que retoma uma frente cortada pelo relógio (não é pause_turn: o turno foi fechado). */
export const PEDIDO_DE_CONTINUAR =
  'A conexão caiu no meio da sua pesquisa; o que está acima foi preservado. Continue de onde parou, sem repetir as buscas já feitas, e, ao terminar, escreva o dossiê INTEIRO na resposta final.'

/** A frase que encerra uma frente no teto: escreve com o que tem, sem buscar mais. */
export const PEDIDO_DE_ENCERRAR =
  'O tempo desta frente acabou. Não faça novas buscas nem abra páginas: escreva AGORA o dossiê INTEIRO com o que você já encontrou acima, no formato pedido, citando as fontes, e termine com "NÃO ENCONTRADO:" listando o que ficou sem resposta.'

// ------------------------------------------------------------------ a conversa salva (checkpoint)

/** Um bloco da conversa, como a API o devolve e o aceita de volta (JSON puro). */
export interface BlocoDaConversa {
  type: string
  id?: string
  tool_use_id?: string
  name?: string
  text?: string
  [outro: string]: unknown
}

/** Uma mensagem da conversa salva: o formato da Messages API, serializável. */
export interface MensagemDaConversa {
  role: 'user' | 'assistant'
  content: string | BlocoDaConversa[]
}

const blocosDe = (m: MensagemDaConversa): BlocoDaConversa[] =>
  typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content

/** O índice da primeira mensagem do trecho final de mensagens do assistente. */
function inicioDoFimDoAssistente(conversa: readonly MensagemDaConversa[]): number {
  let i = conversa.length
  while (i > 0 && conversa[i - 1].role === 'assistant') i--
  return i
}

/**
 * AS CHAMADAS DE FERRAMENTA DO SERVIDOR AINDA SEM RESULTADO no fim da conversa.
 *
 * Um `pause_turn` pode terminar com um `server_tool_use` que ainda não rodou: a
 * API o roda no começo da próxima chamada. Enquanto houver um assim pendente, o
 * turno do assistente NÃO pode ser fechado com uma mensagem do usuário — a API
 * responde 400 ("tool use … was found without a corresponding … result").
 */
export function pendentesNoFim(conversa: readonly MensagemDaConversa[]): Set<string> {
  const abertos = new Set<string>()
  for (let i = inicioDoFimDoAssistente(conversa); i < conversa.length; i++) {
    for (const b of blocosDe(conversa[i])) {
      if (b.type === 'server_tool_use' && typeof b.id === 'string') abertos.add(b.id)
      else if (typeof b.tool_use_id === 'string') abertos.delete(b.tool_use_id)
    }
  }
  return abertos
}

/**
 * ATÉ ONDE UMA RESPOSTA CORTADA PODE SER SALVA: quantos blocos, do começo, formam
 * um trecho em que toda chamada de ferramenta tem o seu resultado (as pendentes
 * de antes inclusive), terminando num resultado ou num texto.
 *
 * É o "ponto seguro": dali, a conversa fecha o turno e pede para continuar sem
 * a API recusar. Os blocos que chegam inteiros pelo stream (o evento de fim de
 * bloco) são exatamente os que a API devolveu — os resultados com o
 * `encrypted_content`, o raciocínio com a assinatura —, e voltam sem edição.
 * Cortar no fim nunca muda o que vem ANTES de um bloco de raciocínio, que é o
 * que a API confere.
 */
export function pontoSeguro(blocos: readonly BlocoDaConversa[], pendentes: ReadonlySet<string> = new Set()): number {
  const abertos = new Set(pendentes)
  let k = 0
  blocos.forEach((b, i) => {
    if (b.type === 'server_tool_use' && typeof b.id === 'string') abertos.add(b.id)
    else if (typeof b.tool_use_id === 'string') abertos.delete(b.tool_use_id)
    const fechaBem = typeof b.tool_use_id === 'string' || b.type === 'text'
    if (abertos.size === 0 && fechaBem) k = i + 1
  })
  return k
}

/** O desfecho de uma resposta completa, para o laço da frente. */
export type DesfechoDaResposta = 'continuar' | 'terminou' | 'recusa'

/**
 * A RESPOSTA COMPLETA ENTRA NA CONVERSA tal como veio. `pause_turn`: a próxima
 * chamada reenvia a conversa como está e a API retoma o turno (sem mensagem
 * nova — a documentação pede assim). Qualquer outro fim encerra a frente.
 */
export function aposResposta(
  conversa: readonly MensagemDaConversa[],
  conteudo: readonly BlocoDaConversa[],
  stopReason: string | null | undefined,
): { conversa: MensagemDaConversa[]; desfecho: DesfechoDaResposta } {
  if (stopReason === 'refusal') return { conversa: [...conversa], desfecho: 'recusa' }
  const nova = conteudo.length > 0
    ? [...conversa, { role: 'assistant' as const, content: [...conteudo] }]
    : [...conversa]
  return { conversa: nova, desfecho: stopReason === 'pause_turn' ? 'continuar' : 'terminou' }
}

/**
 * A RESPOSTA CORTADA PELO RELÓGIO entra até o ponto seguro, e o turno é fechado
 * com o pedido de continuar. Nada no ponto seguro: a conversa fica como estava
 * (a próxima invocação repete a chamada) e `avancou` é falso — duas vezes
 * seguidas assim e a frente encerra (MAX_INTERRUPCOES_SEM_AVANCO).
 */
export function aposInterrupcao(
  conversa: readonly MensagemDaConversa[],
  blocosCompletos: readonly BlocoDaConversa[],
): { conversa: MensagemDaConversa[]; avancou: boolean } {
  const k = pontoSeguro(blocosCompletos, pendentesNoFim(conversa))
  if (k === 0) return { conversa: [...conversa], avancou: false }
  return {
    conversa: [
      ...conversa,
      { role: 'assistant', content: blocosCompletos.slice(0, k) },
      { role: 'user', content: [{ type: 'text', text: PEDIDO_DE_CONTINUAR }] },
    ],
    avancou: true,
  }
}

/**
 * A CONVERSA PRONTA PARA O PEDIDO DE ENCERRAR: o turno do assistente fechado no
 * último ponto seguro (uma chamada de ferramenta pendente no fim sai) e o
 * pedido acrescentado. Se a conversa já termina num pedido do usuário (o de
 * continuar), o de encerrar entra junto dele.
 */
export function conversaParaEncerrar(conversa: readonly MensagemDaConversa[]): MensagemDaConversa[] {
  const inicio = inicioDoFimDoAssistente(conversa)
  const antes = conversa.slice(0, inicio)
  const fim = conversa.slice(inicio)
  const planos = fim.flatMap(blocosDe)
  let restam = pontoSeguro(planos)
  const fimAparado: MensagemDaConversa[] = []
  for (const m of fim) {
    const bs = blocosDe(m)
    const fica = bs.slice(0, Math.max(0, restam))
    restam -= bs.length
    if (fica.length > 0) fimAparado.push({ role: 'assistant', content: fica })
  }
  const base = [...antes, ...fimAparado]
  const pedido: BlocoDaConversa = { type: 'text', text: PEDIDO_DE_ENCERRAR }
  const ultima = base[base.length - 1]
  if (ultima && ultima.role === 'user') {
    return [...base.slice(0, -1), { role: 'user', content: [...blocosDe(ultima), pedido] }]
  }
  return [...base, { role: 'user', content: [pedido] }]
}

/** Todos os blocos do assistente da conversa, na ordem — é de onde sai o dossiê. */
export function blocosDoAssistente(conversa: readonly MensagemDaConversa[]): BlocoDaConversa[] {
  return conversa.filter((m) => m.role === 'assistant').flatMap(blocosDe)
}

/** O dossiê da frente, a partir da conversa inteira (texto + fontes citadas e abertas). */
export function dossieDaConversa(conversa: readonly MensagemDaConversa[]): { texto: string; fontes: FonteDaJustificativa[] } {
  return dossieDaResposta(blocosDoAssistente(conversa) as Parameters<typeof dossieDaResposta>[0])
}

/**
 * O QUE UMA CHAMADA CORTADA JÁ GASTOU em buscas e páginas, contando os
 * resultados que chegaram inteiros (o `usage` de ferramenta vem no fim do
 * stream, que não houve). Resultado de erro não é cobrado e não conta.
 */
export function usoDosBlocos(blocos: readonly BlocoDaConversa[]): { buscas: number; fetches: number } {
  let buscas = 0
  let fetches = 0
  for (const b of blocos) {
    const c = b.content as { type?: string } | unknown[] | undefined
    const erro = !Array.isArray(c) && typeof (c as { type?: string } | undefined)?.type === 'string' &&
      /error/.test(String((c as { type?: string }).type))
    if (b.type === 'web_search_tool_result' && !erro) buscas++
    if (b.type === 'web_fetch_tool_result' && !erro) fetches++
  }
  return { buscas, fetches }
}

// ------------------------------------------------------------------ o estado na linha

export type StatusDaFrente = 'pesquisando' | 'pronta' | 'falha'

/** Uma frente no estado salvo. */
export interface EstadoDaFrente extends FrenteDoPlano {
  id: string
  /** A frente única do plano de reserva: o pedido é a tarefa inteira. */
  unica: boolean
  status: StatusDaFrente
  /** A invocação que está com a frente agora (contra o disparo em dobro). */
  invocacao_id: string | null
  invocacoes: number
  /** Quantas vezes continuou (pause_turn ou corte do relógio). */
  retomadas: number
  interrupcoes_sem_avanco: number
  iniciada_em: string | null
  pulso_em: string | null
  terminada_em: string | null
  /** A conversa salva no checkpoint; null antes de começar e depois de terminar. */
  conversa: MensagemDaConversa[] | null
  /** O contêiner do filtro dinâmico da busca, para reaproveitar ao continuar. */
  container: { id: string; expires_at: string | null } | null
  dossie: { texto: string; fontes: FonteDaJustificativa[] } | null
  /** Encerrada pelo teto: o dossiê é o que deu para achar. */
  parcial: boolean
  erro: string | null
  consumo: ConsumoDaJustificativa
  /** Segundos de relógio somados das invocações desta frente. */
  segundos: number
}

/** O resumo pequeno que a janela lê (`andamento:pesquisa->andamento`). */
export interface AndamentoDaGeracao {
  fase: FaseDaGeracao | 'pronta'
  plano: 'planejado' | 'reserva' | null
  frentes: { id: string; titulo: string; status: StatusDaFrente; parcial: boolean; retomadas: number }[]
}

/** O estado da geração no jsonb `pesquisa` (formato 2). */
export interface EstadoDaPesquisa {
  versao: 2
  /** O contador da gravação condicional: muda a cada gravação. */
  rev: number
  fase: FaseDaGeracao | 'pronta'
  /** O prompt da casa, só a instrução (sem os dados): as frentes o leem como propósito. */
  instrucao: string
  plano: { origem: 'planejado' | 'reserva'; motivo: string | null } | null
  frentes: EstadoDaFrente[]
  redacao: { disparada_em: string | null; disparada_por: string | null; tentativas: number }
  tempos: { inicio: string; planejamento_fim: string | null; pesquisa_fim: string | null; redacao_s: number | null }
  consumo_planejamento: ConsumoDaJustificativa | null
  /** O que as redações cortadas pelo relógio já gastaram (a que termina soma o dela no fim). */
  consumo_redacao: ConsumoDaJustificativa | null
  andamento: AndamentoDaGeracao
}

/** O andamento derivado do estado (é o que a janela lê, e nada mais). */
export function andamentoDe(e: Omit<EstadoDaPesquisa, 'andamento'>): AndamentoDaGeracao {
  return {
    fase: e.fase,
    plano: e.plano?.origem ?? null,
    frentes: e.frentes.map((f) => ({
      id: f.id, titulo: f.titulo, status: f.status, parcial: f.parcial, retomadas: f.retomadas,
    })),
  }
}

/** O estado com que uma geração nasce (a ação `gerar`). */
export function estadoInicial(instrucao: string, agora: Date = new Date()): EstadoDaPesquisa {
  const base: Omit<EstadoDaPesquisa, 'andamento'> = {
    versao: 2,
    rev: 0,
    fase: 'planejando',
    instrucao,
    plano: null,
    frentes: [],
    redacao: { disparada_em: null, disparada_por: null, tentativas: 0 },
    tempos: { inicio: agora.toISOString(), planejamento_fim: null, pesquisa_fim: null, redacao_s: null },
    consumo_planejamento: null,
    consumo_redacao: null,
  }
  return { ...base, andamento: andamentoDe(base) }
}

/** O jsonb lido é o estado de formato 2? (As linhas de antes têm `{ texto, fontes }`.) */
export function ehEstadoV2(p: unknown): p is EstadoDaPesquisa {
  const e = p as Partial<EstadoDaPesquisa> | null
  return !!e && e.versao === 2 && typeof e.rev === 'number' && Array.isArray(e.frentes)
}

/** A frente nova, como o plano a cria. */
export function frenteNova(id: string, f: FrenteDoPlano, unica = false): EstadoDaFrente {
  return {
    ...f, id, unica,
    status: 'pesquisando',
    invocacao_id: null, invocacoes: 0, retomadas: 0, interrupcoes_sem_avanco: 0,
    iniciada_em: null, pulso_em: null, terminada_em: null,
    conversa: null, container: null, dossie: null, parcial: false, erro: null,
    consumo: { ...CONSUMO_ZERO }, segundos: 0,
  }
}

/** O estado com o plano posto: as frentes nascem pesquisando. */
export function comPlano(
  e: EstadoDaPesquisa,
  frentes: FrenteDoPlano[] | null,
  motivo: string | null,
  consumo: ConsumoDaJustificativa | null,
  agora: Date = new Date(),
): EstadoDaPesquisa {
  const plano = frentes && frentes.length > 0
    ? { origem: 'planejado' as const, motivo: null, frentes: frentes.map((f, i) => frenteNova(`f${i + 1}`, f)) }
    : {
      origem: 'reserva' as const,
      motivo: motivo ?? 'o planejamento não devolveu frentes',
      frentes: [frenteNova('f1', { titulo: TITULO_FRENTE_UNICA, perguntas: [], trazer: '', contexto: '' }, true)],
    }
  return {
    ...e,
    fase: 'pesquisando',
    plano: { origem: plano.origem, motivo: plano.motivo },
    frentes: plano.frentes,
    tempos: { ...e.tempos, planejamento_fim: agora.toISOString() },
    consumo_planejamento: consumo,
  }
}

/** A frente terminou (pronta ou falha)? */
export const frenteTerminada = (f: Pick<EstadoDaFrente, 'status'>) => f.status !== 'pesquisando'

/**
 * A FRENTE FECHADA, e — se ela era a última — A REDAÇÃO MARCADA COMO DISPARADA,
 * na MESMA mudança de estado. Como a gravação é condicional ao `rev`, só uma
 * gravação vence com a marca posta: é ela, e só ela, que dispara a redação.
 * Uma segunda frente que tente fechar depois relê o estado, vê a marca e não
 * dispara de novo.
 *
 * Devolve null quando a frente não é mais desta invocação (outra a tomou, ou ela
 * já terminou): não há o que gravar.
 */
export function fecharFrente(
  e: EstadoDaPesquisa,
  frenteId: string,
  invocacaoId: string,
  fim: Pick<EstadoDaFrente, 'status' | 'dossie' | 'parcial' | 'erro' | 'consumo' | 'segundos' | 'retomadas'>,
  agora: Date = new Date(),
): { estado: EstadoDaPesquisa; disparaRedacao: boolean } | null {
  const f = e.frentes.find((x) => x.id === frenteId)
  if (!f || frenteTerminada(f) || f.invocacao_id !== invocacaoId) return null
  const frentes = e.frentes.map((x) =>
    x.id === frenteId
      ? { ...x, ...fim, conversa: null, container: null, terminada_em: agora.toISOString(), pulso_em: agora.toISOString() }
      : x,
  )
  const todas = frentes.every(frenteTerminada)
  const dispara = todas && !e.redacao.disparada_em
  return {
    estado: {
      ...e,
      frentes,
      fase: dispara ? 'redigindo' : e.fase,
      redacao: dispara
        ? { disparada_em: agora.toISOString(), disparada_por: invocacaoId, tentativas: e.redacao.tentativas }
        : e.redacao,
      tempos: dispara ? { ...e.tempos, pesquisa_fim: agora.toISOString() } : e.tempos,
    },
    disparaRedacao: dispara,
  }
}

/**
 * A FRENTE TOMADA por esta invocação (o começo de cada invocação de frente).
 * Devolve null quando não há o que fazer: a frente não existe, já terminou, ou
 * — disparo em dobro — outra invocação a tomou há pouco (o pulso dela é recente).
 */
export function tomarFrente(
  e: EstadoDaPesquisa,
  frenteId: string,
  invocacaoId: string,
  invocacaoAnterior: string | null,
  agora: Date = new Date(),
): EstadoDaPesquisa | null {
  const f = e.frentes.find((x) => x.id === frenteId)
  if (!f || frenteTerminada(f)) return null
  // QUEM DISPAROU diz qual invocação veio antes; se a frente está com outra, e
  // essa outra pulsou há pouco, é um disparo repetido — não roda duas vezes.
  if (f.invocacao_id && f.invocacao_id !== invocacaoAnterior) {
    const pulso = Date.parse(String(f.pulso_em ?? ''))
    if (Number.isFinite(pulso) && agora.getTime() - pulso < TRAVA_GERACAO_MIN * 60_000) return null
  }
  return {
    ...e,
    frentes: e.frentes.map((x) =>
      x.id === frenteId
        ? {
          ...x,
          invocacao_id: invocacaoId,
          invocacoes: x.invocacoes + 1,
          iniciada_em: x.iniciada_em ?? agora.toISOString(),
          pulso_em: agora.toISOString(),
        }
        : x,
    ),
  }
}

/**
 * QUANTO TEMPO SEM SINAL FAZ UMA FRENTE ÓRFÃ. Uma invocação não vive mais de
 * ~150 s (o teto do servidor), e toda invocação que termina deixa sinal na
 * frente — o checkpoint ao ceder, ou o fechamento. Três minutos sem sinal é,
 * com certeza, a invocação morta no caminho.
 */
export const FRENTE_SEM_SINAL_MS = 180_000

/**
 * AS FRENTES ÓRFÃS (08/10/2026): pesquisando, e sem sinal há mais de
 * FRENTE_SEM_SINAL_MS. Devolve o id e a invocação que estava com ela — o
 * `anterior` do relançamento, que `tomarFrente` aceita.
 *
 * O CASO QUE A TROUXE: na geração do Renan de Santana, a frente "Regras
 * federais: EC 136" foi tomada às 19:18:02 e a invocação morreu no primeiro
 * segundo — zero buscas, zero segundos. As outras três terminaram até 19:21 e a
 * redação ficou esperando por ela para sempre: só a própria invocação passava o
 * bastão adiante, e o detector de morte olhava o pulso da geração INTEIRA, que
 * as irmãs mantinham vivo.
 *
 * RELANÇAR É SEGURO: `tomarFrente` só entrega a frente a quem traz a invocação
 * anterior certa, e a gravação é condicional à versão — dois vigias ao mesmo
 * tempo relançam uma vez só. E não roda para sempre: cada relançamento conta
 * uma invocação, e os tetos de `decidirFrente` encerram a frente com o que tiver.
 */
export function frentesOrfas(
  e: Pick<EstadoDaPesquisa, 'fase' | 'frentes' | 'tempos'>,
  agora: Date = new Date(),
): { id: string; anterior: string | null }[] {
  if (e.fase !== 'pesquisando') return []
  return e.frentes
    .filter((f) => !frenteTerminada(f))
    .filter((f) => {
      // A FRENTE QUE NUNCA FOI TOMADA (o disparo se perdeu) conta do fim do plano.
      const ref = Date.parse(String(f.pulso_em ?? e.tempos.planejamento_fim ?? e.tempos.inicio))
      return Number.isFinite(ref) && agora.getTime() - ref > FRENTE_SEM_SINAL_MS
    })
    .map((f) => ({ id: f.id, anterior: f.invocacao_id }))
}

/** O checkpoint: a conversa salva para a próxima invocação continuar. */
export function salvarCheckpoint(
  e: EstadoDaPesquisa,
  frenteId: string,
  invocacaoId: string,
  ponto: Pick<EstadoDaFrente, 'conversa' | 'container' | 'retomadas' | 'interrupcoes_sem_avanco' | 'consumo' | 'segundos'>,
  agora: Date = new Date(),
): EstadoDaPesquisa | null {
  const f = e.frentes.find((x) => x.id === frenteId)
  if (!f || frenteTerminada(f) || f.invocacao_id !== invocacaoId) return null
  return {
    ...e,
    frentes: e.frentes.map((x) => (x.id === frenteId ? { ...x, ...ponto, pulso_em: agora.toISOString() } : x)),
  }
}

/** O próximo passo de uma frente, dentro da invocação. */
export type DecisaoDaFrente = 'chamar' | 'encerrar' | 'ceder' | 'desistir'

/**
 * O QUE A FRENTE FAZ AGORA — a regra do relógio e dos tetos, dita uma vez:
 *
 *   - passou de MAX_INVOCACOES_DA_FRENTE + 2 invocações: 'desistir' (fecha com
 *     o que tem, sem chamar mais nada — a rede da rede);
 *   - no teto (tempo da frente, invocações, buscas e páginas esgotadas, ou
 *     interrupções sem avanço): 'encerrar' — a chamada final, sem ferramenta;
 *   - sem relógio nesta invocação para uma chamada: 'ceder' (checkpoint e
 *     invocação nova);
 *   - senão, 'chamar'.
 *
 * O encerramento também precisa de relógio: sem folga, cede e encerra na
 * próxima invocação.
 */
export function decidirFrente(
  f: Pick<EstadoDaFrente, 'segundos' | 'invocacoes' | 'interrupcoes_sem_avanco' | 'consumo' | 'unica'>,
  restanteDaInvocacaoMs: number,
): DecisaoDaFrente {
  if (f.invocacoes > MAX_INVOCACOES_DA_FRENTE + 2) return 'desistir'
  // O TEMPO DE TRABALHO, e não o de relógio desde o começo (08/10/2026): o das
  // invocações anteriores (`segundos`) mais o desta. Pelo relógio, a frente
  // órfã relançada pelo vigia chegava "estourada" — o tempo em que ficou morta
  // contava — e encerrava sem pesquisar nada.
  const desta = Math.max(0, ORCAMENTO_DA_INVOCACAO_MS - restanteDaInvocacaoMs) / 1000
  const minutos = ((f.segundos ?? 0) + desta) / 60
  const { buscas: maxB, paginas: maxP } = tetosDaFrente(f.unica)
  const noTeto =
    minutos >= TETO_DA_FRENTE_MIN ||
    f.invocacoes > MAX_INVOCACOES_DA_FRENTE ||
    f.interrupcoes_sem_avanco >= MAX_INTERRUPCOES_SEM_AVANCO ||
    (f.consumo.buscas >= maxB && f.consumo.fetches >= maxP)
  if (restanteDaInvocacaoMs < FOLGA_PARA_NOVA_CHAMADA_MS) return 'ceder'
  return noTeto ? 'encerrar' : 'chamar'
}

/** Os tetos de busca e de página de uma frente. */
export function tetosDaFrente(unica: boolean): { buscas: number; paginas: number } {
  return unica
    ? { buscas: MAX_BUSCAS_FRENTE_UNICA, paginas: MAX_PAGINAS_FRENTE_UNICA }
    : { buscas: MAX_BUSCAS_POR_FRENTE, paginas: MAX_PAGINAS_POR_FRENTE }
}

/**
 * O `max_uses` desta chamada: o que sobra do teto da frente. O `max_uses` da
 * API vale POR CHAMADA, e uma frente que continua faz várias — sem isto, cada
 * retomada ganharia o teto inteiro de novo. Nunca menos de 1 (a API não aceita
 * zero): esgotado um dos dois, a frente pode passar dele em uma — o outro ainda
 * corre; esgotados os dois, decidirFrente já manda encerrar.
 */
export function usosRestantes(f: Pick<EstadoDaFrente, 'consumo' | 'unica'>): { buscas: number; paginas: number } {
  const t = tetosDaFrente(f.unica)
  return {
    buscas: Math.max(1, t.buscas - f.consumo.buscas),
    paginas: Math.max(1, t.paginas - f.consumo.fetches),
  }
}

// ------------------------------------------------------------------ a gravação condicional

/** O que uma mudança devolve: o estado novo e colunas a gravar junto, ou null (nada a fazer). */
export type MudancaDoEstado = { estado: EstadoDaPesquisa; colunas?: Record<string, unknown> } | null

/**
 * GRAVA O ESTADO SEM PERDER A GRAVAÇÃO DE NINGUÉM — a concorrência entre as
 * frentes paralelas na mesma linha.
 *
 * Lê o estado, aplica `mudar` e grava CONDICIONADO AO `rev` LIDO (o `gravar`
 * faz o UPDATE … WHERE pesquisa->>rev = lido). Se outra frente gravou no meio,
 * a condição não casa, nada é gravado, e o ciclo recomeça do estado novo — a
 * mudança é reaplicada sobre o que a outra gravou. É a gravação otimista
 * clássica; com espera crescente e aleatória entre as tentativas, para quatro
 * frentes que terminem juntas não se atropelarem em fila.
 *
 * `ler` devolve null quando a linha não é mais desta geração (refeita por
 * cima, ou não está mais 'gerando'): aí não há o que gravar.
 */
export async function gravarComVersao(
  ler: () => Promise<EstadoDaPesquisa | null>,
  gravar: (novo: EstadoDaPesquisa, revLido: number, colunas: Record<string, unknown>) => Promise<boolean>,
  mudar: (atual: EstadoDaPesquisa) => MudancaDoEstado,
  opcoes: { tentativas?: number; esperar?: (ms: number) => Promise<void>; sorteio?: () => number } = {},
): Promise<{ ok: true; estado: EstadoDaPesquisa } | { ok: false; motivo: 'nao-e-mais-desta-geracao' | 'nada-a-fazer' | 'conflito' }> {
  const tentativas = opcoes.tentativas ?? 10
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const sorteio = opcoes.sorteio ?? Math.random
  for (let i = 0; i < tentativas; i++) {
    const atual = await ler()
    if (!atual) return { ok: false, motivo: 'nao-e-mais-desta-geracao' }
    const m = mudar(atual)
    if (!m) return { ok: false, motivo: 'nada-a-fazer' }
    const base = { ...m.estado, rev: atual.rev + 1 }
    const novo: EstadoDaPesquisa = { ...base, andamento: andamentoDe(base) }
    if (await gravar(novo, atual.rev, m.colunas ?? {})) return { ok: true, estado: novo }
    await esperar(Math.round((50 + sorteio() * 150) * (i + 1)))
  }
  return { ok: false, motivo: 'conflito' }
}

// ------------------------------------------------------------------ a junção dos dossiês

/**
 * A NUMERAÇÃO DE UM DOSSIÊ trocada pela global: cada "[n]" local vira o número
 * da mesma fonte na lista única. Número que não é de fonte nenhuma: acima de 99
 * é outra coisa (um ano entre colchetes) e fica como está; até 99 é citação
 * que não leva a lugar nenhum, e sai.
 */
function renumerarDossie(texto: string, mapa: readonly number[]): string {
  return texto.replace(/\[(\s*\d+\s*(?:[,;–-]\s*\d+\s*)*)\]/g, (inteiro, dentro: string) => {
    const ns: number[] = []
    for (const parte of dentro.split(/[,;]/)) {
      const faixa = parte.split(/[–-]/).map((x) => Number(x.trim()))
      const [a, b] = faixa.length === 2 ? faixa : [faixa[0], faixa[0]]
      for (let n = a; n <= b && n - a < 50; n++) {
        if (!Number.isInteger(n)) continue
        if (n > 99) return inteiro
        const g = mapa[n - 1]
        if (g && !ns.includes(g)) ns.push(g)
      }
    }
    return ns.length > 0 ? `[${ns.sort((x, y) => x - y).join(', ')}]` : ''
  })
}

const chaveDaUrl = (u: string) => u.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()

/**
 * OS DOSSIÊS DAS FRENTES JUNTOS, para a redação: um bloco por frente, na ordem
 * do plano, com as fontes RENUMERADAS NUMA LISTA ÚNICA e sem repetição (a mesma
 * página achada por duas frentes é uma fonte só). A regra de citação da redação
 * não muda: ela cita os números desta lista, e textoComFontes renumera de novo
 * na ordem de leitura, só com as citadas.
 */
export function juntarDossies(
  frentes: readonly Pick<EstadoDaFrente, 'titulo' | 'dossie' | 'parcial' | 'erro' | 'status'>[],
): { texto: string; fontes: FonteDaJustificativa[] } {
  const fontes: FonteDaJustificativa[] = []
  const indice = new Map<string, number>()
  const blocos: string[] = []
  frentes.forEach((f, i) => {
    const cabeca = `=== FRENTE ${i + 1}: ${f.titulo} ===`
    const d = f.dossie
    if (!d || !d.texto.trim()) {
      blocos.push(`${cabeca}\n(Esta frente não trouxe resultado${f.erro ? `: ${f.erro}` : ''}. Não use nada sobre o assunto dela além dos dados do crédito.)`)
      return
    }
    const mapa = d.fontes.map((fo) => {
      const k = chaveDaUrl(fo.url)
      const ja = indice.get(k)
      if (ja) return ja
      fontes.push({ url: fo.url, titulo: fo.titulo })
      indice.set(k, fontes.length)
      return fontes.length
    })
    const aviso = f.parcial ? '\n(Pesquisa interrompida pelo tempo: o que segue é o que deu para achar.)' : ''
    blocos.push(`${cabeca}${aviso}\n${renumerarDossie(d.texto.trim(), mapa)}`)
  })
  return { texto: blocos.join('\n\n'), fontes }
}

/**
 * OS DOSSIÊS DE UMA LINHA, em qualquer formato: o de antes (`{ texto, fontes }`,
 * uma geração que começou antes da mudança e chegou à redação) e o de agora.
 */
export function dossiesDaLinha(pesquisa: unknown): { texto: string; fontes: FonteDaJustificativa[] } {
  if (ehEstadoV2(pesquisa)) return juntarDossies(pesquisa.frentes)
  const p = (pesquisa ?? {}) as { texto?: unknown; fontes?: unknown }
  return {
    texto: String(p.texto ?? ''),
    fontes: Array.isArray(p.fontes) ? (p.fontes as FonteDaJustificativa[]) : [],
  }
}

// ------------------------------------------------------------------ o consumo e o tempo

/** Soma consumos inteiros (tokens, chamadas, buscas, páginas, interrompidas). Nulos contam zero. */
export function somarConsumos(...partes: (Partial<ConsumoDaJustificativa> | null | undefined)[]): ConsumoDaJustificativa {
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return partes.reduce<ConsumoDaJustificativa>(
    (a, c) =>
      !c
        ? a
        : {
          ...a,
          chamadas: a.chamadas + n(c.chamadas),
          input_tokens: a.input_tokens + n(c.input_tokens),
          output_tokens: a.output_tokens + n(c.output_tokens),
          cache_creation_input_tokens: a.cache_creation_input_tokens + n(c.cache_creation_input_tokens),
          cache_read_input_tokens: a.cache_read_input_tokens + n(c.cache_read_input_tokens),
          buscas: a.buscas + n(c.buscas),
          fetches: a.fetches + n(c.fetches),
          interrompidas: n(a.interrompidas) + n(c.interrompidas),
        },
    { ...CONSUMO_ZERO, interrompidas: 0 },
  )
}

/** O consumo da geração inteira: planejamento + todas as frentes + redação. */
export function consumoTotal(
  e: EstadoDaPesquisa,
  redacao: ConsumoDaJustificativa | null,
  agora: Date = new Date(),
  modelo?: string,
): ConsumoDaJustificativa {
  const soma = somarConsumos(e.consumo_planejamento, ...e.frentes.map((f) => f.consumo), e.consumo_redacao ?? null, redacao)
  const seg = (de: string | null, ate: string | null) => {
    const a = Date.parse(String(de ?? ''))
    const b = Date.parse(String(ate ?? ''))
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 1000)) : undefined
  }
  const inicio = e.tempos.inicio
  return {
    ...soma,
    ...(modelo ? { modelo } : {}),
    // O TEMPO DA GERAÇÃO é o de relógio, do pedido ao fim — as frentes correm em
    // paralelo, e somar os segundos delas contaria o mesmo minuto quatro vezes.
    segundos: seg(inicio, agora.toISOString()) ?? 0,
    etapas: {
      planejamento_s: seg(inicio, e.tempos.planejamento_fim),
      pesquisa_s: seg(e.tempos.planejamento_fim, e.tempos.pesquisa_fim),
      redacao_s: e.tempos.redacao_s ?? undefined,
    },
    frentes: e.frentes.map((f) => ({
      titulo: f.titulo,
      segundos: f.segundos,
      buscas: f.consumo.buscas,
      fetches: f.consumo.fetches,
      retomadas: f.retomadas,
      parcial: f.parcial,
    })),
  }
}

/**
 * AS VAGAS DE PESQUISA OCUPADAS pelas gerações vivas (o limite de taxa da casa,
 * contado em frentes). Uma geração planejando reserva o máximo (ainda não se
 * sabe quantas frentes terá); pesquisando, conta as frentes que não terminaram;
 * redigindo, uma. Uma linha do formato antigo conta uma.
 */
export function vagasOcupadas(andamentos: readonly (AndamentoDaGeracao | null | undefined)[]): number {
  let total = 0
  for (const a of andamentos) {
    if (!a || !a.fase) {
      total += 1
      continue
    }
    if (a.fase === 'lendo' || a.fase === 'planejando') total += MAX_FRENTES
    else if (a.fase === 'pesquisando') total += Math.max(1, a.frentes.filter((f) => f.status === 'pesquisando').length)
    else if (a.fase === 'redigindo') total += 1
  }
  return total
}

/** Cabe mais uma geração? (Ela precisa das vagas de um plano inteiro.) */
export function cabeMaisUmaGeracao(andamentos: readonly (AndamentoDaGeracao | null | undefined)[]): boolean {
  return vagasOcupadas(andamentos) + MAX_FRENTES <= VAGAS_DE_PESQUISA
}
