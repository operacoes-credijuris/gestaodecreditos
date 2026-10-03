// O AVISO DE VERSÃO NOVA (revisão de qualidade de vida, 03/10/2026).
//
// A plataforma fica aberta o dia inteiro. Quando sai uma versão, quem está com a
// aba aberta continua na antiga até recarregar — e hoje só recarrega sozinho
// quando um pedaço do pacote some (lib/telaSobDemanda.ts), no meio do que estiver
// fazendo. Aqui a plataforma confere, de tempos em tempos, se o index.html
// publicado aponta para outro arquivo de entrada; se apontar, AVISA ("há uma
// versão nova — recarregar") e espera a pessoa escolher a hora. NUNCA recarrega
// sozinha: pode haver algo digitado.
//
// COMO SE SABE A VERSÃO, SEM SERVIDOR NOVO: o Vite põe o hash do conteúdo no nome
// do arquivo de entrada (`assets/index-3fA9c1.js`). Mesmo nome = mesma versão.
// Basta comparar o `<script type="module" src>` da página carregada com o do
// index.html publicado, pedido sem cache. Este módulo é a parte pura dessa
// comparação; quem confere e avisa é components/layout/AvisoDeVersaoNova.tsx.

/** De quanto em quanto tempo conferir, com a aba à vista (ms). */
export const INTERVALO_DA_CONFERENCIA_MS = 5 * 60_000

/** Voltar à aba confere de novo, se a última conferência foi há mais que isto (ms). */
export const INTERVALO_MINIMO_MS = 60_000

/** "Depois" esconde o aviso por este tempo (ms); a versão continua nova. */
export const ADIAMENTO_MS = 30 * 60_000

/** O nome do arquivo, sem pasta nem `?…`: `./assets/index-ab.js?x` → `index-ab.js`. */
export function nomeDoArquivo(src: string): string {
  const semBusca = src.split(/[?#]/)[0]
  return semBusca.slice(semBusca.lastIndexOf('/') + 1)
}

/**
 * O arquivo de entrada que um index.html carrega: o `src` do primeiro
 * `<script type="module">` com `src`. Sem ele (a página de erro do servidor,
 * um HTML qualquer), `null` — e `null` nunca é "versão nova".
 */
export function entradaDoHtml(html: string): string | null {
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const atributos = m[1]
    if (!/\btype\s*=\s*["']?module\b/i.test(atributos)) continue
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(atributos)?.[1]
    if (src) return nomeDoArquivo(src)
  }
  return null
}

/** Há versão nova? Só quando as DUAS entradas são conhecidas e diferem. */
export function haVersaoNova(carregada: string | null, publicada: string | null): boolean {
  return !!carregada && !!publicada && carregada !== publicada
}

/** A entrada da página aberta agora (no navegador), ou null. */
export function entradaCarregada(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): string | null {
  const src = doc?.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src')
  return src ? nomeDoArquivo(src) : null
}

/** Conferir agora? Não com a aba escondida, e não logo depois da última vez. */
export function deveConferir(agora: number, ultima: number | null, abaVisivel: boolean): boolean {
  if (!abaVisivel) return false
  return ultima === null || agora - ultima >= INTERVALO_MINIMO_MS || agora < ultima
}
