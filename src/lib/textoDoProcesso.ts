// O texto do processo que vai para a IA, montado página a página.
//
// O PROBLEMA QUE ISTO RESOLVE. O texto de um processo grande não cabe inteiro
// no pedido, e o corte antigo guardava 60% do INÍCIO e 40% do fim. O início é
// petição inicial e documentos pessoais — a parte que menos serve ao preço. A
// sentença, o trânsito, a conta da contadoria e a homologação ficam no meio de
// um processo de 300 páginas, e era o meio que sumia. A IA então achava o valor
// que sobrava: o da petição inicial, que o próprio prompt lista como o engano
// mais comum. Boa parte de "a IA errou o valor" nasce aqui.
//
// AGORA O CORTE ESCOLHE PÁGINAS, não fatias. Cada página recebe uma pontuação:
// as primeiras do primeiro arquivo são obrigatórias (identificação das partes,
// número, juízo); as últimas do último arquivo também (onde o processo está
// hoje); no meio, ganham prioridade as páginas que falam de conta, homologação,
// requisitório, sentença, trânsito e valores — e, empatando, as mais recentes.
// O que fica de fora é marcado no lugar, com a contagem, para a IA saber que há
// um buraco e não deduzir que "não há conta" quando a conta só não foi enviada.
//
// SEM DEPENDÊNCIA, para o vitest alcançar: é regra de seleção, e a seleção
// decide o que a IA vê.

export interface PaginaLida {
  arquivo: string
  /** 1-based, dentro do arquivo. */
  numero: number
  texto: string
}

export interface TextoMontado {
  texto: string
  incluidas: number
  omitidas: number
  cortou: boolean
}

/**
 * As palavras que marcam página que decide preço. Cada casamento vale um ponto;
 * o teto evita que uma tabela com "valor" cem vezes tome o orçamento inteiro.
 */
const RE_CHAVE =
  /contadoria|c[áa]lculo|homolog|requisit|\bRPV\b|of[íi]cio|senten[çc]a|ac[óo]rd[ãa]o|tr[âa]nsit|liquida[çc]|precat[óo]rio|honor[áa]rio|destaque|alvar[áa]|expedi|valor\s+(bruto|l[íi]quido|total|atualizado|devido)|imposto\s+de\s+renda|\bIRRF?\b|\bINSS\b|juros|corre[çc][ãa]o\s+monet|impugna|cumprimento\s+de\s+senten/gi
const TETO_CHAVE = 20

/** Páginas do começo do primeiro arquivo que sempre entram. */
const INICIO_OBRIGATORIO = 6
/** Páginas do fim do último arquivo que sempre entram. */
const FIM_OBRIGATORIO = 4

function pontuar(p: PaginaLida): number {
  let n = 0
  RE_CHAVE.lastIndex = 0
  while (RE_CHAVE.exec(p.texto) && n < TETO_CHAVE) n++
  return n
}

/** Como uma página é escrita no texto final. */
const marcar = (p: PaginaLida) => `[p.${p.numero}]\n${p.texto.trim()}`
/** O cabeçalho de um arquivo, escrito uma vez antes da primeira página dele. */
const cabecalho = (arquivo: string, total: number) => `\n===== ARQUIVO: ${arquivo} (${total} pág.) =====\n`

/**
 * Monta o texto do processo dentro de `max` caracteres.
 *
 * Cabendo tudo, vai tudo, na ordem, com cabeçalho por arquivo e marcador por
 * página. Não cabendo, seleciona pelas regras acima e marca os buracos.
 */
export function montarTextoDoProcesso(paginas: PaginaLida[], max: number): TextoMontado {
  const validas = paginas.filter((p) => p.texto.trim().length > 0)
  if (validas.length === 0) return { texto: '', incluidas: 0, omitidas: 0, cortou: false }

  const porArquivo = new Map<string, number>()
  for (const p of validas) porArquivo.set(p.arquivo, (porArquivo.get(p.arquivo) ?? 0) + 1)

  const escrever = (escolhidas: Set<number>): string => {
    const partes: string[] = []
    let arquivoAtual: string | null = null
    let buraco = 0
    const fecharBuraco = () => {
      if (buraco > 0) partes.push(`\n[… ${buraco} página(s) omitida(s) por tamanho …]\n`)
      buraco = 0
    }
    validas.forEach((p, i) => {
      if (p.arquivo !== arquivoAtual) {
        fecharBuraco()
        arquivoAtual = p.arquivo
        partes.push(cabecalho(p.arquivo, porArquivo.get(p.arquivo) ?? 0))
      }
      if (escolhidas.has(i)) { fecharBuraco(); partes.push(marcar(p)) }
      else buraco++
    })
    fecharBuraco()
    return partes.join('\n')
  }

  const todas = new Set(validas.map((_, i) => i))
  const inteiro = escrever(todas)
  if (inteiro.length <= max) {
    return { texto: inteiro, incluidas: validas.length, omitidas: 0, cortou: false }
  }

  // Não cabe: prioriza.
  const primeiroArquivo = validas[0].arquivo
  const ultimoArquivo = validas[validas.length - 1].arquivo
  const idxUltimoDoUltimo = validas.length - 1
  const prioridade = validas.map((p, i) => {
    const obrigatoria =
      (p.arquivo === primeiroArquivo && p.numero <= INICIO_OBRIGATORIO) ||
      (p.arquivo === ultimoArquivo && i > idxUltimoDoUltimo - FIM_OBRIGATORIO)
    // Recência desempata: mais perto do fim, mais chance de ser a conta que
    // vale (a última homologada) e o andamento atual.
    const recencia = i / Math.max(1, validas.length - 1)
    return { i, obrigatoria, pontos: pontuar(p) * 10 + recencia * 5, custo: marcar(p).length + 1 }
  })

  const escolhidas = new Set<number>()
  let gasto = 0
  // Orçamento com folga para cabeçalhos e marcadores de buraco.
  const folga = porArquivo.size * 80 + 400
  const orcamento = Math.max(0, max - folga)

  // Obrigatórias primeiro; se nem elas cabem, cortam-se pelo próprio texto.
  for (const c of prioridade.filter((x) => x.obrigatoria)) {
    if (gasto + c.custo <= orcamento) { escolhidas.add(c.i); gasto += c.custo }
  }
  for (const c of prioridade.filter((x) => !x.obrigatoria).sort((a, b) => b.pontos - a.pontos || b.i - a.i)) {
    if (gasto + c.custo <= orcamento) { escolhidas.add(c.i); gasto += c.custo }
  }

  let texto = escrever(escolhidas)
  // Defesa final: uma página gigante pode estourar sozinha.
  if (texto.length > max) texto = texto.slice(0, max)

  return { texto, incluidas: escolhidas.size, omitidas: validas.length - escolhidas.size, cortou: true }
}
