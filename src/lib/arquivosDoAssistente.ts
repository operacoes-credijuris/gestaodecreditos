// Arquivos que uma Skill gerou numa resposta do assistente.
//
// O LINK ASSINADO VALE UMA HORA, mas a conversa fica no histórico por tempo
// indeterminado: reaberta no dia seguinte, o link do arquivo dava erro de token
// expirado, e o arquivo — que continua no bucket — parecia perdido. Por isso a
// conversa guarda também o CAMINHO no bucket, e o link é assinado de novo ao
// reabrir (ver `renovarLinks` em components/Assistente.tsx).

/** Bucket privado dos arquivos gerados (migração 0048). */
export const BUCKET_ARQUIVOS = 'assistente-arquivos'

export interface ArquivoGerado {
  nome: string
  url: string
  /** Caminho no bucket. Ausente nas conversas gravadas antes de existir. */
  caminho?: string
}

/**
 * Caminho do arquivo no bucket, para assinar o link de novo.
 *
 * CONVERSA ANTIGA NÃO TEM O CAMPO `caminho`, mas o link assinado o carrega no
 * próprio token: o JWT do Storage tem a claim `url` = "bucket/caminho". Ler dali,
 * e não do caminho da URL, evita adivinhar quantas vezes ele foi codificado.
 */
export function caminhoDoArquivo(f: Pick<ArquivoGerado, 'url' | 'caminho'>): string | null {
  if (f.caminho) return f.caminho
  try {
    const token = new URL(f.url).searchParams.get('token')
    const corpo = token?.split('.')[1]
    if (!corpo) return null
    const bin = atob(corpo.replace(/-/g, '+').replace(/_/g, '/'))
    const json = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))),
    ) as { url?: unknown }
    const prefixo = `${BUCKET_ARQUIVOS}/`
    return typeof json.url === 'string' && json.url.startsWith(prefixo)
      ? json.url.slice(prefixo.length) || null
      : null
  } catch {
    return null
  }
}
