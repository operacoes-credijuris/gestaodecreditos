// DO CHECKLIST DA CASA ÀS CERTIDÕES DA BULLAI — quais portais pedir para cada
// item.
//
// A METODOLOGIA É A DA PLANILHA, e não da IA. Quem decide QUAIS certidões pedir,
// de QUEM e em QUE estado e município são as regras da casa (migração 0042), que
// saíram da planilha modelo de análise — cada uma guarda a linha de onde veio.
// Foi a escolha de quem opera, em 28/09/2026: "seguir a metodologia que vem na
// planilha". Este arquivo só traduz cada item daquele checklist para as chaves
// do catálogo da BullAI. Não acrescenta, não tira: o que a planilha não pede não
// vem marcado, e o que ela pede e a BullAI não emite aparece como pendência
// manual, com o motivo.
//
// TRADUÇÃO FIXA, e não por semelhança de nome. As chaves da BullAI seguem um
// padrão regular — `sefaz_ba_pf`, `tjba_1grau_civel_pf`, `cnd_salvador_ba_pf` —,
// e é ele que se usa, sempre CONFERIDO contra o catálogo vivo: chave que o padrão
// monta e o catálogo não tem não é pedida. Comparar por semelhança marcaria
// `cnd_curitibanos_sc` para quem morou em Curitiba — e Curitiba não está no
// catálogo (conferido na lista de 28/09/2026, junto com Belo Horizonte, Porto
// Alegre, Manaus e Belém).
//
// MÓDULO PURO — sem `Deno.` e sem `npm:`.

/** Um item do checklist, no que a tradução precisa dele. */
export interface ItemParaBullai {
  /** O código da certidão no catálogo da casa: 'FED.CND_RFB_PGFN', 'MUN.CND'… */
  codigo: string
  /** Os parâmetros do item: {"uf": "BA"}, {"municipio": "Salvador"}. */
  parametros: Record<string, unknown>
  tipoPessoa: 'PF' | 'PJ'
  /** Os estados onde o sujeito morou — o desempate das cidades de mesmo nome. */
  ufsDoSujeito?: string[]
}

/** As chaves da BullAI para um item — ou o motivo de não haver. */
export interface TraducaoParaBullai {
  chaves: string[]
  /** Por que o item fica de fora da BullAI (e vira pendência manual). */
  semBullai: string | null
}

const FORA = (motivo: string): TraducaoParaBullai => ({ chaves: [], semBullai: motivo })

/** O nome da cidade como a BullAI o escreve na chave: sem acento, com "_". */
export function slugDaCidade(nome: string): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * A cidade e, quando vier junto, o estado: "Salvador/BA", "Salvador - BA",
 * "Salvador (BA)". O checklist grava só o nome na maioria das vezes, mas quem
 * digita às vezes acrescenta o estado — e aí ele resolve o desempate sozinho.
 */
export function lerCidade(bruto: unknown): { cidade: string; uf: string | null } {
  const t = String(bruto ?? '').trim()
  const m = t.match(/^(.*?)\s*(?:[/(,-]|\s-\s)\s*([A-Za-z]{2})\)?\s*$/)
  if (m && m[1].trim()) return { cidade: m[1].trim(), uf: m[2].toUpperCase() }
  return { cidade: t, uf: null }
}

/**
 * Os Tribunais de Justiça têm chaves de três formatos — `tjba_1grau_civel`,
 * `tjce_unificada_civel`, `tjap_civel` — e alguns só têm o 2º grau (TJPR). A
 * ordem de preferência é a da planilha: a distribuição de 1º grau é a que pega
 * execução contra o cedente; o 2º grau entra só onde não há outra.
 */
const FORMATOS_DO_TJ = ['1grau_', 'unificada_', '', '2grau_']

function chaveDoTj(uf: string, ramo: 'civel' | 'criminal', suf: string, catalogo: ReadonlySet<string>): string | null {
  const tj = uf === 'DF' ? 'tjdft' : `tj${uf.toLowerCase()}`
  // O MARANHÃO chama o criminal de "penal" no rótulo, mas a chave é `criminal`.
  for (const formato of FORMATOS_DO_TJ) {
    const chave = `${tj}_${formato}${ramo}${suf}`
    if (catalogo.has(chave)) return chave
  }
  return null
}

/**
 * As chaves da BullAI para um item do checklist.
 *
 * O SUFIXO SAI DO TIPO DE PESSOA — `_pf` para CPF, `_pj` para CNPJ —, porque a
 * documentação avisa: a chave não diz qual documento o portal aceita, e mandar o
 * errado devolve 422.
 */
export function traduzirParaBullai(item: ItemParaBullai, catalogo: ReadonlySet<string>): TraducaoParaBullai {
  const suf = item.tipoPessoa === 'PJ' ? '_pj' : '_pf'
  const tem = (c: string) => catalogo.has(c)
  const soAsQueExistem = (lista: string[], motivo: string): TraducaoParaBullai => {
    const chaves = lista.filter(tem)
    return chaves.length ? { chaves, semBullai: null } : FORA(motivo)
  }
  const uf = String(item.parametros?.uf ?? '').trim().toUpperCase()

  switch (item.codigo) {
    case 'FED.CND_RFB_PGFN':
      return soAsQueExistem([`receita_federal${suf}`], 'A BullAI não tem a CND Federal para este tipo de pessoa.')
    case 'TRAB.CNDT':
      return soAsQueExistem([`tst${suf}`], 'A BullAI não tem a CNDT para este tipo de pessoa.')
    case 'FED.CJF_UNIFICADA':
      // CÍVEL E CRIMINAL, e não a eleitoral: a unificada da planilha é a de
      // distribuição, e a eleitoral é outra certidão.
      return soAsQueExistem(
        [`cjf_unificada_civel${suf}`, `cjf_unificada_criminal${suf}`],
        'A BullAI não tem a certidão unificada da Justiça Federal para este tipo de pessoa.',
      )
    case 'FED.TRF1':
    case 'FED.TRF2':
    case 'FED.TRF3':
    case 'FED.TRF4':
    case 'FED.TRF5':
    case 'FED.TRF6': {
      const n = item.codigo.slice(-1)
      const achadas = [...catalogo].filter(
        (c) => c.startsWith(`trf${n}_`) && c.endsWith(suf) && /(^|_)(civel|criminal)(_|$)/.test(c.slice(0, -suf.length)),
      )
      return achadas.length
        ? { chaves: achadas.sort(), semBullai: null }
        : FORA(`A BullAI não tem a certidão do TRF${n} para este tipo de pessoa.`)
    }
    case 'FGTS.CRF':
      return soAsQueExistem([`fgts_crf${suf}`], 'A BullAI não tem o CRF do FGTS para este tipo de pessoa.')
    case 'PROP.SANCOES_CGU':
      return soAsQueExistem([`cgu_transparencia_sancoes${suf}`], 'A BullAI não tem a consulta de sanções da CGU.')
    case 'EST.CDT': {
      if (!uf) return FORA('O item não diz o estado — defina a UF antes de emitir.')
      // SÃO PAULO SE DIVIDE EM DOIS: os débitos não inscritos (SEFAZ) e os
      // inscritos em dívida ativa (PGE). A planilha pede "débitos estaduais", e
      // ali eles moram em duas certidões.
      const lista = [`sefaz_${uf.toLowerCase()}${suf}`, ...(uf === 'SP' ? [`pge_sp${suf}`] : [])]
      return soAsQueExistem(lista, `A BullAI não tem a certidão de débitos estaduais de ${uf}.`)
    }
    case 'EST.TJ_CIVEL_CRIMINAL': {
      if (!uf) return FORA('O item não diz o estado — defina a UF antes de emitir.')
      const chaves = [chaveDoTj(uf, 'civel', suf, catalogo), chaveDoTj(uf, 'criminal', suf, catalogo)].filter(
        (c): c is string => Boolean(c),
      )
      return chaves.length ? { chaves, semBullai: null } : FORA(`A BullAI não tem as certidões do TJ${uf}.`)
    }
    case 'MUN.CND': {
      const { cidade, uf: ufEscrita } = lerCidade(item.parametros?.municipio)
      if (!cidade) return FORA('O item não diz a cidade — defina o município antes de emitir.')
      const slug = slugDaCidade(cidade)
      // O ESTADO ESCRITO NO ITEM MANDA, e aí a chave é exata: "Salvador/SP" não
      // pode virar a CND de Salvador da Bahia só por ela ser a única no catálogo.
      if (ufEscrita) {
        const exata = `cnd_${slug}_${ufEscrita.toLowerCase()}${suf}`
        return tem(exata)
          ? { chaves: [exata], semBullai: null }
          : FORA(`A BullAI não tem a CND municipal de ${cidade}/${ufEscrita}.`)
      }
      const re = new RegExp(`^cnd_${slug}_([a-z]{2})${suf}$`)
      const candidatas = [...catalogo].filter((c) => re.test(c))
      if (candidatas.length === 0) return FORA(`A BullAI não tem a CND municipal de ${cidade}.`)
      // UMA SÓ NO CATÁLOGO é ela — mesmo que a lista de estados da pessoa esteja
      // incompleta, que é o caso comum.
      if (candidatas.length === 1) return { chaves: candidatas, semBullai: null }
      // VÁRIAS COM O MESMO NOME: desempata pelos estados onde a pessoa morou.
      const ufs = (item.ufsDoSujeito ?? []).map((u) => u.toLowerCase())
      const doEstado = candidatas.filter((c) => ufs.includes(c.match(re)![1]))
      if (doEstado.length === 1) return { chaves: doEstado, semBullai: null }
      return FORA(
        `Há ${candidatas.length} cidades chamadas ${cidade} no catálogo da BullAI e não deu para saber de qual ` +
          'estado é esta — escreva a cidade com a UF (ex.: "Bom Jesus/PI").',
      )
    }
    case 'EXTRA.PROTESTO_CENPROT':
    case 'EXTRA.PROTESTO_CENPROT_SP':
      return FORA('Protesto de títulos não está no catálogo da BullAI.')
    case 'PJ.CNPJ_SITUACAO':
      return FORA('A situação cadastral do CNPJ não está no catálogo da BullAI.')
    case 'PROP.INTERDICAO':
      return FORA('A certidão de interdição só existe na BullAI para o TJPA.')
    case 'PREC.CADERNO_PROCESSUAL':
      return FORA('O caderno processual é a leitura dos autos, não uma certidão a emitir.')
    default:
      return FORA(`A certidão ${item.codigo} ainda não tem correspondente na BullAI.`)
  }
}
