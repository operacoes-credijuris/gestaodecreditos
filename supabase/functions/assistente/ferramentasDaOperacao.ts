// AS FERRAMENTAS DA OPERAÇÃO DO ASSISTENTE (12/11/2026).
//
// Cinco consultas que o assistente não tinha, ou tinha erradas:
//   - `fase_processual`: a fase de cada crédito pela tabela da aba Fase
//     processual. Antes, "quais estão conclusos?" virava busca por texto nos
//     andamentos — lenta, incompleta e diferente do que a aba mostra.
//   - `ficha_do_card`: tudo de UM card do Kommo (coluna, etiquetas, cotações dos
//     fundos, notas, justificativa, autos, diligência) — o par de
//     `ficha_do_credito` do lado da análise.
//   - `resumo_do_funil`: no lugar de `listar_analises`, que lia
//     `analises_credito`, tabela que nada mais grava desde que a análise foi
//     para o Kommo. Respondia "nenhuma análise" com o kanban cheio.
//   - `listar_contratos`: os contratos da Geração de contratos.
//   - `situacao_due_diligence`: veio do index.ts e cresceu (histórico do
//     cedente, processos de risco, certidões vencidas e positivas).
//
// MORAM AQUI, E NÃO NO index.ts, para o arquivo grande não crescer mais e para
// a mudança não se misturar com a de quem mexe nas outras ferramentas. O
// index.ts espalha `FERRAMENTAS_DA_OPERACAO` na lista e manda ao
// `executarDaOperacao` o nome que o switch dele não conhece.
//
// AS MESMAS TRÊS REGRAS do index.ts: lê com o cliente de quem pergunta (as RLS
// valem — toda tabela daqui tem policy de leitura para autenticado), não
// escreve nada, e o modelo não escreve SQL. E duas da casa: lista que pode
// passar de 1000 linhas é lida em páginas (o PostgREST corta calado), e todo
// `.error` é olhado — erro engolido vira "não há nada", que é o pior jeito de
// errar num assistente.
//
// NENHUM IMPORT DO npm, nem de tipo: o vitest importa este arquivo e roda os
// executores contra um banco de mentira, e o `tsc` do front (que confere os
// testes) não resolve especificador `npm:`. Ver `ClienteDoBanco`.

import { lerTodasAsLinhas, type LeituraCompleta, type PaginaDoBanco } from '../_shared/leituraPaginada.ts'
import { hojeEmBrasilia } from '../_shared/dataDeBrasilia.ts'
import {
  contarComoATela,
  lerFasePedida,
  normalizarTexto,
  rotuloDaFase,
  type TrilhaDaFase,
} from '../_shared/rotulosDaFase.ts'
import {
  type CotacaoLida,
  cotacoesDoCard,
  formatarPercentual,
  formatarReais,
  type ValorDeCampo,
} from '../_shared/cotacaoDoFundo.ts'
import { etiquetaCanonica, FUNDOS_DA_PRECIFICACAO } from '../_shared/etiquetasDoFundo.ts'
import { semEntidadesHtml } from '../_shared/textoDoKommo.ts'
import { type EntradaOportunidade, resumoDaOportunidade } from '../_shared/anotacaoKommo.ts'
import { FUNIL_GERAL, FUNIL_RPV } from '../_shared/autosParaOKommo.ts'
import { FUNIL_PRECATORIO_EXTERNO, FUNIL_PRECATORIO_INTERNO } from '../_shared/trilhasDoPrecatorio.ts'

type Linha = Record<string, unknown>

/**
 * O CLIENTE DO BANCO pelo mínimo que estas ferramentas usam, e não o
 * `SupabaseClient` do npm (ver o cabeçalho). O index.ts passa o de verdade — o
 * `callerClient`, com as RLS de quem pergunta —, que cabe neste tipo. O
 * construtor de consulta fica `any`: quem confere a cadeia de chamadas são os
 * testes, que a rodam inteira.
 */
// deno-lint-ignore no-explicit-any
export type ClienteDoBanco = { from: (tabela: string) => any }

/** Teto de linhas devolvidas ao modelo: o que vai é contexto, não relatório. */
const LIMITE_MAX = 50

/**
 * O FUNIL DE PRECATÓRIO ANTIGO, dado por encerrado em 14/09/2026 mas ainda
 * espelhado pelo kommo-sync (`FUNIL_PRECATORIO` lá) enquanto houver card nele.
 * Fica FORA das contas por padrão, como o Funil Geral (do qual só a coluna
 * NOVOS é espelhada): nenhum dos dois é funil de análise.
 */
export const FUNIL_PRECATORIO_ANTIGO = 13971995

/** Os funis que o resumo deixa de fora quando ninguém pede por eles. */
export const FUNIS_FORA_POR_PADRAO: readonly number[] = [FUNIL_GERAL, FUNIL_PRECATORIO_ANTIGO]

/** As colunas que o Kommo tem em todo funil, com o mesmo id: 142 ganho, 143 perdido. */
const COLUNAS_DO_SISTEMA: Record<number, string> = {
  142: 'Ganho (fechado no Kommo)',
  143: 'Perdido (fechado no Kommo)',
}

/**
 * COLUNA DE DESFECHO: o card que está nela não está "parado", está decidido.
 * Pelo nome, sem acento, porque os três funis escrevem diferente ("Não
 * fechado", "Não fechados", "NÃO FECHADO").
 */
const COLUNA_DE_DESFECHO = /^(reprovad|nao fechad|sem resposta|pagamento finalizado)/

const LEITURA_CORTADA =
  'A leitura passou do teto de páginas e ficou incompleta — o total não seria exato.'

// ------------------------------------------------------------------ definições

/** A forma de uma ferramenta, como a API da Anthropic a recebe (sem importar o SDK). */
export interface DefinicaoDeFerramenta {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

const LIMITE_SCHEMA = { type: 'integer', description: `Máximo de linhas na lista (padrão 20, teto ${LIMITE_MAX}).` }

export const FERRAMENTAS_DA_OPERACAO: DefinicaoDeFerramenta[] = [
  {
    name: 'fase_processual',
    description:
      'A FASE PROCESSUAL de cada crédito ativo/complementar, pela mesma classificação da aba ' +
      'Publicações e movimentações → Fase processual — os números batem com os cards da aba. Sem ' +
      'filtro, devolve a contagem por fase (e por situação dentro de cada fase), os conclusos e ' +
      'os ainda sem classificação, por trilha. Com `fase` (código ATV-01…/CMP-01… ou nome: ' +
      '"conclusos", "sequestro", "alvará", "penhora", "homologação", "período de graça", ' +
      '"outros"…), `situacao`, `conclusao_pendente` ou a janela da data limite de pagamento, ' +
      'lista os créditos. Com `mudancas_desde`, lista as mudanças de fase desde a data. Use ' +
      'PRIMEIRO para qualquer pergunta de fase ("quais estão conclusos", "quantos em ' +
      'sequestro", "o que mudou de fase esta semana"); a busca por texto nos andamentos é só ' +
      'o plano B.',
    input_schema: {
      type: 'object',
      properties: {
        fase: {
          type: 'string',
          description:
            'Código (ATV-03) ou nome da fase. "conclusos" filtra pela conclusão pendente, em ' +
            'qualquer fase. Nomes que existem nas duas trilhas (Sequestro, Penhora, Alvará, ' +
            'Outros) trazem as duas, a menos que `trilha` venha.',
        },
        trilha: {
          type: 'string',
          enum: ['ativo', 'complementar'],
          description: 'A trilha da aba (o status do crédito). Omita para as duas.',
        },
        conclusao_pendente: { type: 'boolean', description: 'true = só os conclusos (concluso para decisão).' },
        situacao: {
          type: 'string',
          description: 'Trecho do nome da "Situação" que a equipe marcou na linha (ex.: "cobrado", "aguardando ofício").',
        },
        sem_situacao: { type: 'boolean', description: 'true = só as linhas sem situação marcada.' },
        limite_pagamento_desde: {
          type: 'string',
          description: 'Só com data limite de pagamento a partir desta data (AAAA-MM-DD).',
        },
        limite_pagamento_ate: {
          type: 'string',
          description:
            'Só com data limite de pagamento até esta data (AAAA-MM-DD). Para "vencidos", passe a ' +
            'data de ontem; a lista sai ordenada pela data limite.',
        },
        mudancas_desde: {
          type: 'string',
          description:
            'Lista as mudanças de fase (automáticas e manuais) desde esta data (AAAA-MM-DD). Com ' +
            '`fase`, só as que ENTRARAM nela.',
        },
        limite: LIMITE_SCHEMA,
      },
    },
  },
  {
    name: 'ficha_do_card',
    description:
      'TUDO sobre UM card do Kommo (a Análise de crédito, antes da compra): funil, coluna e ' +
      'desde quando está nela, responsável, etiquetas dos fundos com as datas, as cotações ' +
      'gravadas de cada fundo, as notas mais recentes, o resumo da oportunidade, a análise ' +
      'interna, a justificativa técnica, os autos do Escavador, o resumo da due diligence e se ' +
      'o crédito já está na carteira. Busca pelo número do processo ou por trecho do título. ' +
      'Quando mais de um card casa (é comum: principal e honorários do mesmo processo), devolve ' +
      'os candidatos — pergunte qual, ou chame de novo com `kommo_lead_id`.',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Número do processo (com ou sem pontuação) ou trecho do título do card.' },
        kommo_lead_id: { type: 'integer', description: 'O id do card, quando já se sabe qual (veio dos candidatos).' },
        notas: { type: 'integer', description: 'Quantas notas recentes trazer (padrão 6, teto 15).' },
      },
    },
  },
  {
    name: 'resumo_do_funil',
    description:
      'O kanban da Análise de crédito (Kommo) em números: quantos cards há em cada funil e em ' +
      'cada coluna, quantos com a análise pronta (marcada na plataforma), e quais estão ' +
      'parados há N dias na mesma coluna. Por padrão conta os funis de análise (RPV, Precatório ' +
      'Interno, Precatório Externo) e deixa de fora o Funil Geral (NOVOS) e o funil de precatório ' +
      'antigo. Com `coluna`, `parados_ha_dias` ou `analise_pronta`, lista os cards. Para motivos ' +
      'de reprovação, conversão e outros relatórios do histórico, o caminho é a Skill "Base do ' +
      'Kommo (relatórios)".',
    input_schema: {
      type: 'object',
      properties: {
        funil: {
          type: 'string',
          description: 'Nome ou id do funil: "RPV", "Interno", "Externo", "Precatório" (os dois), "Geral", "antigo".',
        },
        incluir_todos_os_funis: {
          type: 'boolean',
          description: 'true = conta também o Funil Geral e o funil de precatório antigo.',
        },
        coluna: { type: 'string', description: 'Trecho do nome da coluna, para listar os cards dela.' },
        responsavel: { type: 'string', description: 'Trecho do nome do responsável pelo card.' },
        parados_ha_dias: {
          type: 'integer',
          description:
            'Cards há mais de N dias na mesma coluna (pela data de entrada nela). Colunas de ' +
            'desfecho (Reprovados, Não fechado, Sem resposta, Pagamento finalizado, Ganho/Perdido) ' +
            'ficam de fora, a menos que `coluna` as peça.',
        },
        analise_pronta: { type: 'boolean', description: 'true = lista os cards com a análise marcada como pronta.' },
        limite: LIMITE_SCHEMA,
      },
    },
  },
  {
    name: 'listar_contratos',
    description:
      'Os contratos da tela Geração de contratos: número do processo, tipo (cessão de crédito, ' +
      'de honorários contratuais ou sucumbenciais, intermediação, procuração), investidor, ' +
      'status, data e os links do arquivo e da pasta no Drive. Devolve os totais por tipo e por ' +
      'status de TODOS os que casam com o filtro, e a lista dos mais recentes.',
    input_schema: {
      type: 'object',
      properties: {
        investidor: { type: 'string', description: 'Trecho do nome do investidor (cessionário).' },
        numero_processo: { type: 'string', description: 'Número do processo, com ou sem pontuação.' },
        tipo: {
          type: 'string',
          enum: [
            'cessao_credito',
            'cessao_honorarios_contratuais',
            'cessao_honorarios_sucumbenciais',
            'intermediacao',
            'procuracao',
          ],
        },
        status: { type: 'string', enum: ['rascunho', 'gerado', 'assinado', 'cancelado'] },
        desde: { type: 'string', description: 'Gerados a partir desta data (AAAA-MM-DD, Brasília).' },
        ate: { type: 'string', description: 'Gerados até esta data, inclusive (AAAA-MM-DD, Brasília).' },
        limite: LIMITE_SCHEMA,
      },
    },
  },
  {
    name: 'situacao_due_diligence',
    description:
      'A due diligence de um card (antes da compra): o checklist de certidões (necessárias, ' +
      'obtidas, pendentes, vencidas — com os nomes — e as que vieram POSITIVAS), a etapa ' +
      'documental, os pedidos de certidão em andamento na BullAI, a apuração de processos ' +
      'contra cada titular (cedente, cônjuge, PJ, advogado: liberada, reprovada e o motivo) e ' +
      'os processos marcados com risco de ATENÇÃO ou ALTO. Use para "a diligência do processo X ' +
      'está completa", "que certidões faltam para o Fulano", "o cedente tem processo contra ' +
      'ele". Quando o número casa com mais de um card, devolve os candidatos.',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Número do processo (CNJ) ou nome do cedente.' },
        kommo_lead_id: { type: 'integer', description: 'O id do card, quando já se sabe qual (veio dos candidatos).' },
      },
    },
  },
]

/** Os nomes que este arquivo atende — o resto continua no index.ts. */
export const NOMES_DA_OPERACAO: ReadonlySet<string> = new Set(FERRAMENTAS_DA_OPERACAO.map((f) => f.name))

// ------------------------------------------------------------------ utilidades puras

const json = (o: unknown) => JSON.stringify(o)

/** O `limite` do modelo, inteiro entre 1 e LIMITE_MAX (mesma regra do index.ts). */
export function limiteDaLista(valor: unknown, padrao = 20): number {
  const n = typeof valor === 'number' && Number.isFinite(valor) ? Math.floor(valor) : padrao
  return Math.min(Math.max(n, 1), LIMITE_MAX)
}

/** Só os dígitos. */
export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

/** Texto cortado com reticências — o começo do andamento ou da nota é o que decide a leitura. */
export function cortar(texto: unknown, max: number): string | null {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** "AAAA-MM-DD" válido, ou null quando não veio; `false` quando veio torto. */
export function dataDoArgumento(v: unknown): string | null | false {
  if (v === undefined || v === null || v === '') return null
  const s = String(v).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return false
  return s
}

/**
 * O INÍCIO DO DIA EM BRASÍLIA, como instante — para comparar com timestamptz.
 * Sem horário de verão desde 2019: o fuso é -03:00 o ano inteiro.
 */
export const inicioDoDiaEmBrasilia = (dia: string) => `${dia}T00:00:00-03:00`

/** O dia seguinte (para "até o dia X, inclusive" virar "< X+1"). */
export function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Dias inteiros entre um instante ISO e agora. */
export function diasDesde(iso: unknown, agora: Date): number | null {
  const t = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(t)) return null
  return Math.floor((agora.getTime() - t) / 86_400_000)
}

/**
 * O CARD CASA COM OS DÍGITOS PEDIDOS? Pelo CNJ do card ou pelo título, que traz
 * o número ("originador - cedente - nº do processo - parcelas - %"). A busca no
 * banco vai pelos 7 primeiros dígitos (é o que sobrevive à pontuação); aqui o
 * número inteiro decide, para "0001234-56.2020" não trazer o "0001234-56.2021".
 */
export function cardCasaComDigitos(card: { processo_cnj?: unknown; nome?: unknown }, digitos: string): boolean {
  if (!digitos) return false
  return soDigitos(card.processo_cnj).includes(digitos) || soDigitos(card.nome).includes(digitos)
}

/** Funil e coluna de um card, pelos nomes do kanban espelhado (kommo_etapa). */
export function etapaDoCard(
  etapas: readonly Linha[],
  pipelineId: unknown,
  statusId: unknown,
): { funil: string; coluna: string; ordem: number } {
  const p = Number(pipelineId)
  const s = Number(statusId)
  const daColuna = etapas.find((e) => Number(e.pipeline_id) === p && Number(e.status_id) === s)
  const doFunil = daColuna ?? etapas.find((e) => Number(e.pipeline_id) === p)
  return {
    funil: String(doFunil?.pipeline_nome ?? p),
    coluna: String(daColuna?.nome ?? COLUNAS_DO_SISTEMA[s] ?? s),
    // As colunas de sistema vão para o fim, depois de todas as do kanban.
    ordem: daColuna ? Number(daColuna.ordem ?? 0) : COLUNAS_DO_SISTEMA[s] ? 100_000 + s : 99_999,
  }
}

/**
 * DESDE QUANDO O CARD ESTÁ NA COLUNA — e só quando a data é desta coluna.
 * `etapa_status_id` diferente de `status_id` = o card se moveu depois do último
 * sync e a data ainda é da coluna de antes (migração 0066): melhor dizer que não
 * se sabe do que afirmar uma data que não vale.
 */
export function naColunaDesde(card: Linha): string | null {
  if (!card.etapa_em) return null
  if (card.etapa_status_id !== undefined && Number(card.etapa_status_id) !== Number(card.status_id)) return null
  return String(card.etapa_em)
}

/**
 * A ANÁLISE ESTÁ PRONTA? A marcação de kommo_analise_interna só vale enquanto o
 * card estiver na coluna em que foi marcada (`status_id_quando_marcado`): se
 * alguém o moveu no Kommo, a marca ficou para trás — mesma regra da tela.
 */
export function analiseProntaDoCard(card: Linha, marcacao: Linha | undefined | null): boolean {
  return !!marcacao && Number(marcacao.status_id_quando_marcado) === Number(card.status_id)
}

/** Uma cotação lida do campo do fundo, em palavras e com os valores em R$. */
export function cotacaoLegivel(fundo: string, c: CotacaoLida) {
  let comissao: string | null = null
  if (c.comissao?.modalidade === 'limitada') comissao = formatarReais(c.comissao.centavos)
  else if (c.comissao?.modalidade === 'spread') {
    const pct = c.comissao.percentualCentesimos
    comissao = [
      c.comissao.centavos !== undefined ? formatarReais(c.comissao.centavos) : null,
      pct !== undefined ? `spread de ${formatarPercentual(pct)}%` : 'spread',
    ]
      .filter(Boolean)
      .join(' — ')
  }
  return {
    fundo,
    texto_no_card: c.texto,
    proposta: c.proposta !== null ? formatarReais(c.proposta) : null,
    comissao,
  }
}

/**
 * AS COTAÇÕES DO CARD, só as preenchidas. Inclui os nomes antigos da Invest
 * Precatórios: a casa trocou a Invest pela Domus em 05/11/2026, e o campo
 * "Domus" é o antigo campo da Invest renomeado — o valor que já estava nele
 * pode ser cotação da Invest. O aviso sai quando isso pode estar acontecendo.
 */
export function cotacoesDoCardLegiveis(
  campos: unknown,
  tags: readonly string[],
): { cotacoes: ReturnType<typeof cotacaoLegivel>[]; aviso?: string } {
  const valores = Array.isArray(campos) ? (campos as ValorDeCampo[]) : []
  const fundos = [...FUNDOS_DA_PRECIFICACAO, 'Invest Precatórios', 'Invest']
  const lidas = cotacoesDoCard(valores, fundos)
  const cotacoes = Object.entries(lidas)
    .filter((e): e is [string, CotacaoLida] => e[1] !== null)
    .map(([fundo, c]) => cotacaoLegivel(fundo, c))
  const temDomus = cotacoes.some((c) => c.fundo === 'Domus')
  const etiquetasNorm = tags.map(normalizarTexto)
  const temEtiquetaInvest = etiquetasNorm.some((t) => t.includes('invest'))
  const temEtiquetaDomus = etiquetasNorm.some((t) => t.includes('domus'))
  const aviso =
    temDomus && (temEtiquetaInvest || !temEtiquetaDomus)
      ? 'O campo "Domus" é o antigo campo da Invest Precatórios, renomeado em 05/11/2026: sem ' +
        'etiqueta da Domus no card (ou com etiqueta da Invest), o valor nele pode ser cotação da ' +
        'INVEST, não da Domus. Diga isso ao citar esse valor.'
      : temEtiquetaInvest
        ? 'O card tem etiqueta da Invest Precatórios, fundo com que a casa não trabalha mais desde ' +
          '05/11/2026 — trate como histórico.'
        : undefined
  return { cotacoes, aviso }
}

/** As etiquetas com a data em que entraram no card (tags_em; null = o Kommo não guarda). */
export function etiquetasComData(tags: unknown, tagsEm: unknown) {
  const datas = (tagsEm && typeof tagsEm === 'object' ? tagsEm : {}) as Record<string, string | null>
  return (Array.isArray(tags) ? tags : []).map((t) => {
    const nome = semEntidadesHtml(t)
    const canonica = etiquetaCanonica(nome)
    return { etiqueta: nome, desde: datas[String(t)] ?? (canonica ? datas[canonica] : null) ?? null }
  })
}

/** As últimas N notas do card, da mais recente para a mais antiga, cortadas. */
export function notasRecentes(notas: unknown, n: number) {
  const lista = (Array.isArray(notas) ? notas : []) as Linha[]
  return [...lista]
    .filter((x) => String(x?.texto ?? '').trim())
    .sort((a, b) => String(b.criado_em ?? '').localeCompare(String(a.criado_em ?? '')))
    .slice(0, n)
    .map((x) => ({
      quando: x.criado_em ?? null,
      autor: x.autor ?? null,
      // DA PLATAFORMA OU DA AUTOMAÇÃO (movimentação, etiqueta, análise), não de pessoa.
      do_sistema: x.automatica === true || undefined,
      texto: cortar(semEntidadesHtml(x.texto), 700),
    }))
}

/**
 * O RESUMO DA OPORTUNIDADE, montado pelo mesmo código que o escreve no card. O
 * jsonb foi gravado por versões diferentes da tela: um campo de tipo inesperado
 * não pode derrubar a ficha inteira — sem resumo, ela segue.
 */
export function oportunidadeLegivel(oportunidade: unknown): string | null {
  if (!oportunidade || typeof oportunidade !== 'object') return null
  try {
    return resumoDaOportunidade(oportunidade as EntradaOportunidade) || null
  } catch {
    return null
  }
}

/** O que cada estado dos autos do Escavador quer dizer (migração 0072). */
const ESTADOS_DOS_AUTOS: Record<string, string> = {
  SEM_CNJ: 'o card não tem número de processo legível',
  NOVO: 'ainda não pedido',
  PEDINDO: 'pedido em curso',
  FILA: 'na fila, esperando a cota diária de pedidos',
  AGUARDANDO: 'pedido feito; o Escavador está buscando no tribunal',
  ANEXANDO: 'os autos estão descendo para o card',
  CONCLUIDO: 'todos os documentos anexados ao card',
  FALHOU: 'o tribunal não entregou (processo físico, sigiloso ou erro do robô)',
  SEM_SALDO: 'o Escavador recusou por falta de crédito; será tentado de novo',
}

/** Rótulo dos tipos de contrato da geração. */
const TIPOS_DE_CONTRATO: Record<string, string> = {
  cessao_credito: 'Cessão de crédito',
  cessao_honorarios_contratuais: 'Cessão de honorários contratuais',
  cessao_honorarios_sucumbenciais: 'Cessão de honorários sucumbenciais',
  intermediacao: 'Intermediação',
  procuracao: 'Procuração',
  cessao: 'Cessão (modelo antigo)',
  investimento: 'Investimento (modelo antigo)',
  outro: 'Outro (modelo antigo)',
}

// ------------------------------------------------------------------ leitura

/**
 * Uma página do construtor do supabase-js. `data` como `unknown`: com o select
 * montado por concatenação, o tipo que o supabase-js infere da string não serve
 * — as linhas são lidas como registro solto, campo a campo.
 */
type Pagina = (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>

/** Tudo, em páginas; erro ou corte viram mensagem para o modelo. */
async function lerTudo(pagina: Pagina): Promise<{ linhas: Linha[] } | { erro: string }> {
  const r: LeituraCompleta<Linha> = await lerTodasAsLinhas<Linha>(
    (de, ate) => pagina(de, ate) as PromiseLike<PaginaDoBanco<Linha>>,
  )
  if (r.erro) return { erro: r.erro }
  if (r.cortada) return { erro: LEITURA_CORTADA }
  return { linhas: r.linhas }
}

/** Uma consulta de seção: o erro fica na seção, o resto da ficha segue. */
async function secao<T>(
  consulta: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<{ data: T | null; erro?: string }> {
  const { data, error } = await consulta
  return error ? { data: null, erro: error.message } : { data }
}

/** As colunas do kanban espelhado — é tabela pequena, mas paginada como o resto. */
function lerEtapas(svc: ClienteDoBanco) {
  return lerTudo((de, ate) =>
    svc
      .from('kommo_etapa')
      .select('pipeline_id, status_id, pipeline_nome, nome, ordem')
      .order('pipeline_id')
      .order('status_id')
      .range(de, ate),
  )
}

const COLUNAS_LEVES_DO_CARD = 'kommo_lead_id, pipeline_id, status_id, nome, responsavel_nome, processo_cnj'

/**
 * OS CARDS QUE CASAM COM A BUSCA: pelo id, pelos dígitos do processo (no CNJ do
 * card ou no título) ou por trecho do título. Até 20, só colunas leves — a ficha
 * inteira, com notas e campos, só se lê para o card escolhido.
 */
async function acharCards(
  svc: ClienteDoBanco,
  busca: string,
  id: number | null,
): Promise<{ cards: Linha[] } | { erro: string }> {
  if (id !== null) {
    const { data, error } = await svc.from('kommo_leads').select(COLUNAS_LEVES_DO_CARD).eq('kommo_lead_id', id).limit(1)
    if (error) return { erro: error.message }
    return { cards: (data ?? []) as Linha[] }
  }
  const digitos = soDigitos(busca)
  if (digitos.length >= 6) {
    const prefixo = digitos.slice(0, 7)
    const { data, error } = await svc
      .from('kommo_leads')
      .select(COLUNAS_LEVES_DO_CARD)
      .or(`processo_cnj.ilike.%${prefixo}%,nome.ilike.%${prefixo}%`)
      .order('kommo_lead_id')
      .limit(20)
    if (error) return { erro: error.message }
    return { cards: ((data ?? []) as Linha[]).filter((c) => cardCasaComDigitos(c, digitos)) }
  }
  const trecho = busca.trim()
  if (trecho.length < 3) return { erro: 'Informe o número do processo (6+ dígitos) ou ao menos 3 letras do título.' }
  const { data, error } = await svc
    .from('kommo_leads')
    .select(COLUNAS_LEVES_DO_CARD)
    .ilike('nome', `%${trecho}%`)
    .order('kommo_lead_id')
    .limit(20)
  if (error) return { erro: error.message }
  return { cards: (data ?? []) as Linha[] }
}

/** Os candidatos, como o modelo os mostra para a pessoa escolher. */
function candidatos(cards: Linha[], etapas: readonly Linha[]) {
  return cards.map((c) => {
    const { funil, coluna } = etapaDoCard(etapas, c.pipeline_id, c.status_id)
    return {
      kommo_lead_id: c.kommo_lead_id,
      titulo: c.nome,
      funil,
      coluna,
      responsavel: c.responsavel_nome,
      processo_cnj: c.processo_cnj,
    }
  })
}

const idDoArgumento = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null

// ------------------------------------------------------------------ executores

/**
 * Executa a ferramenta, se for daqui. `null` = o nome não é deste arquivo (o
 * index.ts então responde "Ferramenta desconhecida").
 */
export async function executarDaOperacao(
  svc: ClienteDoBanco,
  nome: string,
  args: Record<string, unknown>,
  agora: Date = new Date(),
): Promise<string | null> {
  switch (nome) {
    case 'fase_processual': {
      return await faseProcessual(svc, args)
    }
    case 'ficha_do_card': {
      return await fichaDoCard(svc, args)
    }
    case 'resumo_do_funil': {
      return await resumoDoFunil(svc, args, agora)
    }
    case 'listar_contratos': {
      return await listarContratos(svc, args)
    }
    case 'situacao_due_diligence': {
      return await situacaoDueDiligence(svc, args, agora)
    }
    default:
      return null
  }
}

// ---- fase_processual -------------------------------------------------------

async function faseProcessual(svc: ClienteDoBanco, args: Record<string, unknown>): Promise<string> {
  const trilha: TrilhaDaFase | null =
    args.trilha === 'ativo' || args.trilha === 'complementar' ? args.trilha : null

  let codigos: string[] | null = null
  let soConclusos = args.conclusao_pendente === true
  let interpretacao: string | undefined
  if (typeof args.fase === 'string' && args.fase.trim()) {
    const f = lerFasePedida(args.fase, trilha)
    if (f.tipo === 'desconhecida') {
      return json({
        erro: `Não reconheci a fase "${args.fase}".`,
        fases_validas: f.opcoes,
        dica: 'Use um código da lista, um nome dela ou "conclusos".',
      })
    }
    if (f.tipo === 'conclusos') soConclusos = true
    else codigos = f.codigos
    interpretacao = f.interpretacao
  }

  const desdeLimite = dataDoArgumento(args.limite_pagamento_desde)
  const ateLimite = dataDoArgumento(args.limite_pagamento_ate)
  const mudancasDesde = dataDoArgumento(args.mudancas_desde)
  if (desdeLimite === false || ateLimite === false || mudancasDesde === false) {
    return json({ erro: 'Datas no formato AAAA-MM-DD.' })
  }
  const situacao = typeof args.situacao === 'string' && args.situacao.trim() ? normalizarTexto(args.situacao) : null
  const semSituacao = args.sem_situacao === true

  // A CARTEIRA INTEIRA E A CLASSIFICAÇÃO INTEIRA, em páginas: são contagens, e
  // o corte calado de 1000 linhas daria número menor que o da aba.
  const [procs, fases, catalogo] = await Promise.all([
    lerTudo((de, ate) =>
      svc.from('processos').select('id, numero_cnj, cedente, cessionario, status').order('id').range(de, ate),
    ),
    lerTudo((de, ate) =>
      svc
        .from('processos_fase')
        .select(
          'processo_id, fase_codigo, data_entrada_fase, conclusao_pendente, conclusao_desde, ' +
            'data_limite_pagamento, situacao_id, situacao_data, movimentacao_ancora_data, ' +
            'movimentacao_ancora_texto, classificado_em',
        )
        .order('processo_id')
        .range(de, ate),
    ),
    lerTudo((de, ate) =>
      svc.from('processos_fase_situacoes_catalogo').select('id, fase_codigo, nome').order('id').range(de, ate),
    ),
  ])
  if ('erro' in procs) return json({ erro: `Créditos: ${procs.erro}` })
  if ('erro' in fases) return json({ erro: `Fase processual: ${fases.erro}` })
  if ('erro' in catalogo) return json({ erro: `Situações: ${catalogo.erro}` })

  const nomeDaSituacao = new Map(catalogo.linhas.map((s) => [String(s.id), String(s.nome ?? '')]))
  const procPorId = new Map(procs.linhas.map((p) => [String(p.id), p]))
  const faseDe = new Map(fases.linhas.map((f) => [String(f.processo_id), f]))

  const contagem = contarComoATela(
    procs.linhas.map((p) => ({ id: String(p.id), status: (p.status as string | null) ?? null })),
    fases.linhas.map((f) => ({
      processo_id: String(f.processo_id),
      fase_codigo: String(f.fase_codigo),
      conclusao_pendente: f.conclusao_pendente === true,
    })),
  )

  // A SITUAÇÃO DENTRO DE CADA FASE (a coluna "Situação" da aba), por trilha.
  const situacoesPorFase = new Map<string, Record<string, number>>()
  for (const p of procs.linhas) {
    if (p.status !== 'ativo' && p.status !== 'complementar') continue
    const r = faseDe.get(String(p.id))
    if (!r) continue
    const chave = `${p.status}:${r.fase_codigo}`
    const nome = r.situacao_id ? nomeDaSituacao.get(String(r.situacao_id)) ?? 'situação apagada' : 'sem situação'
    const m = situacoesPorFase.get(chave) ?? {}
    m[nome] = (m[nome] ?? 0) + 1
    situacoesPorFase.set(chave, m)
  }
  const trilhas = trilha ? [trilha] : (['ativo', 'complementar'] as const)
  const contagemNaResposta = Object.fromEntries(
    trilhas.map((t) => [
      t,
      {
        ...contagem[t],
        por_fase: contagem[t].por_fase.map((f) => {
          const s = situacoesPorFase.get(`${t}:${f.codigo}`)
          // Só quando alguém marcou situação: "sem situação: 12" sozinho é ruído.
          const temMarcada = s && Object.keys(s).some((k) => k !== 'sem situação')
          return temMarcada ? { ...f, por_situacao: s } : f
        }),
        fora_da_taxonomia: Object.keys(contagem[t].fora_da_taxonomia).length
          ? contagem[t].fora_da_taxonomia
          : undefined,
      },
    ]),
  )

  const classificacaoMaisRecente =
    fases.linhas.map((f) => String(f.classificado_em ?? '')).filter(Boolean).sort().pop() ?? null

  const limite = limiteDaLista(args.limite)
  const listar =
    codigos !== null || soConclusos || situacao !== null || semSituacao || desdeLimite !== null || ateLimite !== null

  let creditos: Record<string, unknown> | undefined
  if (listar) {
    const achados = procs.linhas
      .filter((p) => (trilha ? p.status === trilha : p.status === 'ativo' || p.status === 'complementar'))
      .map((p) => ({ p, r: faseDe.get(String(p.id)) }))
      .filter((x): x is { p: Linha; r: Linha } => !!x.r)
      .filter(({ r }) => {
        if (codigos && !codigos.includes(String(r.fase_codigo))) return false
        if (soConclusos && r.conclusao_pendente !== true) return false
        if (semSituacao && r.situacao_id) return false
        if (situacao !== null) {
          const nome = r.situacao_id ? nomeDaSituacao.get(String(r.situacao_id)) : null
          if (!nome || !normalizarTexto(nome).includes(situacao)) return false
        }
        const lim = r.data_limite_pagamento ? String(r.data_limite_pagamento) : null
        if (desdeLimite && (!lim || lim < desdeLimite)) return false
        if (ateLimite && (!lim || lim > ateLimite)) return false
        return true
      })
    // A ORDEM DA TELA (entrada na fase, da mais recente para a mais antiga); com a
    // janela de data limite, a ordem que interessa é a do vencimento.
    const porVencimento = desdeLimite !== null || ateLimite !== null
    achados.sort((a, b) =>
      porVencimento
        ? String(a.r.data_limite_pagamento ?? '').localeCompare(String(b.r.data_limite_pagamento ?? ''))
        : String(b.r.data_entrada_fase ?? '').localeCompare(String(a.r.data_entrada_fase ?? '')),
    )
    creditos = {
      total: achados.length,
      quantidade_retornada: Math.min(achados.length, limite),
      ordem: porVencimento
        ? 'pela data limite de pagamento, da mais próxima à mais distante'
        : 'pela entrada na fase, da mais recente à mais antiga (a ordem da aba)',
      aviso_limite:
        achados.length > limite
          ? `Mostrando ${limite} de ${achados.length}. Diga quantos faltam; peça mais com \`limite\` (teto ${LIMITE_MAX}).`
          : undefined,
      lista: achados.slice(0, limite).map(({ p, r }) => ({
        numero_cnj: p.numero_cnj,
        cedente: p.cedente,
        cessionario: p.cessionario,
        trilha: p.status,
        fase: `${rotuloDaFase(String(r.fase_codigo))} (${r.fase_codigo})`,
        na_fase_desde: r.data_entrada_fase ?? null,
        concluso_desde: r.conclusao_pendente ? (r.conclusao_desde ?? null) : undefined,
        data_limite_pagamento: r.data_limite_pagamento ?? undefined,
        situacao: r.situacao_id ? nomeDaSituacao.get(String(r.situacao_id)) ?? null : undefined,
        situacao_data: r.situacao_id ? (r.situacao_data ?? null) : undefined,
        andamento_que_fundamentou: r.movimentacao_ancora_data || r.movimentacao_ancora_texto
          ? { data: r.movimentacao_ancora_data ?? null, trecho: cortar(r.movimentacao_ancora_texto, 220) }
          : undefined,
      })),
    }
  }

  let mudancas: Record<string, unknown> | undefined
  if (mudancasDesde) {
    const lidas = await lerTudo((de, ate) =>
      svc
        .from('processos_fase_mudancas')
        .select('id, processo_id, fase_anterior, fase_nova, origem, movimentacao_ancora_data, movimentacao_ancora_texto, criado_em')
        .gte('criado_em', inicioDoDiaEmBrasilia(mudancasDesde))
        .order('criado_em', { ascending: false })
        .order('id')
        .range(de, ate),
    )
    if ('erro' in lidas) return json({ erro: `Mudanças de fase: ${lidas.erro}` })
    const prefixo = trilha === 'ativo' ? 'ATV-' : trilha === 'complementar' ? 'CMP-' : ''
    const filtradas = lidas.linhas.filter(
      (m) =>
        String(m.fase_nova ?? '').startsWith(prefixo) &&
        (!codigos || codigos.includes(String(m.fase_nova))) &&
        // "Conclusos" não é fase: a mudança de fase não diz nada sobre ele.
        !soConclusos,
    )
    mudancas = {
      desde: mudancasDesde,
      total: filtradas.length,
      aviso: soConclusos
        ? 'Concluso não é fase (é atributo) e não entra no log de mudanças de fase.'
        : undefined,
      aviso_limite:
        filtradas.length > limite
          ? `Mostrando as ${limite} mais recentes de ${filtradas.length}.`
          : undefined,
      lista: filtradas.slice(0, limite).map((m) => {
        const p = procPorId.get(String(m.processo_id))
        return {
          quando: m.criado_em,
          numero_cnj: p?.numero_cnj ?? null,
          cedente: p?.cedente ?? null,
          de: m.fase_anterior ? `${rotuloDaFase(String(m.fase_anterior))} (${m.fase_anterior})` : 'primeira classificação',
          para: `${rotuloDaFase(String(m.fase_nova))} (${m.fase_nova})`,
          origem: m.origem === 'manual' ? 'manual (alguém corrigiu na tela)' : 'automática (varredura)',
          andamento: m.movimentacao_ancora_data || m.movimentacao_ancora_texto
            ? { data: m.movimentacao_ancora_data ?? null, trecho: cortar(m.movimentacao_ancora_texto, 220) }
            : undefined,
        }
      }),
    }
  }

  return json({
    fonte:
      'Tabela de fase processual — a mesma da aba Publicações e movimentações → Fase processual. ' +
      'A trilha é o status do crédito (ativo/complementar); concluso é atributo, contado à parte.',
    recorte: {
      trilha: trilha ?? 'ativo e complementar',
      fase: interpretacao,
      conclusos: soConclusos || undefined,
      situacao: args.situacao ?? undefined,
      sem_situacao: semSituacao || undefined,
      limite_pagamento_desde: desdeLimite ?? undefined,
      limite_pagamento_ate: ateLimite ?? undefined,
    },
    classificacao_mais_recente: classificacaoMaisRecente,
    contagem: contagemNaResposta,
    creditos,
    mudancas,
  })
}

// ---- ficha_do_card ---------------------------------------------------------

const COLUNAS_DA_FICHA_DO_CARD =
  'kommo_lead_id, pipeline_id, status_id, nome, responsavel_nome, processo_cnj, tags, tags_em, ' +
  'criado_em, atualizado_em, etapa_em, etapa_status_id, sincronizado_em, notas, oportunidade, ' +
  'campos:raw->custom_fields_values, preco:raw->price, fechado:raw->closed_at'

async function fichaDoCard(svc: ClienteDoBanco, args: Record<string, unknown>): Promise<string> {
  const busca = String(args.busca ?? '').trim()
  const id = idDoArgumento(args.kommo_lead_id)
  if (!busca && id === null) return json({ erro: 'Informe o número do processo, um trecho do título ou o kommo_lead_id.' })

  const [achados, etapas] = await Promise.all([acharCards(svc, busca, id), lerEtapas(svc)])
  if ('erro' in achados) return json({ erro: achados.erro })
  if ('erro' in etapas) return json({ erro: `Colunas do Kommo: ${etapas.erro}` })
  if (achados.cards.length === 0) {
    return json({
      encontrado: false,
      aviso:
        `Nenhum card do Kommo casou com "${busca || id}". O espelho guarda os funis de análise e a ` +
        'coluna NOVOS do Funil Geral; card fora deles não aparece aqui.',
    })
  }
  if (achados.cards.length > 1) {
    return json({
      encontrado: false,
      aviso:
        'Mais de um card casou (é comum: principal e honorários do mesmo processo). Mostre os ' +
        'candidatos e pergunte qual; depois chame de novo com `kommo_lead_id`.',
      candidatos: candidatos(achados.cards, etapas.linhas),
    })
  }

  const leadId = Number(achados.cards[0].kommo_lead_id)
  const { data: cheio, error } = await svc
    .from('kommo_leads')
    .select(COLUNAS_DA_FICHA_DO_CARD)
    .eq('kommo_lead_id', leadId)
    .maybeSingle()
  if (error) return json({ erro: error.message })
  if (!cheio) return json({ encontrado: false, aviso: 'O card saiu do espelho entre uma leitura e outra. Tente de novo.' })
  const card = cheio as unknown as Linha

  const digitosDoCnj = soDigitos(card.processo_cnj)
  const [interna, justificativa, autosCard, autosProcessos, completude, carteira] = await Promise.all([
    secao(
      svc
        .from('kommo_analise_interna')
        .select('status_id_quando_marcado, marcado_em')
        .eq('kommo_lead_id', leadId)
        .maybeSingle(),
    ),
    secao(
      svc
        .from('justificativa_tecnica')
        .select('status, etapa, gerado_em, enviado_em, enviado_por, erro, atualizado_em')
        .eq('kommo_lead_id', leadId)
        .maybeSingle(),
    ),
    secao(
      svc
        .from('escavador_autos_card')
        .select('estado, numero_cnj, total_documentos, anexados, paginas, detalhe, verificado_em, concluido_em')
        .eq('kommo_lead_id', leadId)
        .maybeSingle(),
    ),
    secao(
      svc
        .from('escavador_autos_processo')
        .select('numero_cnj, rotulo, papeis, estado, total_documentos, anexados, paginas, detalhe, concluido_em')
        .eq('kommo_lead_id', leadId)
        .order('numero_cnj')
        .limit(20),
    ),
    secao(svc.from('v_dd_completude').select('*').eq('kommo_lead_id', leadId).maybeSingle()),
    digitosDoCnj.length >= 7
      ? secao(
          svc
            .from('processos')
            .select('numero_cnj, cedente, cessionario, status')
            .ilike('numero_cnj', `%${digitosDoCnj.slice(0, 7)}%`)
            .limit(5),
        )
      : Promise.resolve({ data: [] as Linha[] } as { data: Linha[] | null; erro?: string }),
  ])

  const avisos: string[] = []
  const anota = (rotulo: string, s: { erro?: string }) => {
    if (s.erro) avisos.push(`${rotulo}: não consegui ler (${s.erro}).`)
  }
  anota('Análise interna', interna)
  anota('Justificativa técnica', justificativa)
  anota('Autos do Escavador', autosCard)
  anota('Autos dos processos do crédito', autosProcessos)
  anota('Due diligence', completude)
  anota('Carteira', carteira)

  const { funil, coluna } = etapaDoCard(etapas.linhas, card.pipeline_id, card.status_id)
  const desde = naColunaDesde(card)
  const tags = (Array.isArray(card.tags) ? card.tags : []).map((t) => semEntidadesHtml(t))
  const { cotacoes, aviso: avisoCotacoes } = cotacoesDoCardLegiveis(card.campos, tags)
  const qtdNotas = Math.min(Math.max(typeof args.notas === 'number' ? Math.floor(args.notas) : 6, 1), 15)
  const fechado = Number(card.fechado)
  const preco = Number(card.preco)
  const marcacao = interna.data as Linha | null
  const jt = justificativa.data as Linha | null
  const ac = autosCard.data as Linha | null
  const dd = completude.data as Linha | null
  const naCarteira = ((carteira.data ?? []) as Linha[]).filter((p) => cardCasaComDigitos({ processo_cnj: p.numero_cnj }, digitosDoCnj))

  return json({
    encontrado: true,
    card: {
      kommo_lead_id: leadId,
      titulo: card.nome,
      funil,
      coluna,
      na_coluna_desde: desde,
      aviso_coluna:
        card.etapa_em && !desde
          ? 'O card mudou de coluna depois da última sincronização; a data de entrada nesta coluna ainda não foi apurada.'
          : undefined,
      responsavel: card.responsavel_nome,
      processo_cnj: card.processo_cnj,
      criado_em: card.criado_em,
      atualizado_em: card.atualizado_em,
      fechado_em: Number.isFinite(fechado) && fechado > 0 ? new Date(fechado * 1000).toISOString() : null,
      valor_do_card: Number.isFinite(preco) && preco > 0 ? preco : null,
      sincronizado_em: card.sincronizado_em,
    },
    etiquetas: etiquetasComData(card.tags, card.tags_em),
    cotacoes_dos_fundos: {
      leitura:
        'Texto do campo "R$ X / R$ Y" = proposta do fundo / comissão da casa. "(Spread de N%)" = a ' +
        'comissão é N% sobre o valor líquido validado, e a proposta mostrada já é a final, sem ela.',
      cotacoes,
      aviso: avisoCotacoes,
    },
    oportunidade: oportunidadeLegivel(card.oportunidade),
    analise_interna: marcacao
      ? {
          analise_pronta: analiseProntaDoCard(card, marcacao),
          marcada_em: marcacao.marcado_em,
          observacao: analiseProntaDoCard(card, marcacao)
            ? undefined
            : 'Marcação antiga: o card mudou de coluna depois de marcado, e ela não vale mais.',
        }
      : { analise_pronta: false },
    justificativa_tecnica: jt
      ? {
          status: jt.status,
          etapa: jt.etapa ?? undefined,
          gerada_em: jt.gerado_em ?? null,
          enviada_ao_kommo_em: jt.enviado_em ?? null,
          enviada_por: jt.enviado_por ?? null,
          erro: jt.erro ?? undefined,
        }
      : null,
    autos_escavador: {
      card: ac
        ? {
            estado: ac.estado,
            significa: ESTADOS_DOS_AUTOS[String(ac.estado)] ?? undefined,
            documentos: ac.total_documentos,
            anexados: ac.anexados,
            paginas: ac.paginas,
            detalhe: cortar(ac.detalhe, 300),
            concluido_em: ac.concluido_em ?? null,
          }
        : null,
      processos: ((autosProcessos.data ?? []) as Linha[]).map((p) => ({
        numero_cnj: p.numero_cnj,
        rotulo: p.rotulo,
        estado: p.estado,
        significa: ESTADOS_DOS_AUTOS[String(p.estado)] ?? undefined,
        documentos: p.total_documentos,
        anexados: p.anexados,
        detalhe: cortar(p.detalhe, 200),
      })),
    },
    due_diligence: dd
      ? {
          necessarias: dd.necessarias,
          obtidas_validas: dd.obtidas_validas,
          pendentes: dd.pendentes,
          vencidas: dd.vencidas,
          dispensadas: dd.dispensadas,
          detalhes: 'Os nomes das certidões e os processos contra os titulares: `situacao_due_diligence`.',
        }
      : null,
    credito_na_carteira: naCarteira.length
      ? { creditos: naCarteira, detalhes: 'Já comprado: a situação processual está em `ficha_do_credito`.' }
      : undefined,
    notas_no_total: Array.isArray(card.notas) ? card.notas.length : 0,
    notas_recentes: notasRecentes(card.notas, qtdNotas),
    avisos: avisos.length ? avisos : undefined,
  })
}

// ---- resumo_do_funil -------------------------------------------------------

/** Os apelidos que a equipe usa para os funis. */
const APELIDOS_DE_FUNIL: [RegExp, number[]][] = [
  [/\brpv\b/, [FUNIL_RPV]],
  [/\binterno\b/, [FUNIL_PRECATORIO_INTERNO]],
  [/\bexterno\b/, [FUNIL_PRECATORIO_EXTERNO]],
  [/\b(geral|novos)\b/, [FUNIL_GERAL]],
  [/\bantigo\b/, [FUNIL_PRECATORIO_ANTIGO]],
  [/\bprecatorios?\b/, [FUNIL_PRECATORIO_INTERNO, FUNIL_PRECATORIO_EXTERNO]],
]

/**
 * OS FUNIS PEDIDOS: id, apelido ou trecho do nome. `null` = nenhum pedido (vale o
 * padrão); lista vazia = não reconheci.
 */
export function funisPedidos(texto: unknown, etapas: readonly Linha[]): number[] | null {
  if (texto === undefined || texto === null || String(texto).trim() === '') return null
  const t = normalizarTexto(texto)
  if (/^\d+$/.test(t)) return [Number(t)]
  for (const [re, ids] of APELIDOS_DE_FUNIL) if (re.test(t)) return ids
  const ids = new Set<number>()
  for (const e of etapas) if (normalizarTexto(e.pipeline_nome).includes(t)) ids.add(Number(e.pipeline_id))
  return [...ids]
}

async function resumoDoFunil(svc: ClienteDoBanco, args: Record<string, unknown>, agora: Date): Promise<string> {
  const etapas = await lerEtapas(svc)
  if ('erro' in etapas) return json({ erro: `Colunas do Kommo: ${etapas.erro}` })

  const todosOsFunis = [...new Set(etapas.linhas.map((e) => Number(e.pipeline_id)))]
  const pedidos = funisPedidos(args.funil, etapas.linhas)
  if (pedidos !== null && pedidos.length === 0) {
    return json({
      erro: `Não reconheci o funil "${args.funil}".`,
      funis: [...new Set(etapas.linhas.map((e) => `${e.pipeline_nome} (${e.pipeline_id})`))],
    })
  }
  const funis = pedidos ?? (args.incluir_todos_os_funis === true
    ? todosOsFunis
    : todosOsFunis.filter((f) => !FUNIS_FORA_POR_PADRAO.includes(f)))

  const [cards, marcacoes] = await Promise.all([
    lerTudo((de, ate) =>
      svc
        .from('kommo_leads')
        .select('kommo_lead_id, pipeline_id, status_id, nome, responsavel_nome, processo_cnj, etapa_em, etapa_status_id, sincronizado_em')
        .in('pipeline_id', funis)
        .order('kommo_lead_id')
        .range(de, ate),
    ),
    lerTudo((de, ate) =>
      svc
        .from('kommo_analise_interna')
        .select('kommo_lead_id, status_id_quando_marcado, marcado_em')
        .order('kommo_lead_id')
        .range(de, ate),
    ),
  ])
  if ('erro' in cards) return json({ erro: `Cards do Kommo: ${cards.erro}` })
  if ('erro' in marcacoes) return json({ erro: `Análise interna: ${marcacoes.erro}` })

  const marcacaoDe = new Map(marcacoes.linhas.map((m) => [Number(m.kommo_lead_id), m]))
  const responsavel = typeof args.responsavel === 'string' && args.responsavel.trim() ? normalizarTexto(args.responsavel) : null
  const coluna = typeof args.coluna === 'string' && args.coluna.trim() ? normalizarTexto(args.coluna) : null
  const diasParado =
    typeof args.parados_ha_dias === 'number' && Number.isFinite(args.parados_ha_dias)
      ? Math.max(0, Math.floor(args.parados_ha_dias))
      : null

  interface CardDoResumo {
    kommo_lead_id: unknown
    titulo: unknown
    funil: string
    coluna: string
    ordem: number
    pipeline_id: number
    status_id: number
    responsavel: unknown
    processo_cnj: unknown
    na_coluna_desde: string | null
    dias_na_coluna: number | null
    analise_pronta: boolean
    parado: boolean
  }
  const doRecorte: CardDoResumo[] = cards.linhas
    .filter((c) => !responsavel || normalizarTexto(c.responsavel_nome).includes(responsavel))
    .map((c) => {
      const etapa = etapaDoCard(etapas.linhas, c.pipeline_id, c.status_id)
      const desde = naColunaDesde(c)
      const dias = desde ? diasDesde(desde, agora) : null
      const desfecho = COLUNAS_DO_SISTEMA[Number(c.status_id)] !== undefined || COLUNA_DE_DESFECHO.test(normalizarTexto(etapa.coluna))
      return {
        kommo_lead_id: c.kommo_lead_id,
        titulo: c.nome,
        funil: etapa.funil,
        coluna: etapa.coluna,
        ordem: etapa.ordem,
        pipeline_id: Number(c.pipeline_id),
        status_id: Number(c.status_id),
        responsavel: c.responsavel_nome,
        processo_cnj: c.processo_cnj,
        na_coluna_desde: desde,
        dias_na_coluna: dias,
        analise_pronta: analiseProntaDoCard(c, marcacaoDe.get(Number(c.kommo_lead_id))),
        // A COLUNA PEDIDA VENCE O CORTE DE DESFECHO: "quem está em Sem resposta há
        // 30 dias" é pergunta legítima.
        parado: diasParado !== null && dias !== null && dias > diasParado && (!desfecho || coluna !== null),
      }
    })

  // A CONTAGEM, funil a funil e coluna a coluna, na ordem do kanban — com as
  // colunas vazias, para "quantos em Negociação" poder ser zero com certeza.
  const porFunil = funis.map((f) => {
    const colunasDoFunil = etapas.linhas
      .filter((e) => Number(e.pipeline_id) === f)
      .sort((a, b) => Number(a.ordem ?? 0) - Number(b.ordem ?? 0))
    const doFunil = doRecorte.filter((c) => c.pipeline_id === f)
    const linhas = colunasDoFunil.map((e) => {
      const ali = doFunil.filter((c) => c.status_id === Number(e.status_id))
      return {
        coluna: String(e.nome),
        quantidade: ali.length,
        analise_pronta: ali.filter((c) => c.analise_pronta).length || undefined,
        parados: diasParado !== null ? ali.filter((c) => c.parado).length || undefined : undefined,
      }
    })
    // Card numa coluna que o espelho de colunas não tem (ou 142/143, se não vierem).
    const conhecidas = new Set(colunasDoFunil.map((e) => Number(e.status_id)))
    const soltas = new Map<string, number>()
    for (const c of doFunil) if (!conhecidas.has(c.status_id)) soltas.set(c.coluna, (soltas.get(c.coluna) ?? 0) + 1)
    for (const [nome, n] of soltas) linhas.push({ coluna: nome, quantidade: n, analise_pronta: undefined, parados: undefined })
    return {
      funil: String(colunasDoFunil[0]?.pipeline_nome ?? f),
      pipeline_id: f,
      total: doFunil.length,
      colunas: linhas,
    }
  })

  const sincronizados = cards.linhas.map((c) => String(c.sincronizado_em ?? '')).filter(Boolean).sort()
  const limite = limiteDaLista(args.limite)
  const listar = coluna !== null || diasParado !== null || args.analise_pronta === true
  let lista: Record<string, unknown> | undefined
  if (listar) {
    const achados = doRecorte
      .filter((c) => coluna === null || normalizarTexto(c.coluna).includes(coluna))
      .filter((c) => diasParado === null || c.parado)
      .filter((c) => args.analise_pronta !== true || c.analise_pronta)
    // Parados: do mais parado ao menos. Sem isso, a ordem da tela (entrada na
    // coluna, da mais recente à mais antiga; sem data por último).
    achados.sort((a, b) => {
      if (diasParado !== null) return (b.dias_na_coluna ?? -1) - (a.dias_na_coluna ?? -1)
      if (!a.na_coluna_desde) return 1
      if (!b.na_coluna_desde) return -1
      return b.na_coluna_desde.localeCompare(a.na_coluna_desde)
    })
    lista = {
      total: achados.length,
      quantidade_retornada: Math.min(achados.length, limite),
      aviso_limite:
        achados.length > limite
          ? `Mostrando ${limite} de ${achados.length}. Diga quantos faltam; peça mais com \`limite\` (teto ${LIMITE_MAX}).`
          : undefined,
      cards: achados.slice(0, limite).map((c) => ({
        kommo_lead_id: c.kommo_lead_id,
        titulo: c.titulo,
        funil: c.funil,
        coluna: c.coluna,
        responsavel: c.responsavel,
        processo_cnj: c.processo_cnj,
        na_coluna_desde: c.na_coluna_desde,
        dias_na_coluna: c.dias_na_coluna,
        analise_pronta: c.analise_pronta || undefined,
      })),
    }
  }
  const semData = diasParado !== null ? doRecorte.filter((c) => c.na_coluna_desde === null).length : 0

  return json({
    fonte: 'Espelho do Kommo na plataforma (tela Análise de crédito), sincronizado a cada 15 minutos.',
    recorte: {
      funis: porFunil.map((f) => f.funil),
      fora_por_padrao:
        pedidos === null && args.incluir_todos_os_funis !== true
          ? 'Funil Geral (NOVOS) e funil de precatório antigo'
          : undefined,
      responsavel: args.responsavel ?? undefined,
      coluna: args.coluna ?? undefined,
      parados_ha_mais_de_dias: diasParado ?? undefined,
      criterio_parados:
        diasParado !== null
          ? 'Dias desde a entrada na coluna atual. Colunas de desfecho (Reprovados, Não fechado, Sem ' +
            'resposta, Pagamento finalizado, Ganho/Perdido) não contam como paradas, salvo se pedidas em `coluna`.'
          : undefined,
    },
    sincronizado_entre:
      sincronizados.length ? { mais_antigo: sincronizados[0], mais_recente: sincronizados[sincronizados.length - 1] } : null,
    total_de_cards: doRecorte.length,
    analise_pronta_significa:
      'Análise marcada como pronta na plataforma (aguardando revisão), e o card ainda na coluna em que foi marcado.',
    por_funil: porFunil,
    sem_data_da_coluna: semData || undefined,
    lista,
  })
}

// ---- listar_contratos ------------------------------------------------------

/**
 * O QUE SE LÊ DE `contratos.dados` — e só isto. O resto do jsonb é o que entrou
 * no contrato: CPF, RG, conta e Pix do cedente, do escritório e do investidor.
 * Mesma regra de `listar_investidores`: dado bancário e documento não saem do
 * sistema pelo assistente.
 */
const COLUNAS_DO_CONTRATO =
  'id, numero, tipo, investidor_nome, status, created_at, arquivo_url, drive_folder_url, job_id, ' +
  'cedente:dados->>CEDENTE_NOME, escritorio:dados->>ESCRITORIO_NOME, originador:dados->>ORIGINADOR, ' +
  'categoria:dados->>CATEGORIA, classe_do_ativo:dados->>CLASSE_ATIVO, ' +
  'valor_do_credito:dados->>VALOR_CREDITO_TOTAL, valor_da_cessao:dados->>VALOR_CESSAO, ' +
  'capital_investido:dados->>CAPITAL_INVESTIDO'

async function listarContratos(svc: ClienteDoBanco, args: Record<string, unknown>): Promise<string> {
  const desde = dataDoArgumento(args.desde)
  const ate = dataDoArgumento(args.ate)
  if (desde === false || ate === false) return json({ erro: 'Datas no formato AAAA-MM-DD.' })
  const digitos = soDigitos(args.numero_processo)

  /** Os mesmos filtros nas duas consultas — total e lista não podem discordar. */
  // deno-lint-ignore no-explicit-any
  const filtrar = (q: any) => {
    if (typeof args.investidor === 'string' && args.investidor.trim()) q = q.ilike('investidor_nome', `%${args.investidor.trim()}%`)
    if (typeof args.tipo === 'string' && args.tipo) q = q.eq('tipo', args.tipo)
    if (typeof args.status === 'string' && args.status) q = q.eq('status', args.status)
    if (digitos.length >= 6) q = q.ilike('numero', `%${digitos.slice(0, 7)}%`)
    if (desde) q = q.gte('created_at', inicioDoDiaEmBrasilia(desde))
    if (ate) q = q.lt('created_at', inicioDoDiaEmBrasilia(diaSeguinte(ate)))
    return q
  }

  const limite = limiteDaLista(args.limite)
  const [todos, lista] = await Promise.all([
    lerTudo((de, ate2) => filtrar(svc.from('contratos').select('id, tipo, status, job_id, numero')).order('id').range(de, ate2)),
    filtrar(svc.from('contratos').select(COLUNAS_DO_CONTRATO))
      .order('created_at', { ascending: false })
      .order('id')
      .limit(limite) as PromiseLike<PaginaDoBanco<Linha>>,
  ])
  if ('erro' in todos) return json({ erro: todos.erro })
  if (lista.error) return json({ erro: lista.error.message })

  // O número completo decide, como nos cards: o filtro do banco foi pelos 7 primeiros dígitos.
  const casa = (l: Linha) => digitos.length < 6 || soDigitos(l.numero).includes(digitos)
  const linhas = todos.linhas.filter(casa)
  const porTipo: Record<string, number> = {}
  const porStatus: Record<string, number> = {}
  for (const l of linhas) {
    const t = TIPOS_DE_CONTRATO[String(l.tipo)] ?? String(l.tipo)
    porTipo[t] = (porTipo[t] ?? 0) + 1
    porStatus[String(l.status)] = (porStatus[String(l.status)] ?? 0) + 1
  }
  const contratos = ((lista.data ?? []) as Linha[]).filter(casa)
  return json({
    fonte: 'Tela Geração de contratos (uma linha por documento gerado; uma geração produz vários tipos).',
    recorte: {
      investidor: args.investidor ?? undefined,
      numero_processo: args.numero_processo ?? undefined,
      tipo: args.tipo ?? undefined,
      status: args.status ?? undefined,
      desde: desde ?? undefined,
      ate: ate ?? undefined,
    },
    total: linhas.length,
    geracoes: new Set(linhas.map((l) => String(l.job_id ?? l.id))).size,
    por_tipo: porTipo,
    por_status: porStatus,
    quantidade_retornada: contratos.length,
    aviso_limite:
      linhas.length > contratos.length
        ? `A lista traz os ${contratos.length} mais recentes de ${linhas.length}; os totais acima são de todos.`
        : undefined,
    valores:
      'Os valores vêm como foram escritos no contrato (texto "R$ ..."): valor_do_credito = total do ' +
      'crédito; valor_da_cessao = o que vai ao cedente; capital_investido = o que o investidor paga.',
    contratos: contratos.map((c) => ({
      numero_processo: c.numero,
      tipo: TIPOS_DE_CONTRATO[String(c.tipo)] ?? c.tipo,
      investidor: c.investidor_nome,
      status: c.status,
      gerado_em: c.created_at,
      cedente: c.cedente ?? c.escritorio ?? null,
      originador: c.originador ?? undefined,
      categoria: c.categoria ?? undefined,
      classe_do_ativo: c.classe_do_ativo ?? undefined,
      valor_do_credito: c.valor_do_credito ?? undefined,
      valor_da_cessao: c.valor_da_cessao ?? undefined,
      capital_investido: c.capital_investido ?? undefined,
      arquivo: c.arquivo_url ?? null,
      pasta_no_drive: c.drive_folder_url ?? null,
    })),
  })
}

// ---- situacao_due_diligence ------------------------------------------------

async function situacaoDueDiligence(svc: ClienteDoBanco, args: Record<string, unknown>, agora: Date): Promise<string> {
  const busca = String(args.busca ?? '').trim()
  const id = idDoArgumento(args.kommo_lead_id)
  if (!busca && id === null) return json({ erro: 'Informe o processo, o nome do cedente ou o kommo_lead_id.' })

  const etapas = await lerEtapas(svc)
  if ('erro' in etapas) return json({ erro: `Colunas do Kommo: ${etapas.erro}` })

  // POR NÚMERO, OS CARDS; POR NOME, O CEDENTE CADASTRADO NA DILIGÊNCIA e também o
  // título do card — o nome que a equipe digita pode estar num e não no outro.
  let cards: Linha[]
  if (id !== null || soDigitos(busca).length >= 6) {
    const r = await acharCards(svc, busca, id)
    if ('erro' in r) return json({ erro: r.erro })
    cards = r.cards
  } else {
    if (busca.length < 3) return json({ erro: 'Informe ao menos 3 letras do nome.' })
    const [sujeitos, porTitulo] = await Promise.all([
      svc.from('dd_sujeito').select('kommo_lead_id').eq('papel', 'CEDENTE').ilike('nome', `%${busca}%`).limit(20),
      acharCards(svc, busca, null),
    ])
    if (sujeitos.error) return json({ erro: sujeitos.error.message })
    if ('erro' in porTitulo) return json({ erro: porTitulo.erro })
    const ids = new Set<number>(porTitulo.cards.map((c) => Number(c.kommo_lead_id)))
    const soNaDiligencia = ((sujeitos.data ?? []) as Linha[])
      .map((s) => Number(s.kommo_lead_id))
      .filter((i) => !ids.has(i))
    cards = [...porTitulo.cards]
    if (soNaDiligencia.length) {
      const { data, error } = await svc.from('kommo_leads').select(COLUNAS_LEVES_DO_CARD).in('kommo_lead_id', soNaDiligencia)
      if (error) return json({ erro: error.message })
      const noEspelho = new Set(((data ?? []) as Linha[]).map((c) => Number(c.kommo_lead_id)))
      cards.push(...((data ?? []) as Linha[]))
      // A diligência sobrevive ao card: o card pode ter saído do espelho.
      for (const i of soNaDiligencia) if (!noEspelho.has(i)) cards.push({ kommo_lead_id: i, nome: '(card fora do espelho do Kommo)' })
    }
  }
  if (cards.length === 0) {
    return json({ encontrado: false, aviso: `Nenhum card ou due diligence encontrado para "${busca || id}".` })
  }
  if (cards.length > 1) {
    return json({
      encontrado: false,
      aviso:
        'Mais de um card casou (pode ser principal e honorários do mesmo processo). Mostre os ' +
        'candidatos e pergunte qual; depois chame de novo com `kommo_lead_id`.',
      candidatos: candidatos(cards, etapas.linhas),
    })
  }

  const card = cards[0]
  const leadId = Number(card.kommo_lead_id)
  const hoje = hojeEmBrasilia(agora)
  const [completude, certidoes, historico, processosDeRisco, etapaDocumental, pedidos] = await Promise.all([
    secao(svc.from('v_dd_completude').select('*').eq('kommo_lead_id', leadId).maybeSingle()),
    lerTudo((de, ate) =>
      svc
        .from('dd_certidao')
        .select('id, status, obrigatoria, validade_ate, emitida_em, resultado, certidao_catalogo(nome_curto), dd_sujeito(papel)')
        .eq('kommo_lead_id', leadId)
        .order('id')
        .range(de, ate),
    ),
    secao(
      svc
        .from('dd_historico')
        .select('id, papel, nome, status, apurado_em, liberado_em, reprovado_em, reprovado_motivo, observacao')
        .eq('kommo_lead_id', leadId)
        .order('papel')
        .limit(50),
    ),
    secao(
      svc
        .from('dd_processo')
        .select('historico_id, numero_processo, tribunal, objeto, polo, risco, risco_motivo, valor_cobrado, estagio, data_ultima_movimentacao')
        .eq('kommo_lead_id', leadId)
        .in('risco', ['ATENCAO', 'ALTO'])
        .order('risco')
        .limit(50),
    ),
    secao(svc.from('dd_etapa_documental').select('concluida_em').eq('kommo_lead_id', leadId).maybeSingle()),
    secao(
      svc
        .from('bullai_pedido')
        .select('job_id, status, criado_em, atualizado_em')
        .eq('kommo_lead_id', leadId)
        .eq('is_final', false)
        .order('criado_em', { ascending: false })
        .limit(20),
    ),
  ])

  const avisos: string[] = []
  const anota = (rotulo: string, s: { erro?: string }) => {
    if (s.erro) avisos.push(`${rotulo}: não consegui ler (${s.erro}).`)
  }
  anota('Resumo das certidões', completude)
  if ('erro' in certidoes) avisos.push(`Certidões: não consegui ler (${certidoes.erro}).`)
  anota('Histórico dos titulares', historico)
  anota('Processos de risco', processosDeRisco)
  anota('Etapa documental', etapaDocumental)
  anota('Pedidos à BullAI', pedidos)

  const nomeDaCertidao = (c: Linha) => {
    const nome = (c.certidao_catalogo as { nome_curto?: string } | null)?.nome_curto ?? 'certidão'
    const papel = (c.dd_sujeito as { papel?: string } | null)?.papel
    return papel && papel !== 'CEDENTE' ? `${nome} (${papel.toLowerCase()})` : nome
  }
  const listaCertidoes = 'erro' in certidoes ? [] : certidoes.linhas
  const pendentes = listaCertidoes.filter(
    (c) => c.obrigatoria === true && ['PENDENTE', 'EM_EMISSAO', 'PENDENTE_MANUAL', 'FALHA'].includes(String(c.status)),
  )
  // VENCIDA PELO DIA DE BRASÍLIA, o mesmo `current_date` da view (o banco roda em UTC,
  // então de noite os dois podem discordar por um dia — a view manda no resumo).
  const vencidas = listaCertidoes.filter(
    (c) => c.obrigatoria === true && c.status === 'OBTIDA' && c.validade_ate && String(c.validade_ate) < hoje,
  )
  const positivas = listaCertidoes.filter((c) => normalizarTexto(c.resultado) === 'positiva')

  const titulares = (historico.data ?? []) as Linha[]
  const papelDoHistorico = new Map(titulares.map((h) => [String(h.id), String(h.papel)]))
  const { funil, coluna } = etapaDoCard(etapas.linhas, card.pipeline_id, card.status_id)
  const dd = completude.data as Linha | null

  return json({
    encontrado: true,
    card: { kommo_lead_id: leadId, titulo: card.nome, funil, coluna },
    certidoes: {
      resumo: dd
        ? {
            necessarias: dd.necessarias,
            obtidas_validas: dd.obtidas_validas,
            pendentes: dd.pendentes,
            vencidas: dd.vencidas,
            dispensadas: dd.dispensadas,
          }
        : 'Nenhum titular cadastrado ainda: o checklist de certidões não foi gerado.',
      pendentes: pendentes.map((c) => ({ certidao: nomeDaCertidao(c), status: c.status })),
      vencidas: vencidas.map((c) => ({ certidao: nomeDaCertidao(c), venceu_em: c.validade_ate })),
      positivas: positivas.map((c) => ({ certidao: nomeDaCertidao(c), emitida_em: c.emitida_em ?? null })),
      leitura_das_positivas:
        positivas.length
          ? 'Certidão positiva não é reprovação por si: o que pesa são os processos de risco abaixo.'
          : undefined,
    },
    etapa_documental: etapaDocumental.data
      ? { concluida_em: (etapaDocumental.data as Linha).concluida_em }
      : { concluida: false },
    pedidos_bullai_em_andamento: ((pedidos.data ?? []) as Linha[]).map((p) => ({
      status: p.status,
      pedido_em: p.criado_em,
      atualizado_em: p.atualizado_em,
    })),
    apuracao_dos_titulares: titulares.map((h) => ({
      papel: h.papel,
      nome: h.nome,
      status: h.status,
      apurado_em: h.apurado_em ?? null,
      decisao: h.reprovado_em
        ? `reprovado em ${h.reprovado_em}`
        : h.liberado_em
          ? `liberado em ${h.liberado_em}`
          : h.status === 'APURADO'
            ? 'apurado, sem decisão registrada'
            : undefined,
      motivo_da_reprovacao: h.reprovado_motivo ?? undefined,
      observacao: cortar(h.observacao, 300) ?? undefined,
    })),
    processos_de_risco: ((processosDeRisco.data ?? []) as Linha[]).map((p) => ({
      titular: papelDoHistorico.get(String(p.historico_id)) ?? null,
      numero_processo: p.numero_processo,
      tribunal: p.tribunal,
      objeto: p.objeto,
      polo: p.polo,
      risco: p.risco,
      motivo: cortar(p.risco_motivo, 300),
      valor_cobrado: p.valor_cobrado ?? undefined,
      estagio: p.estagio ?? undefined,
      ultima_movimentacao: p.data_ultima_movimentacao ?? undefined,
    })),
    avisos: avisos.length ? avisos : undefined,
  })
}
