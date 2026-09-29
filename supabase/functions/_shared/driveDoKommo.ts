// O DRIVE DO KOMMO: descobrir o endereço dele e subir um arquivo em partes.
//
// DUAS FUNÇÕES PRECISAM DISTO: a rotina dos autos do Escavador, que sobe os PDFs
// dos processos para o card, e a kommo-anexo-enviar, que sobe o arquivo que
// alguém escolheu no computador (o memorando assinado, por exemplo). Um caminho
// só para as duas: o envio em partes tem regras que não podem divergir.
//
// O ENVIO, pela documentação do Kommo (Files API):
//   1. POST {drive}/v1.0/sessions com nome, tamanho e tipo → upload_url e o
//      tamanho máximo de cada parte (512 KB);
//   2. POST de cada parte no upload_url; a resposta traz o next_url da próxima,
//      e a da última traz o arquivo (uuid);
//   3. quem chamou anexa o uuid ao card (PUT /leads/{id}/files).

import { fatias } from './autosParaOKommo.ts'

/** O endereço do drive da conta (drive-b, drive-c…), que o Kommo informa em /account. */
export async function urlDoDriveDaConta(baseApi: string, auth: Record<string, string>): Promise<string> {
  const r = await fetch(`${baseApi}/account?with=drive_url`, { headers: auth })
  const u = ((await r.json().catch(() => ({}))) as { drive_url?: string })?.drive_url
  if (!u) throw new Error('não consegui descobrir o drive da conta Kommo')
  return String(u)
}

/** Sobe um arquivo ao drive do Kommo, em partes, e devolve o uuid dele. */
export async function subirAoDriveDoKommo(o: {
  drive: string
  auth: Record<string, string>
  nome: string
  bytes: Uint8Array
  mime: string
}): Promise<string> {
  const s = await fetch(`${o.drive}/v1.0/sessions`, {
    method: 'POST',
    headers: { ...o.auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: o.nome, file_size: o.bytes.byteLength, content_type: o.mime }),
  })
  if (!s.ok) throw new Error(`o drive do Kommo recusou a sessão (HTTP ${s.status}): ${(await s.text()).slice(0, 160)}`)
  const sessao = (await s.json()) as { upload_url?: string; max_part_size?: number; max_file_size?: number }
  if (sessao.max_file_size && o.bytes.byteLength > Number(sessao.max_file_size)) {
    throw new Error(`arquivo maior que o limite do Kommo (${o.bytes.byteLength} bytes)`)
  }
  let url: string | null = sessao.upload_url ?? null
  for (const [a, b] of fatias(o.bytes.byteLength, Number(sessao.max_part_size) || 524_288)) {
    if (!url) throw new Error('o drive do Kommo não devolveu o endereço da próxima parte')
    const r = await fetch(url, {
      method: 'POST',
      headers: { ...o.auth, 'Content-Type': 'application/octet-stream' },
      body: o.bytes.slice(a, b),
    })
    if (!r.ok) throw new Error(`o drive do Kommo recusou uma parte (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}`)
    const j = (await r.json().catch(() => ({}))) as { uuid?: string; next_url?: string }
    if (j?.uuid) return String(j.uuid)
    url = j?.next_url ?? null
  }
  throw new Error('o drive do Kommo terminou o envio sem devolver o arquivo')
}
