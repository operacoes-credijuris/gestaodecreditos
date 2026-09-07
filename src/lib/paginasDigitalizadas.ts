// Quais páginas digitalizadas vão para a IA como IMAGEM.
//
// O PROBLEMA. pdf.js lê texto selecionável; página escaneada não tem. Processo
// digitalizado inteiro era recusado na porta ("parece digitalizado"), e — pior,
// porque não avisava — a conta da contadoria escaneada dentro de um processo
// digital simplesmente não era lida: a IA concluía que não havia conta.
//
// A SAÍDA É IMAGEM, NÃO OCR. A IA lê tabela numérica numa imagem muito melhor do
// que qualquer OCR local, e é a tabela que decide o preço. O custo é por página
// enviada, então não se manda tudo: escolhe-se.
//
// O QUE VAI, em ordem de prioridade:
//   1. As páginas de imagem DENTRO de um arquivo que tem texto (caso híbrido).
//      É quase sempre a conta ou o requisitório escaneado — exatamente o que
//      falta ao texto.
//   2. O FIM de um arquivo inteiramente digitalizado: é onde estão a conta
//      mais recente, a homologação, o requisitório e o andamento atual.
//   3. O COMEÇO dele: partes, número, juízo, pedido.
//
// SEM DEPENDÊNCIA, para o vitest alcançar. Quem renderiza é renderizarPaginas.ts.

export interface ArquivoParaImagem {
  nome: string
  paginas: number
  texto: string
  /** Páginas (1-based) sem texto útil dentro de um arquivo que tem texto. */
  paginasImagem?: number[]
  /** Sem os bytes não há o que renderizar. */
  bytes?: ArrayBuffer
  erro?: string
}

export interface SelecaoImagem {
  arquivo: string
  bytes: ArrayBuffer
  /** Páginas escolhidas, 1-based, em ordem crescente. */
  numeros: number[]
  /** Quantas páginas de imagem o arquivo tinha ao todo. */
  total: number
}

export interface LimitesImagem {
  /** Teto de páginas no total, entre todos os arquivos. */
  max: number
  /** Páginas do começo de um arquivo inteiramente digitalizado. */
  inicio: number
  /** Páginas do fim de um arquivo inteiramente digitalizado. */
  fim: number
}

/**
 * 60 no total: a API aceita até 100 imagens por pedido, e cada página custa
 * perto de 1.500 tokens — 60 páginas cabem duas vezes (qualificação e análise)
 * dentro do orçamento da requisição com folga para o texto.
 */
export const LIMITES_PADRAO: LimitesImagem = { max: 60, inicio: 6, fim: 40 }

interface Candidata { arquivo: string; numero: number; prioridade: number }

export function escolherPaginasParaImagem(
  arquivos: ArquivoParaImagem[],
  limites: LimitesImagem = LIMITES_PADRAO,
): SelecaoImagem[] {
  const candidatas: Candidata[] = []
  const totais = new Map<string, number>()

  for (const a of arquivos) {
    if (!a.bytes || a.paginas <= 0 || a.erro) continue
    const temTexto = a.texto.trim().length > 0

    if (temTexto) {
      // Híbrido: só as páginas de imagem, e elas têm prioridade máxima.
      const imgs = [...new Set((a.paginasImagem ?? []).filter((n) => n >= 1 && n <= a.paginas))].sort((x, y) => x - y)
      totais.set(a.nome, imgs.length)
      // Dentro do híbrido, as do fim primeiro: a conta que vale é a última.
      imgs.forEach((n, i) => candidatas.push({ arquivo: a.nome, numero: n, prioridade: 3000 + i }))
      continue
    }

    // Inteiramente digitalizado: fim, depois começo.
    totais.set(a.nome, a.paginas)
    const fim = Math.min(limites.fim, a.paginas)
    for (let k = 0; k < fim; k++) {
      const n = a.paginas - k
      candidatas.push({ arquivo: a.nome, numero: n, prioridade: 2000 - k })
    }
    const inicio = Math.min(limites.inicio, Math.max(0, a.paginas - fim))
    for (let n = 1; n <= inicio; n++) candidatas.push({ arquivo: a.nome, numero: n, prioridade: 1000 - n })
  }

  // Maior prioridade primeiro; empate pela ordem de entrada (estável).
  const escolhidas = candidatas
    .map((c, i) => ({ ...c, i }))
    .sort((x, y) => y.prioridade - x.prioridade || x.i - y.i)
    .slice(0, Math.max(0, limites.max))

  const porArquivo = new Map<string, Set<number>>()
  for (const c of escolhidas) {
    const s = porArquivo.get(c.arquivo) ?? new Set<number>()
    s.add(c.numero)
    porArquivo.set(c.arquivo, s)
  }

  // Na ordem dos arquivos, cada um com as páginas crescentes.
  const saida: SelecaoImagem[] = []
  for (const a of arquivos) {
    const s = porArquivo.get(a.nome)
    if (!s || !a.bytes) continue
    saida.push({
      arquivo: a.nome,
      bytes: a.bytes,
      numeros: [...s].sort((x, y) => x - y),
      total: totais.get(a.nome) ?? 0,
    })
  }
  return saida
}

/** Resumo em português do que foi (e do que não foi) enviado, para a IA e para o aviso. */
export function descreverSelecao(selecao: SelecaoImagem[]): string {
  return selecao
    .map((s) => {
      const faixa = s.numeros.length === s.total
        ? `todas as ${s.total} página(s)`
        : `${s.numeros.length} de ${s.total} página(s) digitalizadas (p. ${resumirNumeros(s.numeros)})`
      return `"${s.arquivo}": ${faixa}`
    })
    .join('; ')
}

/** "1, 2, 3, 7, 40, 41, 42" -> "1-3, 7, 40-42". */
export function resumirNumeros(ns: number[]): string {
  const ord = [...new Set(ns)].sort((a, b) => a - b)
  const partes: string[] = []
  let ini = ord[0], fim = ord[0]
  for (let i = 1; i <= ord.length; i++) {
    if (i < ord.length && ord[i] === fim + 1) { fim = ord[i]; continue }
    partes.push(ini === fim ? String(ini) : `${ini}-${fim}`)
    ini = fim = ord[i]
  }
  return partes.join(', ')
}
