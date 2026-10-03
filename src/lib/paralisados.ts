// Os processos PARALISADOS da aba Movimentações: a ordem da lista, a faixa de
// gravidade (a cor da borda, do selo e da legenda) e o texto do tempo parado.
//
// AS FAIXAS SÃO AS DA PLATAFORMA (20–45, 45–90, 90–180 e mais de 180 dias, ou
// sem movimentação nenhuma); a amostra aprovada só pôs a legenda ao lado, para a
// cor não falar sozinha. A ORDEM É A DA AMOSTRA (decisão do dono): do mais
// parado ao menos parado, e quem nunca movimentou no fim — antes era o inverso,
// e o que pedia ação ficava no pé da lista.

export type FaixaParalisado = 'aviso' | 'serio' | 'ruim' | 'critico'

/** Dias corridos de `ultima` (AAAA-MM-DD ou data com hora) até `agora`, no mínimo 0. */
export function diasParado(ultima: string, agora: Date = new Date()): number {
  const d = new Date(ultima.length <= 10 ? `${ultima}T00:00:00` : ultima)
  return Math.max(0, Math.floor((agora.getTime() - d.getTime()) / 86400000))
}

/** A faixa do tempo parado. `null` = nunca movimentou, que é o caso mais grave. */
export function faixaParalisado(dias: number | null): FaixaParalisado {
  if (dias == null || dias > 180) return 'critico'
  if (dias > 90) return 'ruim'
  if (dias > 45) return 'serio'
  return 'aviso'
}

/** "há 26 dias", "há 4 meses", "sem movimentação". */
export function textoParalisado(dias: number | null): string {
  if (dias == null) return 'sem movimentação'
  return dias < 60 ? `há ${dias} dias` : `há ${Math.floor(dias / 30)} meses`
}

/** A legenda das faixas, na ordem da gravidade. */
export const LEGENDA_PARALISADO: readonly { faixa: FaixaParalisado; rotulo: string }[] = [
  { faixa: 'aviso', rotulo: '20–45 dias' },
  { faixa: 'serio', rotulo: '45–90' },
  { faixa: 'ruim', rotulo: '90–180' },
  { faixa: 'critico', rotulo: 'mais de 180 ou sem movimentação' },
]

/**
 * Do mais parado ao menos parado: a última movimentação MAIS ANTIGA primeiro.
 * Sem movimentação nenhuma vai para o fim, como na amostra — é grave, mas não há
 * data para comparar, e no topo esconderia quem parou há meses.
 */
export function ordenarParalisados<T>(
  lista: readonly T[],
  ultimaDe: (t: T) => string | null | undefined,
): T[] {
  return [...lista].sort((a, b) => {
    const ua = ultimaDe(a) ?? ''
    const ub = ultimaDe(b) ?? ''
    if (!ua && !ub) return 0
    if (!ua) return 1
    if (!ub) return -1
    return ua.localeCompare(ub)
  })
}
