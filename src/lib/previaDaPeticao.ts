// A prévia da petição com as FALTAS MARCADAS (item "Novo" da amostra aprovada)
// e a regra de quando fechar a janela pergunta "Descartar alterações?".
//
// AS FALTAS: aplicarModelo (lib/peticao.ts) troca cada [RÓTULO] do modelo pelo
// valor do cadastro e DEIXA O RÓTULO quando o cadastro não tem o dado. O que sobra
// entre colchetes na prévia é, portanto, exatamente o que não foi preenchido — e
// destacá-lo é o que faz a lista de pendências apontar para um lugar do texto.
// A gravação não muda: a prévia só se desenha diferente.

/** Um pedaço da prévia: texto comum, ou um rótulo que ficou sem valor. */
export interface TrechoDaPrevia {
  texto: string
  falta: boolean
}

/**
 * O mesmo desenho de rótulo de lib/peticao.ts (RE_ROTULO): colchetes com a barra
 * de escape opcional, que a conversão de .docx para .md põe (`\[NÚMERO\]`).
 */
const RE_ROTULO = /\\?\[([^\][\n]*?)\\?\]/g

/** Parte o texto final da petição em trechos, marcando os rótulos que sobraram. */
export function trechosDaPrevia(texto: string): TrechoDaPrevia[] {
  const trechos: TrechoDaPrevia[] = []
  let ultimo = 0
  for (const m of texto.matchAll(RE_ROTULO)) {
    const i = m.index ?? 0
    if (i > ultimo) trechos.push({ texto: texto.slice(ultimo, i), falta: false })
    trechos.push({ texto: `[${m[1].replace(/\\/g, '').trim()}]`, falta: true })
    ultimo = i + m[0].length
  }
  if (ultimo < texto.length) trechos.push({ texto: texto.slice(ultimo), falta: false })
  return trechos
}

/**
 * Fechar a janela da petição perde trabalho?
 *
 * SÓ TROCAR O MODELO NÃO CONTA (decisão registrada na amostra): o modelo se
 * escolhe de novo num clique, e perguntar por isso ensinaria a clicar "OK" sem
 * ler. Conta o que custa refazer: o objeto digitado na aba de IA (além do que já
 * veio pronto do assistente) e a peça redigida, que custou chamada de IA.
 */
export function peticaoAlterada({
  instrucao,
  instrucaoInicial,
  textoIA,
}: {
  instrucao: string
  instrucaoInicial?: string | null
  textoIA: string
}): boolean {
  return instrucao.trim() !== (instrucaoInicial ?? '').trim() || textoIA.trim() !== ''
}
