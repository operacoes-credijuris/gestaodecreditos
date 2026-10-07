// OS AUTOS JUNTADOS — cada processo do card num PDF só (ou em poucas partes).
//
// O PEDIDO DO DONO (07/10/2026). A rotina subia cada DOCUMENTO do processo como
// um PDF separado: 21 a 421 arquivos por processo, na área Arquivos do card.
// "Antigamente a gente baixava o processo inteiro e, no máximo, dava uns três
// arquivos: o conhecimento, o cumprimento e o precatório. Se ficar multiplicando
// arquivos, a IA fica doida tentando contextualizar qual é qual." E a equipe não
// via os arquivos: o que só se liga ao card (PUT /leads/{id}/files) não aparece
// no chat do card no Kommo.
//
// AGORA: os documentos de cada processo são JUNTADOS num PDF, na ordem do
// processo, e só se dividem em PARTES quando o tamanho obriga (memória da
// função, teto do Kommo). Cada parte sobe ao card e entra também como NOTA DE
// ANEXO no chat, onde a equipe a vê.
//
// ESTE ARQUIVO é a parte pura: o plano das partes, os nomes, o estado da
// junção (que atravessa invocações, guardado no banco), as notas e a regra que
// faz o "Executar análise" preferir as partes aos arquivos soltos antigos.
//
// SEM `Deno.` E SEM `npm:`: o vitest alcança este módulo direto.

/**
 * O tamanho de cada parte, no máximo, enquanto nada der errado.
 *
 * MEDIDO, e não chutado (07/10/2026, pdf-lib 1.17.1, PDFs de imagem gerados no
 * teste): juntar 50 MB custou ~0,5 s de CPU e o pico de memória ficou em ~2,2×
 * o tamanho da parte acima da base — 50 MB → ~115 MB a mais; 80 MB → ~175 MB.
 * Com os 256 MB da Edge Function e a base do Deno, 80 MB é encostar no teto; 48
 * MB deixa folga para a janela de download e para o envio. Se mesmo assim a
 * parte derrubar a volta, ela encolhe pela metade (ver `antesDaParte`).
 */
export const ALVO_PARTE_BYTES = 48 * 1024 * 1024
/** Menor que isto a parte não encolhe: o defeito não é de tamanho. */
export const MIN_ALVO_BYTES = 4 * 1024 * 1024
/** Quantas vezes a mesma parte pode derrubar a volta (ou falhar de vez) antes de encolher. */
export const FALHAS_ANTES_DE_ENCOLHER = 2
/** Falhas passageiras seguidas (rede, 5xx) antes de contarem como falha de verdade. */
export const MAX_PASSAGEIRAS = 6
/** Medições de um documento que falharam de passagem antes de ele ficar de fora. */
export const MAX_TENTATIVAS_MEDIR = 4

/** Um documento dos autos, como a junção o vê (de `escavador_documento`). */
export interface DocDaJuntada {
  ordem: number
  chave: string
  nome: string
  data: string | null
  paginas: number
  /** Tamanho do PDF. Null = ainda não medido. */
  bytes: number | null
}

/** Uma parte que já subiu ao drive do Kommo. */
export interface ParteFeita {
  n: number
  /** A primeira e a última `ordem` cobertas por esta parte (os não juntados no meio ficam de fora). */
  de: number
  ate: number
  nome: string
  uuid: string
  versao: string | null
  bytes: number
  paginas: number
  documentos: number
  primeiro: string | null
  ultimo: string | null
  /** Já ligada ao card (área Arquivos). */
  ligada: boolean
  /** A nota de anexo no chat: feita, por fazer, ou recusada pelo Kommo. */
  nota: 'feita' | 'pendente' | 'recusada'
}

/** Documento que ficou fora da junção, e por quê. */
export interface NaoJuntado {
  ordem: number
  nome: string
  data: string | null
  motivo: string
}

/**
 * O estado da junção de um processo, guardado no banco (coluna `juntada`).
 *
 * OS BYTES DA PARTE EM CURSO NÃO FICAM AQUI — não cabem. Cada parte é montada
 * e enviada dentro de uma invocação só; a seguinte começa da próxima. O que
 * atravessa as invocações é isto: as partes prontas, o que não entrou, o
 * tamanho-alvo e a contagem de falhas.
 */
export interface Juntada {
  v: 1
  /** 'rejuntar': o processo já tinha os documentos soltos no card (os de antes de 07/10/2026). */
  modo: 'novo' | 'rejuntar'
  alvo: number
  /** O teto de arquivo que o drive do Kommo informou, quando já se sabe. */
  maxKommo: number | null
  partes: ParteFeita[]
  naoJuntados: NaoJuntado[]
  /** Tentativas da parte em curso que não terminaram. Conta ANTES de começar. */
  falhas: number
  passageiras: number
  /** Velocidade de envio ao Kommo observada (bytes/s), para estimar o tempo da próxima parte. */
  bps: number | null
  /** Tentativas de medir cada documento (pela ordem) que falharam de passagem. */
  tentativasMedir: Record<string, number>
  concluida: boolean
  notaFinal: boolean
}

export function juntadaInicial(modo: Juntada['modo']): Juntada {
  return {
    v: 1,
    modo,
    alvo: ALVO_PARTE_BYTES,
    maxKommo: null,
    partes: [],
    naoJuntados: [],
    falhas: 0,
    passageiras: 0,
    bps: null,
    tentativasMedir: {},
    concluida: false,
    notaFinal: false,
  }
}

const num = (x: unknown, padrao: number) => (Number.isFinite(Number(x)) ? Number(x) : padrao)
const txt = (x: unknown) => (x == null ? null : String(x))

/**
 * O estado lido do banco, conferido campo a campo. JSON torto (versão antiga,
 * edição à mão) não derruba a rotina: o que não se entende volta ao padrão.
 */
export function lerJuntada(bruto: unknown): Juntada | null {
  if (!bruto || typeof bruto !== 'object') return null
  const j = bruto as Record<string, unknown>
  if (j.v !== 1) return null
  const base = juntadaInicial(j.modo === 'rejuntar' ? 'rejuntar' : 'novo')
  const partes = (Array.isArray(j.partes) ? j.partes : [])
    .map((p): ParteFeita | null => {
      const x = (p ?? {}) as Record<string, unknown>
      if (!x.uuid) return null
      const nota = x.nota === 'feita' || x.nota === 'recusada' ? x.nota : 'pendente'
      return {
        n: num(x.n, 0),
        de: num(x.de, 0),
        ate: num(x.ate, 0),
        nome: String(x.nome ?? ''),
        uuid: String(x.uuid),
        versao: txt(x.versao),
        bytes: num(x.bytes, 0),
        paginas: num(x.paginas, 0),
        documentos: num(x.documentos, 0),
        primeiro: txt(x.primeiro),
        ultimo: txt(x.ultimo),
        ligada: x.ligada === true,
        nota,
      }
    })
    .filter((p): p is ParteFeita => !!p)
    .sort((a, b) => a.n - b.n)
  const naoJuntados = (Array.isArray(j.naoJuntados) ? j.naoJuntados : [])
    .map((d) => {
      const x = (d ?? {}) as Record<string, unknown>
      return { ordem: num(x.ordem, 0), nome: String(x.nome ?? ''), data: txt(x.data), motivo: String(x.motivo ?? 'erro') }
    })
  return {
    ...base,
    alvo: Math.max(MIN_ALVO_BYTES, num(j.alvo, ALVO_PARTE_BYTES)),
    maxKommo: j.maxKommo == null ? null : num(j.maxKommo, 0) || null,
    partes,
    naoJuntados,
    falhas: num(j.falhas, 0),
    passageiras: num(j.passageiras, 0),
    bps: j.bps == null ? null : num(j.bps, 0) || null,
    tentativasMedir: Object.fromEntries(
      Object.entries((j.tentativasMedir ?? {}) as Record<string, unknown>).map(([k, x]) => [k, num(x, 0)]),
    ),
    concluida: j.concluida === true,
    notaFinal: j.notaFinal === true,
  }
}

/** Uma parte planejada: as ordens que entram nela e o tamanho somado. */
export interface PartePlanejada {
  ordens: number[]
  bytes: number
}

/** O tamanho que a parte pode ter: o alvo, abaixo do teto do Kommo com folga de 5%. */
export function alvoEfetivo(j: Pick<Juntada, 'alvo' | 'maxKommo'>): number {
  const teto = j.maxKommo ? Math.floor(j.maxKommo * 0.95) : Infinity
  return Math.max(1, Math.min(j.alvo, teto))
}

/**
 * O PLANO DAS PARTES: os documentos na ordem do processo, empacotados enquanto
 * couberem no alvo. Sem reordenar para "encaixar melhor": a parte 1 é o começo
 * do processo e a última é o fim, como no tribunal.
 *
 * Documento maior que o alvo vai sozinho numa parte (sobe como veio, sem
 * passar pela junção). Os já juntados (até `desde`) e os que ficaram de fora
 * não entram. O plano é DETERMINÍSTICO: com os mesmos tamanhos e o mesmo alvo,
 * sai o mesmo — e é isso que deixa o "parte 2 de 4" de uma invocação bater
 * com o da seguinte.
 */
export function planoDasPartes(
  docs: Pick<DocDaJuntada, 'ordem' | 'bytes'>[],
  alvo: number,
  o: { desde?: number; fora?: Iterable<number> } = {},
): PartePlanejada[] {
  const fora = new Set(o.fora ?? [])
  const desde = o.desde ?? 0
  const lista = [...docs].filter((d) => d.ordem > desde && !fora.has(d.ordem)).sort((a, b) => a.ordem - b.ordem)
  const partes: PartePlanejada[] = []
  let atual: PartePlanejada | null = null
  for (const d of lista) {
    const b = Math.max(0, Number(d.bytes) || 0)
    if (atual && atual.bytes + b > alvo) {
      partes.push(atual)
      atual = null
    }
    if (!atual) atual = { ordens: [], bytes: 0 }
    atual.ordens.push(d.ordem)
    atual.bytes += b
  }
  if (atual) partes.push(atual)
  return partes
}

/** Os documentos que ainda não têm tamanho (e não estão fora): é o que falta medir antes do plano. */
export function faltaMedir<T extends Pick<DocDaJuntada, 'ordem' | 'bytes'>>(docs: T[], j: Juntada): T[] {
  const fora = new Set(j.naoJuntados.map((d) => d.ordem))
  return docs.filter((d) => (d.bytes == null || !(Number(d.bytes) > 0)) && !fora.has(d.ordem))
}

/** Onde a junção está: medir, montar a próxima parte, ou fechar (notas). */
export function proximoPasso(
  docs: Pick<DocDaJuntada, 'ordem' | 'bytes'>[],
  j: Juntada,
): { passo: 'medir' } | { passo: 'parte'; parte: PartePlanejada; n: number; total: number } | { passo: 'fechar' } {
  if (faltaMedir(docs, j).length) return { passo: 'medir' }
  const desde = j.partes.length ? Math.max(...j.partes.map((p) => p.ate)) : 0
  const resto = planoDasPartes(docs, alvoEfetivo(j), { desde, fora: j.naoJuntados.map((d) => d.ordem) })
  if (resto.length === 0) return { passo: 'fechar' }
  return { passo: 'parte', parte: resto[0], n: j.partes.length + 1, total: j.partes.length + resto.length }
}

/**
 * Antes de montar uma parte: conta a tentativa (se a volta morrer no meio —
 * memória, CPU, tempo —, a conta já está feita) e, se a mesma parte já caiu
 * vezes demais, encolhe o alvo pela metade. Devolve 'desistir' quando nem o
 * menor alvo passa.
 */
export function antesDaParte(j: Juntada): 'seguir' | 'desistir' {
  if (j.falhas >= FALHAS_ANTES_DE_ENCOLHER) {
    if (j.alvo <= MIN_ALVO_BYTES) return 'desistir'
    j.alvo = Math.max(MIN_ALVO_BYTES, Math.floor(j.alvo / 2))
    j.falhas = 0
  }
  j.falhas++
  return 'seguir'
}

/**
 * Depois da parte. 'ok' zera as contas. 'passageira' (rede, 5xx, o Escavador
 * fora do ar) devolve a tentativa — a parte não teve culpa —, até um limite:
 * passado dele, conta como falha. 'falha' (tempo que não deu, Kommo recusando
 * o tamanho) fica contada, e a próxima volta encolhe a parte se precisar.
 */
export function depoisDaParte(j: Juntada, resultado: 'ok' | 'passageira' | 'falha'): void {
  if (resultado === 'ok') {
    j.falhas = 0
    j.passageiras = 0
    return
  }
  if (resultado === 'passageira') {
    j.passageiras++
    if (j.passageiras <= MAX_PASSAGEIRAS) j.falhas = Math.max(0, j.falhas - 1)
  }
}

/** Uma parte que subiu. */
export function registrarParte(j: Juntada, p: ParteFeita): void {
  j.partes = [...j.partes.filter((x) => x.n !== p.n), p].sort((a, b) => a.n - b.n)
}

/**
 * O nome da parte no card.
 *
 * "Conhecimento - autos completos - 0001234-56.2020.8.05.0001.pdf" quando o
 * processo coube num PDF só; "Conhecimento - autos (parte 2 de 3) - ….pdf"
 * quando não. O RÓTULO NA FRENTE, como antes: é o que diz a quem lê (e à IA)
 * qual processo é qual. O CNJ no fim: dois processos com o mesmo papel no card
 * continuam distinguíveis.
 */
export function nomeDaParte(rotulo: string, cnj: string, n: number, total: number): string {
  const r = (rotulo || 'Autos').replace(/[\\/:*?"<>|]/g, '-').trim()
  const generico = /^(autos|processo)$/i.test(r)
  const cabeca = generico ? 'Autos' : `${r} - autos`
  return total <= 1 ? `${cabeca} completos - ${cnj}.pdf` : `${cabeca} (parte ${n} de ${total}) - ${cnj}.pdf`
}

/** É o nome de uma parte juntada (de qualquer processo)? */
export function ehParteJuntada(nome: string): boolean {
  return /(?:^|- )autos (?:completos|\(parte \d+ de \d+\)) - [\d.-]+\.pdf$/i.test(nome.trim())
}

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * É um documento SOLTO deste rótulo, no formato antigo ("Conhecimento 001 -
 * 09-06-2020 - Petição Inicial.pdf")?
 */
export function ehSoltoDoRotulo(nome: string, rotulo: string): boolean {
  return ordemDoSolto(nome, rotulo) !== null
}

/** O número do documento solto deste rótulo ("Conhecimento 037 - …" → 37), ou null. */
export function ordemDoSolto(nome: string, rotulo: string): number | null {
  const n = semAcento(nome)
  const r = semAcento(rotulo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`^${r} (\\d{3,})(?: - |\\.pdf$)`).exec(n)
  return m ? Number(m[1]) : null
}

/** Um processo do card, como a análise precisa vê-lo para escolher os arquivos. */
export interface ProcessoParaAnalise {
  cnj: string
  rotulo: string
  /** A junção terminou (todas as partes no card). */
  juntado: boolean
  /** Os uuids das partes juntadas. */
  partes: string[]
  /** Os documentos soltos que a rotina subiu deste processo (`escavador_documento`: uuid e ordem). */
  soltos: { uuid: string; ordem: number }[]
  /**
   * As ordens dos documentos que a junção NÃO conseguiu juntar. O solto deles
   * continua sendo lido: é a única cópia daquele documento no card.
   */
  naoJuntados?: number[]
}

/**
 * PARTES > SOLTOS: o que o "Executar análise" lê de um card que tem os dois.
 *
 * Os cards antigos têm os documentos soltos ("Conhecimento 001 - …") e, depois
 * de rejuntados, também as partes. Ler os dois é a análise ver o processo duas
 * vezes — e os 400 arquivos soltos de novo.
 *
 * A REGRA, do mais seguro ao menos:
 *  1. Um processo só substitui os soltos dele quando a junção TERMINOU e TODAS
 *     as partes dele estão no card agora. Parte apagada à mão no Kommo = os
 *     soltos voltam a valer; nada fica sem ser lido.
 *  2. Solto se reconhece primeiro pelo UUID — o registro do que a rotina subiu.
 *     É exato e não depende de nome.
 *  3. Pelo NOME só como reserva (o arquivo que subiu duas vezes, cujo uuid o
 *     banco não guardou), e só quando TODOS os processos do card com aquele
 *     rótulo foram substituídos: dois processos "Autos" no card, um juntado e
 *     outro não, e o nome não diz de qual é o arquivo — então fica.
 *  4. Parte nunca é ignorada, nem o solto de um documento que ficou FORA da
 *     junção (cifrado, corrompido, sem download): é a única cópia dele.
 */
export function arquivosParaAnalise<T extends { uuid: string; nome?: string | null }>(
  arquivos: T[],
  processos: ProcessoParaAnalise[],
): { ler: T[]; ignorados: T[] } {
  const noCard = new Set(arquivos.map((a) => a.uuid))
  const todasAsPartes = new Set(processos.flatMap((p) => p.partes))
  const substituidos = processos.filter(
    (p) => p.juntado && p.partes.length > 0 && p.partes.every((u) => noCard.has(u)),
  )
  const soltos = new Set(
    substituidos
      .flatMap((p) => p.soltos.filter((s) => !(p.naoJuntados ?? []).includes(s.ordem)).map((s) => s.uuid))
      .filter((u) => !todasAsPartes.has(u)),
  )
  const porRotulo = new Map<string, { ok: boolean; fora: Set<number> }>()
  for (const p of processos) {
    const r = semAcento(p.rotulo)
    const atual = porRotulo.get(r) ?? { ok: true, fora: new Set<number>() }
    atual.ok = atual.ok && substituidos.includes(p)
    for (const o of p.naoJuntados ?? []) atual.fora.add(o)
    porRotulo.set(r, atual)
  }
  const rotulosSeguros = [...porRotulo.entries()].filter(([, v]) => v.ok)
  const soltoPeloNome = (nome: string) =>
    rotulosSeguros.some(([r, v]) => {
      const ordem = ordemDoSolto(nome, r)
      return ordem !== null && !v.fora.has(ordem)
    })

  const ler: T[] = []
  const ignorados: T[] = []
  for (const a of arquivos) {
    const parte = todasAsPartes.has(a.uuid) || (a.nome ? ehParteJuntada(a.nome) : false)
    const solto =
      !parte &&
      (soltos.has(a.uuid) || (!!a.nome && soltoPeloNome(String(a.nome))))
    ;(solto ? ignorados : ler).push(a)
  }
  return { ler, ignorados }
}

// ------------------------------------------------------------------ AS NOTAS

const dataBR = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}
const milhar = (n: number) => n.toLocaleString('pt-BR')
const periodo = (a: string | null, b: string | null) =>
  a && b ? (dataBR(a) === dataBR(b) ? `de ${dataBR(a)}` : `de ${dataBR(a)} a ${dataBR(b)}`) : ''

/** Como o documento aparece na lista dos que ficaram de fora. */
export function descreverNaoJuntado(d: NaoJuntado, total: number): string {
  const casas = Math.max(3, String(total).length)
  const data = dataBR(d.data)
  return `${String(d.ordem).padStart(casas, '0')}${data ? ` - ${data}` : ''} - ${d.nome} (${d.motivo})`
}

/**
 * A NOTA DOS AUTOS, quando o processo termina de subir juntado.
 *
 * O QUE ELA PRECISA DIZER (pedido de 07/10/2026): de que processo, qual o
 * papel dele, quantos documentos viraram quantos PDFs (e quantas páginas), de
 * quando a quando — e ONDE os PDFs estão. Sem o "onde", a equipe procurava os
 * arquivos e não achava.
 */
export function notaDosAutosJuntos(o: {
  cnj: string
  rotulo: string
  modo: Juntada['modo']
  partes: Pick<ParteFeita, 'nome' | 'documentos' | 'paginas' | 'primeiro' | 'ultimo' | 'nota'>[]
  totalDocumentos: number
  naoJuntados: NaoJuntado[]
}): string {
  const docs = o.partes.reduce((t, p) => t + p.documentos, 0)
  const paginas = o.partes.reduce((t, p) => t + p.paginas, 0)
  const datas = o.partes.flatMap((p) => [p.primeiro, p.ultimo]).filter((d): d is string => !!d).sort()
  const quando = periodo(datas[0] ?? null, datas.at(-1) ?? null)
  const papel = o.rotulo && !/^(autos|processo)$/i.test(o.rotulo) ? ` (${o.rotulo.toLowerCase()})` : ''
  const pdfs = o.partes.length === 1 ? 'um PDF só' : `${o.partes.length} PDFs`
  const noChat = o.partes.every((p) => p.nota === 'feita')
  const linhas = [
    `📂 Autos do processo ${o.cnj}${papel}, baixados pelo Escavador: ${milhar(docs)} documento(s) reunidos em ${pdfs}` +
      (paginas ? `, ${milhar(paginas)} páginas` : '') +
      (quando ? `, ${quando}` : '') +
      '.',
    noChat
      ? `${o.partes.length === 1 ? 'O PDF está' : 'Os PDFs estão'} logo acima, neste chat, e na área Arquivos do card:`
      : `${o.partes.length === 1 ? 'O PDF está' : 'Os PDFs estão'} na área Arquivos do card` +
        ' (o Kommo recusou a nota de anexo no chat de algum deles):',
    ...o.partes.map((p) => {
      const q = periodo(p.primeiro, p.ultimo)
      return `• ${p.nome} — ${milhar(p.documentos)} doc.` + (p.paginas ? `, ${milhar(p.paginas)} pág.` : '') + (q ? `, ${q}` : '')
    }),
    'Dentro de cada PDF os documentos seguem a ordem do processo, do mais antigo ao mais novo.',
  ]
  if (o.modo === 'rejuntar') {
    linhas.push(
      'Os documentos soltos que este card já tinha deste processo continuam na área Arquivos; ' +
        'o "Executar análise" passa a ler só os PDFs juntados.',
    )
  }
  if (o.naoJuntados.length) {
    const lista = o.naoJuntados.slice(0, 8).map((d) => descreverNaoJuntado(d, o.totalDocumentos))
    linhas.push(
      `⚠️ ${o.naoJuntados.length} documento(s) não puderam ser juntados: ${lista.join('; ')}` +
        `${o.naoJuntados.length > 8 ? '…' : ''}. Se forem importantes, baixe-os no Escavador ou no tribunal.`,
    )
  }
  return linhas.join('\n')
}

/** A nota quando a junção não chega ao fim. */
export function notaDaJuntadaQueFalhou(o: {
  cnj: string
  rotulo: string
  partes: Pick<ParteFeita, 'nome'>[]
  motivo: string
  modo?: Juntada['modo']
}): string {
  const papel = o.rotulo && !/^(autos|processo)$/i.test(o.rotulo) ? ` (${o.rotulo.toLowerCase()})` : ''
  if (o.modo === 'rejuntar') {
    // O CARD JÁ TINHA OS AUTOS, soltos: a falha da junção não tira nada dele.
    const feitas = o.partes.length
      ? ` Subiram ${o.partes.length} parte(s), logo acima neste chat; não confie nelas como autos completos.`
      : ''
    return `⚠️ Não consegui juntar em poucos PDFs os autos do processo ${o.cnj}${papel}: ${o.motivo}.${feitas} ` +
      'Os documentos soltos deste processo continuam na área Arquivos do card, como antes, e a análise segue lendo-os.'
  }
  const feitas = o.partes.length
    ? ` Subiram ${o.partes.length} parte(s), que estão logo acima, neste chat, e na área Arquivos do card: ` +
      o.partes.map((p) => p.nome).join('; ') + '. O resto do processo não está no card.'
    : ' Nenhum PDF deste processo subiu ao card.'
  return `⚠️ Não consegui juntar os autos do processo ${o.cnj}${papel}: ${o.motivo}.${feitas} Anexe o que faltar à mão.`
}
