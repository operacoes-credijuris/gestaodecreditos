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
import { type ArquivoNoDrive, corpoDaNotaDeArquivo, recusouOCampo, textoFicou } from './notaComArquivo.ts'

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

/**
 * O TEXTO E O ARQUIVO NUMA NOTA SÓ — tentativa conferida (ver
 * _shared/notaComArquivo.ts). `junto` diz se ficou uma nota; não ficando, a de
 * arquivo e a de texto saem separadas, como antes.
 */
export async function postarNotaComArquivo(
  conta: { token: string; subdominio: string },
  leadId: number,
  texto: string,
  anexo: ArquivoNoDrive,
  op: OpcoesDaNota,
): Promise<ResultadoDasNotas & { junto?: boolean }> {
  const base = `https://${conta.subdominio}.kommo.com/api/v4`
  const headers = { Authorization: `Bearer ${conta.token}`, 'Content-Type': 'application/json' }
  const marcado = op.dePessoa ? marcarComoDePessoa(texto, op.autor ?? null) : assinarNota(texto)
  const postar = async (corpo: unknown) => {
    const res = await kommoFetch(`${base}/leads/notes`, { method: 'POST', headers, body: JSON.stringify(corpo) })
    if (!res.ok) return { ok: false as const, status: res.status, detalhe: (await res.text()).slice(0, 300) }
    const j = (await res.json().catch(() => null)) as { _embedded?: { notes?: { id?: number }[] } } | null
    const ids = (j?._embedded?.notes ?? []).map((n) => Number(n?.id)).filter((n) => Number.isFinite(n) && n > 0)
    return { ok: true as const, ids }
  }

  const tentativa = await postar(corpoDaNotaDeArquivo(leadId, anexo, marcado))
  let idDoArquivo: number | null = null
  if (tentativa.ok) {
    idDoArquivo = tentativa.ids[0] ?? null
    // A CONFERÊNCIA: o Kommo pode aceitar o campo e guardar o nome do arquivo
    // no lugar. Sem conseguir ler, vale como não guardado — a nota de texto sai.
    if (idDoArquivo) {
      const lida = await kommoFetch(`${base}/leads/notes/${idDoArquivo}`, { headers }, { idempotente: true }).catch(() => null)
      const nota = lida?.ok ? ((await lida.json().catch(() => null)) as { params?: { text?: unknown } } | null) : null
      if (textoFicou(marcado, nota?.params?.text)) return { ok: true, ids: [idDoArquivo], junto: true }
    }
  } else if (recusouOCampo(tentativa.status)) {
    // O CAMPO RECUSADO: a nota de arquivo sem o texto, como sempre foi.
    const soArquivo = await postar(corpoDaNotaDeArquivo(leadId, anexo, null))
    if (!soArquivo.ok) return soArquivo
    idDoArquivo = soArquivo.ids[0] ?? null
  } else {
    return tentativa
  }
  const r = await postarNotas(conta, leadId, [texto], op)
  if (!r.ok) return r
  return { ok: true, ids: [...(idDoArquivo ? [idDoArquivo] : []), ...r.ids], junto: false }
}
