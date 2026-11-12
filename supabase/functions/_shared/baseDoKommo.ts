// A BASE DO KOMMO PARA O ASSISTENTE (12/11/2026, pedido do dono): a chefia pede
// relatórios sobre a análise de crédito — quantos reprovados e por quê, quantos
// chegam à negociação e não fecham, quantos são pagos e por quanto. A fonte é o
// ESPELHO que a plataforma já guarda (kommo_leads, sincronizado a cada 15 min),
// e não a API do Kommo a cada pergunta: ler milhares de cards e notas a 7
// pedidos por segundo não cabe no tempo de uma função, e traria o mesmo dado.
//
// UM ARQUIVO SÓ, UM CARD POR ITEM, com nomes que se leem sem dicionário: o
// assistente o recebe no container de execução de código e faz as contas em
// Python — contagem, percentual e gráfico não podem sair de cabeça.
//
// Sem `Deno.` e sem `npm:`: testável no vitest.

import { semEntidadesHtml } from './textoDoKommo.ts'

/** Uma linha do espelho, como a função a lê (só as colunas usadas aqui). */
export interface LinhaDoEspelho {
  kommo_lead_id: number
  pipeline_id: number
  status_id: number
  nome: string | null
  responsavel_nome: string | null
  processo_cnj: string | null
  tags: string[] | null
  tags_em: Record<string, string | null> | null
  criado_em: string | null
  atualizado_em: string | null
  etapa_em?: string | null
  sincronizado_em?: string | null
  raw: Record<string, unknown> | null
  notas: unknown
}

/** Uma coluna do Kommo (kommo_etapa). */
export interface EtapaDoEspelho {
  pipeline_id: number
  status_id: number
  pipeline_nome: string | null
  nome: string
  /** A ordem da coluna no kanban (o `sort` do Kommo). */
  ordem?: number | null
}

/** As colunas que o Kommo tem em todo funil: 142 = ganho, 143 = perdido. */
export const COLUNAS_DO_SISTEMA: Record<number, string> = { 142: 'Ganho (fechado no Kommo)', 143: 'Perdido (fechado no Kommo)' }

/**
 * O TEXTO DE UMA NOTA VAI ATÉ 1.500 CARACTERES (12/11/2026). A base inteira é
 * montada na memória da função e sobe num arquivo só; nota de movimentação ou
 * e-mail colado chega a dezenas de milhares de caracteres, e o motivo de uma
 * reprovação — o que os relatórios procuram — está no começo. A nota cortada
 * vem marcada (`texto_cortado`), para o relatório não tratá-la como inteira.
 */
export const TETO_DO_TEXTO_DA_NOTA = 1500

/**
 * NOTA DE ANEXO FICA DE FORA (12/11/2026): o texto dela é o nome do arquivo, que
 * não diz motivo nenhum e só pesava na base.
 */
export const TIPOS_DE_NOTA_FORA_DA_BASE: ReadonlySet<string> = new Set(['attachment'])

const iso = (segundos: unknown): string | null => {
  const n = Number(segundos)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null
}

/** Os campos personalizados do card, como { nome do campo: valor(es) }. */
export function camposDoCard(raw: Record<string, unknown> | null): Record<string, string> {
  const fora: Record<string, string> = {}
  const valores = (raw?.custom_fields_values ?? []) as {
    field_name?: unknown
    values?: { value?: unknown }[] | null
  }[]
  if (!Array.isArray(valores)) return fora
  for (const c of valores) {
    const nome = semEntidadesHtml(c?.field_name).trim()
    if (!nome) continue
    const v = (c?.values ?? [])
      .map((x) => semEntidadesHtml(x?.value).trim())
      .filter(Boolean)
      .join('; ')
    if (v) fora[nome] = v
  }
  return fora
}

/** O card, no formato da base. */
export function cardDaBase(l: LinhaDoEspelho, etapas: ReadonlyMap<string, EtapaDoEspelho>) {
  const etapa = etapas.get(`${l.pipeline_id}:${l.status_id}`)
  const qualquerDoFunil = [...etapas.values()].find((e) => e.pipeline_id === l.pipeline_id)
  const raw = l.raw ?? {}
  const notas = (Array.isArray(l.notas) ? l.notas : []) as {
    texto?: unknown
    criado_em?: unknown
    autor?: unknown
    tipo?: unknown
    automatica?: unknown
  }[]
  return {
    id: l.kommo_lead_id,
    titulo: l.nome ?? '',
    funil: etapa?.pipeline_nome ?? qualquerDoFunil?.pipeline_nome ?? String(l.pipeline_id),
    coluna: etapa?.nome ?? COLUNAS_DO_SISTEMA[l.status_id] ?? String(l.status_id),
    responsavel: l.responsavel_nome,
    processo_cnj: l.processo_cnj,
    criado_em: l.criado_em,
    atualizado_em: l.atualizado_em,
    na_coluna_desde: l.etapa_em ?? null,
    fechado_em: iso(raw.closed_at),
    // O "Venda" do card no Kommo (price), quando alguém o preenche.
    valor_do_card: Number.isFinite(Number(raw.price)) && Number(raw.price) > 0 ? Number(raw.price) : null,
    etiquetas: (l.tags ?? []).map((t) => ({ nome: semEntidadesHtml(t), desde: l.tags_em?.[t] ?? null })),
    campos: camposDoCard(raw),
    notas: notas
      .filter((n) => String(n?.texto ?? '').trim() && !TIPOS_DE_NOTA_FORA_DA_BASE.has(String(n?.tipo ?? '')))
      .map((n) => {
        const texto = String(n.texto ?? '')
        const cortado = texto.length > TETO_DO_TEXTO_DA_NOTA
        return {
          quando: (n.criado_em as string | null) ?? null,
          autor: (n.autor as string | null) ?? null,
          tipo: String(n.tipo ?? 'common'),
          // DA PLATAFORMA OU DA AUTOMAÇÃO (movimentação, etiqueta, análise), e não
          // do comercial — ver `automatica` no kommo-sync.
          do_sistema: n.automatica === true,
          texto: cortado ? `${texto.slice(0, TETO_DO_TEXTO_DA_NOTA)}…` : texto,
          ...(cortado ? { texto_cortado: true } : {}),
        }
      }),
  }
}

/** A ordem das colunas de cada funil, como no kanban. */
function colunasPorFunil(etapas: readonly EtapaDoEspelho[]): Record<string, string[]> {
  const funis: Record<string, string[]> = {}
  for (const e of [...etapas].sort((a, b) => a.pipeline_id - b.pipeline_id || (a.ordem ?? 0) - (b.ordem ?? 0))) {
    const f = e.pipeline_nome ?? String(e.pipeline_id)
    ;(funis[f] ??= []).push(e.nome)
  }
  return funis
}

/** A base inteira: o que é, de quando é, e os cards. */
export function montarBaseDoKommo(
  linhas: readonly LinhaDoEspelho[],
  etapas: readonly EtapaDoEspelho[],
  agora: Date,
) {
  const porChave = new Map(etapas.map((e) => [`${e.pipeline_id}:${e.status_id}`, e]))
  const sincronizados = linhas.map((l) => l.sincronizado_em).filter((s): s is string => !!s).sort()
  const cards = linhas.map((l) => cardDaBase(l, porChave))
  return {
    gerado_em: agora.toISOString(),
    // A SINCRONIZAÇÃO MAIS ANTIGA do lote: o dado mais velho da base.
    sincronizado_desde: sincronizados[0] ?? null,
    total_de_cards: cards.length,
    // A ORDEM DAS COLUNAS DE CADA FUNIL, como no kanban: é o que dá sentido a
    // "chegou até a negociação" sem o histórico de movimentos.
    colunas_por_funil: colunasPorFunil(etapas),
    cards,
  }
}

/**
 * A MESMA BASE, MONTADA PÁGINA A PÁGINA E JÁ EM TEXTO (12/11/2026). A função
 * guardava o espelho inteiro três vezes ao mesmo tempo — as linhas lidas, a
 * cópia com o `raw` remontado e os cards — antes de virar JSON, e com as notas
 * de milhares de cards isso pesava na memória e no tempo de uma invocação que
 * morre aos 150 s. Aqui cada página vira texto assim que chega, e as linhas
 * dela podem ser soltas; o JSON é feito uma vez só, card a card.
 *
 * O ARQUIVO É O MESMO de `montarBaseDoKommo` (mesmas chaves, na mesma ordem): o
 * texto de `pedacos().join('')` é o JSON daquela função — o teste confere.
 */
export function baseDoKommoEmPedacos(etapas: readonly EtapaDoEspelho[]) {
  const porChave = new Map(etapas.map((e) => [`${e.pipeline_id}:${e.status_id}`, e]))
  const cards: string[] = []
  let maisAntiga: string | null = null
  return {
    /** Converte uma página do espelho; as linhas não são guardadas. */
    adicionar(linhas: readonly LinhaDoEspelho[]) {
      for (const l of linhas) {
        if (l.sincronizado_em && (maisAntiga === null || l.sincronizado_em < maisAntiga)) {
          maisAntiga = l.sincronizado_em
        }
        cards.push(JSON.stringify(cardDaBase(l, porChave)))
      }
    },
    get total(): number {
      return cards.length
    },
    /** O arquivo, em pedaços prontos para um `Blob` (sem juntar numa string só). */
    pedacos(agora: Date): string[] {
      const cabecalho = JSON.stringify({
        gerado_em: agora.toISOString(),
        sincronizado_desde: maisAntiga,
        total_de_cards: cards.length,
        colunas_por_funil: colunasPorFunil(etapas),
      })
      const fora: string[] = [`${cabecalho.slice(0, -1)},"cards":[`]
      cards.forEach((c, i) => fora.push(i === 0 ? c : `,${c}`))
      fora.push(']}')
      return fora
    },
  }
}
