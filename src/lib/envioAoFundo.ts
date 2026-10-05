// O ENVIO A UM FUNDO, na Remessa aos fundos: a ORDEM das chamadas e o que se diz
// quando uma delas falha. A tela (`enviarAoFundo`, na Análise de crédito) dá os
// passos — as chamadas de verdade, o cache e o andamento —; a sequência e as
// mensagens moram aqui, onde dá para testá-las sem Kommo nem navegador.
//
// A SEQUÊNCIA:
//   1. a anotação no card (e as imagens), se ainda não subiu nesta tentativa;
//   2. a etiqueta do desfecho — e, no ato que pede a cotação ("Cotado BTG",
//      05/10/2026), a cotação no campo do fundo, NO MESMO PATCH da
//      kommo-etiquetar: o card fica com as duas ou com nenhuma;
//   3. com todos os fundos feitos, o card vai para o destino.
//
// NADA MOVE O CARD SE O PASSO 2 FALHAR: o 3 só corre depois de o 2 voltar
// certo — e, com cotação, só se a função confirmar que gravou o campo.
//
// A COTAÇÃO É CONFERIDA ANTES DE TUDO (`validarCotacao`, a mesma porta do
// servidor): faltando o valor, nada vai ao Kommo, nem a anotação.

import type { AtoDoEnvio } from '../../supabase/functions/_shared/trilhasDoPrecatorio.ts'
import {
  type Cotacao,
  NOME_DO_GRUPO_DAS_COTACOES,
  textoDaCotacao,
  validarCotacao,
} from '../../supabase/functions/_shared/cotacaoDoFundo.ts'

/** As chamadas que a tela faz, na ordem em que este módulo as pede. */
export interface PassosDoEnvio {
  /** A anotação (e as imagens). LANÇA com o motivo. */
  anotar: () => Promise<void>
  /**
   * A etiqueta do ato, com a cotação quando ele a pede (num pedido só à
   * kommo-etiquetar). LANÇA com o motivo. `cotacaoGravada` é a função dizendo
   * que gravou o campo (a `cotacao` na resposta).
   */
  etiquetar: (cotacao: Cotacao | null) => Promise<{ tags: string[]; cotacaoGravada: boolean }>
  /** Move o card para o destino. LANÇA com o motivo. */
  mover: () => Promise<void>
}

export type ResultadoDoEnvio = {
  /** As etiquetas do card depois do envio. */
  tags: string[]
  /** O texto gravado no campo do fundo, quando o ato pediu a cotação. */
  cotacao: string | null
} & (
  | { movido: true }
  /** Faltam outros fundos: o card fica na Remessa. */
  | { movido: false; faltamFundos: true }
  /**
   * TUDO REGISTRADO, MAS O CARD NÃO SE MOVEU. Não é falha do envio: a anotação,
   * a etiqueta e a cotação estão no card, e quem refaz o movimento é o botão
   * "Mover para Em precificação" do card. Devolver erro aqui deixaria a janela
   * convidando a confirmar de novo — e a etiqueta, já gravada, seria pedida outra
   * vez à toa.
   */
  | { movido: false; faltamFundos: false; erroAoMover: string }
)

const mensagem = (e: unknown) => (e as Error)?.message ?? String(e)

export async function registrarEnvioAoFundo({
  fundo,
  ato,
  cotacao,
  anotacaoFeita,
  todosFeitos,
  destino,
  passos,
  onAndamento = () => {},
}: {
  /** O nome do fundo, que é também o nome do campo dele no card ("BTG"). */
  fundo: string
  ato: AtoDoEnvio
  /** O que a janela juntou. Só vale no ato que pede a cotação; nos outros, é ignorado. */
  cotacao: Cotacao | null
  /** A anotação deste ato já subiu numa tentativa anterior: não sobe de novo. */
  anotacaoFeita: boolean
  /** Com estas etiquetas, todos os fundos da remessa estão feitos? */
  todosFeitos: (tags: string[]) => boolean
  /** O nome da coluna de destino, para o andamento ("Em precificação"). */
  destino: string
  passos: PassosDoEnvio
  onAndamento?: (texto: string) => void
}): Promise<ResultadoDoEnvio> {
  // 0. A COTAÇÃO, ANTES DE QUALQUER CHAMADA. "Reprovado BTG" e a PJus não a
  // pedem: o que tiver sido digitado na janela fica de fora.
  let comCotacao: Cotacao | null = null
  if (ato.pedeCotacao) {
    const v = validarCotacao(cotacao)
    if (!v.ok) throw new Error(`${v.erro} Nada foi enviado ao Kommo.`)
    comCotacao = v.cotacao
  }
  const texto = comCotacao ? textoDaCotacao(comCotacao) : null
  const oQue = comCotacao
    ? `a cotação (campo ${fundo}) e a etiqueta "${ato.etiqueta}"`
    : `a etiqueta "${ato.etiqueta}"`

  // 1. A ANOTAÇÃO.
  if (!anotacaoFeita) {
    try {
      await passos.anotar()
    } catch (e) {
      throw new Error(
        `A anotação não subiu para o Kommo: ${mensagem(e)}` +
          (comCotacao ? ' A cotação não foi gravada, a etiqueta não entrou e o card não se moveu.' : ''),
      )
    }
  }

  // 2. A ETIQUETA — COM A COTAÇÃO, NUM PATCH SÓ.
  onAndamento(
    comCotacao
      ? `Gravando a cotação no campo ${fundo} e a etiqueta "${ato.etiqueta}"…`
      : `Pondo a etiqueta "${ato.etiqueta}"…`,
  )
  let r: Awaited<ReturnType<PassosDoEnvio['etiquetar']>>
  try {
    r = await passos.etiquetar(comCotacao)
  } catch (e) {
    throw new Error(
      `A anotação está no card, mas ${oQue} não ${comCotacao ? 'entraram' : 'entrou'}: ${mensagem(e)}` +
        (comCotacao ? ' O card não se moveu.' : '') +
        ' Confirme de novo — a anotação não se repete.',
    )
  }
  const tags = r.tags
  if (comCotacao && !r.cotacaoGravada) {
    // A ETIQUETA ENTROU E O CAMPO NÃO SE CONFIRMOU: só acontece com uma
    // kommo-etiquetar que ignora a cotação (anterior a 05/10/2026). O card não
    // se move, e a mensagem diz o que está e o que não está no card.
    throw new Error(
      `A etiqueta "${ato.etiqueta}" entrou, mas a função não confirmou a gravação do campo ${fundo} ` +
        `da aba "${NOME_DO_GRUPO_DAS_COTACOES}" (${texto}). O card não se moveu: confira o campo no ` +
        'Kommo e confirme de novo — a anotação não se repete.',
    )
  }

  // 3. TODOS OS FUNDOS FEITOS — aceito ou reprovado, cada um: o card segue.
  if (!todosFeitos(tags)) return { tags, cotacao: texto, movido: false, faltamFundos: true }
  onAndamento(`Movendo o card para ${destino}…`)
  try {
    await passos.mover()
  } catch (e) {
    return { tags, cotacao: texto, movido: false, faltamFundos: false, erroAoMover: mensagem(e) }
  }
  return { tags, cotacao: texto, movido: true }
}
