// _shared/escavador.ts
// O ESCAVADOR, e a única pergunta que a due diligence faz a ele: "que outros
// processos existem em nome desta pessoa, e algum deles ameaça a cessão?"
//
// POR QUE UMA SEGUNDA FONTE, tendo Judit. A Judit lê OS AUTOS de um processo
// que já sabemos qual é — é dela que sai o texto que a análise de RPV usa, e
// isso não muda. A diligência pergunta o contrário: não "o que há neste
// processo", mas "que processos há desta pessoa". São buscas diferentes, e uma
// delas a Judit não faz: a linha 11 do questionário pergunta pelo ADVOGADO, e
// não existe CPF de advogado nos autos — só a OAB. A migration 0056 registrou a
// lacuna com todas as letras ("o advogado costuma ser conhecido só pela OAB"), e
// quem a fecha é /advogado/resumo, que troca a inscrição pelo CPF dele.
//
// A OAB NÃO É CHAVE DE BUSCA, é chave de identidade. Procurar processos POR OAB
// devolve as causas que o advogado patrocina, e em nenhuma delas ele é parte —
// nada ali é dívida dele. A diligência procura sempre por CPF ou CNPJ, do
// advogado como de qualquer um.
//
// O QUE SAI DAQUI JÁ É LINHA DE dd_processo. O tradutor abaixo devolve
// exatamente as colunas da tabela — polo, ha_cobranca, valor, estágio, risco —
// porque quem consome é o motor de RPV (_shared/dueDiligencia.ts), que já sabe
// lê-las. Este módulo não decide nada sobre a planilha; ele preenche a apuração
// que a planilha já esperava.
//
// SEM `npm:`, DE PROPÓSITO: assim o vitest de src/lib/__tests__ importa este
// módulo direto e troca o fetch global. Ver escavador.test.ts.

import { digitosDoCnj } from './nucleo/cnj.ts'

export const BASE_ESCAVADOR = 'https://api.escavador.com/api/v2'

/** Uma página de 100 é o teto que a API aceita (20 | 50 | 100). */
const POR_PAGINA = 100

/**
 * Teto de páginas por busca.
 *
 * A API é paga por requisição, e há cedente com centenas de processos. Cinco
 * páginas cobrem 500 — acima disso a apuração volta marcada como `truncado`,
 * que é diferente de "achei tudo isto e mais nada". Quem decide se vale pagar
 * mais é quem opera, não este módulo.
 */
const MAX_PAGINAS = 5

// ---------------------------------------------------------------------------
// O que a resposta traz (só os campos que lemos; a API devolve muito mais)
// ---------------------------------------------------------------------------

export interface OabEscavador {
  uf?: string
  numero?: number | string
  tipo?: string
}

export interface EnvolvidoEscavador {
  nome?: string
  cpf?: string
  cnpj?: string
  /** ATIVO | PASSIVO | ADVOGADO | OUTROS — o vocabulário do Escavador. */
  polo?: string
  tipo?: string
  tipo_normalizado?: string
  oabs?: OabEscavador[]
  advogados?: EnvolvidoEscavador[]
}

export interface FonteEscavador {
  sigla?: string
  url?: string
  grau?: number
  segredo_justica?: boolean
  arquivado?: boolean | null
  /** ATIVO | INATIVO — classificação do próprio Escavador, por IA. */
  status_predito?: string
  tribunal?: { sigla?: string; nome?: string }
  capa?: {
    classe?: string
    assunto?: string
    area?: string
    situacao?: string
    data_arquivamento?: string | null
    valor_causa?: { valor?: string | number; valor_formatado?: string }
    assunto_principal_normalizado?: { nome?: string }
  }
  envolvidos?: EnvolvidoEscavador[]
}

export interface ProcessoEscavador {
  numero_cnj?: string
  titulo_polo_ativo?: string
  titulo_polo_passivo?: string
  data_inicio?: string
  data_ultima_movimentacao?: string
  fontes_tribunais_estao_arquivadas?: boolean
  /** DOCUMENTO_TRIBUNAL (o tribunal publicou o CPF) | NOME_EXATO_UNICO. */
  match_documento_por?: string
  unidade_origem?: { nome?: string; tribunal_sigla?: string }
  estado_origem?: { sigla?: string }
  fontes?: FonteEscavador[]
}

// ---------------------------------------------------------------------------
// De quem estamos falando
// ---------------------------------------------------------------------------

export interface AlvoDaBusca {
  /** CPF ou CNPJ, só dígitos. É o que torna o polo confiável. */
  documento?: string | null
  nome?: string | null
  /** "GO 12345" — a única identidade que o advogado costuma ter nos autos. */
  oab?: string | null
  /**
   * O CRÉDITO QUE ESTAMOS COMPRANDO, que volta na busca como qualquer outro.
   *
   * Sem tirá-lo da lista, a linha 10 da planilha responderia "Sim, o cedente
   * tem dívida" apontando o próprio processo da cessão — o crédito virando
   * prova contra si mesmo.
   */
  cnjDoCredito?: string | null
}

/** Uma linha de dd_processo, pronta para gravar. */
export interface ProcessoApurado {
  numero_processo: string
  tribunal: string | null
  objeto: string | null
  polo: 'ATIVO' | 'PASSIVO' | 'TERCEIRO' | 'DESCONHECIDO'
  ha_cobranca: boolean | null
  valor_cobrado: number | null
  estagio: string | null
  risco: 'NENHUM' | 'ATENCAO' | 'ALTO'
  risco_motivo: string | null
  fonte: string
  url_fonte: string | null
}

// ---------------------------------------------------------------------------
// Leitura de texto
// ---------------------------------------------------------------------------

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

/**
 * Escrito com ESCAPES UNICODE, e não com as marcas combinantes literais: o
 * mesmo cuidado de `normalizar` em _shared/credijuris.ts. Um deploy que corrompa
 * o encoding do arquivo invalidaria os literais em silêncio.
 */
const semAcento = (s: unknown): string =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()

const contem = (texto: string, termos: string[]): boolean =>
  termos.some((t) => texto.includes(t))

/**
 * O nome de duas pessoas é o mesmo nome?
 *
 * Comparação por nome só entra quando não há documento — e mesmo assim o
 * resultado fica marcado como match por nome, para não virar dívida silenciosa
 * de um homônimo.
 */
const mesmoNome = (a: unknown, b: unknown): boolean => {
  const x = semAcento(a).replace(/[^A-Z0-9]+/g, ' ').trim()
  const y = semAcento(b).replace(/[^A-Z0-9]+/g, ' ').trim()
  return x.length > 0 && x === y
}

// ---------------------------------------------------------------------------
// As palavras que mudam o risco
// ---------------------------------------------------------------------------

/** Ação que JÁ COBRA. É a que alcança o crédito, não a que ainda discute. */
const EXECUCAO = [
  'EXECUCAO',
  'CUMPRIMENTO DE SENTENCA',
  'MONITORIA',
  'BUSCA E APREENSAO',
  'EXECUCAO FISCAL',
]

/** O credor que quebra não cede crédito: cede massa. */
const INSOLVENCIA = [
  'FALENCIA',
  'RECUPERACAO JUDICIAL',
  'RECUPERACAO EXTRAJUDICIAL',
  'INSOLVENCIA',
]

/** Constrição já decretada — o crédito é alcançável hoje, não em tese. */
const CONSTRICAO = ['PENHORA', 'ARRESTO', 'BLOQUEIO', 'INDISPONIBILIDADE', 'SEQUESTRO']

/** O nome do risco que esta diligência existe para achar. */
const FRAUDE = ['FRAUDE A EXECUCAO', 'FRAUDE CONTRA CREDORES', 'FRAUDE DE EXECUCAO']

// ---------------------------------------------------------------------------
// Tradução: um item do Escavador vira uma linha de dd_processo
// ---------------------------------------------------------------------------

/** O polo do Escavador no vocabulário da tabela. */
function traduzirPolo(polo: unknown): ProcessoApurado['polo'] {
  const p = semAcento(polo)
  if (p === 'ATIVO') return 'ATIVO'
  if (p === 'PASSIVO') return 'PASSIVO'
  // ADVOGADO e OUTROS: está no processo, não é parte. Quem patrocina a causa
  // não responde por ela — e é justamente o caso da linha 11.
  if (p === 'ADVOGADO' || p === 'OUTROS') return 'TERCEIRO'
  return 'DESCONHECIDO'
}

/**
 * Em que polo o ALVO figura neste processo.
 *
 * Por documento sempre que houver: é a única identificação que não confunde
 * homônimo. O nome entra como reserva, e a OAB fecha o caso do advogado, que
 * não tem CPF nos autos.
 *
 * O PIOR POLO VENCE quando o alvo aparece em mais de um: um processo em que o
 * cedente é autor E réu (reconvenção, litisconsórcio cruzado) é uma cobrança
 * contra ele, e arredondar para "autor" apagaria a dívida.
 */
export function poloDoAlvo(
  item: ProcessoEscavador,
  alvo: AlvoDaBusca,
): { polo: ProcessoApurado['polo']; porDocumento: boolean } {
  const doc = soDigitos(alvo.documento)
  const oabAlvo = lerOab(alvo.oab)
  const ordem: ProcessoApurado['polo'][] = ['PASSIVO', 'ATIVO', 'TERCEIRO', 'DESCONHECIDO']
  let melhor: ProcessoApurado['polo'] = 'DESCONHECIDO'
  let porDocumento = false

  const olhar = (e: EnvolvidoEscavador, ehAdvogado: boolean) => {
    const docDele = soDigitos(e.cpf || e.cnpj)
    const bateDoc = doc.length > 0 && docDele.length > 0 && docDele === doc
    const bateOab =
      oabAlvo != null &&
      (e.oabs || []).some(
        (o) =>
          soDigitos(o.numero) === oabAlvo.numero &&
          semAcento(o.uf) === oabAlvo.uf,
      )
    // Nome só quando não há documento para comparar: com CPF em mãos, um
    // homônimo que bate no nome e não no CPF é outra pessoa.
    const bateNome = !bateDoc && doc.length === 0 && mesmoNome(e.nome, alvo.nome)
    if (!bateDoc && !bateOab && !bateNome) return
    const dele = ehAdvogado ? 'TERCEIRO' : traduzirPolo(e.polo)
    if (ordem.indexOf(dele) < ordem.indexOf(melhor)) melhor = dele
    if (bateDoc || bateOab) porDocumento = true
  }

  for (const f of item.fontes || []) {
    for (const e of f.envolvidos || []) {
      olhar(e, false)
      for (const a of e.advogados || []) olhar(a, true)
    }
  }
  return { polo: melhor, porDocumento }
}

/** A fonte que melhor descreve o processo: a de primeiro grau, ou a primeira. */
function fontePrincipal(item: ProcessoEscavador): FonteEscavador {
  const fontes = item.fontes || []
  return fontes.find((f) => f.grau === 1) ?? fontes[0] ?? {}
}

/** O processo ainda anda? Baixado e arquivado não alcançam mais nada hoje. */
function estaAtivo(item: ProcessoEscavador, f: FonteEscavador): boolean {
  if (item.fontes_tribunais_estao_arquivadas === true) return false
  if (f.arquivado === true) return false
  const situacao = semAcento(f.capa?.situacao)
  if (contem(situacao, ['BAIXAD', 'ARQUIVAD', 'EXTINT'])) return false
  if (semAcento(f.status_predito) === 'INATIVO') return false
  return true
}

/** O texto em que as palavras de risco são procuradas. */
function textoDoProcesso(f: FonteEscavador): string {
  const capa = f.capa || {}
  return semAcento(
    [
      capa.classe,
      capa.assunto,
      capa.assunto_principal_normalizado?.nome,
      capa.area,
      capa.situacao,
      (f.envolvidos || []).map((e) => e.tipo_normalizado || e.tipo).join(' '),
    ]
      .filter(Boolean)
      .join(' | '),
  )
}

/**
 * O que ESTE processo faz com A NOSSA cessão. Não é o tamanho da dívida.
 *
 * A régua é a do Manual: o que ameaça o recebimento é a constrição capaz de
 * alcançar o crédito — execução em curso contra o cedente, penhora decretada,
 * insolvência. Um crédito diferente do cedente, uma ação que ele mesmo propôs,
 * uma execução dele CONTRA alguém: nada disso ameaça a cessão, e marcar como
 * risco só ensina quem lê a ignorar o alerta.
 *
 * REGRA DE CÓDIGO, E NÃO DE IA, de propósito: esta é a primeira passada, sobre
 * a lista inteira, e precisa ser barata, determinística e explicável. O parecer
 * por IA (dd-credor) continua sendo o aprofundamento dos que forem marcados.
 */
export function avaliarRisco(
  item: ProcessoEscavador,
  polo: ProcessoApurado['polo'],
  porDocumento: boolean,
): { risco: ProcessoApurado['risco']; motivo: string | null } {
  const f = fontePrincipal(item)
  const texto = textoDoProcesso(f)
  const ativo = estaAtivo(item, f)
  const ressalva = porDocumento
    ? ''
    : ' (vínculo achado pelo NOME, não pelo CPF — confirme que é a mesma pessoa)'

  if (contem(texto, FRAUDE)) {
    return { risco: 'ALTO', motivo: 'Ação de fraude à execução/contra credores' + ressalva }
  }
  // Insolvência vale em QUALQUER polo: falência do cedente arrasta o crédito
  // para a massa, seja ele quem for na ação.
  if (contem(texto, INSOLVENCIA)) {
    return {
      risco: ativo ? 'ALTO' : 'ATENCAO',
      motivo: `Falência/recuperação/insolvência${ativo ? ' em curso' : ' já encerrada'}${ressalva}`,
    }
  }
  // Ele não é o cobrado: pode ser autor, pode ser o advogado da causa.
  if (polo !== 'PASSIVO') return { risco: 'NENHUM', motivo: null }

  if (contem(texto, CONSTRICAO)) {
    return {
      risco: ativo ? 'ALTO' : 'ATENCAO',
      motivo:
        `Constrição (penhora/arresto/bloqueio) contra ele` +
        `${ativo ? '' : ', processo já baixado'}${ressalva}`,
    }
  }
  if (contem(texto, EXECUCAO)) {
    return ativo
      ? {
          risco: 'ALTO',
          motivo: 'Execução em curso contra ele — risco de fraude à execução' + ressalva,
        }
      : { risco: 'ATENCAO', motivo: 'Execução contra ele, processo já baixado/arquivado' + ressalva }
  }
  return ativo
    ? { risco: 'ATENCAO', motivo: 'Ação em curso contra ele; se virar condenação, executa' + ressalva }
    : { risco: 'NENHUM', motivo: null }
}

/** "310455.6100" -> 310455.61. Nulo quando não há número. */
function valorDaCausa(f: FonteEscavador): number | null {
  const bruto = f.capa?.valor_causa?.valor
  if (bruto == null || bruto === '') return null
  const n = typeof bruto === 'number' ? bruto : Number(String(bruto).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

/**
 * Um item do Escavador vira uma linha de dd_processo — ou nada.
 *
 * Devolve `null` para o próprio crédito em análise: ele volta na busca como
 * qualquer outro processo do cedente e não é dívida dele.
 */
export function traduzirProcesso(
  item: ProcessoEscavador,
  alvo: AlvoDaBusca,
): ProcessoApurado | null {
  const numero = String(item.numero_cnj ?? '').trim()
  if (!/\d/.test(numero)) return null
  if (alvo.cnjDoCredito && digitosDoCnj(numero) === digitosDoCnj(alvo.cnjDoCredito)) return null

  const f = fontePrincipal(item)
  const { polo, porDocumento } = poloDoAlvo(item, alvo)
  const { risco, motivo } = avaliarRisco(item, polo, porDocumento)
  const capa = f.capa || {}

  // HA_COBRANCA: só se afirma o que se sabe.
  //
  // Autor não é cobrado — isso é um `false` honesto, e poupa a planilha de
  // contar como "indeterminado" o que não tem indeterminação nenhuma. No polo
  // passivo fica NULL de propósito: há cobrança quase certamente, mas o
  // ENDPOINT DE BUSCA não diz o valor devido, só o valor da causa. O motor lê
  // NULL no passivo como dívida (é o lado conservador) sem que este módulo
  // finja ter apurado um número que não apurou.
  const haCobranca = polo === 'PASSIVO' ? null : false

  return {
    numero_processo: numero,
    tribunal: f.tribunal?.sigla || item.unidade_origem?.tribunal_sigla || null,
    objeto: capa.assunto_principal_normalizado?.nome || capa.classe || capa.assunto || null,
    polo,
    ha_cobranca: haCobranca,
    // Valor da causa, que é o único número que a busca devolve. Vale no polo
    // passivo (é o que se cobra dele) e só confundiria nos outros.
    valor_cobrado: polo === 'PASSIVO' ? valorDaCausa(f) : null,
    estagio: capa.situacao || (estaAtivo(item, f) ? 'Em andamento' : 'Baixado/arquivado'),
    risco,
    risco_motivo: motivo,
    fonte: 'escavador',
    url_fonte: f.url || null,
  }
}

/**
 * A lista inteira: sem repetir processo, e sem os que não são dele.
 *
 * QUEM APARECE COMO TERCEIRO NÃO RESPONDE POR NADA ALI, e é por isso que esses
 * processos saem em vez de entrarem com risco "nenhum". Terceiro aqui é o
 * advogado da causa e o "outros" do Escavador — interessado, perito, quem foi
 * intimado uma vez. Um advogado tem centenas de processos nessa condição: com
 * eles dentro, a tabela da diligência vira o extrato de trabalho dele e a
 * execução que de fato pesa fica na página três. Manter a linha para dizer "não
 * é risco" não é honestidade, é ruído — a pergunta da diligência é "que dívida
 * esta pessoa tem", e patrocinar uma causa não é dívida.
 *
 * De-duplicado por DÍGITO: o mesmo processo aparece mascarado num lugar e cru
 * noutro, e a chave única de dd_processo usa a mesma normalização.
 */
export function apurarProcessos(
  items: ProcessoEscavador[],
  alvo: AlvoDaBusca,
): ProcessoApurado[] {
  const vistos = new Set<string>()
  const saida: ProcessoApurado[] = []
  for (const item of items || []) {
    const linha = traduzirProcesso(item, alvo)
    if (!linha) continue
    if (linha.polo === 'TERCEIRO') continue
    const chave = digitosDoCnj(linha.numero_processo)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    saida.push(linha)
  }
  return saida
}

// ---------------------------------------------------------------------------
// A conversa com a API
// ---------------------------------------------------------------------------

/**
 * Erro do Escavador com a mensagem que o operador precisa ler.
 *
 * "Unauthenticated" e "Você não possui saldo" chegam como 401/402 com corpo de
 * uma linha; sem traduzir, apareceriam na tela como falha genérica e mandariam
 * alguém procurar defeito no lugar errado.
 */
export class ErroEscavador extends Error {
  readonly status: number
  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.name = 'ErroEscavador'
    this.status = status
  }
}

function traduzirFalha(status: number, corpo: unknown): ErroEscavador {
  const dito = String((corpo as { error?: string })?.error ?? '').trim()
  if (status === 401) {
    return new ErroEscavador(
      401,
      'O Escavador recusou o token. Confira a chave em Configurações → Escavador ' +
        '(ela é exibida uma única vez, quando criada em api.escavador.com/tokens).',
    )
  }
  if (status === 402) {
    return new ErroEscavador(
      402,
      'Sem saldo de créditos na API do Escavador. Recarregue em api.escavador.com.',
    )
  }
  if (status === 404) return new ErroEscavador(404, 'O Escavador não encontrou este envolvido.')
  if (status === 429) {
    return new ErroEscavador(
      429,
      'O Escavador está limitando as chamadas (500 por minuto). Tente de novo em um minuto.',
    )
  }
  return new ErroEscavador(status, `Escavador respondeu ${status}${dito ? ': ' + dito : ''}`)
}

export interface BuscaEscavador {
  items: ProcessoEscavador[]
  /** `envolvido_encontrado` ou `advogado_encontrado`: nome, CPF, OABs, sociedades. */
  encontrado: Record<string, unknown> | null
  /** Centavos gastos, somados nas páginas — o header `Creditos-Utilizados`. */
  centavos: number
  paginas: number
  /** Havia mais páginas e o teto foi atingido. */
  truncado: boolean
}

async function pedir(chave: string, url: string): Promise<{ corpo: unknown; centavos: number }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${chave}`,
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  })
  const texto = await res.text()
  let corpo: unknown = texto
  try {
    corpo = JSON.parse(texto)
  } catch {
    // Corpo não-JSON (uma página de erro do proxy, por exemplo): fica o texto,
    // que ainda serve para a mensagem.
  }
  if (!res.ok) throw traduzirFalha(res.status, corpo)
  return { corpo, centavos: Number(res.headers.get('Creditos-Utilizados') ?? 0) || 0 }
}

/**
 * Percorre as páginas pelo `links.next` que a própria API devolve.
 *
 * O cursor é opaco e vem assinado; remontar a URL na mão (`page=2`) é o jeito
 * documentado de errar. O teto está em MAX_PAGINAS, e o que sobra volta como
 * `truncado` em vez de silêncio.
 */
async function paginar(
  chave: string,
  primeira: string,
  chaveEncontrado: string,
): Promise<BuscaEscavador> {
  const items: ProcessoEscavador[] = []
  let encontrado: Record<string, unknown> | null = null
  let centavos = 0
  let url: string | null = primeira
  let paginas = 0

  while (url && paginas < MAX_PAGINAS) {
    const resposta: { corpo: unknown; centavos: number } = await pedir(chave, url)
    centavos += resposta.centavos
    paginas += 1
    const pagina = (resposta.corpo ?? {}) as {
      items?: ProcessoEscavador[]
      links?: { next?: string | null }
      [k: string]: unknown
    }
    if (!encontrado && pagina[chaveEncontrado]) {
      encontrado = pagina[chaveEncontrado] as Record<string, unknown>
    }
    for (const it of pagina.items ?? []) items.push(it)
    url = pagina.links?.next ?? null
  }

  return { items, encontrado, centavos, paginas, truncado: Boolean(url) }
}

/** Os processos de uma pessoa ou empresa, por CPF/CNPJ (ou, na falta, nome). */
export function processosDoEnvolvido(
  chave: string,
  alvo: { documento?: string | null; nome?: string | null; tribunais?: string[] },
): Promise<BuscaEscavador> {
  const doc = soDigitos(alvo.documento)
  const q = new URLSearchParams()
  if (doc) q.set('cpf_cnpj', doc)
  else if (String(alvo.nome ?? '').trim()) q.set('nome', String(alvo.nome).trim())
  else return Promise.reject(new ErroEscavador(400, 'Informe CPF/CNPJ ou nome do envolvido.'))
  q.set('limit', String(POR_PAGINA))
  q.set('ordena_por', 'data_inicio')
  q.set('ordem', 'desc')
  for (const t of alvo.tribunais ?? []) q.append('tribunais[]', t)
  return paginar(chave, `${BASE_ESCAVADOR}/envolvido/processos?${q}`, 'envolvido_encontrado')
}

/**
 * QUEM É O ADVOGADO DE OAB TAL — e, principalmente, QUAL É O CPF DELE.
 *
 * É esta chamada que fecha a linha 11 do questionário, e vale explicar por quê,
 * porque o caminho óbvio é o errado. "Histórico do advogado: tem dívida?" NÃO se
 * responde listando os processos que ele patrocina: nesses ele é o procurador,
 * não a parte, e a resposta sairia "Não" em todos por construção. O que se
 * pergunta são as dívidas PESSOAIS dele, e para isso é preciso o CPF.
 *
 * Nos autos não há CPF de advogado — só a OAB, e foi por isso que a linha 11
 * nunca teve fonte (ver a migration 0056). O Escavador liga uma coisa à outra:
 * a OAB entra aqui, o CPF sai, e a busca de dívidas é a mesma dos demais
 * sujeitos, por `processosDoEnvolvido`.
 *
 * Endpoint de resumo, e não o de processos, porque só a identidade interessa —
 * é uma requisição, não cinco páginas.
 */
export async function identidadeDoAdvogado(
  chave: string,
  oab: { uf: string; numero: string; tipo?: string },
): Promise<{
  nome: string | null
  cpf: string | null
  quantidadeProcessos: number
  sociedades: { nome?: string; inscricao?: string; uf?: string }[]
}> {
  const q = new URLSearchParams({
    oab_estado: semAcento(oab.uf).trim(),
    oab_numero: soDigitos(oab.numero),
  })
  if (oab.tipo) q.set('oab_tipo', oab.tipo)
  const { corpo } = await pedir(chave, `${BASE_ESCAVADOR}/advogado/resumo?${q}`)
  const d = (corpo ?? {}) as {
    nome?: string
    cpf?: string
    quantidade_processos?: number
    sociedades?: { nome?: string; inscricao?: string; uf?: string }[]
  }
  const cpf = soDigitos(d.cpf)
  return {
    nome: d.nome ?? null,
    cpf: cpf.length === 11 ? cpf : null,
    quantidadeProcessos: Number(d.quantidade_processos ?? 0) || 0,
    sociedades: d.sociedades ?? [],
  }
}

// A BUSCA POR OAB SAIU DAQUI, e não é economia de código: ela não serve à
// diligência. /advogado/processos devolve os processos que o advogado
// PATROCINA, onde ele é procurador e nunca parte — nenhum deles é dívida dele.
// A OAB continua entrando, mas só como IDENTIDADE: `identidadeDoAdvogado` a
// troca pelo CPF, e a busca de dívidas é a mesma de qualquer outro sujeito.

/**
 * QUANTOS processos existem, antes de pagar pela lista.
 *
 * Endpoint separado e barato. Serve para não gastar cinco páginas com uma
 * empresa que tem trinta mil processos, e para avisar quem opera antes — e não
 * depois — de a conta chegar.
 */
export async function resumoDoEnvolvido(
  chave: string,
  alvo: { documento?: string | null; nome?: string | null },
): Promise<{ quantidade: number; nome: string | null; dados: Record<string, unknown> }> {
  const doc = soDigitos(alvo.documento)
  const q = new URLSearchParams()
  if (doc) q.set('cpf_cnpj', doc)
  else if (String(alvo.nome ?? '').trim()) q.set('nome', String(alvo.nome).trim())
  else throw new ErroEscavador(400, 'Informe CPF/CNPJ ou nome do envolvido.')
  const { corpo } = await pedir(chave, `${BASE_ESCAVADOR}/envolvido/resumo?${q}`)
  const d = (corpo ?? {}) as { quantidade_processos?: number; nome?: string }
  return {
    quantidade: Number(d.quantidade_processos ?? 0) || 0,
    nome: d.nome ?? null,
    dados: d as Record<string, unknown>,
  }
}

/** O saldo, em créditos e em reais. Para a tela de Configurações. */
export async function saldoEscavador(
  chave: string,
): Promise<{ creditos: number; saldo: number; descricao: string }> {
  const { corpo } = await pedir(chave, `${BASE_ESCAVADOR}/quantidade-creditos`)
  const d = (corpo ?? {}) as {
    quantidade_creditos?: number
    saldo?: number
    saldo_descricao?: string
  }
  return {
    creditos: Number(d.quantidade_creditos ?? 0) || 0,
    saldo: Number(d.saldo ?? 0) || 0,
    descricao: String(d.saldo_descricao ?? ''),
  }
}

/**
 * "GO 12345", "OAB/GO 12.345", "12345/GO" — a OAB como as pessoas a escrevem.
 *
 * O campo `oab` de dd_historico é texto livre preenchido por quem cadastra, e a
 * API exige estado e número em parâmetros separados. Sem esta leitura, a busca
 * do advogado falharia por formatação.
 */
export function lerOab(texto: unknown): { uf: string; numero: string } | null {
  const s = semAcento(texto).replace(/OAB/g, ' ')
  const ufAntes = s.match(/\b([A-Z]{2})\s*[-./ ]?\s*(\d[\d.]{2,8})\b/)
  if (ufAntes) return { uf: ufAntes[1], numero: soDigitos(ufAntes[2]) }
  const ufDepois = s.match(/\b(\d[\d.]{2,8})\s*[-./ ]?\s*([A-Z]{2})\b/)
  if (ufDepois) return { uf: ufDepois[2], numero: soDigitos(ufDepois[1]) }
  return null
}
