// A API DA BULLAI — a plataforma que emite as certidões da due diligence.
//
// O QUE ELA FAZ, pela documentação (api.bullai.com.br/docs, lida em 28/09/2026):
//
//   GET  /due-diligence/v1/portals   o catálogo: cada item é uma certidão que ela
//                                    busca, com o tipo de documento que aceita
//                                    (CPF ou CNPJ) e se exige presença física
//   GET  /due-diligence/v1/credits   as consultas que restam no período
//   POST /due-diligence/v1/jobs      um pedido: um documento, vários portais
//   GET  /due-diligence/v1/jobs/{id} o andamento, portal a portal — até isFinal
//   GET  .../artifacts/{id}/download o PDF de uma certidão
//
// CADA PORTAL PEDIDO GASTA UMA CONSULTA do plano. Por isso nada aqui pede sozinho.
//
// A CHAVE VAI NO HEADER `x-api-key`, e o endereço base não está na
// documentação: foi confirmado batendo em /credits sem chave (401 "Header
// x-api-key em falta").

export const BASE_BULLAI = 'https://api.bullai.com.br/due-diligence/v1'

/** Um portal do catálogo — uma certidão que a BullAI sabe buscar. */
export interface PortalBullai {
  /**
   * A chave que se manda no pedido. É a `publicKey` da API, e não a `key`: a
   * documentação avisa que a `key` embute o fornecedor do sistema de cada
   * município, e muda quando o município troca de fornecedor — sem a certidão
   * mudar.
   */
  chave: string
  rotulo: string
  /** O que o portal considera uma certidão válida — texto da própria BullAI. */
  criterio: string
  documento: 'CPF' | 'CNPJ'
  /** Exige comparecimento: nunca volta certidão automaticamente. */
  presencial: boolean
}

export interface CreditosBullai {
  /** null quando o plano é ilimitado. */
  restantes: number | null
  limite: number | null
  usadas: number
  excedente: number
  fimDoPeriodo: string | null
}

export class ErroBullai extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

/** Traduz a resposta de erro no que a pessoa precisa saber para agir. */
function mensagemDoErro(status: number, corpo: string): string {
  let msg = corpo.slice(0, 200)
  try {
    const j = JSON.parse(corpo) as { message?: unknown }
    if (j?.message) msg = Array.isArray(j.message) ? j.message.join('; ') : String(j.message)
  } catch { /* corpo que não é JSON vai cru */ }
  if (status === 401) return 'A BullAI recusou a chave. Confira em Configurações › Chaves de API da BullAI — ela é mostrada uma única vez, na criação.'
  if (status === 402) return 'Sem consultas disponíveis no plano da BullAI.'
  if (status === 422) return `A BullAI recusou o pedido: ${msg}`
  if (status === 429) return 'A BullAI limitou as chamadas por excesso. Tente de novo em instantes.'
  return `A BullAI respondeu HTTP ${status}: ${msg}`
}

export async function pedirBullai<T>(chave: string, caminho: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_BULLAI}${caminho}`, {
    ...init,
    headers: {
      'x-api-key': chave,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const txt = await res.text()
  if (!res.ok) throw new ErroBullai(mensagemDoErro(res.status, txt), res.status)
  return (txt ? JSON.parse(txt) : null) as T
}

export async function creditosBullai(chave: string): Promise<CreditosBullai> {
  const c = await pedirBullai<{
    remaining: number | null
    limit: number | null
    used: number
    overage: number
    periodEnd?: string
  }>(chave, '/credits')
  return {
    restantes: c.remaining ?? null,
    limite: c.limit ?? null,
    usadas: Number(c.used ?? 0) || 0,
    excedente: Number(c.overage ?? 0) || 0,
    fimDoPeriodo: c.periodEnd ?? null,
  }
}

export async function portaisBullai(chave: string): Promise<PortalBullai[]> {
  const lista = await pedirBullai<
    { publicKey: string; label: string; acceptanceCriteria: string; documentType: 'CPF' | 'CNPJ'; inPerson: boolean }[]
  >(chave, '/portals')
  return (lista ?? []).map((p) => ({
    chave: p.publicKey,
    rotulo: p.label,
    criterio: p.acceptanceCriteria,
    documento: p.documentType,
    presencial: Boolean(p.inPerson),
  }))
}
