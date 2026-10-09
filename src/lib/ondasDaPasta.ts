// O preenchimento do crédito novo pela pasta do Drive chega em DUAS ONDAS
// (components/NovoCreditoDoDrive.tsx): o que o caminho da pasta garante entra na
// hora e libera os campos; o que a IA lê dos documentos chega segundos depois.
//
// Entre as duas, a pessoa já pode corrigir um campo (auditoria de bugs,
// 09/10/2026). A segunda onda SOBRESCREVIA a correção sem aviso. Agora ela só
// escreve no campo que continua como a onda anterior o deixou.

const igual = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * Junta uma onda nova ao rascunho.
 *
 * @param atual o rascunho agora (com o que a pessoa digitou)
 * @param depoisDaOndaAnterior o rascunho como a onda anterior o deixou
 * @param dados o que a onda nova traz
 */
export function mesclarOndaDaPasta<T extends Record<string, unknown>>(
  atual: T,
  depoisDaOndaAnterior: T,
  dados: Partial<T>,
): T {
  const saida: Record<string, unknown> = { ...atual }
  for (const [k, v] of Object.entries(dados)) {
    // Campo que a pessoa mexeu depois da onda anterior fica como ela deixou.
    if (!igual(atual[k], depoisDaOndaAnterior[k])) continue
    saida[k] = v
  }
  return saida as T
}
