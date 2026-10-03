// Os contadores ao lado dos itens do menu (item "Novo" da amostra): as
// publicações novas e as tarefas vencidas.
//
// O QUE CADA NÚMERO CONTA, e de onde:
// - PUBLICAÇÕES NOVAS: as do DJEN ainda não tratadas, NA MESMA JANELA DE 30 DIAS
//   da tela de Publicações (data de disponibilização a partir de hoje − 30, no
//   fuso local). Janela diferente faria o menu dizer 12 e a tela mostrar 5.
// - TAREFAS VENCIDAS: as em aberto com prazo fatal antes de hoje, lidas do CACHE
//   `advbox_tarefas` — NUNCA da ação `list` ao vivo do ADVBOX, que baixa todas as
//   tarefas a cada chamada; num menu que se atualiza sozinho, seria isso a cada
//   cinco minutos, de cada pessoa logada.
//
// As duas são contagens leves (`head: true`, nenhuma linha baixada).

/** De quanto em quanto tempo os contadores se atualizam sozinhos. */
export const INTERVALO_DOS_CONTADORES = 5 * 60_000

/** Os dias da janela das publicações — os mesmos da tela de Publicações. */
export const DIAS_DA_JANELA_DAS_PUBLICACOES = 30

/** Data ISO local (AAAA-MM-DD) de N dias atrás — a mesma conta da tela. */
export function isoDiasAtras(dias: number, agora: Date = new Date()): string {
  return new Date(agora.getTime() - dias * 86400000).toLocaleDateString('sv-SE')
}

export type Contador = 'publicacoes' | 'tarefas'

/** Qual contador vai ao lado de cada item do menu (pelo endereço do item). */
export const CONTADOR_DO_ITEM: Readonly<Record<string, Contador>> = {
  '/operacional/execucao/publicacoes': 'publicacoes',
  '/operacional/execucao/tarefas': 'tarefas',
}

/**
 * O texto do contador por extenso — é o que o leitor de tela lê e o que a dica
 * mostra ("5 publicações novas", "1 tarefa vencida"). O número sozinho, ao lado
 * do nome, não diz o que conta.
 */
export function textoDoContador(contador: Contador, n: number): string {
  if (contador === 'publicacoes') return n === 1 ? '1 publicação nova' : `${n} publicações novas`
  return n === 1 ? '1 tarefa vencida' : `${n} tarefas vencidas`
}

/** O número na pílula: até 99; acima disso, "99+" (a pílula não alarga o menu). */
export function numeroDoContador(n: number): string {
  return n > 99 ? '99+' : String(n)
}

/** Há o que mostrar? Zero, erro e "ainda carregando" não mostram pílula. */
export function mostraContador(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * O nome do item com o menu recolhido, quando só o ícone aparece: a dica e o
 * nome para o leitor de tela levam também o contador ("Tarefas · 2 tarefas
 * vencidas").
 */
export function rotuloDoItemRecolhido(nome: string, textoContador?: string | null): string {
  return textoContador ? `${nome} · ${textoContador}` : nome
}
