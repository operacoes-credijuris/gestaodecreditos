// A RESERVA DOS ITENS ANTES DE PEDIR À BULLAI (revisão de 03/10/2026).
//
// O DEFEITO. A ação 'pedir' da `bullai-certidoes` chamava a BullAI primeiro e só
// depois marcava os itens como EM_EMISSAO. Duas abas — ou um clique duplo —
// liam os mesmos itens como pedíveis e pagavam as mesmas consultas duas vezes.
// E os erros do insert em `bullai_pedido` e do update em `dd_certidao` eram
// ignorados: um pedido pago podia ficar sem registro, e a atualização nunca
// mais o encontrava.
//
// A RESERVA, COM O QUE O BANCO JÁ TEM (sem migração). Antes de pedir, cada item
// passa a EM_EMISSAO por um UPDATE CONDICIONAL — `where status = <o que se
// leu>` — e com `bullai_job_id` marcado com um token de reserva. O Postgres faz
// o update linha a linha com trava: de duas abas, só uma vê a linha mudar, e só
// os itens que mudaram seguem para a BullAI. Confirmado o pedido, o token dá
// lugar ao id do job.
//
// O QUE PODE SOBRAR, e quem limpa:
//   - reserva sem pedido (a função morreu entre reservar e pedir): passados
//     RESERVA_VENCE_MIN minutos, a ação 'atualizar' devolve o item a FALHA, com
//     o motivo, e ele volta a ser pedível;
//   - pedido sem registro (o job saiu, o insert em `bullai_pedido` falhou): os
//     itens guardam o id do job e os portais, e a 'atualizar' reconstrói o
//     registro a partir deles.
//
// O QUE A RESERVA NÃO COBRE: os portais "extras" sem linha no checklist não têm
// onde ser reservados. Pedido só de extras continua sem trava; pedido com
// itens em que nenhum foi reservado é tratado como o clique repetido que é, e
// os extras dele também não saem.
//
// MÓDULO PURO — sem `npm:` e sem `Deno.` —, para o vitest o testar.

export const PREFIXO_RESERVA = 'reserva:'
export const RESERVA_VENCE_MIN = 15

/** Os estados de onde se pode pedir — a mesma régua de `pedivel` na tela. */
export const STATUS_PEDIVEIS = ['PENDENTE', 'FALHA', 'PENDENTE_MANUAL'] as const

export interface ItemDoChecklist {
  id: string
  status: string
  erro_classe?: string | null
  bullai_job_id?: string | null
  bullai_portais?: string[] | null
  sujeito_id?: string | null
  atualizado_em?: string | null
}

/**
 * O item pode ir à BullAI? Igual à tela (`EmissaoBullai.tsx`): pendente,
 * falha, ou pendente de ação manual que não seja presencial.
 */
export function itemPedivel(i: Pick<ItemDoChecklist, 'status' | 'erro_classe'>): boolean {
  if (i.status === 'PENDENTE' || i.status === 'FALHA') return true
  return i.status === 'PENDENTE_MANUAL' && i.erro_classe !== 'presencial'
}

export const ehReserva = (jobId: unknown): boolean =>
  typeof jobId === 'string' && jobId.startsWith(PREFIXO_RESERVA)

/**
 * O mapa portal → itens, só com os itens que esta chamada RESERVOU.
 *
 * Portal que tinha itens e ficou sem nenhum sai: os itens dele são de outra aba.
 * Portal que já vinha sem item (extra, ou item sem id) fica — não há o que
 * reservar nele.
 */
export function portaisDosReservados(
  portais: Record<string, string[]>,
  reservados: Set<string>,
): Record<string, string[]> {
  const saida: Record<string, string[]> = {}
  for (const [k, ids] of Object.entries(portais)) {
    if (ids.length === 0) {
      saida[k] = []
      continue
    }
    const meus = ids.filter((id) => reservados.has(id))
    if (meus.length > 0) saida[k] = meus
  }
  return saida
}

/**
 * Pedido repetido: vieram itens e nenhum foi reservado — outra aba (ou o clique
 * anterior) já os pediu. Nada sai, nem os extras.
 */
export function pedidoRepetido(itensPedidos: number, reservados: number): boolean {
  return itensPedidos > 0 && reservados === 0
}

/** Reserva que ficou para trás: EM_EMISSAO, ainda com o token, há tempo demais. */
export function reservaVencida(i: ItemDoChecklist, agora: number, minutos = RESERVA_VENCE_MIN): boolean {
  if (i.status !== 'EM_EMISSAO' || !ehReserva(i.bullai_job_id)) return false
  const t = Date.parse(String(i.atualizado_em ?? ''))
  return Number.isFinite(t) && agora - t > minutos * 60_000
}

/** Um pedido à BullAI sem linha em `bullai_pedido`, refeito a partir dos itens. */
export interface PedidoSemRegistro {
  jobId: string
  sujeitoId: string | null
  portais: Record<string, string[]>
}

/**
 * Os pedidos que os itens conhecem e `bullai_pedido` não: itens EM_EMISSAO com
 * um id de job de verdade (não token de reserva) que não está entre os
 * registrados. O mapa portal → itens sai do `bullai_portais` de cada item.
 */
export function pedidosSemRegistro(itens: ItemDoChecklist[], registrados: Set<string>): PedidoSemRegistro[] {
  const porJob = new Map<string, PedidoSemRegistro>()
  for (const i of itens) {
    const job = i.bullai_job_id
    if (i.status !== 'EM_EMISSAO' || !job || ehReserva(job) || registrados.has(job)) continue
    const p = porJob.get(job) ?? { jobId: job, sujeitoId: i.sujeito_id ?? null, portais: {} }
    for (const k of i.bullai_portais ?? []) {
      const lista = p.portais[k] ?? []
      if (!lista.includes(i.id)) lista.push(i.id)
      p.portais[k] = lista
    }
    porJob.set(job, p)
  }
  return [...porJob.values()]
}
