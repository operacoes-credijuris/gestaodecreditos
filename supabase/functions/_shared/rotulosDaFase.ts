// _shared/rotulosDaFase.ts
// OS NOMES DAS FASES PROCESSUAIS, DO LADO DO SERVIDOR (12/11/2026).
//
// O assistente passou a responder "quais estão em sequestro", "quantos
// conclusos" pela tabela `processos_fase` — a mesma da aba Fase processual —, e
// precisa dizer o NOME da fase, não o código: "ATV-03" não significa nada para
// quem pergunta. Os nomes moram em `src/lib/labels.ts` (FASE_PROCESSUAL), que a
// Edge Function não importa. Esta é a CÓPIA, e um teste
// (assistenteFerramentasDaOperacao.test.ts) confere que as duas continuam
// iguais: mudou o nome na tela, o teste quebra até mudar aqui.
//
// E AS CONTAS SÃO AS DA TELA (src/pages/operacional/execucao/FaseProcessual.tsx):
// a trilha é o `status` do crédito (ativo ou complementar), cada crédito da
// trilha conta na fase da sua linha em `processos_fase`, quem não tem linha é
// "sem classificação", e "concluso" é atributo (conclusao_pendente), contado à
// parte em cima de qualquer fase. Se o assistente contasse de outro jeito, a
// pessoa veria um número no chat e outro na aba — e não teria como saber qual vale.
//
// Sem `Deno.` e sem `npm:`: roda no vitest.

export interface RotuloDaFase {
  label: string
  tone: string
}

/** Cópia de FASE_PROCESSUAL (src/lib/labels.ts). Concluso NÃO é fase: é atributo. */
export const FASE_PROCESSUAL_ROTULOS: Record<string, RotuloDaFase> = {
  'ATV-01': { label: 'Aguardando Homologação', tone: 'blue' },
  'ATV-02': { label: 'Homologado / Aguardando Período de Graça', tone: 'blue' },
  'ATV-03': { label: 'Sequestro', tone: 'yellow' },
  'ATV-05': { label: 'Penhora Efetivada', tone: 'orange' },
  'ATV-06': { label: 'Alvará Expedido / Aguardando Pagamento', tone: 'green' },
  'ATV-08': { label: 'Outros', tone: 'gray' },
  'CMP-01': { label: 'RPV Complementar Peticionado', tone: 'blue' },
  'CMP-02': { label: 'Deferido', tone: 'blue' },
  'CMP-03': { label: 'Aguardando Cálculos', tone: 'blue' },
  'CMP-04': { label: 'Aguardando Expedição da RPV', tone: 'blue' },
  'CMP-05': { label: 'Aguardando Período de Graça', tone: 'blue' },
  'CMP-06': { label: 'Sequestro', tone: 'yellow' },
  'CMP-07': { label: 'Penhora', tone: 'yellow' },
  'CMP-08': { label: 'Alvará Expedido / Aguardando Pagamento', tone: 'green' },
  'CMP-10': { label: 'Outros', tone: 'gray' },
}

/** A ordem dos cards da trilha ativo na tela (cópia de FASE_ATIVO_ORDEM). */
export const FASE_ATIVO_ORDEM = ['ATV-01', 'ATV-02', 'ATV-03', 'ATV-05', 'ATV-06', 'ATV-08']

/** A ordem dos cards da trilha complementar na tela (cópia de FASE_COMPLEMENTAR_ORDEM). */
export const FASE_COMPLEMENTAR_ORDEM = [
  'CMP-01',
  'CMP-02',
  'CMP-03',
  'CMP-04',
  'CMP-05',
  'CMP-06',
  'CMP-07',
  'CMP-08',
  'CMP-10',
]

export type TrilhaDaFase = 'ativo' | 'complementar'

/** O nome da fase; código fora da taxonomia volta como está (mesma regra do getLabel da tela). */
export function rotuloDaFase(codigo: string | null | undefined): string {
  if (!codigo) return '—'
  return FASE_PROCESSUAL_ROTULOS[codigo]?.label ?? codigo
}

/** Minúsculas, sem acento e sem espaço sobrando — para comparar o que a pessoa escreveu. */
export function normalizarTexto(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Palavras que não distinguem fase nenhuma ("processos em fase de..."). */
const PALAVRAS_VAZIAS = new Set([
  'que', 'com', 'sem', 'dos', 'das', 'nos', 'nas', 'para', 'por', 'fase', 'fases',
  'processo', 'processos', 'credito', 'creditos', 'aguardando', 'estao', 'esta', 'em',
  // As do menu "Consultar processos por situação": "pedido de bloqueio", "alvará
  // expedido e ainda não cumprido", "sem decisão de homologação".
  'pedido', 'pedidos', 'ainda', 'nao', 'cumprido', 'cumpridos', 'decisao', 'quais', 'quantos',
])

/**
 * SINÔNIMOS DE QUEM PERGUNTA, levados ao nome da fase. "Bloqueio" é como a
 * equipe chama o sequestro de verba pública (o pedido de bloqueio via
 * SISBAJUD); "homologado" é a ATV-02, e não a ATV-01, que ainda AGUARDA.
 */
const SINONIMOS: [RegExp, string][] = [
  [/\bbloqueios?\b/g, 'sequestro'],
  [/\bhomologad[oa]s?\b/g, 'homologado'],
  [/\bhomologac(ao|oes)\b/g, 'homologacao'],
]

export type FasePedida =
  | { tipo: 'codigos'; codigos: string[]; interpretacao: string }
  | { tipo: 'conclusos'; interpretacao: string }
  | { tipo: 'desconhecida'; opcoes: string[] }

/**
 * O QUE A PESSOA QUIS DIZER COM A FASE: um código ("ATV-03", "cmp 06") ou um
 * nome ("sequestro", "alvará", "conclusos", "período de graça"). Devolve os
 * códigos — as duas trilhas têm Sequestro, Penhora, Alvará e Outros —, já
 * limitados à trilha quando ela veio. A `interpretacao` vai na resposta da
 * ferramenta, para o modelo dizer o recorte que usou.
 */
export function lerFasePedida(texto: unknown, trilha?: TrilhaDaFase | null): FasePedida {
  const prefixo = trilha === 'ativo' ? 'ATV-' : trilha === 'complementar' ? 'CMP-' : ''
  const daTrilha = (c: string) => !prefixo || c.startsWith(prefixo)
  const opcoes = Object.entries(FASE_PROCESSUAL_ROTULOS)
    .filter(([c]) => daTrilha(c))
    .map(([c, r]) => `${c} — ${r.label}`)

  let t = normalizarTexto(texto)
  if (!t) return { tipo: 'desconhecida', opcoes }

  const codigo = /^(atv|cmp)\s*-?\s*(\d{2})$/.exec(t)
  if (codigo) {
    const c = `${codigo[1].toUpperCase()}-${codigo[2]}`
    return { tipo: 'codigos', codigos: [c], interpretacao: `${c} — ${rotuloDaFase(c)}` }
  }
  if (/\bconclus/.test(t)) {
    return {
      tipo: 'conclusos',
      interpretacao:
        'Conclusos = créditos com conclusão pendente (o card "Conclusos" da aba), em qualquer fase.',
    }
  }

  for (const [re, troca] of SINONIMOS) t = t.replace(re, troca)
  const palavras = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PALAVRAS_VAZIAS.has(w))
  if (palavras.length === 0) return { tipo: 'desconhecida', opcoes }

  const codigos = Object.entries(FASE_PROCESSUAL_ROTULOS)
    .filter(([c]) => daTrilha(c))
    .filter(([, r]) => {
      const nome = normalizarTexto(r.label)
      // Plural da pergunta ("alvarás", "sequestros") contra o singular do nome.
      return palavras.every((w) => nome.includes(w) || (w.endsWith('s') && nome.includes(w.slice(0, -1))))
    })
    .map(([c]) => c)
  if (codigos.length === 0) return { tipo: 'desconhecida', opcoes }
  return {
    tipo: 'codigos',
    codigos,
    interpretacao: codigos.map((c) => `${c} — ${rotuloDaFase(c)}`).join('; '),
  }
}

/** O mínimo do crédito para a conta da tela. */
export interface CreditoDaFase {
  id: string
  status: string | null
}

/** O mínimo da linha de `processos_fase` para a conta da tela. */
export interface LinhaDaFase {
  processo_id: string
  fase_codigo: string
  conclusao_pendente: boolean | null
}

export interface ContagemDaTrilha {
  /** Créditos com esse status na carteira. */
  creditos: number
  /** Por código, NA ORDEM DOS CARDS da tela; só as fases da taxonomia. */
  por_fase: { codigo: string; fase: string; quantidade: number }[]
  /** Créditos da trilha sem linha em processos_fase (ainda não classificados). */
  sem_classificacao: number
  /** O card "Conclusos": conclusao_pendente, somado à fase de cada um. */
  conclusos: number
  /**
   * Linhas com código fora da taxonomia atual (um "ATV-04" antigo): a tela não
   * tem card para elas, então NÃO aparecem nos cards. Ficam aqui para a soma
   * fechar e ninguém sumir sem explicação.
   */
  fora_da_taxonomia: Record<string, number>
}

/**
 * A CONTAGEM DA ABA FASE PROCESSUAL, trilha a trilha — o mesmo laço do
 * `contagem` de FaseProcessual.tsx: só créditos com status ativo/complementar,
 * cada um na fase da sua linha, sem linha = sem classificação, e o concluso
 * contado à parte.
 */
export function contarComoATela(
  creditos: readonly CreditoDaFase[],
  fases: readonly LinhaDaFase[],
): Record<TrilhaDaFase, ContagemDaTrilha> {
  const faseDe = new Map(fases.map((f) => [f.processo_id, f]))
  const fora = {} as Record<TrilhaDaFase, ContagemDaTrilha>
  for (const trilha of ['ativo', 'complementar'] as const) {
    const ordem = trilha === 'ativo' ? FASE_ATIVO_ORDEM : FASE_COMPLEMENTAR_ORDEM
    const porCodigo: Record<string, number> = {}
    let total = 0
    let semClassificacao = 0
    let conclusos = 0
    for (const p of creditos) {
      if (p.status !== trilha) continue
      total++
      const r = faseDe.get(p.id)
      if (!r) {
        semClassificacao++
        continue
      }
      porCodigo[r.fase_codigo] = (porCodigo[r.fase_codigo] ?? 0) + 1
      if (r.conclusao_pendente) conclusos++
    }
    const foraDaTaxonomia: Record<string, number> = {}
    for (const [c, n] of Object.entries(porCodigo)) if (!ordem.includes(c)) foraDaTaxonomia[c] = n
    fora[trilha] = {
      creditos: total,
      por_fase: ordem.map((c) => ({ codigo: c, fase: rotuloDaFase(c), quantidade: porCodigo[c] ?? 0 })),
      sem_classificacao: semClassificacao,
      conclusos,
      fora_da_taxonomia: foraDaTaxonomia,
    }
  }
  return fora
}
