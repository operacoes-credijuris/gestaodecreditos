// A PRÉVIA DA IMAGEM ANEXADA (06/10/2026, pedido do dono): "no Kommo, quando eu
// anexo uma imagem, aparece uma pré-visualização dentro da própria anotação".
// Aqui moram as REGRAS, testáveis sem Kommo nem navegador:
//
//   - o que é imagem (pelo nome e, quando se sabe, pelo tipo);
//   - o grupo de miniaturas de uma anotação: a primeira à vista, "+N" no selo;
//   - por quanto tempo o link assinado do Kommo ainda serve;
//   - o cache dos links e o limite de pedidos ao mesmo tempo.
//
// A TELA (components/analise/MiniaturasDaNota.tsx) liga isto à `kommo-anexo`.
//
// O LINK É ASSINADO E VENCE (ver a função): nada aqui o guarda além da memória
// da página, e nunca depois de perto de vencer.

import type { KommoNota } from '@/lib/types'
import { nomeDoAnexo } from '@/lib/historicoDeNotas'

/** Os formatos que o navegador mostra num `<img>` sem nada à volta. */
const EXTENSAO_DE_IMAGEM = /\.(png|jpe?g|gif|webp)$/i
const MIME_DE_IMAGEM = /^image\/(png|jpe?g|pjpeg|gif|webp)$/i
/** Tipo que não diz nada: quem decide é o nome. */
const MIME_GENERICO = /^(application\/octet-stream|binary\/octet-stream)?$/i

/**
 * O arquivo é uma imagem que se mostra em miniatura?
 *
 * O TIPO, QUANDO VEM, MANDA: "foto.png" que o drive diz ser PDF não é imagem.
 * Sem tipo (a anotação do espelho só tem o nome) ou com o tipo genérico do
 * drive, vale a extensão. HEIC, TIFF e SVG ficam de fora de propósito: os dois
 * primeiros o navegador não abre, e o SVG de um terceiro não entra na tela.
 */
export function ehImagem(nome: string, mime?: string | null): boolean {
  const m = String(mime ?? '').trim()
  if (!MIME_GENERICO.test(m)) return MIME_DE_IMAGEM.test(m)
  return EXTENSAO_DE_IMAGEM.test(String(nome ?? '').trim())
}

/** Os arquivos de uma anotação, separados para a tela. */
export interface GrupoDeMiniaturas {
  /** As imagens que ganham miniatura, na ordem do histórico. */
  imagens: KommoNota[]
  /** O resto (PDF, planilha, imagem sem `arquivo_uuid`): a lista de sempre. */
  outros: KommoNota[]
  /** "+2" quando há mais imagens que a da miniatura; nulo com uma só. */
  selo: string | null
}

/**
 * Separa as imagens dos outros arquivos da anotação.
 *
 * IMAGEM SEM `arquivo_uuid` FICA NA LISTA: a nota gravada antes de o espelho
 * guardar a chave só se acha pelo nome, na lista de anexos do card — uma
 * consulta pesada (`buscar-kommo`) por miniatura, para cada card na tela. Ela
 * continua abrindo como sempre, pelo nome, no clique.
 */
export function grupoDeMiniaturas(arquivos: readonly KommoNota[]): GrupoDeMiniaturas {
  const imagens: KommoNota[] = []
  const outros: KommoNota[] = []
  for (const a of arquivos) {
    if (a.arquivo_uuid && ehImagem(nomeDoAnexo(a))) imagens.push(a)
    else outros.push(a)
  }
  return { imagens, outros, selo: imagens.length > 1 ? `+${imagens.length - 1}` : null }
}

// ─── A validade do link ──────────────────────────────────────────────────────

/** Sem prazo escrito no link, quanto ele fica no cache. */
export const VALIDADE_PADRAO_MS = 10 * 60 * 1000
/** Quanto antes de vencer o link deixa de ser usado. */
export const MARGEM_DO_VENCIMENTO_MS = 60 * 1000

/** "20261006T120000Z" (o `X-Amz-Date`) em milissegundos. */
function dataCompacta(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN
}

/** Segundos (ou milissegundos) desde 1970, como os links costumam escrever. */
function instanteNumerico(s: string): number {
  if (!/^\d{9,13}$/.test(s)) return NaN
  const n = Number(s)
  return n < 1e12 ? n * 1000 : n
}

/**
 * Até quando o link pode ser usado (em ms), já com a margem.
 *
 * O KOMMO NÃO DIZ O PRAZO na resposta dos metadados do drive. Quando o próprio
 * link o escreve — `expires`/`Expires`/`exp` em segundos, ou o par
 * `X-Amz-Date` + `X-Amz-Expires` de um link assinado no estilo S3 —, vale o que
 * ele diz, menos um minuto: um link pego no último segundo venceria entre o
 * pedido e a imagem chegar. Sem prazo escrito, `padraoMs` (dez minutos): curto o
 * bastante para nunca usar um link morto por muito tempo, longo o bastante para
 * a pessoa rolar a lista e voltar sem pedir de novo.
 *
 * NUNCA MAIS QUE O PADRÃO: um prazo de um dia escrito no link não prende no
 * cache um endereço que o Kommo pode revogar antes.
 */
export function validadeDoLink(
  url: string,
  agoraMs: number,
  padraoMs = VALIDADE_PADRAO_MS,
  margemMs = MARGEM_DO_VENCIMENTO_MS,
): number {
  const teto = agoraMs + padraoMs
  let q: URLSearchParams
  try {
    q = new URL(url).searchParams
  } catch {
    return teto
  }
  let vence = NaN
  for (const chave of ['expires', 'Expires', 'exp']) {
    const v = q.get(chave)
    if (v) {
      vence = instanteNumerico(v)
      break
    }
  }
  const amzData = q.get('X-Amz-Date')
  const amzPrazo = q.get('X-Amz-Expires')
  if (Number.isNaN(vence) && amzData && amzPrazo && /^\d+$/.test(amzPrazo)) {
    vence = dataCompacta(amzData) + Number(amzPrazo) * 1000
  }
  if (Number.isNaN(vence)) return teto
  return Math.min(teto, vence - margemMs)
}

// ─── O limite de pedidos ao mesmo tempo ──────────────────────────────────────

/**
 * Uma fila que deixa no máximo `limite` tarefas correndo ao mesmo tempo.
 *
 * POR QUE: uma lista de Análise rolada depressa põe vinte miniaturas na tela
 * num segundo. Cada uma é uma ida à `kommo-anexo` e dela ao Kommo, que limita a
 * conta a 7 pedidos por segundo — e a mesma conta serve o `kommo-sync` e quem
 * está anotando. Duas de cada vez, a ~0,5 s cada, ficam perto de 4 por segundo
 * no pior caso; as outras esperam a vez, na ordem em que apareceram.
 */
export function criarLimitador(limite: number) {
  let correndo = 0
  const fila: (() => void)[] = []
  const proxima = () => {
    if (correndo >= limite) return
    const vez = fila.shift()
    if (vez) vez()
  }
  return function <T>(tarefa: () => Promise<T>): Promise<T> {
    return new Promise<T>((ok, falha) => {
      fila.push(() => {
        correndo += 1
        let p: Promise<T>
        try {
          p = tarefa()
        } catch (e) {
          p = Promise.reject(e)
        }
        p.then(ok, falha).finally(() => {
          correndo -= 1
          proxima()
        })
      })
      proxima()
    })
  }
}

// ─── O cache dos links ───────────────────────────────────────────────────────

/** O que a `kommo-anexo` devolve e a tela usa. */
export interface LinkDoAnexo {
  download: string
  /** A prévia pequena do drive, quando o Kommo a gera (ver a função). */
  miniatura?: string | null
  nome?: string
  mime?: string
}

interface Guardado {
  promessa: Promise<LinkDoAnexo>
  /** Nulo enquanto o pedido não voltou: a promessa em voo vale sempre. */
  venceEm: number | null
}

/**
 * O cache dos links dos anexos, por uuid, na memória da página.
 *
 * GUARDA A PROMESSA, e não o valor: a miniatura do card e a do histórico do
 * mesmo arquivo, aparecendo juntas, entram na MESMA espera em vez de pedirem
 * duas vezes. Quando a resposta chega, o prazo do link (`validadeDoLink`) passa
 * a valer; vencido, o próximo pedido busca de novo.
 *
 * FALHA NÃO FICA GUARDADA: a próxima tentativa (o "Abrir" da miniatura que não
 * carregou) vai ao servidor de novo, em vez de repetir um erro de rede.
 */
export function criarCacheDeLinks({
  buscar,
  agora = () => Date.now(),
  concorrencia = 2,
  padraoMs = VALIDADE_PADRAO_MS,
}: {
  buscar: (uuid: string) => Promise<LinkDoAnexo>
  agora?: () => number
  concorrencia?: number
  padraoMs?: number
}) {
  const guardados = new Map<string, Guardado>()
  const naFila = criarLimitador(concorrencia)

  function obter(uuid: string): Promise<LinkDoAnexo> {
    const g = guardados.get(uuid)
    if (g && (g.venceEm === null || agora() < g.venceEm)) return g.promessa
    const novo: Guardado = { promessa: naFila(() => buscar(uuid)), venceEm: null }
    guardados.set(uuid, novo)
    novo.promessa.then(
      (link) => {
        const t = agora()
        // O PRAZO É O DO LINK QUE VENCE PRIMEIRO: a miniatura e o download
        // costumam ser assinados juntos, mas nada garante.
        const prazos = [link.download, link.miniatura]
          .filter((u): u is string => !!u)
          .map((u) => validadeDoLink(u, t, padraoMs))
        novo.venceEm = prazos.length ? Math.min(...prazos) : t
      },
      () => {
        if (guardados.get(uuid) === novo) guardados.delete(uuid)
      },
    )
    return novo.promessa
  }

  return {
    obter,
    /** Joga fora o link guardado — a imagem não abriu com ele. */
    esquecer(uuid: string) {
      guardados.delete(uuid)
    },
    /** Quantos links o cache guarda (para o teste). */
    get tamanho() {
      return guardados.size
    },
  }
}

export type CacheDeLinks = ReturnType<typeof criarCacheDeLinks>

// ─── As imagens escolhidas na caixa do Anotar ────────────────────────────────

/**
 * Acerta os endereços locais (`blob:`) das imagens da caixa do Anotar com a
 * lista de agora: cria o que entrou, REVOGA o que saiu (tirado com o X ou já
 * enviado). Devolve o mapa novo, chave → endereço.
 *
 * REVOGAR É O QUE IMPORTA: cada `createObjectURL` prende o arquivo inteiro na
 * memória da aba até ser revogado — um print de 5 MB esquecido fica lá até a
 * página fechar, e quem anota o dia todo cola dezenas.
 */
export function acertarEnderecosLocais(
  guardados: ReadonlyMap<string, string>,
  imagens: readonly { chave: string; arquivo: Blob }[],
  criar: (arquivo: Blob) => string,
  revogar: (url: string) => void,
): Map<string, string> {
  const novo = new Map<string, string>()
  for (const { chave, arquivo } of imagens) {
    novo.set(chave, guardados.get(chave) ?? criar(arquivo))
  }
  for (const [chave, url] of guardados) if (!novo.has(chave)) revogar(url)
  return novo
}
