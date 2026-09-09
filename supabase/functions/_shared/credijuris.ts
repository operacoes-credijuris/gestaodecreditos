// _shared/credijuris.ts
// Helpers de Google Drive, FONTE ÚNICA para gerar-contrato, gerar-analise-rpv e
// analise-precatorio.
//
// A HISTÓRIA IMPORTA PARA NÃO SE REPETIR. Estes helpers nasceram em
// gerar-contrato, foram copiados "verbatim" para gerar-analise-rpv, e depois
// extraídos para aqui — mas a cópia da RPV ficou lá, e a análise de precatório
// ainda escreveu uma terceira versão de "achar a raiz das análises". Três
// cópias do mesmo código, e no dia em que o upload passou a substituir em vez de
// apagar (DELETE definitivo, sem lixeira), a correção teve de ser feita duas
// vezes — e a terceira cópia não estava errada só por sorte. Agora todas as
// functions importam daqui, e mudança aqui vale para todas.
//
// O que NÃO está aqui: o que é de UMA function só (leitura de XLSX, .docx,
// extração via Claude, a árvore "B. Processos" dos contratos). A árvore "A.
// Análises de crédito" ESTÁ, porque duas functions a percorrem do mesmo jeito.

import { type SupabaseClient } from 'npm:@supabase/supabase-js@2.111.0'

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFile {
  id: string
  name: string
  mimeType?: string
  parents?: string[]
}

/**
 * Lowercase, sem acento, sem pontuação — pra comparar nomes de pasta/pessoa por
 * busca tolerante.
 *
 * O range U+0300–U+036F cobre as marcas combinantes (NFD separa "á" em "a" +
 * acento). Escrito com ESCAPES UNICODE, e não com os caracteres literais: um
 * deploy que corrompa o encoding do arquivo (cmd → CP1252 → UTF-8) invalidaria
 * os literais, e a busca tolerante passaria a não achar pasta nenhuma. A cópia
 * que vivia em gerar-analise-rpv já trazia esse cuidado; esta não.
 */
// A implementação mora em nucleo/texto.ts, que não importa nada: assim quem
// depende dela — as listas suspensas da planilha, entre outros — fica alcançável
// pelos testes. Este arquivo importa o SDK do Supabase e barrava todos eles.
import { normalizarParaComparar as normalizar } from './nucleo/texto.ts'
export { normalizar }

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
  // SUBSTITUI O CONTEÚDO, NÃO APAGA O ARQUIVO.
  //
  // A versão anterior fazia DELETE no arquivo de mesmo nome e criava outro. Na
  // API v3 o DELETE é definitivo — não passa pela lixeira —, então refazer uma
  // análise apagava a anterior sem recuperação. E a resposta do DELETE não era
  // conferida: falhando por permissão, o upload seguia e criava DUPLICATA com o
  // mesmo nome. Agora o arquivo existente recebe o conteúdo novo como REVISÃO:
  // mesmo id, mesmo link, e o Drive guarda as versões anteriores. Esta é a única
  // implementação: a cópia que vivia em gerar-analise-rpv saiu, e é daqui que
  // as três functions fazem upload.
  const existing = sobrescrever ? await driveFindChild(token, name, parentId) : null

  // Multipart upload (mais simples que resumable pra arquivos pequenos). Na
  // atualização os metadados não levam `parents`: o arquivo já está na pasta.
  const boundary = '-------cred' + Math.random().toString(36).slice(2)
  const metadata = JSON.stringify(existing ? { name } : { name, parents: [parentId] })
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

  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink'
  const res = await fetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Drive ${existing ? 'atualizar' : 'upload'} '${name}' (${res.status}): ${txt.slice(0, 300)}`)
  }
  return await res.json()
}

// ---------------------------------------------------------------------------
// A árvore das análises de crédito
//   {Shared Drive "Credijuris - Atualizado"} / A. Análises de crédito / {categoria} / {originador} / {cedente}
// Percorrida por gerar-analise-rpv e analise-precatorio do mesmo jeito.
// ---------------------------------------------------------------------------

export const DRIVE_ROOT_NAME = 'Credijuris - Atualizado'
export const DRIVE_ANALISES_NAME = 'A. Análises de crédito'

/**
 * A pasta "A. Análises de crédito", dentro do Drive compartilhado.
 *
 * Tenta o Shared Drive pelo nome; sem permissão de listar drives, cai na busca
 * por pasta com esse nome em qualquer drive. Falha com mensagem que diz o que
 * não foi achado — a conta do refresh_token pode simplesmente não ter acesso.
 */
export async function driveEncontrarAnalisesRoot(token: string): Promise<string> {
  const drive = await driveFindSharedDrive(token, DRIVE_ROOT_NAME)
  if (drive) {
    const child = await driveFindChildByTolerantName(token, drive.id, DRIVE_ANALISES_NAME)
    if (child) return child.id
    throw new Error(`Shared Drive '${DRIVE_ROOT_NAME}' achado, mas pasta '${DRIVE_ANALISES_NAME}' não existe nele.`)
  }
  const roots = await driveListFiles(
    token,
    `name = '${escapeDriveQuery(DRIVE_ROOT_NAME)}' and trashed = false and mimeType = '${FOLDER_MIME}'`,
  )
  if (!roots[0]) {
    throw new Error(`'${DRIVE_ROOT_NAME}' não encontrado no Drive. Confirme se a conta do refresh_token tem acesso.`)
  }
  const child = await driveFindChildByTolerantName(token, roots[0].id, DRIVE_ANALISES_NAME)
  if (!child) throw new Error(`Pasta '${DRIVE_ANALISES_NAME}' não existe dentro de '${DRIVE_ROOT_NAME}'.`)
  return child.id
}

/** Os originadores (intermediadores) que já têm pasta numa categoria, em ordem alfabética. */
export async function driveListarOriginadoresAnalise(token: string, categoria: string): Promise<string[]> {
  const analisesRootId = await driveEncontrarAnalisesRoot(token)
  const catFolder = await driveFindChildByTolerantName(token, analisesRootId, categoria)
  if (!catFolder) return []
  const subs = await driveListFiles(
    token,
    `'${catFolder.id}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
  )
  return subs.map((s) => s.name).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
