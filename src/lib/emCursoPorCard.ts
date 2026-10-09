// O QUE ESTÁ EM CURSO EM CADA CARD da Análise de crédito: a movimentação (com a
// nota que vem depois dela) e a etiqueta em gravação.
//
// POR CARD, E NÃO UMA VAGA SÓ PARA A PÁGINA. Era uma vaga só, e duas coisas
// davam errado quando a pessoa agia em dois cards seguidos — o que os botões
// sem janela (Escolher proposta, Fechado!, Mover para Em precificação, as
// etiquetas) deixam fazer:
//   - começar no card B apagava a trava do card A, que ainda estava no ar: os
//     botões de A voltavam a valer, e um segundo clique movia A DE NOVO —
//     movimento no Kommo não se desfaz e dispara as automações do funil;
//   - terminar no card A soltava a trava do card B, ainda no ar, pelo mesmo
//     caminho.
// Com um registro por card, terminar um não mexe no outro.

/** O que está em curso, por `kommo_lead_id`. */
export type PorCard<T> = Readonly<Record<number, T>>

/** Marca o card como ocupado com `valor` (o destino, a etiqueta). */
export function comecarNoCard<T>(m: PorCard<T>, leadId: number, valor: T): PorCard<T> {
  return { ...m, [leadId]: valor }
}

/** Solta o card — e só ele. Sem nada em curso nele, devolve o mesmo objeto. */
export function terminarNoCard<T>(m: PorCard<T>, leadId: number): PorCard<T> {
  if (!(leadId in m)) return m
  const resto: Record<number, T> = { ...m }
  delete resto[leadId]
  return resto
}

/**
 * Só as entradas dos cards com janela aberta — o resto sai.
 *
 * É o descarte do cache de anexos depois de uma sincronização: o PDF do card
 * pode ter sido trocado no Kommo, mas o card cuja janela está aberta (a due
 * diligence OU as certidões) não pode ver a janela esvaziar embaixo de si.
 */
export function soDosAbertos<T>(
  antes: PorCard<T>,
  abertos: readonly (number | null | undefined)[],
): Record<number, T> {
  const fica: Record<number, T> = {}
  for (const id of abertos) {
    if (id != null && antes[id] !== undefined) fica[id] = antes[id]
  }
  return fica
}

/**
 * A chave de "card já movido, falta a nota" — ver `moverComNota` na Análise.
 */
export const chaveDoMovimento = (leadId: number, statusId: number): string => `${leadId}:${statusId}`

/**
 * O card JÁ SE MOVEU nesta janela para OUTRA coluna e só falta a nota de lá?
 * Então mover de novo, para cá, é recusado — e a mensagem diz o que fazer.
 *
 * O caso real: a nota falha com o card já movido (para Reprovados, digamos), a
 * janela de análise continua aberta e oferece as outras saídas — e um clique
 * em "Exigir diligência" tirava o card de Reprovados, deixando duas
 * movimentações e a razão de nenhuma. A `kommo-mover` só confere a origem nos
 * destinos da Negociação, então quem segura é a tela.
 */
export function movimentoRecusado(
  jaMovidos: ReadonlySet<string>,
  leadId: number,
  statusId: number,
): string | null {
  const desta = chaveDoMovimento(leadId, statusId)
  const outra = [...jaMovidos].some((k) => k.startsWith(`${leadId}:`) && k !== desta)
  return outra
    ? 'Este card já foi movido nesta janela para outra coluna, e falta só a nota de lá. ' +
        'Confirme de novo naquela saída (só anota) ou feche a janela — mover agora deixaria duas movimentações.'
    : null
}

/**
 * O CARD SE MOVEU E A NOTA NÃO SUBIU — o erro que `moverComNota` lança nesse
 * caso, com a mensagem pronta para a tela.
 *
 * TIPO PRÓPRIO, e não "a chave ainda está em `jaMovidos`" (09/10/2026): quem
 * pergunta isso depois do erro pode já não achar a chave — a caixa do
 * "Fechado!" ou do "Escolher proposta" se desmonta quando o card sai da lista
 * (o movimento invalida o cache e o card muda de aba antes de a nota terminar),
 * e ao se desmontar ela esquece os movimentos do card. Pela chave, a falha da
 * nota passava sem aviso nenhum: a tela dizia "Card movido" e a nota nunca
 * chegava ao Kommo.
 */
export class NotaNaoSubiu extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'NotaNaoSubiu'
  }
}

/** O erro é o de "moveu, mas a nota não subiu"? */
export const ehNotaNaoSubiu = (e: unknown): e is NotaNaoSubiu => e instanceof NotaNaoSubiu

/**
 * ESQUECER OS MOVIMENTOS DE UM CARD só quando nada dele estiver no ar.
 *
 * A caixa que se fecha (ou se desmonta) pede para esquecer; se o card ainda
 * está travado — o movimento ou a nota correndo —, o pedido fica para quando a
 * operação acabar. Esquecer no meio apagaria a memória "já movido" entre o
 * movimento e a nota, e um novo pedido para o mesmo card moveria de novo.
 * Devolve se é para esquecer JÁ.
 */
export function esquecerAgoraOuDepois(
  travados: ReadonlySet<number>,
  adiados: Set<number>,
  leadId: number,
): boolean {
  if (travados.has(leadId)) {
    adiados.add(leadId)
    return false
  }
  adiados.delete(leadId)
  return true
}
