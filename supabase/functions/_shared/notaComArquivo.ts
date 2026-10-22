// O TEXTO E O ARQUIVO NUMA NOTA SÓ (22/10/2026, pedido do dono). O "Anotar"
// com arquivo gravava duas notas no card: a de arquivo (tipo `attachment`) e a
// de texto. O sentido da coisa é uma só.
//
// O QUE SE SABE DO KOMMO: a documentação da nota de arquivo lista só
// `file_uuid`, `version_uuid` e `file_name`; e o `params.text` das notas de
// arquivo do espelho é o nome do arquivo — o Kommo o preenche sozinho, inclusive
// nas que a equipe anexa pela tela dele. Mandar o texto ali é TENTATIVA, e por
// isso a gravação confere o que o Kommo guardou (`textoFicou`): ficou o nosso
// texto, a nota é uma só; não ficou (ou o Kommo recusou o campo), sai também a
// nota de texto, como antes — nunca se perde o que a pessoa escreveu.
//
// Sem `Deno.` e sem `npm:`: testável no vitest.

import { semEntidadesHtml } from './textoDoKommo.ts'

/** O arquivo já no drive e no card (o que a kommo-anexo-enviar devolve com `x-sem-nota`). */
export interface ArquivoNoDrive {
  file_uuid: string
  version_uuid?: string | null
  file_name: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** O `anexo` do corpo, conferido — ou null quando não presta. */
export function arquivoNoDrive(x: unknown): ArquivoNoDrive | null {
  const a = (x ?? null) as Record<string, unknown> | null
  if (!a || typeof a !== 'object') return null
  const uuid = String(a.file_uuid ?? '').trim()
  const versao = String(a.version_uuid ?? '').trim()
  const nome = String(a.file_name ?? '').trim().slice(0, 180)
  if (!UUID.test(uuid) || !nome) return null
  if (versao && !UUID.test(versao)) return null
  return { file_uuid: uuid, ...(versao ? { version_uuid: versao } : {}), file_name: nome }
}

/** O corpo do POST /leads/notes: a nota de arquivo, com ou sem o texto. */
export function corpoDaNotaDeArquivo(leadId: number, anexo: ArquivoNoDrive, texto: string | null) {
  return [
    {
      entity_id: leadId,
      note_type: 'attachment',
      params: {
        file_uuid: anexo.file_uuid,
        file_name: anexo.file_name,
        ...(anexo.version_uuid ? { version_uuid: anexo.version_uuid } : {}),
        ...(texto ? { text: texto } : {}),
      },
      is_need_to_trigger_digital_pipeline: false,
    },
  ]
}

const comparavel = (s: unknown) =>
  semEntidadesHtml(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/**
 * O KOMMO GUARDOU O NOSSO TEXTO? Compara o começo (o Kommo devolve HTML
 * escapado e pode mexer em quebras de linha), e não o fim, que leva o rodapé.
 */
export function textoFicou(enviado: string, devolvido: unknown): boolean {
  const e = comparavel(enviado)
  const d = comparavel(devolvido)
  if (!e || !d) return false
  return d.includes(e.slice(0, 60))
}

/**
 * Recusa de VALIDAÇÃO (o campo não é aceito): só aí se tenta de novo sem o
 * texto. Um 5xx pode ter gravado a nota, e repetir a duplicaria.
 */
export const recusouOCampo = (status: number) => status === 400 || status === 422
