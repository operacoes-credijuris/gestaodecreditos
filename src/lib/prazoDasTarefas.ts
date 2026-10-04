// Os prazos da tela de Tarefas: em que grupo cada tarefa fatal cai e o que o
// selo do prazo diz.
//
// OS QUATRO GRUPOS SÃO DA AMOSTRA APROVADA (Vencidas, Hoje e amanhã, Próximos 7
// dias, Mais adiante), no lugar de "Pendentes" e "Vencidas". As FRONTEIRAS são
// as da régua de cor que a tela já tinha: vermelho para vencida, hoje e amanhã;
// âmbar até 7 dias; sem selo depois disso. O grupo e a cor dizem a mesma coisa,
// então não podem discordar — por isso moram juntos aqui.
//
// AS DATAS SÃO TEXTO ISO LOCAL (AAAA-MM-DD): o "hoje" vem de hojeISO e anda na
// virada do dia com a tela aberta, e o prazo vem do ADVBOX às vezes com hora
// ("2026-10-02 18:00:00") — só os dez primeiros caracteres contam.

export type GrupoDoPrazo = 'vencidas' | 'hoje_amanha' | 'proximos_7' | 'mais_adiante'

/** Os grupos na ordem da tela: o que pede ação primeiro. */
export const GRUPOS_DO_PRAZO: readonly { chave: GrupoDoPrazo; titulo: string }[] = [
  { chave: 'vencidas', titulo: 'Vencidas' },
  { chave: 'hoje_amanha', titulo: 'Hoje e amanhã' },
  { chave: 'proximos_7', titulo: 'Próximos 7 dias' },
  { chave: 'mais_adiante', titulo: 'Mais adiante' },
]

/** Dias inteiros de `hoje` até `prazo` (negativo = já venceu). */
export function diasAtePrazo(hoje: string, prazo: string): number {
  const a = new Date(`${hoje.slice(0, 10)}T00:00:00`).getTime()
  const b = new Date(`${prazo.slice(0, 10)}T00:00:00`).getTime()
  return Math.round((b - a) / 86400000)
}

export function grupoDoPrazo(dias: number): GrupoDoPrazo {
  if (dias < 0) return 'vencidas'
  if (dias <= 1) return 'hoje_amanha'
  if (dias <= 7) return 'proximos_7'
  return 'mais_adiante'
}

export type TomDoPrazo = 'perigo' | 'aviso' | 'neutro'

/**
 * O selo do prazo: o tom e o texto relativo. Depois de 7 dias não há selo
 * (`rel` vazio) — a data no calendário do cartão basta.
 */
export function seloDoPrazo(dias: number): { tom: TomDoPrazo; rel: string } {
  if (dias < 0) return { tom: 'perigo', rel: dias === -1 ? 'venceu ontem' : `venceu há ${-dias} dias` }
  if (dias <= 1) return { tom: 'perigo', rel: dias === 0 ? 'hoje' : 'amanhã' }
  if (dias <= 7) return { tom: 'aviso', rel: `em ${dias} dias` }
  return { tom: 'neutro', rel: '' }
}

/**
 * O PRAZO EM POUCAS LETRAS, para caber DENTRO do bloco de data do cartão
 * (auditoria visual, T1): "há 2 dias", "ontem", "hoje", "amanhã", "em 5 dias".
 * O bloco passou a ser o único sinal colorido da tarefa, no lugar do selo
 * "venceu há 2 dias" ao lado do título. O "venceu" sai porque o vermelho do
 * bloco e o grupo "Vencidas" já dizem isso. Mesma régua do `seloDoPrazo`:
 * depois de 7 dias, nada — a data basta.
 */
export function prazoCurto(dias: number): string {
  if (dias < -1) return `há ${-dias} dias`
  if (dias === -1) return 'ontem'
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'amanhã'
  if (dias <= 7) return `em ${dias} dias`
  return ''
}

/**
 * As tarefas COM PRAZO, separadas nos quatro grupos.
 *
 * A ORDEM DENTRO DE CADA GRUPO é a da plataforma: as vencidas da que estourou há
 * MENOS tempo à mais antiga (quanto mais fundo, mais velho o atraso); as outras,
 * do prazo mais próximo ao mais longe. Tarefa sem prazo não entra — ela é da
 * visão "Sem prazo", onde não há o que vencer.
 */
export function agruparPorPrazo<T>(
  tarefas: readonly T[],
  hoje: string,
  prazoDe: (t: T) => string | null | undefined,
): Record<GrupoDoPrazo, T[]> {
  const grupos: Record<GrupoDoPrazo, T[]> = {
    vencidas: [],
    hoje_amanha: [],
    proximos_7: [],
    mais_adiante: [],
  }
  const prazo = (t: T) => (prazoDe(t) ?? '').slice(0, 10)
  for (const t of tarefas) {
    const p = prazo(t)
    if (!p) continue
    grupos[grupoDoPrazo(diasAtePrazo(hoje, p))].push(t)
  }
  grupos.vencidas.sort((a, b) => prazo(b).localeCompare(prazo(a)))
  for (const g of ['hoje_amanha', 'proximos_7', 'mais_adiante'] as const)
    grupos[g].sort((a, b) => prazo(a).localeCompare(prazo(b)))
  return grupos
}
