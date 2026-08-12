// Acesso ao Google Drive pelo NAVEGADOR, com a conta de quem está usando.
//
// POR QUE PELO NAVEGADOR, e não por uma conta de robô no servidor: robô não tem
// espaço próprio no Drive, então criar arquivo em pasta de pessoa dá erro de cota —
// contornável só com Drive compartilhado ou delegação no Workspace. Pelo navegador,
// cada pessoa autoriza com a conta dela, que já tem acesso às pastas, e o arquivo
// aparece no histórico do Drive com o nome de quem gerou, não de um robô. E não há
// nenhuma credencial da empresa guardada em arquivo.
//
// O ID do cliente é PÚBLICO por design: fica visível no código do site. O que
// protege são as origens autorizadas no Google Cloud e o login de cada pessoa.
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

/**
 * Escopo AMPLO, e não `drive.file`.
 *
 * `drive.file` alcança só arquivos que o próprio app criou — não daria para
 * PROCURAR a pasta do crédito na árvore, que é o essencial aqui. O escopo amplo é
 * "restrito" para a Google e exigiria verificação num app externo; como o app é
 * INTERNO da organização Workspace, o próprio administrador autoriza.
 */
const ESCOPO = 'https://www.googleapis.com/auth/drive'

/**
 * Raiz de "B. Processos" no Drive da Credijuris — a árvore de TODOS os créditos.
 *
 * A constante se chamava PASTA_PETICOES e o comentário dizia "Raiz de Petições",
 * o que era enganoso: as petições são uma das sete subpastas de dentro de cada
 * crédito, bem no fundo desta árvore. O nome errado passou a doer quando um
 * segundo consumidor apareceu (a descoberta de crédito novo, em creditoDoDrive).
 */
export const PASTA_PROCESSOS = '11zhEdPVBMQZxPSzLa-rHKtjBH6T4RhL7'

export const driveConfigurado = Boolean(CLIENT_ID)

export interface PastaDrive {
  id: string
  nome: string
}

// ---------------------------------------------------------------------------
// Autorização
// ---------------------------------------------------------------------------

interface RespostaToken {
  access_token?: string
  error?: string
  expires_in?: number
}

interface ClienteToken {
  requestAccessToken: (opcoes?: { prompt?: string }) => void
}

interface GoogleGis {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string
        scope: string
        callback: (r: RespostaToken) => void
      }) => ClienteToken
    }
  }
}

declare global {
  interface Window {
    google?: GoogleGis
  }
}

/**
 * Token guardado em memória E no sessionStorage, com a validade.
 *
 * NÃO VAI PARA localStorage, e isso não mudou: lá a credencial do Drive da empresa
 * sobreviveria a fechar o navegador e ficaria à disposição da próxima pessoa que o
 * abrisse. O sessionStorage é por ABA e morre quando a aba fecha.
 *
 * POR QUE SAIU DA MEMÓRIA PURA: em memória, recarregar a página perdia o token e a
 * chamada seguinte pedia autorização de novo. Isso ficou insuportável quando a aba
 * Automatizado passou a consultar o Drive só de ser aberta — o pedido de
 * autorização virou a primeira coisa que acontecia, em toda página nova.
 *
 * O risco que sobra é a aba ficar aberta em máquina compartilhada, que é o mesmo
 * risco de deixar a própria plataforma logada — e o Sair apaga este token junto
 * (ver esquecerTokenDrive, chamado no signOut).
 */
const CHAVE_TOKEN = 'credijuris.drive.token'

interface TokenDrive {
  valor: string
  expiraEm: number
}

let token: TokenDrive | null = null

/** Token válido, de onde estiver. Uma folga de 60s: ver autorizarDrive. */
function lerToken(): TokenDrive | null {
  if (!token) {
    try {
      const cru = sessionStorage.getItem(CHAVE_TOKEN)
      if (cru) token = JSON.parse(cru) as TokenDrive
    } catch {
      // sessionStorage indisponível (aba privada, política do navegador) ou JSON
      // corrompido: segue só com a memória, que é o comportamento anterior.
    }
  }
  if (token && token.expiraEm - 60_000 > Date.now()) return token
  return null
}

function guardarToken(t: TokenDrive): void {
  token = t
  try {
    sessionStorage.setItem(CHAVE_TOKEN, JSON.stringify(t))
  } catch {
    /* sem sessionStorage, vale a memória */
  }
}

/** Apaga o token. Chamado no Sair, para não ficar acessível a quem vier depois. */
export function esquecerTokenDrive(): void {
  token = null
  try {
    sessionStorage.removeItem(CHAVE_TOKEN)
  } catch {
    /* nada a fazer */
  }
}

let gisCarregado: Promise<void> | null = null

/** Carrega o script do Google uma única vez, sob demanda. */
function carregarGis(): Promise<void> {
  if (gisCarregado) return gisCarregado
  gisCarregado = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () =>
      reject(new Error('Não foi possível carregar o login do Google. Verifique a rede.'))
    document.head.appendChild(s)
  })
  return gisCarregado
}

/**
 * Devolve um token válido, pedindo autorização se necessário.
 *
 * `prompt: ''` deixa o Google decidir: quem já autorizou antes não vê janela
 * nenhuma; quem não autorizou vê uma vez.
 */
export async function autorizarDrive(): Promise<string> {
  if (!CLIENT_ID) {
    throw new Error(
      'O acesso ao Drive não está configurado (falta VITE_GOOGLE_CLIENT_ID no build).',
    )
  }
  // Uma folga de 60s: token que expira no meio da subida do arquivo falharia com
  // uma mensagem que não diz nada. A margem está em lerToken.
  const guardado = lerToken()
  if (guardado) return guardado.valor

  await carregarGis()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('O login do Google não ficou disponível.')

  return await new Promise<string>((resolve, reject) => {
    const cliente = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: ESCOPO,
      callback: (r) => {
        if (r.error || !r.access_token) {
          reject(
            new Error(
              r.error === 'access_denied'
                ? 'Autorização do Google negada. Sem ela não é possível salvar no Drive.'
                : `Falha na autorização do Google: ${r.error ?? 'sem token'}.`,
            ),
          )
          return
        }
        guardarToken({
          valor: r.access_token,
          expiraEm: Date.now() + (r.expires_in ?? 3600) * 1000,
        })
        resolve(r.access_token)
      },
    })
    cliente.requestAccessToken({ prompt: '' })
  })
}

// ---------------------------------------------------------------------------
// Chamadas à API
// ---------------------------------------------------------------------------

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const acesso = await autorizarDrive()
  const resp = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${acesso}` },
  })
  if (!resp.ok) {
    let detalhe = `HTTP ${resp.status}`
    try {
      const corpo = (await resp.json()) as { error?: { message?: string } }
      if (corpo.error?.message) detalhe = corpo.error.message
    } catch {
      /* resposta sem json — fica o status */
    }
    // 403 aqui quase sempre é a pessoa não ter acesso à pasta, não bug do código.
    if (resp.status === 403) {
      throw new Error(`O Google recusou o acesso: ${detalhe}. Confira se você tem permissão nessa pasta do Drive.`)
    }
    throw new Error(`Drive: ${detalhe}`)
  }
  return (await resp.json()) as T
}

const q = (s: string) => encodeURIComponent(s)

/**
 * Quantas páginas de 200 se aceita percorrer. 20 = 4.000 subpastas numa só pasta,
 * que a árvore de petições não alcança nem de longe; passar disso é sinal de que
 * algo está errado, e aí é melhor falhar com mensagem do que rodar sem fim.
 */
const MAX_PAGINAS = 20

/**
 * As subpastas de uma pasta, TODAS elas.
 *
 * Pagina de propósito. A versão anterior pedia 200 numa página só e ficava com o
 * que viesse: bastava uma pasta passar de 200 itens para a busca não achar o nome
 * que estava lá, e a tela dizer "não achei a pasta do Fulano" com a pasta
 * existindo. O corte era silencioso — nada distinguia "não existe" de "não olhei
 * até o fim".
 *
 * O caso não acontece hoje (são 11 originadores), então o laço roda uma volta só e
 * o custo é zero. A segunda chamada só existe quando é realmente necessária.
 */
export async function listarSubpastas(paiId: string): Promise<PastaDrive[]> {
  const filtro = `'${paiId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const todas: PastaDrive[] = []
  let pagina: string | undefined

  for (let i = 0; i < MAX_PAGINAS; i++) {
    const dados = await api<{
      files?: { id: string; name: string }[]
      nextPageToken?: string
    }>(
      `https://www.googleapis.com/drive/v3/files?q=${q(filtro)}` +
        `&fields=nextPageToken,files(id,name)&pageSize=200&orderBy=name` +
        (pagina ? `&pageToken=${q(pagina)}` : ''),
    )
    for (const f of dados.files ?? []) todas.push({ id: f.id, nome: f.name })
    if (!dados.nextPageToken) return todas
    pagina = dados.nextPageToken
  }

  throw new Error(
    `Esta pasta do Drive tem mais de ${MAX_PAGINAS * 200} subpastas — parei de ler. ` +
      'Confira se a pasta é a esperada.',
  )
}

/** Um arquivo com este nome exato dentro da pasta, se existir. */
export async function acharArquivo(
  paiId: string,
  nome: string,
): Promise<{ id: string } | null> {
  const escapado = nome.replace(/'/g, "\\'")
  const filtro = `'${paiId}' in parents and name='${escapado}' and trashed=false`
  const dados = await api<{ files: { id: string }[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q(filtro)}&fields=files(id)&pageSize=2`,
  )
  return dados.files?.[0] ?? null
}

const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * Sobe o arquivo na pasta. Se já existir um com o mesmo nome, SOBRESCREVE — foi a
 * decisão de produto. Sobrescrever mantém o histórico de versões do próprio Drive,
 * então a versão anterior não se perde: fica em "Gerenciar versões".
 *
 * Devolve o link de visualização, para abrir em outra aba.
 */
export async function subirDocx(
  paiId: string,
  nome: string,
  conteudo: Blob,
): Promise<{ id: string; link: string }> {
  const existente = await acharArquivo(paiId, nome)
  const acesso = await autorizarDrive()

  const metadados = existente
    ? // Em atualização, mandar `parents` é erro do lado do Google: o arquivo já
      // está na pasta, e o campo não é aceito no PATCH.
      { name: nome, mimeType: MIME_DOCX }
    : { name: nome, mimeType: MIME_DOCX, parents: [paiId] }

  const corpo = new FormData()
  corpo.append(
    'metadata',
    new Blob([JSON.stringify(metadados)], { type: 'application/json' }),
  )
  corpo.append('file', conteudo)

  const url = existente
    ? `https://www.googleapis.com/upload/drive/v3/files/${existente.id}?uploadType=multipart&fields=id,webViewLink`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink`

  const resp = await fetch(url, {
    method: existente ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${acesso}` },
    body: corpo,
  })
  if (!resp.ok) {
    let detalhe = `HTTP ${resp.status}`
    try {
      const erro = (await resp.json()) as { error?: { message?: string } }
      if (erro.error?.message) detalhe = erro.error.message
    } catch {
      /* fica o status */
    }
    throw new Error(`Não foi possível salvar no Drive: ${detalhe}`)
  }
  const dados = (await resp.json()) as { id: string; webViewLink?: string }
  return {
    id: dados.id,
    link: dados.webViewLink ?? `https://drive.google.com/file/d/${dados.id}/view`,
  }
}
