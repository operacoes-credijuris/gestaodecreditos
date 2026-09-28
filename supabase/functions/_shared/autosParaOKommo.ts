// OS AUTOS DO ESCAVADOR, ANEXADOS AO CARD DO KOMMO — as partes puras.
//
// O FLUXO. O card chega no Operacional (a primeira coluna de cada funil) e a
// rotina `escavador-autos-rotina` pede os autos ao Escavador pelo CNJ do card. O
// robô deles entra no tribunal com o certificado digital e leva horas; quando
// termina, cada PDF é baixado do Escavador e subido direto como ANEXO DO CARD no
// Kommo. Não fica cópia em lugar nenhum da plataforma: o card é o lugar dos
// documentos, e é de lá que o "Executar análise" já lê.
//
// ESTE ARQUIVO é o que se pode testar sem conta nenhuma: quais colunas contam
// como "chegou no Operacional", a ordem e o nome dos anexos, as fatias do envio
// ao drive do Kommo e o texto da nota.
//
// SEM `Deno.` E SEM `npm:`: o vitest alcança este módulo direto.

import { TRILHAS_PRECATORIO } from './trilhasDoPrecatorio.ts'

/** O funil de RPV e a coluna em que o Operacional o recebe (Análise Jurídica-Econômico). */
export const FUNIL_RPV = 13901939
export const ENTRADA_RPV = 107272803

/**
 * O FUNIL GERAL e a coluna NOVOS, onde o card nasce antes de ir para um funil
 * de trabalho (pedido de 28/09/2026: os autos já podem descer dali). O
 * kommo-sync espelha SÓ esta coluna do funil geral — o resto dele não é do
 * Operacional —, e é daqui que ele tira os dois valores.
 */
export const FUNIL_GERAL = 14439508
export const COLUNA_NOVOS = 'NOVOS'

/**
 * A coluna em que cada funil de Precatório chega ao Operacional: a PRIMEIRA aba
 * da trilha. Lida da definição das trilhas, e não copiada, para que mudar a
 * primeira aba lá mude a entrada aqui.
 */
export function colunasDeEntradaDoPrecatorio(): { pipelineId: number; coluna: string }[] {
  return TRILHAS_PRECATORIO.map((t) => ({ pipelineId: t.pipelineId, coluna: t.abas[0].colunaKommo }))
}

/** As colunas de entrada que se acham pelo NOME: a 1ª de cada trilha e a NOVOS do funil geral. */
export function colunasDeEntradaPorNome(): { pipelineId: number; coluna: string }[] {
  return [...colunasDeEntradaDoPrecatorio(), { pipelineId: FUNIL_GERAL, coluna: COLUNA_NOVOS }]
}

/** Os funis cujas colunas a rotina precisa achar no espelho. */
export const FUNIS_DE_ENTRADA_POR_NOME = [
  ...TRILHAS_PRECATORIO.map((t) => t.pipelineId),
  FUNIL_GERAL,
]

export const normal = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()

/**
 * Os pares (funil, coluna) de entrada, resolvidos contra o espelho das colunas
 * do Kommo (`kommo_etapa`). Coluna que não se acha no espelho fica de fora — e
 * volta sozinha quando o sync a trouxer.
 */
export function entradasDoOperacional(
  etapas: { pipeline_id: number; status_id: number; nome: string }[],
): { pipeline_id: number; status_id: number }[] {
  const fora = [{ pipeline_id: FUNIL_RPV, status_id: ENTRADA_RPV }]
  for (const e of colunasDeEntradaPorNome()) {
    const achada = etapas.find(
      (x) => Number(x.pipeline_id) === e.pipelineId && normal(String(x.nome)) === normal(e.coluna),
    )
    if (achada) fora.push({ pipeline_id: e.pipelineId, status_id: Number(achada.status_id) })
  }
  return fora
}

/** Um documento dos autos como a listagem do Escavador o descreve. */
export interface DocumentoDosAutos {
  chave: string
  titulo: string
  tipo: string | null
  data: string | null
  paginas: number
}

/**
 * A lista de `/autos`, no formato que gravamos.
 *
 * A DATA VEM ANINHADA (`data.date`, "2020-06-09 15:54:00"), e é ela que ordena
 * os anexos. Documento sem `key` não tem como ser baixado e sai.
 */
export function documentosDosAutos(corpo: unknown): DocumentoDosAutos[] {
  const itens = (corpo as { items?: unknown[] } | null)?.items
  if (!Array.isArray(itens)) return []
  const fora: DocumentoDosAutos[] = []
  for (const bruto of itens) {
    const i = (bruto ?? {}) as Record<string, unknown>
    const chave = String(i.key ?? '').trim()
    if (!chave) continue
    const d = i.data as { date?: unknown } | string | null | undefined
    const data = typeof d === 'string' ? d : typeof d?.date === 'string' ? d.date : null
    fora.push({
      chave,
      titulo: String(i.titulo ?? i.nome ?? i.descricao ?? '').trim() || 'Documento',
      tipo: typeof i.tipo === 'string' ? i.tipo : null,
      data: data ? data.replace(' ', 'T').slice(0, 19) : null,
      paginas: Number(i.quantidade_paginas) || 0,
    })
  }
  return fora
}

/**
 * Do mais antigo ao mais novo — a ordem em que os autos se leem. A petição
 * inicial fica em primeiro, e é o "Autos 001" do card.
 */
export function emOrdemDosAutos<T extends { data: string | null; chave: string }>(docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const da = a.data ?? '9999'
    const db = b.data ?? '9999'
    return da < db ? -1 : da > db ? 1 : a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0
  })
}

/**
 * O nome do anexo no card: "Autos 001 - 09-06-2020 - Petição Inicial.pdf".
 *
 * O NÚMERO NA FRENTE é o que mantém a ordem dos autos na lista de arquivos do
 * Kommo, que ordena por nome; a data vem em seguida porque "Certidão" se repete
 * trinta vezes num processo, e a data é o que distingue uma da outra.
 */
export function nomeDoAnexo(ordem: number, total: number, doc: { titulo: string; data: string | null }): string {
  const casas = Math.max(3, String(total).length)
  const n = String(ordem).padStart(casas, '0')
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(doc.data ?? '')
  const data = m ? ` - ${m[3]}-${m[2]}-${m[1]}` : ''
  // O título do Escavador repete o tipo ("Certidão - Certidão", "Decisão (Decisão)").
  let titulo = doc.titulo.replace(/\s+/g, ' ').trim()
  const rep = /^(.+?)\s*(?:-|\()\s*\1\)?$/i.exec(titulo)
  if (rep) titulo = rep[1]
  titulo = titulo.replace(/[\\/:*?"<>|]/g, '-').slice(0, 90)
  return `Autos ${n}${data} - ${titulo}.pdf`
}

/** As fatias do envio ao drive do Kommo: [início, fim) de cada parte. */
export function fatias(tamanho: number, maxParte: number): [number, number][] {
  const passo = Math.max(1, Math.floor(maxParte))
  const fora: [number, number][] = []
  for (let i = 0; i < tamanho; i += passo) fora.push([i, Math.min(tamanho, i + passo)])
  if (fora.length === 0) fora.push([0, 0])
  return fora
}

const dataBR = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** A nota do card quando os autos terminam de descer. */
export function notaDosAutos(o: {
  cnj: string
  anexados: number
  total: number
  paginas: number
  primeiro: string | null
  ultimo: string | null
  falhas: string[]
}): string {
  const periodo = o.primeiro && o.ultimo ? `, de ${dataBR(o.primeiro)} a ${dataBR(o.ultimo)}` : ''
  const linhas = [
    `📂 Autos do processo ${o.cnj} anexados a este card pelo Escavador: ${o.anexados} de ${o.total} documento(s)` +
      (o.paginas ? `, ${o.paginas.toLocaleString('pt-BR')} páginas` : '') +
      `${periodo}.`,
    'Os arquivos "Autos 001, 002…" seguem a ordem do processo, do mais antigo ao mais novo.',
  ]
  if (o.falhas.length) {
    linhas.push(`⚠️ ${o.falhas.length} documento(s) não desceram: ${o.falhas.slice(0, 5).join('; ')}${o.falhas.length > 5 ? '…' : ''}`)
  }
  return linhas.join('\n')
}

/** A nota do card quando o tribunal não entrega os autos. */
export function notaDeFalha(cnj: string, motivo: string): string {
  return `⚠️ Não consegui baixar os autos do processo ${cnj} pelo Escavador: ${motivo}. Anexe os autos à mão.`
}

/** O que o estado do pedido no Escavador quer dizer para quem lê o card. */
export function motivoDoEstado(status: string, motivo: string | null): string {
  const s = status.toUpperCase()
  if (s === 'NAO_ENCONTRADO') {
    return 'o robô não achou o processo no sistema do tribunal (pode ser físico, sigiloso ou arquivado)'
  }
  if (s === 'ERRO') return `o robô não conseguiu entrar no tribunal${motivo ? ` (${motivo})` : ''}`
  return `o pedido terminou como ${status}${motivo ? ` (${motivo})` : ''}`
}
