// QUAL APURAÇÃO DO PAPEL PREENCHE OS CAMPOS do painel de processos judiciais
// (09/10/2026).
//
// Corrigido o titular, a apuração da pessoa nova entra como OUTRA linha do
// mesmo papel em dd_historico (a chave inclui o documento), e a antiga fica ao
// lado. O painel pré-preenchia os campos com a PRIMEIRA linha do papel que o
// banco devolvesse — sem ordem garantida, muitas vezes a antiga. Com a leitura
// dos autos sem documento (PDF só imagem, IA que falhou), o CPF do campo era o
// do titular errado, e o "Reapurar" pagava a busca sobre a pessoa errada.
//
// A MAIS RECENTE é a que vale: a apurada por último; sem data, a que veio
// depois na lista (a linha sem `apurado_em` é a que ainda não terminou).

export interface ApuracaoDoPapel {
  papel: string
  apurado_em?: string | null
}

/** A apuração mais recente do papel, ou undefined. */
export function apuracaoMaisRecente<T extends ApuracaoDoPapel>(apuracoes: readonly T[], papel: string): T | undefined {
  let melhor: T | undefined
  let melhorEm = -Infinity
  for (const a of apuracoes) {
    if (a.papel !== papel) continue
    const t = a.apurado_em ? Date.parse(a.apurado_em) : NaN
    const em = Number.isNaN(t) ? -Infinity : t
    // `>=`: entre iguais (ou duas sem data), fica a que veio depois.
    if (!melhor || em >= melhorEm) {
      melhor = a
      melhorEm = em
    }
  }
  return melhor
}
