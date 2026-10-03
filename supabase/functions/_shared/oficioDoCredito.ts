// _shared/oficioDoCredito.ts
// O OFÍCIO REQUISITÓRIO (RPV ou precatório) ENTRE OS ANEXOS DO CARD — e quem ele
// diz que é o titular do crédito.
//
// A REGRA DO DONO (03/10/2026): "para extração das certidões o cedente deve
// corresponder ao titular do crédito, do precatório, o que precisa corresponder
// ao ofício anexado no kommo." Até aqui o titular saía do TÍTULO do card (ou do
// nome digitado) e dos autos. O título é escrito à mão pelo comercial; o ofício
// é o documento do tribunal que diz a quem o dinheiro vai ser pago. Quando os
// dois divergem, quem está certo é o ofício — e a certidão tirada no nome do
// título é a certidão de quem não recebe nada.
//
// O QUE MORA AQUI, tudo puro e testado:
//   - `lerOficios`: acha o(s) ofício(s) pelo NOME do arquivo e pelo CONTEÚDO
//     (cabeçalho "OFÍCIO REQUISITÓRIO", "REQUISIÇÃO DE PEQUENO VALOR",
//     "PRECATÓRIO"; campos "Beneficiário", "CPF/CNPJ", "Valor requisitado",
//     "Natureza do crédito"…, como nos modelos do TJ, do TRF e do TRT), e lê de
//     cada um os beneficiários: nome, documento com dígito válido e natureza;
//   - `oficioParaACessao`: o titular da parcela cedida segundo o ofício e a
//     divergência com o título;
//   - as conferências do que a IA devolve sobre o ofício (`conferirTitularDaIA`)
//     e o alinhamento da qualificação e dos titulares ao ofício.
//
// A LEITURA DETERMINÍSTICA VEM PRIMEIRO, a IA confirma. O campo "Beneficiário:
// FULANO CPF/CNPJ: …" é literal; quando ele se deixa ler, não há o que
// interpretar. A IA entra para o ofício de layout que estas regras não leem, e
// mesmo aí o documento que ela der precisa estar ESCRITO no ofício.
//
// O TEXTO VEM DO PDF.JS, e isso decide a forma das regras: os pedaços de cada
// página são juntados com espaço, sem quebra de linha. "Beneficiário: MARIA DOS
// SANTOS CPF/CNPJ: 529.982.247-25 Natureza: Alimentar" chega numa linha só — o
// nome acaba no próximo rótulo, e não no fim da linha.
//
// MÓDULO PURO — sem `Deno.` e sem `npm:`: o vitest, o navegador e as Edge
// Functions o alcançam. A tela roda a mesma leitura localmente (sem custo) para
// pré-preencher e avisar antes de a IA responder.

import {
  MARCA_DE_CORTE,
  documentosNoTexto,
  mencionaNome,
  nomesCompativeis,
  palavrasDoNome,
  tipoPessoaPeloNome,
} from './focoNoCedente.ts'
import { cnpjComDvValido, cpfComDvValido } from './qualificacaoDoCedente.ts'
import type { QualificacaoLida } from './qualificacaoDoCedente.ts'
import { alvosDaCessao, type PapelApurado, type ParcelaCedida, type TitularLido } from './titularesDaCessao.ts'

// ------------------------------------------------------------------ tipos

/** Um anexo do card, como a tela o leu: o nome do arquivo e o texto. */
export interface AnexoDoCard {
  nome: string
  texto: string
}

/**
 * A verba de que o beneficiário é titular, no ofício.
 *
 * 'honorarios' é o ofício (ou o campo) que diz "honorários" sem dizer quais —
 * o modelo do TRF costuma separar, o do TJ nem sempre.
 */
export type NaturezaDoBeneficio = 'principal' | 'contratuais' | 'sucumbenciais' | 'honorarios'

export type EspecieDoOficio = 'RPV' | 'PRECATORIO' | ''

/** Um beneficiário lido do ofício. Também é a forma do titular (`TitularDoOficio`). */
export interface BeneficiarioDoOficio {
  nome: string
  /** CPF (11) ou CNPJ (14), só dígitos, com dígito verificador válido. Senão ''. */
  documento: string
  tipo_pessoa: 'PF' | 'PJ' | ''
  natureza: NaturezaDoBeneficio
  /**
   * Quem ele sucede, quando o ofício diz ("ESPÓLIO DE X", "sucessora de X"). É
   * o que deixa o título "Espólio de João" bater com a herdeira do ofício.
   */
  sucede: string
  /** O trecho do ofício de onde saiu, até 400 caracteres. */
  evidencia: string
  /** O nome do arquivo do ofício. */
  arquivo: string
}

/** O titular segundo o ofício. A mesma forma do beneficiário. */
export type TitularDoOficio = BeneficiarioDoOficio

export interface OficioAchado {
  /** O nome do arquivo ('' na tela antiga, que manda o texto sem os nomes). */
  arquivo: string
  /** A posição do arquivo na lista de anexos. */
  indice: number
  especie: EspecieDoOficio
  /** O texto do ofício: o arquivo inteiro, ou o trecho dele que é o ofício. */
  texto: string
  /** O nome diz ofício, mas o arquivo não tem texto (digitalização). */
  sem_texto: boolean
  /** Por que se concluiu que é ofício, para a tela poder dizer. */
  porque: string[]
  beneficiarios: BeneficiarioDoOficio[]
}

export interface Divergencia {
  /** O nome que o título do card (ou o cadastro) dá. */
  titulo: string
  /** O nome que o ofício dá. */
  oficio: string
  mensagem: string
}

export interface EscolhaDoTitular {
  titular: TitularDoOficio | null
  /** Os beneficiários da natureza procurada (mais de um = litisconsórcio no ofício). */
  candidatos: BeneficiarioDoOficio[]
  aviso: string | null
}

/** O que a leitura do ofício decide para uma cessão. */
export interface LeituraDoOficio {
  oficios: OficioAchado[]
  /** O titular de cada papel apurado (os de `alvosDaCessao`). */
  porPapel: Partial<Record<PapelApurado, EscolhaDoTitular>>
  /** O papel de quem CEDE no card: o advogado numa cessão só de honorários. */
  papelDoCedente: PapelApurado
  /** O titular do ofício para quem cede. */
  titular: TitularDoOficio | null
  /** Por que a escolha do titular de quem cede não fechou (ou fechou com ressalva). */
  avisoDaEscolha: string | null
  divergencia: Divergencia | null
  /**
   * O aviso de destaque: a divergência, o "nenhum ofício", o ofício ilegível
   * ou ambíguo. `null` quando o ofício confirma o título.
   */
  aviso: string | null
}

/** O resumo do ofício que vai na resposta das funções. */
export interface ResumoDoOficio {
  achado: boolean
  arquivos: { nome: string; especie: EspecieDoOficio; sem_texto: boolean; porque: string[] }[]
  beneficiarios: { nome: string; documento: string; natureza: NaturezaDoBeneficio; tipo_pessoa: 'PF' | 'PJ' | '' }[]
}

/**
 * Os campos que dd-qualificacao e dd-titulares ACRESCENTAM à resposta.
 * Opcionais: um servidor anterior a 03/10/2026 não os manda.
 */
export interface CamposDoOficio {
  oficio?: ResumoDoOficio
  titular_do_oficio?: TitularDoOficio | null
  divergencia?: Divergencia | null
  aviso_do_oficio?: string | null
}

// ------------------------------------------------------------------ texto

/**
 * Minúsculo e sem acento, COM O MESMO COMPRIMENTO do original — as posições
 * achadas aqui cortam o texto original.
 */
export function dobrar(s: string): string {
  const baixo = s.toLowerCase()
  if (baixo.length === s.length) {
    return baixo.replace(/[À-ɏ]/g, (c) => {
      const b = c.normalize('NFD')[0] ?? c
      return b.length === 1 ? b : c
    })
  }
  // Raro ("İ" vira dois caracteres no toLowerCase): caractere a caractere.
  const out: string[] = []
  for (const c of s) {
    for (let k = 0; k < c.length; k++) {
      const u = c[k]
      const n = (u.normalize('NFD')[0] ?? u).toLowerCase()
      out.push(n.length === 1 ? n : u)
    }
  }
  return out.join('')
}

const espacos = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** "52998224725" → "529.982.247-25"; "11222333000181" → "11.222.333/0001-81". */
export function formatarDocumento(d: string): string {
  const x = soDigitos(d)
  if (x.length === 11) return x.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (x.length === 14) return x.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return x
}

const documentoValido = (d: string) =>
  d.length === 11 ? cpfComDvValido(d) : d.length === 14 ? cnpjComDvValido(d) : false

const rotuloDoDocumento = (d: string) => (d.length === 14 ? 'CNPJ' : 'CPF')

// ------------------------------------------------------------------ reconhecer

/**
 * Os cabeçalhos de ofício. Cada um, sozinho, não basta: "expeça-se ofício
 * requisitório" aparece em todo despacho de cumprimento de sentença. É o
 * cabeçalho somado aos CAMPOS do formulário que faz um ofício.
 */
const CABECALHOS: { re: RegExp; rotulo: string; especie: EspecieDoOficio }[] = [
  { re: /oficio\s+requisitorio/g, rotulo: 'cabeçalho "OFÍCIO REQUISITÓRIO"', especie: '' },
  { re: /requisicao\s+de\s+pequeno\s+valor/g, rotulo: 'cabeçalho "REQUISIÇÃO DE PEQUENO VALOR"', especie: 'RPV' },
  { re: /requisicao\s+de\s+pagamento/g, rotulo: 'cabeçalho "REQUISIÇÃO DE PAGAMENTO"', especie: '' },
  {
    re: /oficio\s+(?:de\s+)?precatorio|precatorio\s+requisitorio|requisicao\s+de\s+precatorio|precatorio\s+n[o°º.]*\s*\d/g,
    rotulo: 'cabeçalho "PRECATÓRIO"',
    especie: 'PRECATORIO',
  },
  { re: /\brpv\s+n[o°º.]*\s*\d/g, rotulo: 'cabeçalho "RPV nº"', especie: 'RPV' },
]

/**
 * Os campos do formulário do ofício, com o peso de cada um. Os rótulos são os
 * dos modelos reais: o do CJF (TRFs), o do SAJ/portal de precatórios (TJs) e o
 * do PJe-JT (TRTs).
 */
const CAMPOS: { re: RegExp; peso: number; rotulo: string; pessoa?: boolean }[] = [
  { re: /\bbeneficiari[oa]s?\b[^:]{0,40}:/, peso: 2, rotulo: 'campo "Beneficiário"', pessoa: true },
  { re: /\bcpf\s*\/\s*cnpj\b|\bcnpj\s*\/\s*cpf\b/, peso: 1, rotulo: 'campo "CPF/CNPJ"', pessoa: true },
  {
    re: /\bvalor\s+(?:total\s+|global\s+|bruto\s+)?(?:requisitado|da\s+requisicao|do\s+requisitorio|a\s+requisitar)/,
    peso: 2,
    rotulo: 'campo "Valor requisitado"',
  },
  {
    re: /\bnatureza\s+do\s+credito\b|\bnatureza\s*:\s*(?:alimentar|alimenticia|comum|nao\s+alimentar)/,
    peso: 2,
    rotulo: 'campo "Natureza do crédito"',
  },
  { re: /\bdata[\s-]*base\b/, peso: 1, rotulo: 'campo "Data-base"' },
  { re: /\bentidade\s+devedora\b|\bente\s+devedor\b|\bdevedor\s*:/, peso: 1, rotulo: 'campo "Entidade devedora"' },
  {
    re: /\bespecie\b[^:]{0,20}:\s*(?:rpv|precatorio|requisicao\s+de\s+pequeno)/,
    peso: 2,
    rotulo: 'campo "Espécie"',
  },
  { re: /\bcredor(?:\(es\)|es)?\s*:/, peso: 1, rotulo: 'campo "Credor"', pessoa: true },
]

/** O nome do arquivo diz ofício ("oficio", "requisitório", "RPV", "precatório"…). */
export function nomePareceOficio(nome: string): boolean {
  return /oficio|requisi[tc]|\brpv\b|precatori/.test(dobrar(nome).replace(/[_\-.]+/g, ' '))
}

/** Até onde vai um ofício a partir do cabeçalho. Um ofício tem de uma a quatro páginas. */
const ALCANCE_DO_OFICIO = 9000
/** Cabeçalhos mais perto que isto são o MESMO ofício (o título e o subtítulo). */
const MESMO_OFICIO = 2500
/** Arquivo até este tamanho, com um ofício só, é o ofício inteiro. */
const ARQUIVO_PEQUENO = 15000

interface Trecho {
  inicio: number
  fim: number
  cabecalhos: string[]
  especie: EspecieDoOficio
}

/** Os trechos do texto que começam num cabeçalho de ofício. */
function trechosComCabecalho(f: string): Trecho[] {
  const achados: { pos: number; rotulo: string; especie: EspecieDoOficio }[] = []
  for (const c of CABECALHOS) {
    c.re.lastIndex = 0
    for (const m of f.matchAll(c.re)) achados.push({ pos: m.index ?? 0, rotulo: c.rotulo, especie: c.especie })
  }
  achados.sort((a, b) => a.pos - b.pos)
  const grupos: { pos: number; rotulos: string[]; especies: EspecieDoOficio[] }[] = []
  for (const a of achados) {
    const ult = grupos[grupos.length - 1]
    if (ult && a.pos - ult.pos <= MESMO_OFICIO) {
      if (!ult.rotulos.includes(a.rotulo)) ult.rotulos.push(a.rotulo)
      ult.especies.push(a.especie)
    } else {
      grupos.push({ pos: a.pos, rotulos: [a.rotulo], especies: [a.especie] })
    }
  }
  const L = f.length
  const pequeno = L <= ARQUIVO_PEQUENO && grupos.length === 1
  return grupos.map((g, i) => {
    const prox = grupos[i + 1]?.pos
    const inicio = pequeno ? 0 : Math.max(0, g.pos - 300, i > 0 ? grupos[i - 1].pos + 1 : 0)
    let fim = pequeno ? L : Math.min(L, g.pos + ALCANCE_DO_OFICIO)
    if (prox !== undefined) fim = Math.min(fim, Math.max(g.pos + 1, prox - 300))
    // RPV vence: "OFÍCIO REQUISITÓRIO – REQUISIÇÃO DE PEQUENO VALOR" é RPV.
    const especie: EspecieDoOficio = g.especies.includes('RPV')
      ? 'RPV'
      : g.especies.includes('PRECATORIO')
        ? 'PRECATORIO'
        : /pequeno\s+valor|\brpv\b/.test(f.slice(inicio, Math.min(fim, inicio + 1500)))
          ? 'RPV'
          : /precatorio/.test(f.slice(inicio, Math.min(fim, inicio + 1500)))
            ? 'PRECATORIO'
            : ''
    return { inicio, fim, cabecalhos: g.rotulos, especie }
  })
}

function pontuarCampos(f: string): { pontos: number; rotulos: string[]; pessoa: boolean } {
  let pontos = 0
  let pessoa = false
  const rotulos: string[] = []
  for (const c of CAMPOS) {
    if (c.re.test(f)) {
      pontos += c.peso
      rotulos.push(c.rotulo)
      if (c.pessoa) pessoa = true
    }
  }
  return { pontos, rotulos, pessoa }
}

/**
 * Os ofícios requisitórios entre os anexos.
 *
 * QUANDO É OFÍCIO:
 *   - nome de arquivo de ofício + cabeçalho, ou + dois pontos de campos;
 *   - nome genérico ("documento.pdf"): cabeçalho + campos de peso 3 ou mais,
 *     entre eles um campo de pessoa (Beneficiário, Credor, CPF/CNPJ) — e pelo
 *     menos um beneficiário lido. É o que separa o ofício do despacho que manda
 *     expedi-lo.
 * Um arquivo de autos inteiros com o ofício no meio vale: o ofício é o TRECHO
 * que começa no cabeçalho, não o arquivo.
 */
export function lerOficios(anexos: AnexoDoCard[]): OficioAchado[] {
  const fora: OficioAchado[] = []
  anexos.forEach((a, indice) => {
    const nome = espacos(a?.nome).slice(0, 200)
    const texto = String(a?.texto ?? '')
    const peloNome = nome ? nomePareceOficio(nome) : false

    if (texto.replace(/\s+/g, '').length < 80) {
      // O NOME DIZ OFÍCIO E NÃO HÁ TEXTO: é o ofício digitalizado. Fica na lista
      // — "achei o ofício e não consigo lê-lo" é diferente de "não há ofício".
      if (peloNome) {
        fora.push({
          arquivo: nome,
          indice,
          especie: /rpv|pequeno/.test(dobrar(nome)) ? 'RPV' : /precator/.test(dobrar(nome)) ? 'PRECATORIO' : '',
          texto: '',
          sem_texto: true,
          porque: ['nome do arquivo'],
          beneficiarios: [],
        })
      }
      return
    }

    const f = dobrar(texto)
    let trechos = trechosComCabecalho(f)
    if (trechos.length === 0 && peloNome) {
      trechos = [{ inicio: 0, fim: Math.min(f.length, ARQUIVO_PEQUENO), cabecalhos: [], especie: '' }]
    }
    let algumDoArquivo = false
    for (const tr of trechos) {
      const ft = f.slice(tr.inicio, tr.fim)
      const campos = pontuarCampos(ft)
      const temCabecalho = tr.cabecalhos.length > 0
      const passa = peloNome
        ? temCabecalho || campos.pontos >= 2
        : temCabecalho && campos.pontos >= 3 && campos.pessoa
      if (!passa) continue
      const textoDoTrecho = texto.slice(tr.inicio, tr.fim)
      const beneficiarios = lerBeneficiarios(textoDoTrecho, ft, nome)
      // NOME GENÉRICO SEM BENEFICIÁRIO LIDO: não é certeza bastante para dizer
      // "achei o ofício". Com o nome do arquivo dizendo ofício, fica — e a IA o lê.
      if (!peloNome && beneficiarios.length === 0) continue
      algumDoArquivo = true
      fora.push({
        arquivo: nome,
        indice,
        especie: tr.especie,
        texto: textoDoTrecho,
        sem_texto: false,
        porque: [...(peloNome ? ['nome do arquivo'] : []), ...tr.cabecalhos, ...campos.rotulos],
        beneficiarios,
      })
    }
    // O nome diz ofício, o texto existe, mas nada nele se parece com o
    // formulário: fica como ofício sem beneficiário lido (a IA tenta).
    if (!algumDoArquivo && peloNome && trechos.length === 0) {
      fora.push({
        arquivo: nome,
        indice,
        especie: '',
        texto: texto.slice(0, ARQUIVO_PEQUENO),
        sem_texto: false,
        porque: ['nome do arquivo'],
        beneficiarios: [],
      })
    }
  })
  return fora
}

// ------------------------------------------------------------------ beneficiários

/** Os rótulos de quem recebe: os de primeira linha. */
const RE_BENEFICIARIO =
  /\b(beneficiari[oa]s?|credor(?:\(es\)|es|a)?|nome\s+do\s+(?:beneficiario|credor)|advogad[oa]s?\s+beneficiari[oa]s?)\b(\s*\([^)]{0,25}\))?\s*:/g

/**
 * Os de segunda linha: só valem quando o ofício não tem "Beneficiário" nem
 * "Credor". No ofício de honorários do TRF, "Requerente" é o autor e o
 * beneficiário é o advogado — ler os dois como beneficiários poria o autor
 * como titular dos honorários.
 */
const RE_PARTE_AUTORA = /\b(exequentes?|requerentes?|reclamantes?|autor(?:\(a\)|a|es)?)\b(\s*\([^)]{0,25}\))?\s*:/g

/** Os rótulos de outra pessoa: encerram o bloco do beneficiário. */
const RE_OUTRA_PESSOA =
  /\b(advogad[oa]s?|procurador(?:a|es)?|requerid[oa]s?|executad[oa]s?|devedor(?:a|es)?|entidade\s+devedora|ente\s+devedor|reu|re|reclamad[oa]s?)\b(\s*\([^)]{0,25}\))?\s*:/g

/** "CPF/CNPJ do beneficiário:" é campo DELE, não um beneficiário novo. */
const RE_CAMPO_DO_BENEFICIARIO =
  /(cpf|cnpj|documento|dados|valor|conta|banco|nascimento|endereco|nome\s+da\s+mae)(?:\s*\/\s*(?:cpf|cnpj))?\s+(?:d[oa]s?|de)\s*$/

const CONECTIVOS_DO_NOME = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'd', '&'])

/** Palavras que não são nome: rótulos do formulário e da qualificação. */
const PARADAS = new Set(
  (
    'cpf cnpj mf data nascimento natureza valor valores especie advogado advogada oab ' +
    'requerido requerida requerente executado executada exequente processo banco agencia conta tipo ' +
    'situacao endereco mae orgao entidade juros principal total assunto documento doc rg portador ' +
    'portadora doenca deficiencia renuncia beneficiario beneficiaria credor credora devedor sucessor ' +
    'sucessora herdeiro herdeira numero vara juizo comarca honorarios contratuais sucumbenciais ' +
    'alimentar comum inscrito inscrita brasileiro brasileira residente domiciliado domiciliada ' +
    'procurador procuradora idoso idosa superpreferencia preferencia percentual quantidade meses rra ' +
    'observacao observacoes pis pasep nit cep email telefone nacionalidade civil casado casada ' +
    'solteiro solteira divorciado divorciada viuvo viuva profissao representante representado ' +
    'representada por nome natural nb beneficio reu autor autora database requisicao requisitado ' +
    'oficio precatorio rpv referencia competencia inscricao inss uniao fazenda municipio estado ' +
    'destaque destacado destacados parte autos origem originario'
  ).split(' '),
)

/**
 * O nome escrito a partir de `inicio`, até o próximo rótulo, número ou sinal.
 *
 * Sem quebra de linha (ver o cabeçalho do arquivo), quem acaba o nome é: um
 * número, dois-pontos, parêntese, vírgula, travessão, uma palavra de rótulo, ou
 * — num nome todo em maiúsculas — a primeira palavra que não está.
 */
function lerNome(t: string, inicio: number, fim: number): { nome: string; fim: number } | null {
  const janela = t.slice(inicio, Math.min(fim, inicio + 400))
  // "Nome:", "Nome completo:", "Nome do beneficiário:" logo depois do rótulo; e
  // o documento ANTES do nome ("Beneficiário: 529.982.247-25 - MARIA…").
  const pre =
    /^\s*(?:nome(?:\s+completo)?(?:\s+d[oa]\s+(?:benefici[aá]ri[oa]|credor[a]?))?\s*:)?\s*(?:\d[\d.\/\s-]{9,20}\d\s*[-–—]?\s*)?/i.exec(
      janela,
    )
  let pos = pre ? pre[0].length : 0
  const palavras: string[] = []
  let fimDoNome = pos
  let maiusculo: boolean | null = null
  const re = /\S+/g
  re.lastIndex = pos
  let m: RegExpExecArray | null
  while ((m = re.exec(janela)) !== null) {
    let w = m[0]
    if (/^[-–—]+$/.test(w)) break
    let parar = false
    if (/[,;)]+$/.test(w) && !w.includes('(')) {
      w = w.replace(/[,;)]+$/, '')
      parar = true
    }
    if (!w || /[\d:()[\]{},;"“”]/.test(w)) break
    if (w !== '&' && !/^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'´`’.&/-]*$/.test(w)) break
    const base = dobrar(w).replace(/[^a-z&]/g, '')
    if (!base) break
    if (PARADAS.has(base)) break
    const conectivo = CONECTIVOS_DO_NOME.has(base)
    if (!conectivo) {
      const letras = w.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '')
      const todoMaiusculo = letras === letras.toUpperCase()
      if (maiusculo === null) maiusculo = todoMaiusculo
      else if (maiusculo && !todoMaiusculo) break
      else if (!maiusculo && letras[0] !== letras[0].toUpperCase()) break
    }
    palavras.push(w)
    fimDoNome = m.index + m[0].length
    pos = fimDoNome
    if (parar || palavras.length >= 14) break
  }
  while (palavras.length && CONECTIVOS_DO_NOME.has(dobrar(palavras[palavras.length - 1]).replace(/[^a-z&]/g, ''))) {
    palavras.pop()
  }
  const nome = palavras.join(' ').replace(/\.+$/, '')
  if (!nome) return null
  const significativas = palavrasDoNome(nome).length
  if (significativas < 2 && !(tipoPessoaPeloNome(nome) === 'PJ' && significativas >= 1)) return null
  return { nome, fim: inicio + fimDoNome }
}

/** "ESPÓLIO DE X" → X; "(sucessora de X)" logo depois do nome → X; "(espólio)" → o próprio nome. */
function sucessao(t: string, f: string, nome: string, fimDoNome: number, fimDoBloco: number): string {
  const doNome = /^\s*esp[oó]lio\s+d[eoa]s?\s+(.+)$/i.exec(nome)
  if (doNome) return doNome[1].trim()
  const depois = f.slice(fimDoNome, Math.min(fimDoBloco, fimDoNome + 160))
  if (/^\W{0,4}\(?\s*espolio\b/.test(depois)) return nome
  const m = /^\W{0,4}\(?\s*(?:sucessor(?:a|es)?|herdeir[oa]s?|habilitad[oa]s?)(?:\s+(?:habilitad[oa]|legal|legitim[oa]))?\s+(?:de|do|da)\s+/.exec(
    depois,
  )
  if (!m) return ''
  const lido = lerNome(t, fimDoNome + m[0].length, fimDoBloco)
  return lido?.nome ?? ''
}

function naturezaPeloTexto(f: string): NaturezaDoBeneficio | null {
  if (/contratua/.test(f)) return 'contratuais'
  if (/sucumb/.test(f)) return 'sucumbenciais'
  if (/destaque|destacad/.test(f)) return 'contratuais'
  if (/honorari/.test(f)) return 'honorarios'
  return null
}

/** "Tipo de requisição: Honorários sucumbenciais", "Verba: Principal". */
const RE_NATUREZA_NO_CAMPO =
  /\b(?:tipo|natureza|especie|verba|referente|modalidade|categoria|classificacao)\b[^:]{0,40}:\s*(?:a\s+|aos?\s+)?(?:de\s+)?(honorarios[^,;:]{0,40}|principal|credito\s+principal|parte\s+autora)/

/** "REQUISIÇÃO DE PEQUENO VALOR – HONORÁRIOS SUCUMBENCIAIS", "Precatório de honorários". */
const RE_NATUREZA_NO_CABECALHO =
  /(?:requisicao(?:\s+de\s+pequeno\s+valor|\s+de\s+pagamento)?|rpv|precatorio|oficio(?:\s+requisitorio)?)\s*(?:n[o°º.]*\s*[\d./-]+\s*)?[-–:]?\s*(?:de\s+)?(honorarios(?:\s+advocaticios)?(?:\s+(?:contratuais|sucumbenciais|de\s+sucumbencia))?)/

/** A natureza do ofício inteiro, pelo que vem antes do primeiro beneficiário. */
function naturezaDoOficio(fCabecalho: string): NaturezaDoBeneficio | null {
  const c = RE_NATUREZA_NO_CABECALHO.exec(fCabecalho)
  if (c) return naturezaPeloTexto(c[1])
  const m = RE_NATUREZA_NO_CAMPO.exec(fCabecalho)
  if (m && /honorari/.test(m[1])) return naturezaPeloTexto(m[1])
  return null
}

const ehHonorario = (n: NaturezaDoBeneficio | null) => n !== null && n !== 'principal'

/** Os beneficiários de um ofício: `t` é o texto do trecho, `f` o mesmo dobrado. */
function lerBeneficiarios(t: string, f: string, arquivo: string): BeneficiarioDoOficio[] {
  type Rotulo = { inicio: number; fim: number; texto: string; pessoa: boolean }
  const coletar = (re: RegExp, pessoa: boolean): Rotulo[] => {
    re.lastIndex = 0
    return [...f.matchAll(re)].map((m) => ({
      inicio: m.index ?? 0,
      fim: (m.index ?? 0) + m[0].length,
      texto: m[0],
      pessoa,
    }))
  }
  const doBeneficiario = (r: Rotulo) => !RE_CAMPO_DO_BENEFICIARIO.test(f.slice(Math.max(0, r.inicio - 30), r.inicio))
  let rotulos = coletar(RE_BENEFICIARIO, true).filter(doBeneficiario)
  if (rotulos.length === 0) rotulos = coletar(RE_PARTE_AUTORA, true).filter(doBeneficiario)
  if (rotulos.length === 0) return []
  const outras = coletar(RE_OUTRA_PESSOA, false).filter(
    // "Advogado beneficiário:" é beneficiário, não fronteira.
    (o) => !rotulos.some((r) => o.inicio >= r.inicio && o.inicio < r.fim),
  )

  const primeiro = Math.min(...rotulos.map((r) => r.inicio))
  const daNatureza = naturezaDoOficio(f.slice(0, primeiro))

  // Só os rótulos que trazem um nome contam como fronteira entre beneficiários.
  const lidos: { r: Rotulo; nome: string; fimDoNome: number }[] = []
  for (const r of rotulos) {
    const n = lerNome(t, r.fim, Math.min(t.length, r.fim + 400))
    if (n) lidos.push({ r, nome: n.nome, fimDoNome: n.fim })
  }
  const fronteiras = [...lidos.map((l) => l.r.inicio), ...outras.map((o) => o.inicio)].sort((a, b) => a - b)

  const fora: BeneficiarioDoOficio[] = []
  let limiteAnterior = 0
  for (const l of lidos) {
    const fimDoBloco = Math.min(
      fronteiras.find((p) => p > l.r.inicio) ?? t.length,
      l.r.fim + 1500,
      t.length,
    )
    const bloco = t.slice(l.r.fim, fimDoBloco)
    const fBloco = f.slice(l.r.inicio, fimDoBloco)

    const doc =
      documentosNoTexto(bloco)
        .map((d) => d.doc)
        .find((d) => documentoValido(d)) ?? ''

    // A NATUREZA, do mais explícito ao mais indireto.
    let natureza: NaturezaDoBeneficio | null = null
    const campo = RE_NATUREZA_NO_CAMPO.exec(fBloco)
    if (campo) natureza = /honorari/.test(campo[1]) ? naturezaPeloTexto(campo[1]) : 'principal'
    if (natureza === null) {
      // O título da seção logo antes do rótulo ("Honorários contratuais
      // (destaque) Beneficiário: …") — só o que vem depois do último número ou
      // dois-pontos, para "Honorários destacados: Não" do bloco anterior não
      // contar.
      const antes = f.slice(Math.max(limiteAnterior, l.r.inicio - 120), l.r.inicio)
      const corte = Math.max(antes.search(/[\d:][^\d:]*$/), -1)
      const titulo = corte >= 0 ? antes.slice(corte + 1) : antes
      if (/honorari|destaque/.test(titulo)) natureza = naturezaPeloTexto(titulo)
    }
    const nomeDobrado = dobrar(l.nome)
    const pertoDoNome = f.slice(l.fimDoNome, Math.min(fimDoBloco, l.fimDoNome + 150))
    const eAdvogado =
      /advogad/.test(l.r.texto) ||
      /advogad|advocacia/.test(nomeDobrado) ||
      /\boab\b/.test(pertoDoNome.split(/\bcpf\b|\bcnpj\b/)[0] ?? '') ||
      /\btipo[^:]{0,30}:\s*advogad/.test(fBloco)
    if (natureza === null) {
      natureza = eAdvogado
        ? ehHonorario(daNatureza)
          ? daNatureza
          : 'honorarios'
        : (daNatureza ?? 'principal')
    }

    fora.push({
      nome: l.nome,
      documento: doc,
      tipo_pessoa: doc.length === 14 ? 'PJ' : doc.length === 11 ? 'PF' : (tipoPessoaPeloNome(l.nome) ?? ''),
      natureza,
      sucede: sucessao(t, f, l.nome, l.fimDoNome, fimDoBloco),
      evidencia: espacos(t.slice(l.r.inicio, Math.min(fimDoBloco, l.r.inicio + 400))),
      arquivo,
    })
    limiteAnterior = l.fimDoNome
  }
  return unicos(fora)
}

/** Um beneficiário por pessoa e verba; o que tem documento vence. */
function unicos(lista: BeneficiarioDoOficio[]): BeneficiarioDoOficio[] {
  const fora: BeneficiarioDoOficio[] = []
  for (const b of lista) {
    const i = fora.findIndex(
      // A MESMA VERBA: o advogado que recebe contratuais e sucumbenciais são
      // dois beneficiários, e cada parcela cedida procura o seu.
      (x) =>
        x.natureza === b.natureza &&
        ((Boolean(x.documento) && x.documento === b.documento) ||
          ((!x.documento || !b.documento) && nomesCompativeis(x.nome, b.nome))),
    )
    if (i < 0) fora.push(b)
    else if (!fora[i].documento && b.documento) fora[i] = { ...b, sucede: b.sucede || fora[i].sucede }
  }
  return fora
}

// ------------------------------------------------------------------ mesma pessoa

const RE_SUCESSAO =
  /\b(esp[oó]lio|herdeir[oa]s?|sucessor(?:a|es)?|inventariante|de\s+cujus|falecid[oa])\b\s*(?:(?:de|do|da|dos|das)\s+)?/gi

const semSucessao = (n: string) => espacos(String(n ?? '').replace(RE_SUCESSAO, ' '))

/**
 * Os dois nomes podem ser da MESMA pessoa — tolerando acento, maiúsculas, nome
 * do meio abreviado ou omitido, e o espólio/herdeiro: "Espólio de João da
 * Silva" bate com "JOÃO DA SILVA", e com a herdeira cujo ofício diz "sucessora
 * de JOÃO DA SILVA" (passe-a em `sucedidos`).
 */
export function mesmaPessoa(a: string, b: string, sucedidos: string[] = []): boolean {
  const x = semSucessao(a)
  const y = semSucessao(b)
  if (!x || !y) return false
  if (nomesCompativeis(x, y)) return true
  return sucedidos.some((s) => Boolean(s) && nomesCompativeis(x, semSucessao(s)))
}

// ------------------------------------------------------------------ o titular

export const ROTULO_DA_NATUREZA: Record<NaturezaDoBeneficio, string> = {
  principal: 'crédito principal',
  contratuais: 'honorários contratuais',
  sucumbenciais: 'honorários sucumbenciais',
  honorarios: 'honorários',
}

/** As naturezas que servem a um papel, na ordem de preferência. */
export function naturezasDoPapel(papel: PapelApurado, parcela: ParcelaCedida | string): NaturezaDoBeneficio[] {
  if (papel === 'CEDENTE') return ['principal']
  if (parcela === 'sucumbenciais') return ['sucumbenciais', 'honorarios', 'contratuais']
  return ['contratuais', 'honorarios', 'sucumbenciais']
}

/** Todos os beneficiários dos ofícios, sem repetição. */
export function beneficiariosDosOficios(oficios: OficioAchado[]): BeneficiarioDoOficio[] {
  return unicos(oficios.flatMap((o) => o.beneficiarios))
}

const listaDeNomes = (l: BeneficiarioDoOficio[]) =>
  l
    .slice(0, 4)
    .map((b) => b.nome)
    .join('; ') + (l.length > 4 ? '…' : '')

/**
 * O titular de um papel segundo o ofício.
 *
 * UM BENEFICIÁRIO DAQUELA VERBA: é ele, diga o título o que disser. VÁRIOS (o
 * ofício do TJ lista os litisconsortes num formulário só): o título escolhe;
 * sem o título escolher, ninguém — e o aviso diz quem são.
 */
export function escolherTitular(
  oficios: OficioAchado[],
  papel: PapelApurado,
  parcela: ParcelaCedida | string,
  nomeDoTitulo: string,
): EscolhaDoTitular {
  const todos = beneficiariosDosOficios(oficios)
  const prefs = naturezasDoPapel(papel, parcela)
  const verba = ROTULO_DA_NATUREZA[prefs[0]]
  let candidatos: BeneficiarioDoOficio[] = []
  let achada: NaturezaDoBeneficio | null = null
  for (const n of prefs) {
    candidatos = todos.filter((b) => b.natureza === n)
    if (candidatos.length > 0) {
      achada = n
      break
    }
  }
  if (candidatos.length === 0) {
    return {
      titular: null,
      candidatos: [],
      aviso:
        todos.length > 0
          ? `O ofício requisitório não traz beneficiário de ${verba} (traz ${listaDeNomes(todos)}).`
          : oficios.some((o) => !o.sem_texto)
            ? 'Não consegui ler o beneficiário no ofício requisitório.'
            : null,
    }
  }
  let titular: BeneficiarioDoOficio | null = null
  let aviso: string | null = null
  if (candidatos.length === 1) titular = candidatos[0]
  else {
    const batem = nomeDoTitulo ? candidatos.filter((b) => mesmaPessoa(nomeDoTitulo, b.nome, [b.sucede])) : []
    if (batem.length === 1) titular = batem[0]
    else {
      aviso =
        `O ofício requisitório traz ${candidatos.length} beneficiários de ${verba} (${listaDeNomes(candidatos)}) ` +
        `e ${batem.length > 1 ? 'mais de um' : 'nenhum'} bate com o título do card` +
        `${nomeDoTitulo ? ` (${nomeDoTitulo})` : ''} — confira qual deles cede.`
    }
  }
  if (
    titular &&
    papel === 'ADVOGADO' &&
    achada &&
    achada !== prefs[0] &&
    achada !== 'honorarios' &&
    (parcela === 'contratuais' || parcela === 'sucumbenciais')
  ) {
    aviso = `O card cede ${ROTULO_DA_NATUREZA[prefs[0]]}, mas o ofício de honorários é de ${ROTULO_DA_NATUREZA[achada]} — confira.`
  }
  return { titular, candidatos, aviso }
}

export const SEM_OFICIO =
  'Nenhum ofício requisitório nos anexos do card; usando o nome do título — confira.'

/**
 * O aviso de destaque e a divergência, dado o titular FINAL (o determinístico,
 * ou o que a IA confirmou no ofício).
 */
export function confrontarComOTitulo(
  nomeDoTitulo: string,
  titular: TitularDoOficio | null,
  oficios: OficioAchado[],
  avisoDaEscolha: string | null = null,
): { divergencia: Divergencia | null; aviso: string | null } {
  if (oficios.length === 0) return { divergencia: null, aviso: SEM_OFICIO }
  if (oficios.every((o) => o.sem_texto)) {
    return {
      divergencia: null,
      aviso:
        `O ofício requisitório (${oficios.map((o) => o.arquivo || 'anexo').join(', ')}) está anexado, mas sem ` +
        'texto legível — é digitalização. Usando o nome do título; confira o titular no PDF.',
    }
  }
  if (!titular) {
    return {
      divergencia: null,
      aviso: `${avisoDaEscolha ?? 'Não consegui ler o beneficiário no ofício requisitório.'} Usando o nome do título — confira.`,
    }
  }
  const nome = espacos(nomeDoTitulo)
  if (nome && !mesmaPessoa(nome, titular.nome, [titular.sucede])) {
    const doc = titular.documento ? ` (${rotuloDoDocumento(titular.documento)} ${formatarDocumento(titular.documento)})` : ''
    const mensagem =
      `O título do card diz ${nome}; o ofício requisitório diz ${titular.nome}${doc}. ` +
      'As certidões e a due diligence seguem o ofício — confira e corrija o card.'
    return { divergencia: { titulo: nome, oficio: titular.nome, mensagem }, aviso: mensagem }
  }
  if (nome && titular.sucede && !mesmaPessoa(nome, titular.nome) && mesmaPessoa(nome, titular.sucede)) {
    return {
      divergencia: null,
      aviso:
        `O ofício está em nome de ${titular.nome}, que sucede ${titular.sucede} (o título fala de ${nome}). ` +
        'As certidões são de quem está no ofício.',
    }
  }
  return { divergencia: null, aviso: avisoDaEscolha }
}

/**
 * O ofício aplicado à cessão: os ofícios achados, o titular de cada papel, o
 * de quem cede, a divergência com o título e o aviso de destaque.
 *
 * `nomeDoTitulo` é o nome do cedente segundo o título (ou o que a pessoa
 * digitou): é contra ele que se confronta, e é ele que escolhe entre vários
 * beneficiários da mesma verba.
 */
export function oficioParaACessao(
  anexos: AnexoDoCard[],
  parcela: ParcelaCedida | string,
  nomeDoTitulo: string,
): LeituraDoOficio {
  const oficios = lerOficios(anexos)
  const alvos = alvosDaCessao(parcela)
  const papelDoCedente: PapelApurado = alvos.cedenteEhOAdvogado ? 'ADVOGADO' : 'CEDENTE'
  const nome = espacos(nomeDoTitulo)
  const porPapel: Partial<Record<PapelApurado, EscolhaDoTitular>> = {}
  for (const papel of alvos.papeis) porPapel[papel] = escolherTitular(oficios, papel, parcela, nome)

  let escolha = porPapel[papelDoCedente] ?? escolherTitular(oficios, papelDoCedente, parcela, nome)
  // CARD QUE NÃO DIZ A VERBA: quem cede é quem o título nomeia, seja do
  // principal, seja dos honorários.
  if ((parcela === 'auto' || parcela === 'indefinido' || !parcela) && nome) {
    const batem = beneficiariosDosOficios(oficios).filter((b) => mesmaPessoa(nome, b.nome, [b.sucede]))
    if (batem.length === 1) escolha = { titular: batem[0], candidatos: batem, aviso: null }
  }
  const { divergencia, aviso } = confrontarComOTitulo(nome, escolha.titular, oficios, escolha.aviso)
  return { oficios, porPapel, papelDoCedente, titular: escolha.titular, avisoDaEscolha: escolha.aviso, divergencia, aviso }
}

// ------------------------------------------------------------------ para as funções

/**
 * Os anexos do pedido. `arquivos: [{nome, texto}]` é o campo novo (03/10/2026);
 * a tela aberta antes do deploy manda só `texto`, e ele continua valendo — como
 * um anexo sem nome, lido pelo conteúdo.
 */
export function anexosDoCorpo(body: unknown): { anexos: AnexoDoCard[]; texto: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const lista = Array.isArray(b.arquivos) ? b.arquivos : []
  const anexos = lista
    .map((a) => {
      const o = (a ?? {}) as Record<string, unknown>
      return { nome: espacos(o.nome).slice(0, 200), texto: String(o.texto ?? '') }
    })
    .filter((a) => a.texto.trim() || a.nome)
  if (anexos.some((a) => a.texto.trim())) {
    return {
      anexos,
      texto: anexos
        .map((a) => a.texto)
        .filter((t) => t.trim())
        .join('\n\n===== PRÓXIMO ARQUIVO =====\n\n')
        .trim(),
    }
  }
  const texto = String(b.texto ?? '').trim()
  // A TELA ANTIGA JUNTA OS ARQUIVOS COM UM SEPARADOR: desfeito aqui, cada
  // pedaço é um anexo sem nome — e o trecho de um ofício não invade o arquivo
  // seguinte.
  const pedacos = texto
    .split(/\n*===== PRÓXIMO ARQUIVO =====\n*/)
    .filter((t) => t.trim())
    .map((t) => ({ nome: '', texto: t }))
  return { anexos: [...pedacos, ...anexos.filter((a) => a.nome)], texto }
}

/** O texto do(s) ofício(s), para conferir o que a IA diz ter lido nele. */
export function textoDosOficios(oficios: OficioAchado[]): string {
  return oficios
    .filter((o) => !o.sem_texto && o.texto)
    .map((o) => o.texto)
    .join(`\n\n${MARCA_DE_CORTE}\n\n`)
}

/**
 * O bloco que vai NO TOPO do pedido à IA, em destaque. Cada ofício com o nome
 * do arquivo, dentro de `max` caracteres.
 */
export function blocoDoOficioParaIA(oficios: OficioAchado[], max = 40_000): string {
  const comTexto = oficios.filter((o) => !o.sem_texto && o.texto.trim())
  if (comTexto.length === 0) return ''
  const cada = Math.floor(max / comTexto.length) - 120
  return comTexto
    .map(
      (o) =>
        `[arquivo: ${o.arquivo || '(anexo sem nome)'}${o.especie ? ` · ${o.especie === 'RPV' ? 'RPV' : 'precatório'}` : ''}]\n` +
        o.texto.trim().slice(0, Math.max(1000, cada)),
    )
    .join(`\n\n${MARCA_DE_CORTE}\n\n`)
    .slice(0, max)
}

export function resumoDoOficio(oficios: OficioAchado[]): ResumoDoOficio {
  return {
    achado: oficios.length > 0,
    arquivos: oficios.map((o) => ({
      nome: o.arquivo,
      especie: o.especie,
      sem_texto: o.sem_texto,
      porque: o.porque.slice(0, 8),
    })),
    beneficiarios: beneficiariosDosOficios(oficios).map((b) => ({
      nome: b.nome,
      documento: b.documento,
      natureza: b.natureza,
      tipo_pessoa: b.tipo_pessoa,
    })),
  }
}

const NATUREZAS = new Set<string>(['principal', 'contratuais', 'sucumbenciais', 'honorarios'])

/** O que a IA escreveu em "natureza", no vocabulário daqui. */
export function naturezaDaIA(v: unknown): NaturezaDoBeneficio | null {
  const s = dobrar(espacos(v))
  if (!s) return null
  if (NATUREZAS.has(s)) return s as NaturezaDoBeneficio
  if (/contratua/.test(s)) return 'contratuais'
  if (/sucumb/.test(s)) return 'sucumbenciais'
  if (/honorari/.test(s)) return 'honorarios'
  if (/principal|exequente|autor/.test(s)) return 'principal'
  return null
}

/**
 * O `titular_do_oficio` que a IA devolveu, conferido.
 *
 * O DOCUMENTO TEM DE ESTAR ESCRITO NO OFÍCIO e ter dígito válido; senão sai.
 * Havendo a leitura determinística, ela é o que está literalmente no campo do
 * beneficiário: a IA que aponta outra pessoa perde, e a que confirma só pode
 * acrescentar (o documento que o campo não trouxe). Sem leitura determinística,
 * vale a da IA — desde que o nome esteja no ofício e a verba sirva ao papel.
 */
export function conferirTitularDaIA(
  bruto: unknown,
  oficios: OficioAchado[],
  deterministico: TitularDoOficio | null,
  naturezasAceitas: NaturezaDoBeneficio[] = ['principal', 'contratuais', 'sucumbenciais', 'honorarios'],
): { titular: TitularDoOficio | null; avisos: string[] } {
  const avisos: string[] = []
  const comTexto = oficios.filter((o) => !o.sem_texto && o.texto)
  if (comTexto.length === 0) return { titular: deterministico, avisos }
  const o = (bruto ?? {}) as Record<string, unknown>
  const nome = espacos(o.nome).slice(0, 200)
  const textoOficio = textoDosOficios(comTexto)

  let doc = soDigitos(o.documento ?? o.cpf ?? o.cnpj)
  if (doc) {
    if (!documentoValido(doc)) {
      avisos.push(
        `O documento que a IA leu no ofício para ${nome || 'o titular'} (${doc}) tem dígito verificador inválido — descartado.`,
      )
      doc = ''
    } else if (!documentosNoTexto(textoOficio).some((d) => d.doc === doc)) {
      avisos.push(
        `O documento que a IA indicou para ${nome || 'o titular'} não está escrito no ofício requisitório — descartado.`,
      )
      doc = ''
    }
  }
  const natureza = naturezaDaIA(o.natureza)
  const evidencia = espacos(o.evidencia).slice(0, 400)

  if (deterministico) {
    if (nome && !mesmaPessoa(nome, deterministico.nome, [deterministico.sucede])) {
      avisos.push(
        `A IA apontou ${nome} como titular no ofício, mas o campo do beneficiário diz ${deterministico.nome} — ` +
          'vale o que está escrito no ofício.',
      )
      return { titular: deterministico, avisos }
    }
    if (doc && deterministico.documento && doc !== deterministico.documento) {
      avisos.push(
        `A IA leu no ofício o documento ${formatarDocumento(doc)}, mas o campo do beneficiário traz ` +
          `${formatarDocumento(deterministico.documento)} — vale o do campo.`,
      )
    }
    const documento = deterministico.documento || doc
    return {
      titular: {
        ...deterministico,
        documento,
        tipo_pessoa: documento.length === 14 ? 'PJ' : documento.length === 11 ? 'PF' : deterministico.tipo_pessoa,
        evidencia: deterministico.evidencia || evidencia,
      },
      avisos,
    }
  }

  if (!nome) return { titular: null, avisos }
  if (!mencionaNome(textoOficio, nome)) {
    avisos.push(`A IA apontou ${nome} como titular, mas esse nome não está no ofício requisitório — descartado.`)
    return { titular: null, avisos }
  }
  if (natureza && !naturezasAceitas.includes(natureza)) {
    avisos.push(
      `A IA apontou ${nome} como beneficiário de ${ROTULO_DA_NATUREZA[natureza]} no ofício, e a verba cedida é outra — ` +
        'não usado como titular.',
    )
    return { titular: null, avisos }
  }
  const arquivo = comTexto.find((x) => mencionaNome(x.texto, nome))?.arquivo ?? comTexto[0].arquivo
  return {
    titular: {
      nome,
      documento: doc,
      tipo_pessoa: doc.length === 14 ? 'PJ' : doc.length === 11 ? 'PF' : (tipoPessoaPeloNome(nome) ?? ''),
      natureza: natureza ?? naturezasAceitas[0],
      sucede: '',
      evidencia,
      arquivo,
    },
    avisos,
  }
}

/**
 * A qualificação lida, alinhada ao ofício: o nome e o documento do titular do
 * ofício entram (o documento já conferido: escrito no ofício, dígito válido), e
 * o tipo PF/PJ segue o documento — 14 dígitos é pessoa jurídica.
 *
 * VALE O OFÍCIO. Um CPF diferente na qualificação dos autos é de outra pessoa
 * ou de outro momento; a certidão tem de sair no documento de quem recebe.
 * Muda `q` e o devolve.
 */
export function alinharQualificacaoAoOficio(q: QualificacaoLida, t: TitularDoOficio | null): QualificacaoLida {
  if (!t) return q
  const ev = t.evidencia || `Ofício requisitório${t.arquivo ? ` (${t.arquivo})` : ''}: ${t.nome}`
  if (!q.cedente.nome && t.nome) q.cedente.nome = { valor: t.nome, evidencia: ev }
  const doc = t.documento
  if (!doc) return q
  const tipo: 'PF' | 'PJ' = doc.length === 14 ? 'PJ' : 'PF'
  const tipoLido = q.cedente.tipo_pessoa ?? 'PF'
  if (tipoLido !== tipo) {
    q.avisos.push(
      `O ofício requisitório traz ${rotuloDoDocumento(doc)} para o titular: ele é pessoa ` +
        `${tipo === 'PJ' ? 'jurídica' : 'física'}, e o cadastro segue o ofício.`,
    )
    if (tipo === 'PJ') {
      q.cedente = {
        nome: q.cedente.nome,
        cpf: null,
        nascimento: null,
        nome_mae: null,
        tipo_pessoa: 'PJ',
        cnpj: { valor: doc, evidencia: ev },
      }
      q.estado_civil = null
      q.conjuge = null
    } else {
      q.cedente = {
        nome: q.cedente.nome,
        cpf: { valor: doc, evidencia: ev },
        nascimento: null,
        nome_mae: null,
        tipo_pessoa: 'PF',
        cnpj: null,
      }
    }
    return q
  }
  const atual = tipo === 'PJ' ? (q.cedente.cnpj ?? null) : q.cedente.cpf
  if (atual && atual.valor !== doc) {
    q.avisos.push(
      `O ${rotuloDoDocumento(doc)} lido na qualificação dos autos (${formatarDocumento(atual.valor)}) não é o do ` +
        `ofício requisitório (${formatarDocumento(doc)}) — vale o do ofício.`,
    )
  }
  if (!atual || atual.valor !== doc) {
    if (tipo === 'PJ') q.cedente.cnpj = { valor: doc, evidencia: ev }
    else q.cedente.cpf = { valor: doc, evidencia: ev }
  }
  q.cedente.tipo_pessoa = tipo
  return q
}

/**
 * Os titulares lidos dos autos, com o ofício por cima: o do ofício é o
 * titular do papel. A leitura que apontou outra pessoa é trocada (com aviso);
 * a que apontou a mesma ganha o documento do ofício. A OAB lida fica — o
 * ofício raramente a traz, e é dela que o Escavador acha o advogado.
 */
export function imporOficioAosTitulares(
  titulares: TitularLido[],
  doOficio: Partial<Record<PapelApurado, TitularDoOficio | null>>,
): { titulares: TitularLido[]; avisos: string[] } {
  const avisos: string[] = []
  const saida = [...titulares]
  for (const papel of ['CEDENTE', 'ADVOGADO'] as PapelApurado[]) {
    const o = doOficio[papel]
    if (!o) continue
    const quem = papel === 'CEDENTE' ? 'do crédito principal' : 'dos honorários'
    const doOf: TitularLido = {
      papel,
      nome: o.nome,
      documento: o.documento,
      oab: '',
      tipoPessoa: o.tipo_pessoa,
      evidencia: o.evidencia,
    }
    const i = saida.findIndex((t) => t.papel === papel)
    if (i < 0) {
      saida.push(doOf)
      continue
    }
    const lido = saida[i]
    if (lido.nome && !mesmaPessoa(lido.nome, o.nome, [o.sucede])) {
      avisos.push(
        `A leitura dos autos apontou ${lido.nome} como titular ${quem}, mas o ofício requisitório diz ${o.nome} — vale o ofício.`,
      )
      saida[i] = doOf
      continue
    }
    if (o.documento && lido.documento && lido.documento !== o.documento) {
      avisos.push(
        `O documento lido nos autos para ${o.nome} (${formatarDocumento(lido.documento)}) não é o do ofício ` +
          `(${formatarDocumento(o.documento)}) — vale o do ofício.`,
      )
    }
    const documento = o.documento || lido.documento
    saida[i] = {
      ...lido,
      nome: o.nome || lido.nome,
      documento,
      tipoPessoa: documento.length === 14 ? 'PJ' : documento.length === 11 ? 'PF' : lido.tipoPessoa,
      evidencia: lido.evidencia || o.evidencia,
    }
  }
  return { titulares: saida, avisos }
}
