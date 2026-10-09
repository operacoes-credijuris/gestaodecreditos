// _shared/relogioDaInvocacao.ts
// O RELÓGIO DE UMA INVOCAÇÃO (auditoria de bugs, 09/10/2026).
//
// Uma Edge Function aqui morre por volta de 150 s de PAREDE, medidos do começo
// da invocação — e morre calada: sem resposta para a tela, sem `catch`, sem
// gravar nada. Uma chamada longa à IA ou a uma API externa sem teto, ou com um
// teto contado do momento da chamada (e não do começo da invocação), chega lá.
//
// O que este módulo dá é o tempo que AINDA cabe até perto do teto, para virar o
// `AbortSignal` da chamada: ela é interrompida antes, e a função responde o
// motivo em vez de sumir.
//
// Sem `Deno.` e sem `npm:`, para o vitest.

/** O teto medido de uma invocação, em ms de parede. */
export const TETO_DA_INVOCACAO_MS = 150_000

/**
 * Quanto uma chamada que começa agora pode durar: até `folga` antes do teto,
 * contado de `inicio`; nunca menos que `minimo` (abaixo disso, melhor falhar logo
 * com motivo do que nem tentar e não dizer por quê).
 */
export function tempoAteOTeto(
  inicio: number,
  agora: number,
  { folgaMs = 15_000, minimoMs = 5_000, tetoMs = TETO_DA_INVOCACAO_MS }: {
    folgaMs?: number
    minimoMs?: number
    tetoMs?: number
  } = {},
): number {
  return Math.max(minimoMs, tetoMs - folgaMs - (agora - inicio))
}

/** O `AbortSignal` de uma chamada que não pode passar do teto da invocação. */
export function sinalAteOTeto(inicio: number, opcoes?: Parameters<typeof tempoAteOTeto>[2]): AbortSignal {
  return AbortSignal.timeout(tempoAteOTeto(inicio, Date.now(), opcoes))
}

/** A falha é o teto de tempo (o AbortSignal.timeout disparou)? */
export function estourouOTempo(e: unknown): boolean {
  const nome = (e as { name?: unknown } | null)?.name
  return nome === 'TimeoutError' || nome === 'AbortError'
}
