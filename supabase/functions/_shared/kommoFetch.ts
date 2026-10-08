// _shared/kommoFetch.ts
// A CHAMADA AO KOMMO QUE AGUENTA O LIMITE DE TAXA (08/10/2026).
//
// O Kommo aceita umas 7 requisições por segundo por conta, e responde 429 a
// partir daí. Pôr uma etiqueta são 4 chamadas (ler o card, o PATCH, reler, a
// nota de registro); o envio a um fundo, mais as da anotação e do movimento — e
// tudo isso disputa a cota com a sincronização automática e com o resto da
// equipe. Era a falha intermitente de "às vezes a etiqueta não vai": a função
// desistia no primeiro 429.
//
// A REGRA:
//   - 429 (e 403 de bloqueio temporário, que o Kommo dá a quem insiste): a
//     requisição NÃO foi processada, então repetir é seguro em qualquer método.
//     Espera o `Retry-After` (ou 1 s, 2 s…) e tenta de novo;
//   - 5xx e falha de rede: só se repete o que é IDEMPOTENTE (`idempotente`:
//     GET, e PATCH de etiqueta/status/campo, que dão o mesmo resultado se
//     aplicados duas vezes). Um POST de nota que falhou com 502 pode ter
//     gravado — repetir deixaria a nota duas vezes no card;
//   - no máximo `tentativas` (3) e nunca mais que uns poucos segundos no total:
//     a função tem teto de ~150 s, e quem espera é uma pessoa na tela.
//
// SEM `npm:` e com o fetch e a espera injetáveis, para o vitest.

export interface OpcoesDoKommoFetch {
  /** A requisição pode ser repetida depois de 5xx ou falha de rede (GET, PATCH de etiqueta…). */
  idempotente?: boolean
  tentativas?: number
  /** Para os testes. */
  fetch?: typeof fetch
  esperar?: (ms: number) => Promise<void>
}

const esperarDeVerdade = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Quanto esperar antes da tentativa `n` (1, 2…): o Retry-After, se veio, até 5 s. */
export function esperaAntesDaTentativa(n: number, retryAfter: string | null): number {
  const s = Number(retryAfter)
  if (Number.isFinite(s) && s > 0) return Math.min(5_000, Math.round(s * 1000))
  return Math.min(5_000, 1_000 * n)
}

export async function kommoFetch(
  url: string,
  init: RequestInit = {},
  { idempotente = (init.method ?? 'GET').toUpperCase() === 'GET', tentativas = 3, ...o }: OpcoesDoKommoFetch = {},
): Promise<Response> {
  const f = o.fetch ?? fetch
  const esperar = o.esperar ?? esperarDeVerdade
  for (let n = 1; ; n++) {
    let res: Response
    try {
      res = await f(url, init)
    } catch (e) {
      if (!idempotente || n >= tentativas) throw e
      await esperar(esperaAntesDaTentativa(n, null))
      continue
    }
    const recusada = res.status === 429 || res.status === 403
    const doServidor = res.status >= 500
    if (n < tentativas && (recusada || (doServidor && idempotente))) {
      // O corpo é descartado: a resposta que vale é a da próxima tentativa.
      await res.body?.cancel().catch(() => {})
      await esperar(esperaAntesDaTentativa(n, res.headers.get('Retry-After')))
      continue
    }
    return res
  }
}
