// AS REGRAS PURAS DAS FERRAMENTAS DO ASSISTENTE (12/11/2026).
//
// O executor das ferramentas mora em assistente/index.ts, que sobe o servidor
// (`Deno.serve`) e importa o SDK por `npm:` — o vitest não o importa. As regras
// que decidem o resultado (validar número, casar processo por dígitos, cortar
// texto, agrupar nomes, montar a lista de pessoas e a de paralisados, traduzir
// erro da Anthropic) moram aqui para serem testadas de verdade, e não só lidas
// no fonte.
//
// Sem `Deno.` e sem `npm:`.

import { normalizarNome } from './nucleo/texto.ts'

// ------------------------------------------------------------------ números

/**
 * Um inteiro entre `min` e `max`, ou o padrão.
 *
 * O MODELO MANDA O QUE QUISER (12/11/2026): `dias: 7.5`, `"15"`, `-3`, `NaN`.
 * Fração ia crua para a data (`desde(7.5)` dava data inválida) ou para o
 * `limit` do PostgREST, que recusa a consulta inteira; negativo virava "daqui a
 * 3 dias". Número em texto é aceito (o modelo às vezes manda assim); o resto
 * cai no padrão.
 */
export function inteiroEntre(
  valor: unknown,
  { min, max, padrao }: { min: number; max: number; padrao: number },
): number {
  const n =
    typeof valor === 'number'
      ? valor
      : typeof valor === 'string' && valor.trim() !== ''
        ? Number(valor.trim())
        : Number.NaN
  if (!Number.isFinite(n)) return padrao
  return Math.min(Math.max(Math.floor(n), min), max)
}

/**
 * Um inteiro POSITIVO opcional (ex.: `dias`), ou null quando não veio ou não
 * serve — e então o filtro não é aplicado, com aviso de quem chama.
 */
export function inteiroPositivoOuNulo(valor: unknown, max = 36_500): number | null {
  if (valor === undefined || valor === null || valor === '') return null
  const n = inteiroEntre(valor, { min: 0, max, padrao: 0 })
  return n >= 1 ? n : null
}

/** A data em AAAA-MM-DD, se for uma data de verdade; senão null. */
export function dataAAAAMMDD(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const s = valor.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

// ------------------------------------------------------- número do processo

/** Só os dígitos. */
export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

/**
 * O número do processo casado pelos DÍGITOS, com ou sem máscara (12/11/2026).
 *
 * `processos.numero_cnj` é digitado à mão no cadastro (com ou sem pontuação) e
 * vem mascarado do Drive; o DJEN também grava nos dois jeitos. Um `ilike` com o
 * texto do modelo só casava quando a pessoa escrevia o número do MESMO jeito do
 * cadastro — "0001234-56.2020..." não achava "00012345620208..." e vice-versa,
 * e a resposta era "nenhum crédito" havendo.
 *
 * A expressão regular aceita qualquer coisa que não seja dígito entre dois
 * dígitos: casa a máscara, a falta dela e espaço no meio. `inteiro` exige o
 * número todo (nada de dígito antes nem depois); sem ele, é trecho.
 */
export function regexDosDigitos(digitos: string, { inteiro }: { inteiro: boolean }): string {
  const meio = soDigitos(digitos).split('').join('[^0-9]*')
  return inteiro ? `^[^0-9]*${meio}[^0-9]*$` : meio
}

/**
 * As duas grafias de um número CNJ inteiro (20 dígitos): sem máscara e com a
 * máscara padrão (0000000-00.0000.0.00.0000) — para um `.in()` que não pode
 * usar expressão regular. Número que não é CNJ inteiro volta só como veio.
 */
export function formasDoNumero(digitos: string): string[] {
  const d = soDigitos(digitos)
  if (d.length !== 20) return d ? [d] : []
  return [d, `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`]
}

/** O valor é um número de processo (só dígitos e pontuação), e não um nome? */
export function pareceNumeroDeProcesso(valor: unknown): boolean {
  const s = String(valor ?? '').trim()
  return /\d/.test(s) && /^[\d\s.\-/]+$/.test(s)
}

// ------------------------------------------------------------ texto corrido

/**
 * O TETO DE TEXTO DE UMA CHAMADA de `ler_historico_apos_data` (12/11/2026). O
 * texto vai inteiro, por processo, e quinze processos com vinte andamentos
 * longos cada passavam de centenas de milhares de caracteres — a pergunta
 * estourava a janela do modelo ("prompt is too long") em vez de responder.
 */
export const TETO_DE_CARACTERES_DO_HISTORICO = 60_000

/**
 * Os andamentos (do mais antigo ao mais recente) que cabem em `orcamento`
 * caracteres, guardando OS MAIS RECENTES: é o fim do histórico que diz onde o
 * processo está. O mais recente entra sempre — cortado, se sozinho já passa.
 */
export function cortarPorTamanho<T extends { texto?: unknown }>(
  andamentos: readonly T[],
  orcamento: number,
): { andamentos: T[]; cortado: boolean } {
  const fora: T[] = []
  let usado = 0
  for (let i = andamentos.length - 1; i >= 0; i--) {
    const a = andamentos[i]
    const tam = String(a.texto ?? '').length
    if (usado + tam <= orcamento) {
      fora.unshift(a)
      usado += tam
      continue
    }
    if (fora.length === 0) {
      fora.unshift({ ...a, texto: `${String(a.texto ?? '').slice(0, Math.max(0, orcamento))}…` })
    }
    return { andamentos: fora, cortado: true }
  }
  return { andamentos: fora, cortado: false }
}

// ------------------------------------------------------------ agrupamentos

/** As dimensões em que o mesmo nome aparece escrito de jeitos diferentes. */
const DIMENSOES_POR_NOME = new Set(['cessionario', 'originador', 'entidade_devedora', 'tribunal', 'comarca', 'vara'])

/**
 * A chave e o rótulo de um grupo do resumo financeiro (12/11/2026).
 *
 * "Fulano de Tal", "fulano de tal " e "Fulano  de Tal" eram três grupos — três
 * investidores com um terço da carteira cada. Nome de pessoa e de órgão agrupa
 * por `normalizarNome` (a mesma chave das fichas de investidor e da tela de
 * Carteiras); o rótulo é a primeira grafia vista, sem espaço sobrando.
 */
export function grupoDoValor(dimensao: string, valor: unknown): { chave: string; rotulo: string } {
  const rotulo = String(valor ?? '').replace(/\s+/g, ' ').trim()
  if (!rotulo) return { chave: '', rotulo: 'não informado' }
  return { chave: DIMENSOES_POR_NOME.has(dimensao) ? normalizarNome(rotulo) : rotulo, rotulo }
}

// --------------------------------------------------------------- investidores

/**
 * Os investidores (cessionários) distintos entre os créditos que casaram com a
 * busca, pela chave normalizada — com a grafia que aparece e quantos créditos.
 */
export function investidoresDistintos(
  creditos: readonly { cessionario?: unknown }[],
): { chave: string; nome: string; creditos: number }[] {
  const m = new Map<string, { chave: string; nome: string; creditos: number }>()
  for (const c of creditos) {
    const nome = String(c.cessionario ?? '').replace(/\s+/g, ' ').trim()
    if (!nome) continue
    const chave = normalizarNome(nome)
    const atual = m.get(chave)
    if (atual) atual.creditos += 1
    else m.set(chave, { chave, nome, creditos: 1 })
  }
  return [...m.values()].sort((a, b) => b.creditos - a.creditos || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/**
 * QUAL INVESTIDOR A BUSCA QUIS (12/11/2026). "Silva" casava três investidores, e
 * a carteira somava os três como se fossem um. Agora: um só, ele; o nome exato
 * (normalizado) entre vários, ele; senão, ninguém — e quem chama devolve os
 * candidatos para a pessoa escolher.
 */
export function escolherInvestidor(
  buscado: string,
  distintos: readonly { chave: string }[],
): string | null {
  if (distintos.length === 1) return distintos[0].chave
  const exato = distintos.find((d) => d.chave === normalizarNome(buscado))
  return exato ? exato.chave : null
}

/** Uma ficha de `investidor_dados`, só com o que a lista usa. */
export interface FichaDaPessoa {
  tipo: string
  nome_exibicao: string | null
  nome_chave: string
  [campo: string]: unknown
}

export type PapelDaPessoa = 'investidor' | 'originador'

/** De qual campo do crédito sai o nome de cada papel (o mesmo de src/lib/pessoas.ts). */
const COLUNA_DO_PAPEL: Record<PapelDaPessoa, 'cessionario' | 'originador'> = {
  investidor: 'cessionario',
  originador: 'originador',
}

/**
 * A LISTA DE PESSOAS DA TELA, NO SERVIDOR (12/11/2026). A ferramenta listava só
 * as fichas cadastradas — quem aparece nos créditos sem ficha nenhuma (o caso
 * mais incompleto de todos) não existia para "quem está com ficha incompleta".
 * E contava os créditos por `trim().toLowerCase()`, que não casa acento com a
 * chave da ficha (`normalizarNome`): "José" na ficha, "Jose" no crédito, zero
 * créditos.
 *
 * Mesma regra de `listarPessoas` (src/lib/pessoas.ts): as duas origens, os
 * créditos primeiro (a grafia do crédito vale), a ficha casada por
 * `normalizarNome === nome_chave`, em ordem alfabética.
 */
export function pessoasDoAssistente(
  papel: PapelDaPessoa,
  processos: readonly { cessionario?: unknown; originador?: unknown }[],
  fichas: readonly FichaDaPessoa[],
): { papel: PapelDaPessoa; chave: string; nome: string; creditos: number; ficha: FichaDaPessoa | null }[] {
  const coluna = COLUNA_DO_PAPEL[papel]
  const porChave = new Map<string, { papel: PapelDaPessoa; chave: string; nome: string; creditos: number; ficha: FichaDaPessoa | null }>()
  for (const p of processos) {
    const nome = String(p[coluna] ?? '').trim()
    if (!nome) continue
    const chave = normalizarNome(nome)
    const atual = porChave.get(chave)
    if (atual) atual.creditos += 1
    else porChave.set(chave, { papel, chave, nome, creditos: 1, ficha: null })
  }
  for (const f of fichas) {
    if (f.tipo !== papel) continue
    const atual = porChave.get(f.nome_chave)
    if (atual) {
      atual.ficha = f
      continue
    }
    porChave.set(f.nome_chave, {
      papel,
      chave: f.nome_chave,
      nome: f.nome_exibicao?.trim() || f.nome_chave,
      creditos: 0,
      ficha: f,
    })
  }
  return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

// ----------------------------------------------------------------- paralisados

/** Dias corridos entre duas datas AAAA-MM-DD (ou com hora), nunca negativo. */
export function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${ate.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86_400_000)) : 0
}

/**
 * Do MAIS parado ao menos parado, e quem nunca movimentou no fim — a ordem da
 * aba Paralisados (`ordenarParalisados`, src/lib/paralisados.ts; o teste
 * confere que as duas concordam).
 */
export function ordenarDoMaisParado<T>(lista: readonly T[], ultimaDe: (t: T) => string | null | undefined): T[] {
  return [...lista].sort((a, b) => {
    const ua = ultimaDe(a) ?? ''
    const ub = ultimaDe(b) ?? ''
    if (!ua && !ub) return 0
    if (!ua) return 1
    if (!ub) return -1
    return ua.localeCompare(ub)
  })
}

export interface CreditoParaParalisados {
  id: unknown
  numero_cnj: unknown
  cedente?: unknown
  cessionario?: unknown
  status?: unknown
}

export interface Paralisado {
  numero_processo: string
  numero_cnj_do_credito: string | null
  via_apenso: boolean | undefined
  cedente: unknown
  cessionario: unknown
  status: unknown
  ultima_movimentacao: string | null
  dias_parado: number | null
}

/**
 * OS PARALISADOS PELO CRITÉRIO DA TELA (12/11/2026), que a ferramenta dizia
 * seguir e não seguia:
 *
 *   - casa o processo pelos DÍGITOS INTEIROS (a tela exige 15 ou mais), e não
 *     pelos 7 primeiros — dois processos do mesmo ano e vara com o mesmo
 *     começo se confundiam, e um crédito encerrado podia emprestar o cadastro a
 *     um parado;
 *   - o número do ADVBOX pode ser de um APENSO: herda o crédito pai, como na
 *     tela;
 *   - processo com andamento dentro da janela em `advbox_movimentacoes` não é
 *     parado, mesmo que a linha de status esteja atrasada (as duas tabelas vêm
 *     de payloads diferentes do ADVBOX — é o "em Novas e em Paralisados ao
 *     mesmo tempo" que a tela já corrigiu);
 *   - nunca movimentou (sem data) entra, no fim;
 *   - do mais parado ao menos parado.
 *
 * `creditos` são só os que podem aparecer (ativos e complementares).
 */
export function paradosDaCarteira({
  status,
  creditos,
  apensos,
  comMovimentoNaJanela,
  corte,
  hoje,
}: {
  status: readonly { numero_processo: unknown; ultima_movimentacao: string | null }[]
  creditos: readonly CreditoParaParalisados[]
  apensos: readonly { numero: unknown; processo_id: unknown }[]
  comMovimentoNaJanela: ReadonlySet<string>
  corte: string
  hoje: string
}): Paralisado[] {
  const porDigitos = new Map<string, CreditoParaParalisados>()
  const porId = new Map<string, CreditoParaParalisados>()
  for (const c of creditos) {
    porId.set(String(c.id), c)
    const d = soDigitos(c.numero_cnj)
    if (d.length >= 15) porDigitos.set(d, c)
  }
  const apensoParaCredito = new Map<string, string>()
  for (const a of apensos) {
    const d = soDigitos(a.numero)
    if (d.length >= 15 && a.processo_id) apensoParaCredito.set(d, String(a.processo_id))
  }
  const fora: Paralisado[] = []
  for (const s of status) {
    const d = soDigitos(s.numero_processo)
    if (d.length < 15) continue
    let credito = porDigitos.get(d)
    let viaApenso = false
    if (!credito) {
      const pai = apensoParaCredito.get(d)
      credito = pai ? porId.get(pai) : undefined
      viaApenso = !!credito
    }
    if (!credito) continue
    if (comMovimentoNaJanela.has(d)) continue
    if (s.ultima_movimentacao && s.ultima_movimentacao.slice(0, 10) >= corte) continue
    fora.push({
      numero_processo: String(s.numero_processo),
      numero_cnj_do_credito: viaApenso ? String(credito.numero_cnj ?? '') || null : null,
      via_apenso: viaApenso || undefined,
      cedente: credito.cedente,
      cessionario: credito.cessionario,
      status: credito.status,
      ultima_movimentacao: s.ultima_movimentacao,
      dias_parado: s.ultima_movimentacao ? diasEntre(s.ultima_movimentacao, hoje) : null,
    })
  }
  return ordenarDoMaisParado(fora, (p) => p.ultima_movimentacao)
}

// ---------------------------------------------------------- erros da Anthropic

/**
 * A FALHA DA ANTHROPIC EM PORTUGUÊS, SEMPRE (12/11/2026). O que não casava com
 * nenhum caso conhecido saía cru, em inglês ("prompt is too long: 215000 tokens
 * > 200000 maximum"), na tela de quem perguntou. Agora todo caso tem frase, e o
 * que sobra diz o código HTTP — é o que o suporte precisa para achar o motivo.
 *
 * `status` vem do erro do SDK ou da resposta HTTP do upload; `bruto` é a
 * mensagem original, usada só para reconhecer o caso.
 */
export function traduzirErroDaAnthropic(status: number | undefined, bruto: string): string {
  const m = String(bruto ?? '')
  if (status === 401 || /invalid x-api-key|authentication_error/i.test(m)) {
    return (
      'A Anthropic recusou a chave de API. Confira em Configurações → ' +
      'Integração Anthropic; se a chave foi colada incompleta, gere uma nova ' +
      'em console.anthropic.com → API Keys.'
    )
  }
  if (status === 429 || /rate_limit/i.test(m)) {
    return 'Limite de uso da Anthropic atingido. Tente de novo em instantes.'
  }
  if (/credit balance|billing/i.test(m)) {
    return (
      'A conta da Anthropic está sem crédito. Verifique o saldo e o método de ' +
      'pagamento em console.anthropic.com.'
    )
  }
  if (status === 403 || /permission_error/i.test(m)) {
    return 'A chave da Anthropic não tem permissão para esta operação.'
  }
  if (/prompt is too long|too many (input )?tokens|exceeds? the (model'?s? )?(context|maximum)|context window/i.test(m)) {
    return (
      'A pergunta ficou grande demais para o modelo — somando o histórico da ' +
      'conversa, os anexos e a Base do Kommo, quando vai junto. Peça um recorte ' +
      'menor (um período, um funil, menos processos) ou comece uma conversa nova.'
    )
  }
  if (status === 413 || /request_too_large|payload too large|file too large|too large/i.test(m)) {
    return (
      'O que foi enviado passa do tamanho que a Anthropic aceita. Envie ' +
      'arquivos menores ou menos arquivos de uma vez.'
    )
  }
  if (/container/i.test(m) && /expir|not found|no longer|não existe/i.test(m)) {
    return (
      'O ambiente de execução de código desta pergunta expirou no meio do ' +
      'trabalho. Envie a pergunta de novo — ele é recriado do zero.'
    )
  }
  if (status === 404 && /model/i.test(m)) {
    return 'O modelo escolhido não está disponível para esta chave da Anthropic. Escolha outro no seletor.'
  }
  if (status !== undefined && (status >= 500 || status === 529)) {
    return 'A Anthropic está indisponível no momento. Tente de novo em instantes.'
  }
  if (status !== undefined) {
    return `A Anthropic recusou o pedido (HTTP ${status}). Tente de novo; se persistir, avise o suporte com este código.`
  }
  return 'Falha inesperada no assistente. Tente de novo; se persistir, avise o suporte.'
}
