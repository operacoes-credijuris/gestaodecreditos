// Conferência da FORMA da petição escrita pela IA.
//
// POR QUE ISTO EXISTE: instrução no prompt não basta. A lição está registrada na
// carteira-resumo — na varredura de 2026-08-10, com as regras já escritas, 12 de
// 94 textos citaram data e 52 estouraram o limite. Aqui o custo de confiar seria
// maior: peça fora do dialeto perde cor, régua e recuo no .docx, e o defeito só
// apareceria no arquivo que vai a protocolo.
//
// SEM IMPORT NENHUM, de propósito: assim o mesmo arquivo roda na Edge Function
// (Deno) e num teste com tsx — foi testado com peça conforme e com peça torta.
//
// As regras espelham src/lib/peticaoLayout.ts (lerModelo). Se o parser mudar,
// este arquivo muda junto, senão a conferência aprova o que o parser recusa.

/** Mesmo critério de todoNegrito() em src/lib/peticaoLayout.ts. */
export const todoNegrito = (bloco: string): boolean =>
  /\*\*/.test(bloco) && bloco.replace(/\*\*[^*]+\*\*/g, '').trim() === ''

const semAcento = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Peça menor que isto está incompleta, não concisa. */
export const MIN_CHARS_PECA = 600

export function blocosDe(texto: string): string[] {
  return texto
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
}

/**
 * O que a peça viola. Lista vazia = forma conforme.
 *
 * Cada mensagem é escrita para ser DEVOLVIDA AO MODELO como correção, então diz
 * o que está errado e o que fazer — não só que está errado.
 */
export function problemasDaPeca(texto: string): string[] {
  const p: string[] = []
  const blocos = blocosDe(texto)

  if (texto.trim().length < MIN_CHARS_PECA) {
    p.push(
      `A petição tem ${texto.trim().length} caracteres — está incompleta. Escreva a peça inteira, do endereçamento ao fecho.`,
    )
  }
  if (blocos.length < 4) {
    p.push(
      'A petição tem menos de 4 blocos. No mínimo: endereçamento, número do processo, corpo e fecho, separados por linha em branco.',
    )
  }

  const cabecalho = (i: number, oQue: string) => {
    const b = blocos[i]
    if (!b) {
      p.push(`Falta o bloco ${i + 1}, que deve ser ${oQue}.`)
      return
    }
    if (b.includes('\n') || !todoNegrito(b)) {
      p.push(
        `O bloco ${i + 1} deve ser ${oQue}: UMA linha só, TODA entre ** **. Veio assim: ${JSON.stringify(b.slice(0, 90))}.`,
      )
    }
  }
  cabecalho(0, 'o endereçamento ao juízo')
  cabecalho(1, 'o número do processo')

  if (!semAcento(texto).includes('pede deferimento')) {
    p.push(
      'Falta o fecho. O texto tem de conter "pede deferimento" — é o que faz o programa centralizar local, data e assinatura.',
    )
  }

  // Rótulo entre colchetes: nos modelos do bucket é variável a substituir; aqui
  // seria lacuna indo para o juízo.
  const lacuna = texto.match(/\[[^\]\n]{2,}\]/)
  if (lacuna) {
    p.push(
      `A petição deixou ${lacuna[0]} para preencher depois. Use os dados fornecidos; o que não houver, não afirme.`,
    )
  }

  if (/^#{1,6}\s/m.test(texto)) {
    p.push(
      'A petição usa título com #. Título é UMA linha toda em negrito, nunca com #.',
    )
  }

  return p
}
