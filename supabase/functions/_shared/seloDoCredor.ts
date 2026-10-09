// _shared/seloDoCredor.ts
// O SELO DE CADA PROCESSO NO RELATÓRIO DOS PROCESSOS DO CREDOR (dd-credor).
//
// O DEFEITO (auditoria de bugs, 09/10/2026): o selo caía em "APROVADA" sempre
// que a classificação não dizia vermelho nem amarelo — inclusive quando NÃO HAVIA
// classificação: a IA recusou (429/529), cortou a resposta, devolveu JSON
// inválido, ou a Judit ainda coletava. O PDF que ia ao Drive mostrava o processo
// em verde, "APROVADA", e a frase do topo dizia "Nenhum processo do credor
// apresentou risco ao crédito principal". Falha de leitura virando atestado.
//
// Sem `npm:` e sem `Deno.`, para o vitest.

export type Selo = 'REPROVADA' | 'RESSALVAS' | 'APROVADA' | 'NÃO QUALIFICADO'

/** O selo pela classificação que a IA deu; sem classificação, NÃO QUALIFICADO. */
export function seloDaClassificacao(classificacao: unknown): Selo {
  const x = String(classificacao ?? '').trim()
  if (!x) return 'NÃO QUALIFICADO'
  if (x.includes('🔴') || /reprov/i.test(x)) return 'REPROVADA'
  if (x.includes('🟡') || /ressalv/i.test(x)) return 'RESSALVAS'
  if (x.includes('🟢') || /aprov/i.test(x)) return 'APROVADA'
  return 'NÃO QUALIFICADO'
}

/** A frase do topo do relatório: só diz "nenhum risco" se TODOS foram qualificados. */
export function conclusaoDoRelatorio(
  processos: readonly { qualificacao?: { classificacao?: unknown } | null }[],
  algumReprovado: boolean,
): { texto: string; tom: 'risco' | 'incompleto' | 'ok' } {
  if (algumReprovado) {
    return { texto: 'ATENÇÃO: há processo com RISCO ao crédito principal — revisão obrigatória.', tom: 'risco' }
  }
  const semQualificar = processos.filter(
    (p) => seloDaClassificacao(p.qualificacao?.classificacao) === 'NÃO QUALIFICADO',
  ).length
  if (semQualificar > 0) {
    return {
      texto:
        `INCOMPLETO: ${semQualificar} processo(s) não foram qualificados (ver abaixo) — ` +
        'o relatório não atesta ausência de risco.',
      tom: 'incompleto',
    }
  }
  return { texto: 'Nenhum processo do credor apresentou risco ao crédito principal.', tom: 'ok' }
}
