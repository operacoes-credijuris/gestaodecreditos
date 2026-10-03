// A LÓGICA DE TELA da Análise de crédito redesenhada (onda 2 do redesenho):
// o quadro de fases, os filtros rápidos, a ordenação, o tempo na etapa, o
// título do card quebrado em campos e o resultado da busca.
//
// SAIU DA PÁGINA PARA SER PRESA POR TESTE (quadroDaAnalise.test.ts). Nada aqui
// decide o que o card FAZ — botões, desfechos e movimentos continuam em
// kommo.ts (`botoesDaAba`, `abasDoFunil`). Aqui só se decide o que se VÊ e em
// que ordem.
import type { KommoLead } from './types'
import { normalizarBusca } from './format'
import { dataDaEtapa, lerTituloCard, ordemNaColuna, type Aba } from './kommo'

/**
 * A PARTIR DE QUANTOS DIAS NA MESMA COLUNA o card está "parado" — o selo âmbar
 * "Parado há N dias" e o filtro rápido "Parados há 7+ dias". O mesmo prazo da
 * amostra aprovada (`PRAZO_PARADO`).
 */
export const PRAZO_PARADO = 7

/** Quantos cards a lista mostra de cada vez — "Mostrar mais" acrescenta outro tanto. */
export const POR_VEZ = 8

const DIA = 86_400_000

/**
 * HÁ QUANTOS DIAS o card está na coluna em que está — ou null, se não sabemos.
 *
 * SAI DA MESMA DATA DA "ÚLT. MOV." (`dataDaEtapa`), e por isso herda a regra
 * dela: card movido depois do último sync tem uma data que não é da coluna em
 * que está, e aí a tela não diz NADA — nem "nesta etapa", nem "parado há". Uma
 * conta errada tem a mesma cara de uma certa.
 *
 * DIAS DE CALENDÁRIO, e não blocos de 24 horas: o card que entrou ontem às 23h
 * não está "desde hoje" às 8h da manhã seguinte.
 */
export function diasNaEtapa(lead: KommoLead, agora: Date = new Date()): number | null {
  const quando = dataDaEtapa(lead)
  if (!quando) return null
  const d = new Date(quando)
  if (Number.isNaN(d.getTime())) return null
  const dia = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())
  return Math.max(0, Math.round((dia(agora) - dia(d)) / DIA))
}

/** "desde hoje", "1 dia", "9 dias" — o valor do "Nesta etapa". */
export function textoDosDias(dias: number): string {
  if (dias === 0) return 'desde hoje'
  return dias === 1 ? '1 dia' : `${dias} dias`
}

/**
 * A IDADE CURTA de uma etiqueta no card: "hoje", "2d", "9d" — o "· 2d" que vai
 * ao lado do "Cotado BTG" na amostra. A data exata fica no passar do mouse.
 * Vazio sem data (o Kommo nem sempre guarda o evento da etiqueta).
 */
export function idadeCurta(quando: string | null | undefined, agora: Date = new Date()): string {
  if (!quando) return ''
  const d = new Date(quando)
  if (Number.isNaN(d.getTime())) return ''
  const dia = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())
  const dias = Math.round((dia(agora) - dia(d)) / DIA)
  if (dias < 0) return ''
  return dias === 0 ? 'hoje' : `${dias}d`
}

/** O card passou do prazo na coluna? Sem data conhecida, não. */
export function estaParado(dias: number | null): boolean {
  return dias !== null && dias >= PRAZO_PARADO
}

/** Os campos do título, quando ele segue o padrão da casa. */
export interface CamposDoTitulo {
  cedente: string
  intermediador: string
  /** CNJ pontuado, ou vazio quando o título não traz o número. */
  numero: string
  /** A parcela cedida, com a primeira letra maiúscula ("Principal + honorários"). */
  objeto: string
  /** O percentual escrito no título, já com vírgula e "%" ("17,5%"), ou vazio. */
  percentual: string
}

/**
 * O TÍTULO DO CARD QUEBRADO EM CAMPOS (item "Novo" da amostra): cedente em
 * destaque e intermediador, processo, objeto e percentual em campos próprios.
 *
 * COM O NÚMERO, PELA MESMA LEITURA QUE A ANÁLISE USA (`lerTituloCard`),
 * ancorada no CNJ — e só quando ela acha as três partes que identificam o
 * crédito: intermediador, cedente e número.
 *
 * SEM O NÚMERO, A ÂNCORA É A PARCELA CEDIDA (`lerTituloSemNumero`). O card que
 * chega sem processo é justamente o que mais precisa ser achado na lista, e
 * mostrá-lo cru, com "Título fora do padrão", dizia que o comercial errou o
 * formato quando ele só não tinha o número ainda (amostra: o cedente em
 * destaque, e o campo do processo some).
 *
 * FORA DO PADRÃO de fato — sem intermediador, sem cedente, ou sem número E sem
 * parcela — a tela mostra o título cru, como sempre mostrou: separar campos de
 * um título que não os tem inventaria um cedente.
 */
export function camposDoTitulo(nome: string | null | undefined): CamposDoTitulo | null {
  if (!nome?.trim()) return null
  const d = lerTituloCard(nome)
  const lido = d.numero ? d : lerTituloSemNumero(nome)
  if (!lido || !lido.intermediador || !lido.cedente) return null
  const objeto = lido.parcelaCedida.trim()
  return {
    cedente: lido.cedente,
    intermediador: lido.intermediador,
    numero: lido.numero,
    objeto: objeto ? objeto.charAt(0).toLocaleUpperCase('pt-BR') + objeto.slice(1) : '',
    percentual: lido.honorariosPct ? `${lido.honorariosPct.replace('.', ',')}%` : '',
  }
}

// AS MESMAS REGRAS DE `lerTituloCard` (supabase/functions/_shared/
// cadastroDoCard.ts), repetidas aqui porque lá elas não são exportadas e aquele
// arquivo é do servidor. Se uma mudar lá, mude aqui.
const RE_SEPARADOR = /\s+[-–—]\s+/
const RE_SO_PORCENTAGEM = /^(\d{1,3}(?:[.,]\d+)?)\s*%?$/
const RE_PORCENTAGEM_NO_FIM = /(\d{1,3}(?:[.,]\d+)?)\s*%\s*$/
const RE_VERBA = /principal|honor|sucumb|contratu/i

/**
 * O LUGAR DO NÚMERO OCUPADO SEM NÚMERO: "sem número", "s/n", "sem nº", "?", ou
 * um número que não chega a ser CNJ (incompleto, só com dígitos e pontuação).
 * Ocupa a casa do processo e não entra no nome do cedente.
 */
const RE_LUGAR_DO_NUMERO =
  /^(?:sem\s+(?:n[úu]mero|n[º°o]\.?)(?:\s+d[eo]\s+processo)?|s\s*\/\s*n[º°o]?\.?|n\s*\/\s*a|[?–—-]+|[\d][\d.\-/\s]*)$/i

/**
 * O TÍTULO SEM O NÚMERO DO PROCESSO: "originador - cedente - parcela - %", com
 * ou sem um marcador no lugar do número ("sem número").
 *
 * A ÂNCORA É A PRIMEIRA PARTE DE VERBA (principal, honorários, sucumbência,
 * contratuais), procurada a partir da terceira parte: antes dela estão o
 * originador (a primeira) e o cedente (o resto, remontado com o separador, como
 * faz `lerTituloCard` — um nome pode ter " - " dentro). SEM VERBA NÃO HÁ ÂNCORA:
 * "Credijuris - Maria" pode ser qualquer coisa, e devolve null.
 *
 * O número fica vazio — o card não o tem, e a tela não mostra o campo.
 */
export function lerTituloSemNumero(nome: string | null | undefined): {
  intermediador: string
  cedente: string
  numero: string
  parcelaCedida: string
  honorariosPct: string
} | null {
  const cru = String(nome ?? '').split(RE_SEPARADOR).map((p) => p.trim())
  let honorariosPct = ''
  const partes: string[] = []
  cru.forEach((p, i) => {
    const m = i > 0 && !honorariosPct ? p.match(RE_SO_PORCENTAGEM) : null
    if (m) honorariosPct = m[1].replace(',', '.')
    else partes.push(p)
  })
  const iVerba = partes.findIndex((p, i) => i >= 2 && RE_VERBA.test(p))
  if (iVerba < 0) return null
  const intermediador = partes[0] ?? ''
  const cedente = partes
    .slice(1, iVerba)
    .filter((p) => p && !RE_LUGAR_DO_NUMERO.test(p))
    .join(' - ')
  const verbas: string[] = []
  for (const p of partes.slice(iVerba)) {
    if (!RE_VERBA.test(p)) continue
    const m = p.match(RE_PORCENTAGEM_NO_FIM)
    if (!m) {
      verbas.push(p)
      continue
    }
    if (!honorariosPct) honorariosPct = m[1].replace(',', '.')
    verbas.push(p.slice(0, m.index).replace(/[\s,;:]+$/, ''))
  }
  if (!intermediador || !cedente) return null
  return { intermediador, cedente, numero: '', parcelaCedida: verbas.join(' - '), honorariosPct }
}

/**
 * Siglas que continuam em caixa alta quando o nome da coluna vem todo em
 * maiúsculas do Kommo.
 */
const SIGLAS = new Set(['RPV', 'BTG', 'CNJ', 'OAB', 'PJ', 'PF', 'TJ', 'TRF', 'TRT', 'INSS', 'IPCA'])

/**
 * O NOME DA COLUNA COMO A TELA O ESCREVE.
 *
 * O Kommo do Externo guarda parte das colunas EM CAIXA ALTA ("REVISÃO/ASSINATURA
 * DA ESCRITURA"), e a amostra aprovada as escreve como frase ("Revisão/assinatura
 * da escritura"). SÓ APRESENTAÇÃO: o rótulo da aba (`Aba.label`) continua sendo o
 * do Kommo, e é ele que a busca, os testes e os avisos usam. Nome que já tem
 * minúscula fica como veio — quem o escreveu escolheu a caixa.
 */
export function nomeDaColuna(nome: string): string {
  if (!nome || nome !== nome.toLocaleUpperCase('pt-BR') || nome === nome.toLocaleLowerCase('pt-BR')) {
    return nome
  }
  const minusc = nome.toLocaleLowerCase('pt-BR')
  const frase = minusc.charAt(0).toLocaleUpperCase('pt-BR') + minusc.slice(1)
  return frase.replace(/[\p{L}]+/gu, (p) => (SIGLAS.has(p.toLocaleUpperCase('pt-BR')) ? p.toLocaleUpperCase('pt-BR') : p))
}

/** Uma fase do quadro, com as abas dela na ordem do kanban. */
export interface FaseDoQuadro {
  /** O nome da fase; null quando o funil não tem fases (ver `fasesDoQuadro`). */
  nome: string | null
  /** Fora do fluxo (os perdidos): mais discreta, sem número de passo. */
  discreta: boolean
  abas: Aba[]
}

/**
 * AS FASES DO QUADRO, na ordem em que aparecem nas abas.
 *
 * GENÉRICA SOBRE `Aba.fase`, que sai das `fases` da trilha (ou de `FASES_RPV`):
 * a tela não sabe qual funil está desenhando. Funil sem fases (o Interno, até a
 * trilha dele as declarar) vira UM grupo só, sem nome — melhor que inventar
 * fases que ninguém definiu.
 */
export function fasesDoQuadro(abas: Aba[]): FaseDoQuadro[] {
  if (!abas.some((a) => a.fase)) return abas.length ? [{ nome: null, discreta: false, abas }] : []
  const fases: FaseDoQuadro[] = []
  for (const a of abas) {
    const nome = a.fase ?? null
    const f = fases.find((x) => x.nome === nome)
    if (f) {
      f.abas.push(a)
      f.discreta = f.discreta || Boolean(a.faseDiscreta)
    } else {
      fases.push({ nome, discreta: Boolean(a.faseDiscreta), abas: [a] })
    }
  }
  return fases
}

/**
 * A LARGURA DA BARRA de cada coluna, em %, proporcional à maior contagem.
 *
 * As fases do fluxo se comparam entre si (a mesma régua para as três); a dos
 * perdidos tem régua própria — 73 reprovados não podem apagar as barras de quem
 * está em trabalho. Zero é barra nenhuma; acima de zero, um mínimo de 6% para a
 * coluna com um card não sumir.
 */
export function larguraDaBarra(n: number, maior: number): number {
  if (n <= 0) return 0
  return Math.min(100, Math.max(6, Math.round((n / Math.max(maior, 1)) * 100)))
}

export type FiltroRapido = 'todos' | 'parados' | 'cotados' | 'prontas' | 'semnum'
export type OrdemDaLista = 'recente' | 'parado'

/** A etiqueta diz que o fundo cotou? Pelo começo do nome, como a cor (`tomDaTag`). */
export const temCotacao = (lead: KommoLead): boolean =>
  (lead.tags ?? []).some((t) => normalizarBusca(t).startsWith('cotad'))

/**
 * OS FILTROS RÁPIDOS e a ORDEM da lista (itens "Novo" da amostra).
 *
 * `temNumero` e `pronta` vêm de quem chama porque dependem do que a página sabe
 * (a leitura do cadastro do card; as análises prontas do banco).
 *
 * A ORDEM PADRÃO É A DA PLATAFORMA: quem entrou na coluna mais recentemente vem
 * primeiro (`ordemNaColuna`). "Mais tempo na etapa" inverte pelo número de dias;
 * card sem data conhecida vai para o fim — não há como dizer que está parado.
 */
export function filtrarEOrdenar(
  leads: KommoLead[],
  {
    filtro,
    ordem,
    agora = new Date(),
    temNumero,
    pronta,
  }: {
    filtro: FiltroRapido
    ordem: OrdemDaLista
    agora?: Date
    temNumero: (l: KommoLead) => boolean
    pronta: (l: KommoLead) => boolean
  },
): KommoLead[] {
  const passa = (l: KommoLead): boolean => {
    switch (filtro) {
      case 'parados':
        return estaParado(diasNaEtapa(l, agora))
      case 'cotados':
        return temCotacao(l)
      case 'prontas':
        return pronta(l)
      case 'semnum':
        return !temNumero(l)
      default:
        return true
    }
  }
  const lista = leads.filter(passa)
  const recente = (a: KommoLead, b: KommoLead) =>
    ordemNaColuna(b) - ordemNaColuna(a) || b.kommo_lead_id - a.kommo_lead_id
  if (ordem === 'recente') return lista.sort(recente)
  return lista.sort((a, b) => {
    const da = diasNaEtapa(a, agora)
    const db = diasNaEtapa(b, agora)
    if (da === null && db === null) return recente(a, b)
    if (da === null) return 1
    if (db === null) return -1
    return db - da || ordemNaColuna(a) - ordemNaColuna(b) || a.kommo_lead_id - b.kommo_lead_id
  })
}

/** Uma etapa em que a busca achou cards. */
export interface AchadoDaBusca {
  key: string
  label: string
  n: number
  /** A fase dela, quando é outra que não a da aba aberta — "na fase Comercialização". */
  outraFase: string | null
}

/**
 * ONDE A BUSCA ACHOU CARDS, na ordem das abas.
 *
 * `comAAberta` decide se a aba aberta entra: a faixa de cima (resumo) conta
 * todas; o vazio "Nada encontrado" diz só onde MAIS achou. A fase só é dita
 * quando difere da fase aberta — é o que diz para que lado do quadro olhar.
 */
export function achadosDaBusca(
  abas: Aba[],
  porAba: Record<string, KommoLead[]>,
  abaAberta: Aba | null,
  comAAberta: boolean,
): AchadoDaBusca[] {
  return abas
    .filter((a) => (porAba[a.key]?.length ?? 0) > 0 && (comAAberta || a.key !== abaAberta?.key))
    .map((a) => ({
      key: a.key,
      label: a.label,
      n: porAba[a.key].length,
      outraFase: a.fase && a.fase !== abaAberta?.fase ? a.fase : null,
    }))
}
