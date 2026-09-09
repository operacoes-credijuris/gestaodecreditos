// _shared/desfecho.ts
// COMO A ANOTAÇÃO DO DESFECHO ABRE, e por que o título não é do modelo.
//
// A primeira linha de cada anotação é fixa. É o que faz a coluna do CRM ficar
// legível de cima a baixo: todo card do mesmo desfecho abre igual, e quem varre
// o funil reconhece o que aconteceu sem ler o parágrafo. Um modelo que
// parafraseia — "Crédito recusado", "Recusa do crédito", "Reprovação" — quebra
// esse padrão, e ninguém revisa anotação de card a card para descobrir.
//
// Por isso o título é PEDIDO no prompt e GARANTIDO aqui: pedir sozinho depende
// da obediência do modelo em cada chamada.
//
// SEM `npm:`, para o vitest alcançar. A regra é pequena e é justamente o tipo de
// coisa que se quebra sem ninguém notar.

export type Desfecho = 'reprovado' | 'diligencia' | 'validacao'

/**
 * O título exato de cada desfecho.
 *
 * "CRÉDITO RECUSADO", e não "Reprovado": é a palavra que o dono usa e a que vai
 * para o card. A coluna do Kommo continua se chamando "Reprovados Operacional" —
 * o nome da coluna é do CRM, o título da anotação é nosso.
 */
export const TITULO_DO_DESFECHO: Record<Desfecho, string> = {
  reprovado: 'Crédito Recusado',
  diligencia: 'Diligência Solicitada',
  validacao: 'Análise Concluída — Enviada para Validação',
}

/** Os títulos que já saíram para cards, e que ainda se leem por aí. */
const TITULOS_ANTIGOS = ['crédito reprovado', 'credito reprovado']

/** A primeira linha não vazia, sem marcação e sem pontuação final. */
function primeiraLinha(texto: string): string {
  return (texto.split('\n').find((l) => l.trim()) ?? '')
    .replace(/[*#_]/g, '')
    .replace(/[.:;]+$/, '')
    .trim()
}

/**
 * Devolve o texto com o título certo na frente — trocando o que o modelo pôs,
 * se ele pôs outro.
 *
 * TRÊS CASOS, e os três aparecem: o modelo obedeceu (nada a fazer); o modelo
 * escreveu um título ANTIGO ou parafraseado (a linha é substituída, senão o card
 * ficaria com dois títulos); o modelo não escreveu título nenhum (o título entra
 * na frente).
 */
export function garantirTitulo(texto: string, titulo: string): string {
  const corpo = texto.trim()
  const cabeca = primeiraLinha(corpo)
  const igual = cabeca.toLocaleLowerCase('pt-BR') === titulo.toLocaleLowerCase('pt-BR')
  if (igual) return corpo

  // Título parafraseado ou de uma versão anterior: a linha sai, e a nossa entra.
  // Sem isto o card abriria com "Crédito Reprovado" seguido de "Crédito
  // Recusado", que é pior do que qualquer um dos dois sozinho.
  const ehTituloDeOutraGrafia =
    TITULOS_ANTIGOS.includes(cabeca.toLocaleLowerCase('pt-BR')) ||
    Object.values(TITULO_DO_DESFECHO).some(
      (t) => t.toLocaleLowerCase('pt-BR') === cabeca.toLocaleLowerCase('pt-BR'),
    )
  if (ehTituloDeOutraGrafia) {
    const semCabeca = corpo.slice(corpo.indexOf('\n') + 1).replace(/^\s+/, '')
    return `${titulo}\n\n${semCabeca}`
  }
  return `${titulo}\n\n${corpo}`
}
