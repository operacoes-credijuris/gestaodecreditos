// _shared/qualificacaoDoCedente.ts
// O QUE A IA LEU DOS AUTOS sobre quem cede, conferido antes de chegar à tela.
//
// É o cadastro de que o checklist de certidões depende: CPF, nascimento, onde a
// pessoa mora e já morou, estado civil e cônjuge. Cada campo decide certidões —
// a UF e o município puxam as estaduais e municipais (planilha, linhas 48, 64 e
// 78), o casamento puxa o bloco do cônjuge, e a data de nascimento é exigida pela
// BullAI para pessoa física.
//
// A IA SUGERE; ESTE ARQUIVO CONFERE. Modelo que obedece ao prompt não é
// garantia, e o campo errado aqui custa caro: CPF inventado faz todo portal
// responder "nada consta", corretamente, e o dossiê fecha limpo sobre ninguém.
// Por isso:
//   - CPF só passa com dígito verificador válido E escrito nos autos — o número
//     tem de aparecer no texto, e não só "parecer plausível";
//   - data só passa se for data de verdade e de adulto;
//   - UF só passa se for uma das 27.
// O que não passa vira aviso, e o campo fica vazio para quem confere.
//
// E, DESDE 03/10/2026, O DADO TEM DE SER DO CEDENTE — e não só "estar nos
// autos". A leitura vinha trazendo o CPF de outro autor, do advogado, do réu:
// todos escritos nos autos, todos de dígito válido. Agora, sabendo o nome de
// quem cede (o título do card o diz):
//   - a resposta com o nome de OUTRA pessoa cai inteira;
//   - o CPF/CNPJ só passa escrito DEPOIS do nome, na qualificação dele, sem
//     outro documento no meio (ver `documentoDepoisDoNome`);
//   - o resto (nascimento, mãe, estado civil, endereços) só passa se o trecho
//     citado estiver nos autos e PERTO do nome.
// E o cedente pode ser PESSOA JURÍDICA: aí vêm razão social, CNPJ e os
// endereços da sede, e não vêm nascimento, mãe, estado civil nem cônjuge.
//
// SEM `npm:` E SEM `Deno.`: o vitest e o navegador alcançam este módulo direto.

import {
  documentoDepoisDoNome,
  documentosNoTexto,
  localizarTrecho,
  mencionaNome,
  nomesCompativeis,
  pertoDoNome,
  posicoesDoNome,
  preparar,
  tipoPessoaPeloNome,
  type DocumentoNoTexto,
  type Ocorrencia,
  type TextoPreparado,
} from './focoNoCedente.ts'

export { tipoPessoaPeloNome } from './focoNoCedente.ts'

export const UFS_DO_BRASIL = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const

export type EstadoCivil = 'solteiro' | 'casado' | 'divorciado' | 'viuvo' | 'separado' | 'uniao_estavel'
const ESTADOS_CIVIS = new Set<string>(['solteiro', 'casado', 'divorciado', 'viuvo', 'separado', 'uniao_estavel'])

/** Um campo lido, com o trecho dos autos de onde saiu. */
export interface Lido<T> {
  valor: T
  evidencia: string
}

export interface PessoaLida {
  nome: Lido<string> | null
  cpf: Lido<string> | null
  nascimento: Lido<string> | null
  nome_mae: Lido<string> | null
}

export interface ResidenciaLida {
  uf: string
  municipio: string
  /** A de hoje, pela peça mais recente. As outras são anteriores. */
  atual: boolean
  evidencia: string
}

/**
 * O cedente lido. Os campos de `PessoaLida` são os de sempre (a tela antiga lê
 * só eles); `tipo_pessoa` e `cnpj` são ACRÉSCIMOS de 03/10/2026, opcionais no
 * tipo porque um servidor anterior não os manda. Para PJ, `nome` é a razão
 * social, `cpf`/`nascimento`/`nome_mae` vêm nulos e o documento está em `cnpj`.
 */
export interface CedenteLido extends PessoaLida {
  tipo_pessoa?: 'PF' | 'PJ'
  cnpj?: Lido<string> | null
}

/** Quem a leitura procurou: o nome que o card dá ao cedente. Acréscimo. */
export interface AlvoDaLeitura {
  /** O nome procurado ('' quando o card não diz). */
  nome: string
  /** Quantas vezes ele aparece nos autos. */
  ocorrencias: number
  /** O recorte foi montado em volta dele. */
  focado: boolean
  /**
   * De onde veio o nome procurado (acréscimo de 03/10/2026): o beneficiário do
   * ofício requisitório, o cadastro da tela ou o título do card.
   */
  origem?: 'oficio' | 'cadastro' | 'titulo' | ''
}

export interface QualificacaoLida {
  cedente: CedenteLido
  estado_civil: Lido<EstadoCivil> | null
  conjuge: PessoaLida | null
  /** Para PJ, os endereços da SEDE (o atual e os anteriores). */
  residencias: ResidenciaLida[]
  avisos: string[]
  alvo?: AlvoDaLeitura
}

// ------------------------------------------------------------------ conferências

/** Dígito verificador do CPF. */
export function cpfComDvValido(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (n: number) => {
    let soma = 0
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

/**
 * Os CPFs ESCRITOS no texto — formatados (000.000.000-00) ou em onze dígitos
 * seguidos, sempre com fronteira dos dois lados.
 *
 * A FRONTEIRA É A TRAVA. Tirar todos os não-dígitos do texto e procurar ali
 * acharia qualquer CPF "dentro" de um protocolo seguido de uma data — o falso
 * positivo que `cpfNoTexto.ts` documenta. Aqui o número tem de estar escrito
 * como número.
 */
export function cpfsEscritosNoTexto(texto: string): Set<string> {
  const fora = new Set<string>()
  const re = /(?<![\d.\-/])(\d{3})\.?\s?(\d{3})\.?\s?(\d{3})\s?[-.–]?\s?(\d{2})(?![\d\-/]|\.\d)/g
  for (const m of texto.matchAll(re)) fora.add(m[1] + m[2] + m[3] + m[4])
  return fora
}

/** Dígito verificador do CNPJ. */
export function cnpjComDvValido(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (n: number) => {
    let peso = n - 7
    let soma = 0
    for (let i = 0; i < n; i++) {
      soma += Number(d[i]) * peso
      peso = peso === 2 ? 9 : peso - 1
    }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}

/** Os CNPJs ESCRITOS no texto, com a mesma trava de fronteira dos CPFs. */
export function cnpjsEscritosNoTexto(texto: string): Set<string> {
  return new Set(documentosNoTexto(texto).filter((d) => d.doc.length === 14).map((d) => d.doc))
}

/** Data ISO de verdade, de alguém entre 16 e 120 anos em `hoje`. */
export function nascimentoPlausivel(iso: string, hoje = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return false
  }
  const anos = (hoje.getTime() - d.getTime()) / (365.25 * 86_400_000)
  return anos >= 16 && anos <= 120
}

/** "12/04/1985" ou "1985-04-12" → "1985-04-12". Outro formato → ''. */
export function dataParaIso(s: string): string {
  const t = String(s ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''
}

const texto = (v: unknown, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

function lido<T>(valor: T | '' | null, evidencia: unknown): Lido<T> | null {
  return valor ? { valor: valor as T, evidencia: texto(evidencia) } : null
}

// ------------------------------------------------------------------ normalização

export interface OpcoesDaConferencia {
  /**
   * O nome do cedente segundo o card (título ou anotação). Com ele, cada dado
   * tem de ser DESTE nome; sem ele, ficam só as conferências de sempre (está
   * escrito nos autos, dígito válido, data plausível).
   */
  nomeDoCedente?: string
}

/** O que as conferências de proximidade precisam, montado uma vez. */
interface Conferencia {
  /** Há nome para conferir. Sem ele, só as conferências de sempre. */
  ativa: boolean
  nome: string
  prep: TextoPreparado | null
  /** Onde o nome do cedente aparece nos autos. */
  ancoras: Ocorrencia[]
  /** Os CPFs e CNPJs de dígito válido escritos nos autos, com a posição. */
  docs: DocumentoNoTexto[]
  avisos: string[]
}

const nomeCurto = (n: string) => texto(n, 60) || 'o cedente'

/**
 * O trecho citado está nos autos E perto do cedente (ou o menciona)?
 *
 * É a conferência dos campos que não são documento: nascimento, mãe, estado
 * civil, endereço. O trecho tem de EXISTIR no texto — trecho que não está lá
 * é paráfrase, e paráfrase não prova nada — e estar perto do nome procurado.
 */
function trechoDoCedente(
  conf: Conferencia,
  evidencia: string,
  campo: string,
  ancorasExtras: Ocorrencia[] = [],
  nomesExtras: string[] = [],
): boolean {
  if (!conf.ativa || !conf.prep) return true
  if (!evidencia) {
    conf.avisos.push(`${campo}: a IA não citou o trecho dos autos de onde tirou — descartado.`)
    return false
  }
  const posicoes = localizarTrecho(conf.prep, evidencia)
  if (posicoes.length === 0) {
    conf.avisos.push(`${campo}: o trecho que a IA citou não está nos autos — descartado. Confira à mão.`)
    return false
  }
  const nomes = [conf.nome, ...nomesExtras].filter(Boolean)
  if (nomes.some((n) => mencionaNome(evidencia, n))) return true
  if (pertoDoNome(conf.prep.texto, posicoes, [...conf.ancoras, ...ancorasExtras])) return true
  conf.avisos.push(
    `${campo}: o trecho citado está longe do nome de ${nomeCurto(conf.nome)} nos autos — pode ser de ` +
      'outra pessoa. Descartado.',
  )
  return false
}

/**
 * O documento (CPF ou CNPJ) que a IA indicou, conferido. Devolve só dígitos,
 * ou '' quando não passa — e aí o motivo vai para os avisos.
 */
function documento(
  tipo: 'CPF' | 'CNPJ',
  bruto: unknown,
  quem: string,
  conf: Conferencia,
  escritos: ReadonlySet<string>,
  ancoras: Ocorrencia[],
  /** Sem o nome desta pessoa nos autos, basta estar perto destas. */
  ancorasDeReserva: Ocorrencia[] = [],
): string {
  const d = String(bruto ?? '').replace(/\D/g, '')
  if (!d) return ''
  const dvOk = tipo === 'CPF' ? cpfComDvValido(d) : cnpjComDvValido(d)
  if (!dvOk) {
    conf.avisos.push(`O ${tipo} que a IA leu para ${quem} (${d}) tem dígito verificador inválido — descartado.`)
    return ''
  }
  if (!escritos.has(d)) {
    conf.avisos.push(`O ${tipo} que a IA indicou para ${quem} não está escrito nos autos — descartado. Confira à mão.`)
    return ''
  }
  if (conf.ativa && conf.prep) {
    const naQualificacao =
      ancoras.length > 0
        ? documentoDepoisDoNome(conf.prep.texto, d, ancoras, conf.docs)
        : pertoDoNome(
            conf.prep.texto,
            conf.docs.filter((x) => x.doc === d).map((x) => x.inicio),
            ancorasDeReserva,
          )
    if (!naQualificacao) {
      conf.avisos.push(
        `O ${tipo} que a IA indicou para ${quem} está nos autos, mas não na qualificação de ` +
          `${quem === 'o cedente' ? nomeCurto(conf.nome) : quem} — pode ser de outra pessoa (outro autor, ` +
          'advogado, réu). Descartado: confira à mão.',
      )
      return ''
    }
  }
  return d
}

function pessoaFisica(
  bruto: any,
  quem: string,
  conf: Conferencia,
  cpfsDosAutos: ReadonlySet<string>,
  hoje: Date,
  ancoras: Ocorrencia[],
  ancorasDeReserva: Ocorrencia[] = [],
  nomesExtras: string[] = [],
): PessoaLida {
  const nome = texto(bruto?.nome, 160)
  const cpfOk = documento('CPF', bruto?.cpf, quem, conf, cpfsDosAutos, ancoras, ancorasDeReserva)
  // O trecho do CÔNJUGE vale perto do nome dele também, e não só do cedente.
  const extras = quem === 'o cedente' ? [] : ancoras
  const evid = (k: string) => texto(bruto?.[k] ?? bruto?.evidencia)

  const nascBruto = dataParaIso(String(bruto?.nascimento ?? ''))
  let nasc = ''
  if (bruto?.nascimento) {
    if (!nascBruto || !nascimentoPlausivel(nascBruto, hoje)) {
      conf.avisos.push(`A data de nascimento lida para ${quem} ("${texto(bruto.nascimento, 20)}") não é plausível — descartada.`)
    } else if (trechoDoCedente(conf, evid('evidencia_nascimento'), `Nascimento de ${quem}`, extras, nomesExtras)) {
      nasc = nascBruto
    }
  }
  let mae = texto(bruto?.nome_mae, 160)
  if (mae && !trechoDoCedente(conf, evid('evidencia_nome_mae'), `Nome da mãe de ${quem}`, extras, nomesExtras)) mae = ''

  return {
    nome: lido(nome, bruto?.evidencia_nome ?? bruto?.evidencia),
    cpf: lido(cpfOk, bruto?.evidencia_cpf ?? bruto?.evidencia),
    nascimento: lido(nasc, bruto?.evidencia_nascimento ?? bruto?.evidencia),
    nome_mae: lido(mae, bruto?.evidencia_nome_mae ?? bruto?.evidencia),
  }
}

const vazio = (tipo: 'PF' | 'PJ'): CedenteLido => ({
  nome: null,
  cpf: null,
  nascimento: null,
  nome_mae: null,
  tipo_pessoa: tipo,
  cnpj: null,
})

/**
 * O JSON da IA, conferido campo a campo contra o texto dos autos.
 *
 * `textoDosAutos` é o MESMO texto que foi mandado à IA: é contra ele que o
 * documento é conferido, e é nele que o nome do cedente é procurado.
 */
export function normalizarQualificacao(
  bruto: any,
  textoDosAutos: string,
  hoje = new Date(),
  opcoes: OpcoesDaConferencia = {},
): QualificacaoLida {
  const avisos: string[] = []
  const cpfsDosAutos = cpfsEscritosNoTexto(textoDosAutos)
  const cnpjsDosAutos = cnpjsEscritosNoTexto(textoDosAutos)
  const bc = bruto?.cedente ?? {}

  const doModelo = texto(bruto?.aviso, 400)
  const fechar = (q: Omit<QualificacaoLida, 'avisos'>): QualificacaoLida => {
    if (doModelo) avisos.push(doModelo)
    return { ...q, avisos }
  }
  const nadaLido = (tipo: 'PF' | 'PJ') =>
    fechar({ cedente: vazio(tipo), estado_civil: null, conjuge: null, residencias: [] })

  const alvo = texto(opcoes.nomeDoCedente, 200)
  const nomeLido = texto(bc?.nome, 160)

  // ---- PF OU PJ. A forma societária no nome decide sozinha ("LTDA" não é
  // gente); sem ela, vale o que a IA viu nos autos; sem nada, pessoa física.
  const peloNome = tipoPessoaPeloNome(alvo || nomeLido)
  const daIA = String(bc?.tipo_pessoa ?? '').toUpperCase().trim()
  const soCnpj =
    Boolean(String(bc?.cnpj ?? '').replace(/\D/g, '')) && !String(bc?.cpf ?? '').replace(/\D/g, '')
  const tipo: 'PF' | 'PJ' =
    peloNome === 'PJ' ? 'PJ' : daIA === 'PJ' || daIA === 'PF' ? daIA : soCnpj ? 'PJ' : 'PF'
  if (peloNome === 'PJ' && daIA === 'PF') {
    avisos.push(
      `A IA tratou o cedente como pessoa física, mas o nome (${nomeCurto(alvo || nomeLido)}) é de empresa — ` +
        'lido como pessoa jurídica.',
    )
  }

  // ---- A IA DISSE QUE NÃO ACHOU: vazio, e nunca os dados de outra pessoa.
  if (bc?.encontrado === false) {
    avisos.push(
      `A IA não achou nos autos, com segurança, ${alvo ? `o cedente ${nomeCurto(alvo)}` : 'quem cede'} — ` +
        'nenhum dado foi preenchido. Confira o processo à mão.',
    )
    return nadaLido(tipo)
  }

  // ---- O NOME DEVOLVIDO TEM DE SER O DO CEDENTE. Dados coerentes de outra
  // pessoa são o erro mais caro desta leitura, e o mais fácil de não ver.
  if (alvo && nomeLido && !nomesCompativeis(alvo, nomeLido)) {
    avisos.push(
      `A IA devolveu a qualificação de ${nomeCurto(nomeLido)}, mas o cedente deste card é ` +
        `${nomeCurto(alvo)} — tudo descartado, para não preencher dados de outra pessoa.`,
    )
    return nadaLido(tipo)
  }

  // ---- ONDE O CEDENTE ESTÁ NOS AUTOS. Pelo nome do card; não aparecendo
  // (grafia diferente demais), pelo nome que a IA leu — que acabou de se
  // mostrar compatível com o do card.
  const nomeDeConferencia = alvo || nomeLido
  // SEM O NOME DO CARD, O COMPORTAMENTO DE SEMPRE: o nome que a IA leu não
  // serve de âncora sozinho — conferir a IA contra ela mesma não prova nada.
  const prep = alvo ? preparar(textoDosAutos) : null
  let ancoras = prep && alvo ? posicoesDoNome(textoDosAutos, alvo, prep.plano) : []
  let nomeAncora = alvo
  if (prep && ancoras.length === 0 && nomeLido) {
    ancoras = posicoesDoNome(textoDosAutos, nomeLido, prep.plano)
    nomeAncora = nomeLido
  }
  const conf: Conferencia = {
    ativa: Boolean(prep),
    nome: nomeAncora || nomeDeConferencia,
    prep,
    ancoras,
    docs: documentosNoTexto(textoDosAutos).filter((d) =>
      d.doc.length === 11 ? cpfComDvValido(d.doc) : cnpjComDvValido(d.doc),
    ),
    avisos,
  }
  if (conf.ativa && ancoras.length === 0) {
    const algo =
      nomeLido || bc?.cpf || bc?.cnpj || bc?.nascimento || (Array.isArray(bruto?.residencias) && bruto.residencias.length)
    if (algo) {
      avisos.push(
        `O nome do cedente (${nomeCurto(nomeDeConferencia)}) não aparece no trecho dos autos que a IA leu — ` +
          'nada foi preenchido, para não trazer dados de outra pessoa. Confira o processo à mão.',
      )
    }
    return nadaLido(tipo)
  }

  // ---- O CEDENTE.
  let cedente: CedenteLido
  if (tipo === 'PJ') {
    const cnpjOk = documento('CNPJ', bc?.cnpj, 'o cedente', conf, cnpjsDosAutos, ancoras)
    if (String(bc?.cpf ?? '').replace(/\D/g, '')) {
      avisos.push(
        'A IA trouxe um CPF para a empresa cedente (provavelmente do sócio ou do representante) — ignorado: ' +
          'o documento de pessoa jurídica é o CNPJ.',
      )
    }
    cedente = {
      ...vazio('PJ'),
      nome: lido(nomeLido, bc?.evidencia_nome ?? bc?.evidencia),
      cnpj: lido(cnpjOk, bc?.evidencia_cnpj ?? bc?.evidencia),
    }
  } else {
    cedente = {
      ...pessoaFisica(bc, 'o cedente', conf, cpfsDosAutos, hoje, ancoras),
      tipo_pessoa: 'PF',
      cnpj: null,
    }
  }

  // ---- ESTADO CIVIL E CÔNJUGE: só de pessoa física.
  let estado_civil: Lido<EstadoCivil> | null = null
  let conjuge: PessoaLida | null = null
  if (tipo === 'PF') {
    const ec = String(bruto?.estado_civil?.valor ?? bruto?.estado_civil ?? '').toLowerCase().trim()
    const evEc = texto(bruto?.estado_civil?.evidencia)
    estado_civil =
      ESTADOS_CIVIS.has(ec) && trechoDoCedente(conf, evEc, 'Estado civil')
        ? { valor: ec as EstadoCivil, evidencia: evEc }
        : null

    // O CÔNJUGE SÓ EXISTE SE O ESTADO CIVIL PEDIR. Um nome de cônjuge com o
    // cedente divorciado é o ex — e o bloco dele não entra no checklist.
    const pedeConjuge = estado_civil?.valor === 'casado' || estado_civil?.valor === 'uniao_estavel'
    const conjugeBruto = bruto?.conjuge && (bruto.conjuge.nome || bruto.conjuge.cpf) ? bruto.conjuge : null
    if (pedeConjuge && conjugeBruto) {
      const nomeConjuge = texto(conjugeBruto.nome, 160)
      const ancorasConjuge =
        conf.ativa && prep && nomeConjuge ? posicoesDoNome(textoDosAutos, nomeConjuge, prep.plano) : []
      conjuge = pessoaFisica(
        conjugeBruto,
        'o cônjuge',
        conf,
        cpfsDosAutos,
        hoje,
        ancorasConjuge,
        ancoras,
        nomeConjuge ? [nomeConjuge] : [],
      )
      if (conjuge.cpf && conjuge.cpf.valor === cedente.cpf?.valor) {
        avisos.push('A IA deu ao cônjuge o mesmo CPF do cedente — descartado.')
        conjuge.cpf = null
      }
    }
  }

  // AS RESIDÊNCIAS (para PJ, a sede): UF válida, sem repetição, trecho perto do
  // cedente, e UMA atual só (a primeira que a IA marcou; sem nenhuma marcada, a
  // primeira da lista).
  const residencias: ResidenciaLida[] = []
  const rotuloEndereco = tipo === 'PJ' ? 'Endereço da sede' : 'Residência'
  for (const r of Array.isArray(bruto?.residencias) ? bruto.residencias : []) {
    const uf = String(r?.uf ?? '').trim().toUpperCase()
    if (!(UFS_DO_BRASIL as readonly string[]).includes(uf)) continue
    const municipio = texto(r?.municipio, 80)
    const chave = `${uf}|${municipio.toLowerCase()}`
    if (residencias.some((x) => `${x.uf}|${x.municipio.toLowerCase()}` === chave)) continue
    const evidencia = texto(r?.evidencia)
    if (!trechoDoCedente(conf, evidencia, `${rotuloEndereco} ${municipio ? municipio + '/' : ''}${uf}`)) continue
    residencias.push({ uf, municipio, atual: Boolean(r?.atual), evidencia })
  }
  const atual = residencias.findIndex((r) => r.atual)
  residencias.forEach((r, i) => (r.atual = i === (atual >= 0 ? atual : 0)))

  return fechar({ cedente, estado_civil, conjuge, residencias })
}
