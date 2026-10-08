// O TEXTO QUE VAI PARA O CARD NOS DESFECHOS DA ONDA 4 DO REDESENHO (02/10/2026):
// a nota do Concluir da Revisão do RPV, do "Fechado!" e do "Não fechou".
//
// FUNÇÕES PURAS, com teste (desfechoDoCard.test.ts): a nota é o único registro
// que fica no Kommo de por que o card se moveu, e quem a lê é o comercial, sem a
// análise à mão. Um resumo da oportunidade que entrasse por engano numa
// reprovação viraria a "razão" dela.

import type { PapelDaTela } from './kommo'

/**
 * A NOTA DE UM DESFECHO DA JANELA DA MENSAGEM.
 *
 * O RESUMO DA OPORTUNIDADE SÓ ENTRA AO APROVAR (etapa 9, Revisão do RPV): é o que
 * a coluna seguinte precisa para montar a proposta. Na diligência ou na
 * reprovação ele seria a ficha de um crédito que não vai adiante — por isso mora
 * numa caixa à parte, e não no campo da mensagem. Vai COMO FICOU NA CAIXA (quem
 * aprova completa o que o motor deixou "a confirmar").
 *
 * DUAS NOTAS, E NÃO UMA (07/10/2026, pedido do dono): o resumo (o roteiro, o link
 * da análise no Drive e o canhoto) numa nota, e a mensagem de quem aprovou na
 * nota seguinte. Juntos, viravam uma nota só muito grande, e o comercial tinha
 * de achar o comentário no fim dela. Na ORDEM do feed: o resumo, e depois o
 * comentário.
 *
 * Sem caixa de resumo (`resumo` null), a nota é a mensagem, como sempre foi.
 * Texto vazio não vira nota (lista vazia: nada a anotar — ver `moverComNota`).
 */
export function notasDoDesfecho({
  papel,
  mensagem,
  resumo,
}: {
  papel: PapelDaTela
  mensagem: string
  /** O texto da caixa do resumo, quando a janela tem a caixa; null quando não tem. */
  resumo: string | null
}): string[] {
  const msg = mensagem.trim()
  if (papel !== 'aprovar' || resumo === null) return msg ? [msg] : []
  return [resumo.trim(), msg].filter(Boolean)
}

/** A linha que abre a nota do "Fechado!" — o fato, antes da anotação de quem fechou. */
export const NOTA_DO_FECHADO = 'Proposta aceita pelo cedente.'

/** A nota do "Fechado!": a linha fixa e, se houver, a anotação opcional. */
export function notaDoFechado(anotacao: string): string {
  const a = anotacao.trim()
  return a ? `${NOTA_DO_FECHADO}\n\n${a}` : NOTA_DO_FECHADO
}

/** Os dois jeitos de não fechar: o cedente recusou, ou deixou de responder. */
export type TipoDeNaoFechou = 'recusou' | 'sumiu'

/**
 * O TEXTO DE CADA JEITO DE NÃO FECHAR, como na amostra (`MOTIVOS_NAO_FECHOU`): o
 * rótulo da opção, a linha de apoio, o exemplo do campo, os motivos de um clique e
 * o começo da nota.
 */
export const MOTIVOS_NAO_FECHOU: Readonly<
  Record<
    TipoDeNaoFechou,
    { rotulo: string; apoio: string; exemplo: string; sugestoes: readonly string[]; prefixo: string; confirmar: string }
  >
> = {
  recusou: {
    rotulo: 'O cedente recusou',
    apoio: 'Disse não à proposta',
    exemplo: 'Por que o cedente não fechou. Ex.: achou o deságio alto; fechou com outra empresa.',
    sugestoes: [
      'Achou o deságio alto',
      'Fechou com outra empresa',
      'Desistiu de vender',
      'Quer receber pelo processo',
      'Prazo de pagamento não atendeu',
    ],
    prefixo: 'Não fechou: ',
    confirmar: 'Confirmar: não fechou',
  },
  sumiu: {
    rotulo: 'O cedente sumiu',
    apoio: 'Parou de responder',
    exemplo: 'Como foi o último contato. Ex.: não responde no WhatsApp desde 20/09.',
    sugestoes: [
      'Não responde no WhatsApp',
      'Não atende o telefone',
      'Parou de responder depois da proposta',
      'Contato do cedente desatualizado',
    ],
    prefixo: 'Sem resposta do cedente: ',
    confirmar: 'Confirmar: sem resposta',
  },
}

/**
 * O MOTIVO MÍNIMO: 10 caracteres, a mesma régua da razão nos desfechos que
 * interrompem. É o que o comercial lê depois para entender a perda.
 */
export const MINIMO_DO_MOTIVO = 10

export function motivoSuficiente(texto: string): boolean {
  return texto.trim().length >= MINIMO_DO_MOTIVO
}

/** A nota do "Não fechou": o começo que diz qual dos dois, e o motivo escrito. */
export function notaDoNaoFechou(tipo: TipoDeNaoFechou, motivo: string): string {
  return MOTIVOS_NAO_FECHOU[tipo].prefixo + motivo.trim()
}

/**
 * O MOTIVO DE UM CLIQUE entra no fim do que já foi escrito, como frase: "Achou o
 * deságio alto." — ou, depois de um texto, "… Achou o deságio alto.".
 *
 * O TEXTO SEM PONTO GANHA UM antes da frase nova: "achou caro" e um clique em
 * "Desistiu de vender" davam "achou caro Desistiu de vender." — uma frase só,
 * com maiúscula no meio, na nota que o comercial lê.
 */
export function comSugestao(texto: string, sugestao: string): string {
  const t = texto.trim()
  if (!t) return `${sugestao}.`
  return /[.!?;:…]$/.test(t) ? `${t} ${sugestao}.` : `${t}. ${sugestao}.`
}
