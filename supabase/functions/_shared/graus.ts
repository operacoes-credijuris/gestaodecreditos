// O GRAU DE UM RISCO, num vocabulário só.
//
// Cinco vocabulários chegavam aqui. A auditoria dos cálculos classifica a
// GRAVIDADE de cada divergência em alta/media/baixa; o risco de revisão sai
// alto/medio/baixo/nenhum; o bloco de riscos que o modelo escreve usa
// Impeditivo/Elevado/Moderado/Ponto de atenção. "Elevado" e "Alto" são a mesma
// coisa dita de dois jeitos.
//
// POR QUE ELE SAIU DA TELA. A tradução existia em AnaliseRpvModal.tsx e a
// versão do SERVIDOR — que escreve a coluna de riscos da planilha e o `riscos`
// devolvido no 'salvar' — casava por igualdade exata: `x === 'alta'`. Assim
// "média", "Alta " e "ALTA." caíam no grau mais fraco. É o mesmo defeito que a
// tela já havia consertado ("alta" não contém "alto"), vivo na cópia que
// produz o DOCUMENTO — o que se lê seis meses depois, sem a análise à mão.
//
// OS RADICAIS SÃO CURTOS DE PROPÓSITO — "alt", e não "alto": a auditoria
// escreve a gravidade no feminino ("alta") e o bloco de riscos escreve o grau
// no masculino ("Alto"). Casando a palavra inteira, o achado que derruba o
// crédito aparecia com o mesmo selo apagado de uma imprecisão sem efeito.

/** O vocabulário da TELA: cinco degraus, do impeditivo à nota de rodapé. */
export type GrauRisco = 'IMPEDITIVO' | 'ALTO' | 'MODERADO' | 'ATENÇÃO' | 'NOTA'

/** Qualquer jeito de dizer o grau vira um dos cinco. */
export function normalizarGrau(bruto: unknown): GrauRisco {
  const g = String(bruto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (g.includes('impeditiv')) return 'IMPEDITIVO'
  if (g.includes('alt') || g.includes('elevad')) return 'ALTO'
  if (g.includes('moderad') || g.includes('medi')) return 'MODERADO'
  if (g.includes('nota') || g.includes('nenhum')) return 'NOTA'
  return 'ATENÇÃO'
}

/** Do mais grave para o menos: é esta a ordem em que se lê uma lista de riscos. */
export const ORDEM_GRAU: Record<GrauRisco, number> = {
  IMPEDITIVO: 0, ALTO: 1, MODERADO: 2, 'ATENÇÃO': 3, NOTA: 4,
}

/** O vocabulário da PLANILHA, que é o da lista suspensa da célula. */
export type GrauDaPlanilha = 'ALTO' | 'MODERADO' | 'PONTO DE ATENÇÃO'

/**
 * O grau como a planilha o escreve.
 *
 * TRÊS DEGRAUS, E NÃO CINCO, porque é o que a coluna de riscos do modelo
 * aceita. O impeditivo desce para ALTO: a planilha não tem degrau acima, e
 * rebaixá-lo para "ponto de atenção" — que era o efeito do casamento exato —
 * é o erro que este módulo existe para não repetir.
 */
export function grauDaPlanilha(bruto: unknown): GrauDaPlanilha {
  const g = normalizarGrau(bruto)
  if (g === 'IMPEDITIVO' || g === 'ALTO') return 'ALTO'
  if (g === 'MODERADO') return 'MODERADO'
  return 'PONTO DE ATENÇÃO'
}
