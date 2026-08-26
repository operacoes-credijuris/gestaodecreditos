// _shared/credijuris.ts
// Helpers de Google Drive genéricos, EXTRAÍDOS VERBATIM de gerar-contrato (a
// função que os introduziu, portada de credijuris-contratos/Python). Também
// usados por gerar-analise-rpv — antes desta extração eles viviam duplicados
// nas duas functions; o comentário de topo de gerar-analise-rpv já prometia
// este arquivo, sem ele existir. Fonte única agora.
//
// O que NÃO está aqui: qualquer coisa específica de UMA function (leitura de
// XLSX de análise, preenchimento de .docx, extração via Claude, a árvore de
// pastas "B. Processos" vs "A. Análises de crédito" — cada function sabe o seu
// caminho). Só o que as duas literalmente repetiam.

import { type SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFile {
  id: string
  name: string
  mimeType?: string
  parents?: string[]
}

/** Lowercase, sem acento, sem pontuação — pra comparar nomes de pasta/pessoa por busca tolerante. */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.\-/() ]/g, '')
}

export function escapeDriveQuery(s: string): string {
  return s.replace(/'/g, "\\'")
}

export async function storageGetBytes(
  sb: SupabaseClient<any, any, any>,
  bucket: string,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await sb.storage.from(bucket).download(path)
  if (error) throw new Error(`Storage download falhou (${bucket}/${path}): ${error.message}`)
  const buf = await data.arrayBuffer()
  return new Uint8Array(buf)
}

export async function refreshGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Google OAuth refresh falhou (${res.status}): ${txt.slice(0, 300)}`)
  }
  const data = await res.json()
  if (!data.access_token) throw new Error('Google OAuth: sem access_token na resposta')
  return data.access_token as string
}

export async function driveListFiles(
  token: string,
  query: string,
  driveId?: string,
): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,mimeType,parents)',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    pageSize: '1000',
  })
  if (driveId) {
    params.set('corpora', 'drive')
    params.set('driveId', driveId)
  } else {
    params.set('corpora', 'allDrives')
  }
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Drive list (${res.status}): ${txt.slice(0, 300)} | query=${query}`)
  }
  const data = await res.json()
  return data.files || []
}

export async function driveFindSharedDrive(
  token: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  let pageToken: string | undefined
  while (true) {
    const params = new URLSearchParams({ fields: 'nextPageToken,drives(id,name)' })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`https://www.googleapis.com/drive/v3/drives?${params}`, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (!res.ok) {
      // pode não ter permissão de listar drives — não é fatal, segue pra busca normal
      return null
    }
    const data = await res.json()
    for (const d of data.drives || []) if (d.name === name) return d
    pageToken = data.nextPageToken
    if (!pageToken) return null
  }
}

export async function driveFindChild(
  token: string,
  name: string,
  parentId: string,
  mime?: string,
): Promise<DriveFile | null> {
  let q = `name = '${escapeDriveQuery(name)}' and '${parentId}' in parents and trashed = false`
  if (mime) q += ` and mimeType = '${mime}'`
  const files = await driveListFiles(token, q)
  return files[0] || null
}

export async function driveCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Drive criar pasta '${name}' (${res.status}): ${txt.slice(0, 300)}`)
  }
  const data = await res.json()
  return data.id
}

export async function driveFindOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const existing = await driveFindChild(token, name, parentId, FOLDER_MIME)
  if (existing) return existing.id
  return driveCreateFolder(token, name, parentId)
}

/** Busca tolerante: nome exato primeiro, senão a primeira pasta cujo nome CONTÉM a agulha. */
export async function driveFindChildByTolerantName(
  token: string,
  parentId: string,
  needle: string,
  mustBeFolder = true,
): Promise<DriveFile | null> {
  let q = `'${parentId}' in parents and trashed = false`
  if (mustBeFolder) q += ` and mimeType = '${FOLDER_MIME}'`
  const files = await driveListFiles(token, q)
  const n = normalizar(needle)
  return files.find((f) => normalizar(f.name) === n) ?? files.find((f) => normalizar(f.name).includes(n)) ?? null
}

export async function driveUploadBytes(
  token: string,
  name: string,
  parentId: string,
  bytes: Uint8Array,
  mime: string,
  sobrescrever = true,
): Promise<{ id: string; webViewLink?: string }> {
  if (sobrescrever) {
    const existing = await driveFindChild(token, name, parentId)
    if (existing) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${existing.id}?supportsAllDrives=true`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      })
    }
  }
  // Multipart upload (mais simples que resumable pra arquivos pequenos)
  const boundary = '-------cred' + Math.random().toString(36).slice(2)
  const metadata = JSON.stringify({ name, parents: [parentId] })
  const enc = new TextEncoder()
  const head = enc.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  )
  const tail = enc.encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + bytes.length + tail.length)
  body.set(head, 0)
  body.set(bytes, head.length)
  body.set(tail, head.length + bytes.length)

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Drive upload '${name}' (${res.status}): ${txt.slice(0, 300)}`)
  }
  return await res.json()
}
