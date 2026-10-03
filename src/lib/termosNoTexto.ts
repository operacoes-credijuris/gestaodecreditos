// Os termos do glossário dentro de um texto corrido (o `termosNoTexto` da
// amostra, ajuda.js): quem lê "o card volta para a Revisão depois de sanar a
// diligência" passa o mouse em "diligência" e vê o que é, sem abrir o glossário.
//
// FUNÇÃO PURA, e não HTML montado como na amostra: devolve os PEDAÇOS do texto,
// e o componente (layout/TextoComTermos.tsx) desenha cada termo. Sem HTML em
// string, não há o que escapar — o texto nunca vira marcação.
//
// AS REGRAS SÃO AS DA AMOSTRA:
// - SÓ PALAVRA INTEIRA: "TIR" não casa dentro de "TIRAR", nem "Sanar" dentro de
//   "Sanaram". Letra acentuada conta como letra ("Sanar" não casa em "sanará").
// - Maiúscula e minúscula tanto faz ("rpv" é RPV), mas o texto sai como estava.
// - SÓ A PRIMEIRA OCORRÊNCIA de cada termo: sublinhar todas transformava o
//   parágrafo numa fileira de pontilhados.
// - O TERMO MAIS LONGO PRIMEIRO, e nunca um termo dentro de outro já marcado:
//   em "valor de face", quem ganha é "Valor de face", e não um pedaço dele.

import { GLOSSARIO } from './ajudaDaPlataforma'

/** Um verbete do glossário. */
export interface TermoDoGlossario {
  termo: string
  definicao: string
}

/** Um pedaço do texto: texto comum, ou um termo do glossário (com o verbete). */
export interface PedacoDoTexto {
  /** O texto como está escrito (a caixa original é mantida). */
  texto: string
  /** Presente quando o pedaço é um termo do glossário. */
  termo?: TermoDoGlossario
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Divide o texto em pedaços, marcando a primeira ocorrência de cada termo do
 * glossário. Juntar os `texto` de todos os pedaços devolve o texto original.
 */
export function termosNoTexto(
  texto: string,
  glossario: readonly TermoDoGlossario[] = GLOSSARIO,
): PedacoDoTexto[] {
  if (!texto) return []
  let partes: PedacoDoTexto[] = [{ texto }]
  const doMaiorParaOMenor = [...glossario]
    .filter((g) => g.termo.trim())
    .sort((a, b) => b.termo.length - a.termo.length)
  for (const verbete of doMaiorParaOMenor) {
    // Antes e depois do termo, nada que seja letra ou número (em qualquer
    // alfabeto, acentos inclusive): é o "palavra inteira".
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escaparRegex(verbete.termo)}(?![\\p{L}\\p{N}_])`,
      'iu',
    )
    const i = partes.findIndex((p) => !p.termo && re.test(p.texto))
    if (i < 0) continue
    const p = partes[i]
    const m = re.exec(p.texto)
    if (!m) continue
    const novos: PedacoDoTexto[] = [
      { texto: p.texto.slice(0, m.index) },
      { texto: m[0], termo: verbete },
      { texto: p.texto.slice(m.index + m[0].length) },
    ].filter((x) => x.texto !== '')
    partes = [...partes.slice(0, i), ...novos, ...partes.slice(i + 1)]
  }
  return partes
}
