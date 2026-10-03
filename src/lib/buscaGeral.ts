// A busca geral do topo (Ctrl+K, item "Novo" da amostra): acha crédito, card,
// contato ou tela de qualquer lugar da plataforma.
//
// DESEMPENHO (PLANO §4). A busca NUNCA baixa uma lista inteira:
// - só consulta o banco com a janela aberta e a partir de 3 letras, depois de
//   uma pausa na digitação (`ESPERA_MS`);
// - cada fonte é uma consulta com `ilike` (ou expressão regular, para número)
//   NO SERVIDOR, com LIMITE e poucas colunas;
// - as telas são do próprio menu, filtradas aqui, sem rede.
//
// ESTE MÓDULO É PURO: monta os filtros das consultas e junta/ordena os
// resultados. Quem consulta e desenha é `components/layout/BuscaGeral.tsx`.

import { normalizarBusca, onlyDigits } from './format'
import { camposDoTitulo, nomeDaColuna } from './quadroDaAnalise'
import {
  ABAS_DO_QUADRO,
  NAVIGATION,
  NAV_CONFIG,
  type NavSection,
  type NavLeaf,
} from '@/components/layout/navigation'

/** A partir de quantas letras o banco é consultado. */
export const MIN_LETRAS = 3
/** A pausa na digitação antes de consultar (ms). */
export const ESPERA_MS = 300
/** Quantas linhas cada fonte traz, no máximo. */
export const LIMITE_POR_FONTE = 5
/** Quantos resultados a lista mostra, no máximo. */
export const LIMITE_TOTAL = 12
/** Sem nada digitado, quantas telas a lista sugere. */
export const TELAS_SEM_BUSCA = 8

/** O termo digitado, já preparado para as consultas. */
export interface TermoDaBusca {
  /** Sem os caracteres que quebram o filtro do PostgREST nem os curingas. */
  texto: string
  digitos: string
  /** Só número (e pontuação de número): procura pelos dígitos, em qualquer formatação. */
  porNumero: boolean
  /** Já dá para consultar o banco (3 letras ou mais). */
  consulta: boolean
}

/**
 * Prepara o termo.
 *
 * TIRA O QUE QUEBRA O FILTRO: no `or()` do PostgREST, vírgula e parênteses
 * separam condições; `%`, `_` e `*` são curingas do `ilike`; aspas e barra
 * invertida escapam valor. Um nome com vírgula ("Silva, João") viraria duas
 * condições — ou um erro na tela —, e um `%` digitado traria a tabela inteira.
 */
export function lerTermo(digitado: string): TermoDaBusca {
  const texto = digitado
    .replace(/[,()%_*\\"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const digitos = onlyDigits(texto)
  const porNumero = digitos.length >= 4 && /^[\d\s.\-/]+$/.test(texto)
  return { texto, digitos, porNumero, consulta: texto.length >= MIN_LETRAS }
}

/** O padrão do `ilike`: o texto em qualquer lugar; espaço vale qualquer trecho. */
export function padraoDoTexto(texto: string): string {
  return `%${texto.split(' ').filter(Boolean).join('%')}%`
}

/**
 * Os dígitos em qualquer formatação: entre um dígito e o seguinte, qualquer coisa
 * que não seja dígito. "00012345620" acha "0001234-56.20…", e o número
 * formatado acha o gravado cru.
 */
export function padraoDosDigitos(digitos: string): string {
  return digitos.split('').join('[^0-9]*')
}

/** Uma condição do `or()`, com o valor entre aspas (ponto e dois-pontos não quebram). */
const cond = (coluna: string, op: 'ilike' | 'imatch', valor: string) => `${coluna}.${op}."${valor}"`

function filtroOr(termo: TermoDaBusca, porTexto: readonly string[], porNumero: readonly string[]): string {
  if (termo.porNumero) {
    const re = padraoDosDigitos(termo.digitos)
    return porNumero.map((c) => cond(c, 'imatch', re)).join(',')
  }
  const p = padraoDoTexto(termo.texto)
  return porTexto.map((c) => cond(c, 'ilike', p)).join(',')
}

/** Créditos (`processos`): pelo número (judicial ou administrativo) ou pelas partes. */
export function filtroDosCreditos(termo: TermoDaBusca): string {
  return filtroOr(
    termo,
    ['cedente', 'cessionario', 'entidade_devedora', 'numero_cnj'],
    ['numero_cnj', 'numero_processo_administrativo'],
  )
}

/** Cards da Análise (`kommo_leads`): pelo título do card ou pelo número do processo. */
export function filtroDosCards(termo: TermoDaBusca): string {
  return filtroOr(termo, ['nome'], ['processo_cnj', 'nome'])
}

/** Contatos (`contatos_serventias`): pelo órgão, tribunal e e-mails; número pelos telefones. */
export function filtroDosContatos(termo: TermoDaBusca): string {
  return filtroOr(
    termo,
    ['orgao', 'tribunal', 'serventia_email', 'gabinete_email'],
    ['serventia_telefone', 'serventia_whatsapp', 'gabinete_telefone', 'gabinete_whatsapp'],
  )
}

// ---------------------------------------------------------------- resultados

export type TipoDoResultado = 'tela' | 'card' | 'credito' | 'contato'

export interface ResultadoDaBusca {
  /** Único na lista (tipo + id): é a chave e o id da opção. */
  chave: string
  tipo: TipoDoResultado
  titulo: string
  sub: string
  /** O selo à direita: onde a coisa está. */
  onde: string
  /** Para tela: o endereço. Para os outros: o id do registro. */
  alvo: string
}

/** Uma tela que a busca pode achar. */
export interface TelaBuscavel {
  titulo: string
  sub: string
  to: string
}

/**
 * As telas do menu, com as abas do Quadro. Configurações SÓ PARA ADMINISTRADOR,
 * como no menu: oferecer a quem não pode abrir só levaria de volta ao início.
 */
export function telasBuscaveis(
  isAdmin: boolean,
  secoes: readonly NavSection[] = NAVIGATION,
  config: NavLeaf = NAV_CONFIG,
): TelaBuscavel[] {
  const telas: TelaBuscavel[] = []
  for (const s of secoes) {
    for (const item of s.items) {
      if (item.abas) {
        for (const aba of item.abas) {
          telas.push({
            titulo: aba === ABAS_DO_QUADRO[0] ? item.label : aba.label,
            sub: [s.title, item.label].filter(Boolean).join(' › '),
            to: aba.to,
          })
        }
      } else {
        telas.push({ titulo: item.label, sub: s.title ?? '', to: item.to })
      }
    }
  }
  if (isAdmin) telas.push({ titulo: config.label, sub: '', to: config.to })
  return telas
}

/** Linhas que as consultas devolvem (só as colunas pedidas). */
export interface CreditoAchado {
  id: string
  numero_cnj: string | null
  cedente: string | null
  entidade_devedora: string | null
}
export interface CardAchado {
  kommo_lead_id: number
  pipeline_id: number
  status_id: number
  nome: string | null
  processo_cnj: string | null
}
export interface ContatoAchado {
  id: string
  orgao: string | null
  tribunal: string | null
}

/** Os nomes das colunas do Kommo e dos funis, para dizer onde o card está. */
export interface OndeEstaOCard {
  funil: (pipelineId: number) => string
  coluna: (pipelineId: number, statusId: number) => string | null
}

/** Relevância: começa com o termo > contém o termo > casou por outro campo. */
function relevancia(titulo: string, q: string): number {
  const t = normalizarBusca(titulo)
  if (!q) return 0
  if (t.startsWith(q)) return 2
  return t.includes(q) ? 1 : 0
}

function ordenar<T>(itens: readonly T[], titulo: (x: T) => string, q: string): T[] {
  // ESTÁVEL: entre iguais, fica a ordem em que o banco devolveu.
  return itens
    .map((x, i) => ({ x, i, r: relevancia(titulo(x), q) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((o) => o.x)
}

/**
 * Junta e ordena os resultados.
 *
 * A ORDEM DOS GRUPOS é a da amostra: telas primeiro (ir para um lugar é o uso
 * mais comum), depois cards, créditos e contatos. Dentro de cada grupo, o que
 * COMEÇA com o termo vem antes do que só o contém.
 *
 * Telas casam desde a primeira letra (sem rede); sem nada digitado, a lista
 * sugere as primeiras telas do menu.
 */
export function montarResultados(entrada: {
  digitado: string
  telas: readonly TelaBuscavel[]
  creditos?: readonly CreditoAchado[]
  cards?: readonly CardAchado[]
  contatos?: readonly ContatoAchado[]
  onde?: OndeEstaOCard
}): ResultadoDaBusca[] {
  const q = normalizarBusca(entrada.digitado)
  const telasQueCasam = q
    ? ordenar(
        entrada.telas.filter((t) => normalizarBusca(`${t.titulo} ${t.sub}`).includes(q)),
        (t) => t.titulo,
        q,
      ).slice(0, LIMITE_POR_FONTE)
    : entrada.telas.slice(0, TELAS_SEM_BUSCA)

  const telas: ResultadoDaBusca[] = telasQueCasam.map((t) => ({
    chave: `tela:${t.to}`,
    tipo: 'tela',
    titulo: t.titulo,
    sub: t.sub,
    onde: 'Tela',
    alvo: t.to,
  }))

  const cards: ResultadoDaBusca[] = ordenar(
    (entrada.cards ?? []).map((c) => {
      const campos = camposDoTitulo(c.nome)
      const funil = entrada.onde?.funil(c.pipeline_id) ?? ''
      const coluna = entrada.onde?.coluna(c.pipeline_id, c.status_id)
      return {
        chave: `card:${c.kommo_lead_id}`,
        tipo: 'card' as const,
        titulo: campos?.cedente ?? c.nome?.trim() ?? `Card ${c.kommo_lead_id}`,
        sub: [funil, campos?.numero ?? c.processo_cnj, campos?.intermediador].filter(Boolean).join(' · '),
        onde: coluna ? nomeDaColuna(coluna) : 'Análise de crédito',
        alvo: String(c.kommo_lead_id),
      }
    }),
    (r) => r.titulo,
    q,
  )

  const creditos: ResultadoDaBusca[] = ordenar(
    (entrada.creditos ?? []).map((c) => ({
      chave: `credito:${c.id}`,
      tipo: 'credito' as const,
      titulo: c.numero_cnj?.trim() || c.cedente?.trim() || 'Crédito sem número',
      sub: [c.cedente, c.entidade_devedora].filter(Boolean).join(' · '),
      onde: 'Créditos',
      alvo: c.id,
    })),
    // O TÍTULO É O NÚMERO, mas quem procura pelo nome procura o cedente.
    (r) => `${r.sub} ${r.titulo}`,
    q,
  )

  const contatos: ResultadoDaBusca[] = ordenar(
    (entrada.contatos ?? []).map((c) => ({
      chave: `contato:${c.id}`,
      tipo: 'contato' as const,
      titulo: c.orgao?.trim() || 'Contato sem órgão',
      sub: c.tribunal?.trim() ?? '',
      onde: 'Contatos',
      alvo: c.id,
    })),
    (r) => r.titulo,
    q,
  )

  return [...telas, ...cards, ...creditos, ...contatos].slice(0, LIMITE_TOTAL)
}

// ---------------------------------------------------------------- ao escolher

/**
 * O pedido que a busca deixa no `state` da navegação, para a tela de destino
 * levar a pessoa ao registro: abrir a ficha do crédito, ou filtrar os contatos
 * pelo órgão. No `state`, e não no endereço: não vira link salvo nem favorito,
 * e some ao recarregar.
 */
export interface PedidoDaBusca {
  abrirCredito?: string
  filtrarContatos?: string
}

/** Lê o pedido do `state` da navegação (qualquer outra coisa ali é ignorada). */
export function lerPedidoDaBusca(state: unknown): PedidoDaBusca {
  if (!state || typeof state !== 'object') return {}
  const s = state as Record<string, unknown>
  const pedido: PedidoDaBusca = {}
  if (typeof s.abrirCredito === 'string' && s.abrirCredito) pedido.abrirCredito = s.abrirCredito
  if (typeof s.filtrarContatos === 'string' && s.filtrarContatos) pedido.filtrarContatos = s.filtrarContatos
  return pedido
}
