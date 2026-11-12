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
const COLUNAS_DO_SISTEMA: Record<number, string> = { 142: 'Ganho (fechado no Kommo)', 143: 'Perdido (fechado no Kommo)' }

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
      .filter((n) => String(n?.texto ?? '').trim())
      .map((n) => ({
        quando: (n.criado_em as string | null) ?? null,
        autor: (n.autor as string | null) ?? null,
        tipo: String(n.tipo ?? 'common'),
        // DA PLATAFORMA OU DA AUTOMAÇÃO (movimentação, etiqueta, análise), e não
        // do comercial — ver `automatica` no kommo-sync.
        do_sistema: n.automatica === true,
        texto: String(n.texto ?? ''),
      })),
  }
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
  // A ORDEM DAS COLUNAS DE CADA FUNIL, como no kanban: é o que dá sentido a
  // "chegou até a negociação" sem o histórico de movimentos.
  const funis: Record<string, string[]> = {}
  for (const e of [...etapas].sort((a, b) => a.pipeline_id - b.pipeline_id || (a.ordem ?? 0) - (b.ordem ?? 0))) {
    const f = e.pipeline_nome ?? String(e.pipeline_id)
    ;(funis[f] ??= []).push(e.nome)
  }
  return {
    gerado_em: agora.toISOString(),
    // A SINCRONIZAÇÃO MAIS ANTIGA do lote: o dado mais velho da base.
    sincronizado_desde: sincronizados[0] ?? null,
    total_de_cards: cards.length,
    colunas_por_funil: funis,
    cards,
  }
}
