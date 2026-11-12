/**
 * UM BANCO DE MENTIRA PARA OS EXECUTORES DO ASSISTENTE (12/11/2026).
 *
 * As ferramentas da operação (supabase/functions/assistente/ferramentasDaOperacao.ts)
 * só falam com o banco pelo construtor do supabase-js. Este imita o pedaço que
 * elas usam — filtros, ordem, `range`, `limit`, `maybeSingle`, `count` — sobre
 * tabelas em memória, para os testes rodarem a ferramenta INTEIRA sem rede e sem
 * tocar o banco de produção.
 *
 * O `select` não recorta colunas: a fixture já vem no formato que a consulta
 * devolveria (com os apelidos, como `campos`, e os embutidos, como
 * `certidao_catalogo`). E o teto de 1000 linhas do PostgREST é imitado: sem
 * `range`, a resposta para em 1000 — é o corte calado que a leitura paginada evita.
 */

type Linha = Record<string, unknown>

const TETO_DO_POSTGREST = 1000

function comoRegex(padrao: string): RegExp {
  const corpo = padrao
    .split('')
    .map((c) => (c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('')
  return new RegExp(`^${corpo}$`, 'is')
}

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v))

class Consulta implements PromiseLike<unknown> {
  private filtros: ((l: Linha) => boolean)[] = []
  private ordens: { coluna: string; asc: boolean }[] = []
  private de = 0
  private ate = Infinity
  private teto = Infinity
  private soContagem = false
  private umSo = false

  constructor(
    private readonly tabela: string,
    private readonly banco: BancoFalso,
  ) {}

  select(_colunas?: string, opcoes?: { count?: string; head?: boolean }) {
    this.banco.selects.push({ tabela: this.tabela, colunas: _colunas ?? '*' })
    if (opcoes?.head) this.soContagem = true
    return this
  }
  eq(c: string, v: unknown) {
    this.filtros.push((l) => texto(l[c]) === texto(v))
    return this
  }
  neq(c: string, v: unknown) {
    this.filtros.push((l) => texto(l[c]) !== texto(v))
    return this
  }
  in(c: string, vs: unknown[]) {
    const alvo = new Set(vs.map(texto))
    this.filtros.push((l) => alvo.has(texto(l[c])))
    return this
  }
  gte(c: string, v: unknown) {
    this.filtros.push((l) => l[c] != null && comparar(l[c], v) >= 0)
    return this
  }
  gt(c: string, v: unknown) {
    this.filtros.push((l) => l[c] != null && comparar(l[c], v) > 0)
    return this
  }
  lte(c: string, v: unknown) {
    this.filtros.push((l) => l[c] != null && comparar(l[c], v) <= 0)
    return this
  }
  lt(c: string, v: unknown) {
    this.filtros.push((l) => l[c] != null && comparar(l[c], v) < 0)
    return this
  }
  ilike(c: string, padrao: string) {
    const re = comoRegex(padrao)
    this.filtros.push((l) => re.test(texto(l[c])))
    return this
  }
  is(c: string, _v: null) {
    this.filtros.push((l) => l[c] === null || l[c] === undefined)
    return this
  }
  not(c: string, _op: string, _v: null) {
    this.filtros.push((l) => l[c] !== null && l[c] !== undefined)
    return this
  }
  /** Só o que as ferramentas usam: "col.ilike.padrão,col.ilike.padrão". */
  or(expr: string) {
    const partes = expr.split(',').map((p) => {
      const [col, op, ...resto] = p.split('.')
      if (op !== 'ilike') throw new Error(`or() do banco falso só entende ilike: ${p}`)
      return { col, re: comoRegex(resto.join('.')) }
    })
    this.filtros.push((l) => partes.some((p) => p.re.test(texto(l[p.col]))))
    return this
  }
  order(coluna: string, opcoes?: { ascending?: boolean }) {
    this.ordens.push({ coluna, asc: opcoes?.ascending !== false })
    return this
  }
  limit(n: number) {
    this.teto = n
    return this
  }
  range(de: number, ate: number) {
    this.de = de
    this.ate = ate
    return this
  }
  maybeSingle() {
    this.umSo = true
    return this
  }

  then<A = unknown, B = never>(
    ok?: ((v: unknown) => A | PromiseLike<A>) | null,
    falha?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.executar()).then(ok, falha)
  }

  private executar() {
    this.banco.consultas.push(this.tabela)
    const erro = this.banco.erros[this.tabela]
    if (erro) return { data: null, error: { message: erro }, count: null }
    let linhas = (this.banco.tabelas[this.tabela] ?? []).filter((l) => this.filtros.every((f) => f(l)))
    if (this.soContagem) return { data: null, error: null, count: linhas.length }
    for (const o of [...this.ordens].reverse()) {
      linhas = [...linhas].sort((a, b) => (o.asc ? 1 : -1) * comparar(a[o.coluna], b[o.coluna]))
    }
    const fim = Math.min(this.ate + 1, this.de + TETO_DO_POSTGREST)
    linhas = linhas.slice(this.de, fim).slice(0, this.teto)
    if (this.umSo) return { data: linhas[0] ?? null, error: null }
    return { data: linhas, error: null }
  }
}

/** Instante com fuso ("2026-11-01T00:00:00-03:00") compara como instante, como no Postgres. */
const INSTANTE = /^\d{4}-\d{2}-\d{2}T/

function comparar(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (INSTANTE.test(texto(a)) && INSTANTE.test(texto(b))) return Date.parse(texto(a)) - Date.parse(texto(b))
  return texto(a).localeCompare(texto(b))
}

export class BancoFalso {
  /** Tabelas cujas consultas falham, com a mensagem do erro. */
  erros: Record<string, string> = {}
  /** As tabelas consultadas, na ordem (uma entrada por página). */
  consultas: string[] = []
  /** Os selects pedidos, para conferir o que a ferramenta lê. */
  selects: { tabela: string; colunas: string }[] = []

  constructor(public tabelas: Record<string, Linha[]>) {}

  from(tabela: string) {
    return new Consulta(tabela, this)
  }
}

/** O banco de mentira, no tipo que o executor espera. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const comoCliente = (b: BancoFalso) => b as any
