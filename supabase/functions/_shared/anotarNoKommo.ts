// A NOTA NO CARD DO KOMMO, como a `kommo-anotar` a escreve — agora num lugar só.
//
// SAIU DE `kommo-anotar/index.ts` em 05/10/2026, quando a justificativa técnica
// passou a gravar nota também: a justificativa pode passar do tamanho de uma
// nota e ir em partes, e as partes têm de sair NUMA CHAMADA SÓ (o Kommo aceita
// uma lista no POST /leads/notes) — senão uma falha no meio deixaria a parte 1
// no card e a 2 de fora, e tentar de novo duplicaria a 1. O formato da nota (o
// tipo `common`, a marca de autoria, o gatilho desligado) continua o mesmo da
// kommo-anotar, que passou a chamar daqui: os dois caminhos escrevem igual.
//
// Sem `Deno.` e sem `npm:` — quem chama passa o par token + subdomínio.

import { kommoFetch } from './kommoFetch.ts'
import { assinarNota, marcarComoDePessoa } from './notaCredijuris.ts'

export interface OpcoesDaNota {
  /** O texto é de uma pessoa (o rodapé diz quem registrou) ou da análise (a marca automática). */
  dePessoa: boolean
  autor?: string | null
}

/** O corpo do POST /leads/notes: uma nota `common` por texto, na ordem. */
export function corpoDasNotas(leadId: number, textos: readonly string[], op: OpcoesDaNota) {
  return textos.map((texto) => ({
    entity_id: leadId,
    // NOTA DE VERDADE, e não service_message — ver o cabeçalho da kommo-anotar.
    note_type: 'common',
    params: { text: op.dePessoa ? marcarComoDePessoa(texto, op.autor ?? null) : assinarNota(texto) },
    // Registro de resultado não é evento de pipeline: não dispara gatilho.
    is_need_to_trigger_digital_pipeline: false,
  }))
}

export type ResultadoDasNotas =
  | { ok: true; ids: number[] }
  | { ok: false; status: number; detalhe: string }

/** Grava as notas no card, todas numa chamada. Devolve os ids que o Kommo deu. */
export async function postarNotas(
  conta: { token: string; subdominio: string },
  leadId: number,
  textos: readonly string[],
  op: OpcoesDaNota,
): Promise<ResultadoDasNotas> {
  // POST: repetido só com 429 (não processado) — ver kommoFetch.
  const res = await kommoFetch(`https://${conta.subdominio}.kommo.com/api/v4/leads/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conta.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpoDasNotas(leadId, textos, op)),
  })
  if (!res.ok) return { ok: false, status: res.status, detalhe: (await res.text()).slice(0, 300) }
  const corpo = (await res.json().catch(() => null)) as { _embedded?: { notes?: { id?: number }[] } } | null
  const ids = (corpo?._embedded?.notes ?? [])
    .map((n) => Number(n?.id))
    .filter((n) => Number.isFinite(n) && n > 0)
  return { ok: true, ids }
}
