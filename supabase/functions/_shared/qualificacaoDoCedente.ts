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
// SEM `npm:` E SEM `Deno.`: o vitest e o navegador alcançam este módulo direto.

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

export interface QualificacaoLida {
  cedente: PessoaLida
  estado_civil: Lido<EstadoCivil> | null
  conjuge: PessoaLida | null
  residencias: ResidenciaLida[]
  avisos: string[]
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

function pessoa(
  bruto: any,
  quem: string,
  cpfsDosAutos: ReadonlySet<string>,
  avisos: string[],
  hoje: Date,
): PessoaLida {
  const nome = texto(bruto?.nome, 160)
  const cpf = String(bruto?.cpf ?? '').replace(/\D/g, '')
  let cpfOk: string = ''
  if (cpf) {
    if (!cpfComDvValido(cpf)) {
      avisos.push(`O CPF que a IA leu para ${quem} (${cpf}) tem dígito verificador inválido — descartado.`)
    } else if (!cpfsDosAutos.has(cpf)) {
      avisos.push(`O CPF que a IA indicou para ${quem} não está escrito nos autos — descartado. Confira à mão.`)
    } else {
      cpfOk = cpf
    }
  }
  const nascBruto = dataParaIso(String(bruto?.nascimento ?? ''))
  let nasc = ''
  if (bruto?.nascimento) {
    if (nascBruto && nascimentoPlausivel(nascBruto, hoje)) nasc = nascBruto
    else avisos.push(`A data de nascimento lida para ${quem} ("${texto(bruto.nascimento, 20)}") não é plausível — descartada.`)
  }
  return {
    nome: lido(nome, bruto?.evidencia_nome ?? bruto?.evidencia),
    cpf: lido(cpfOk, bruto?.evidencia_cpf ?? bruto?.evidencia),
    nascimento: lido(nasc, bruto?.evidencia_nascimento ?? bruto?.evidencia),
    nome_mae: lido(texto(bruto?.nome_mae, 160), bruto?.evidencia_nome_mae ?? bruto?.evidencia),
  }
}

/**
 * O JSON da IA, conferido campo a campo contra o texto dos autos.
 *
 * `textoDosAutos` é o MESMO texto que foi mandado à IA: é contra ele que o CPF
 * é conferido.
 */
export function normalizarQualificacao(bruto: any, textoDosAutos: string, hoje = new Date()): QualificacaoLida {
  const avisos: string[] = []
  const cpfsDosAutos = cpfsEscritosNoTexto(textoDosAutos)

  const cedente = pessoa(bruto?.cedente, 'o cedente', cpfsDosAutos, avisos, hoje)

  const ec = String(bruto?.estado_civil?.valor ?? bruto?.estado_civil ?? '').toLowerCase().trim()
  const estado_civil =
    ESTADOS_CIVIS.has(ec) ? { valor: ec as EstadoCivil, evidencia: texto(bruto?.estado_civil?.evidencia) } : null

  // O CÔNJUGE SÓ EXISTE SE O ESTADO CIVIL PEDIR. Um nome de cônjuge com o
  // cedente divorciado é o ex — e o bloco dele não entra no checklist.
  const pedeConjuge = estado_civil?.valor === 'casado' || estado_civil?.valor === 'uniao_estavel'
  const conjugeBruto = bruto?.conjuge && (bruto.conjuge.nome || bruto.conjuge.cpf) ? bruto.conjuge : null
  const conjuge = pedeConjuge && conjugeBruto ? pessoa(conjugeBruto, 'o cônjuge', cpfsDosAutos, avisos, hoje) : null
  if (conjuge?.cpf && conjuge.cpf.valor === cedente.cpf?.valor) {
    avisos.push('A IA deu ao cônjuge o mesmo CPF do cedente — descartado.')
    conjuge.cpf = null
  }

  // AS RESIDÊNCIAS: UF válida, sem repetição, e UMA atual só (a primeira que a
  // IA marcou; sem nenhuma marcada, a primeira da lista).
  const residencias: ResidenciaLida[] = []
  for (const r of Array.isArray(bruto?.residencias) ? bruto.residencias : []) {
    const uf = String(r?.uf ?? '').trim().toUpperCase()
    if (!(UFS_DO_BRASIL as readonly string[]).includes(uf)) continue
    const municipio = texto(r?.municipio, 80)
    const chave = `${uf}|${municipio.toLowerCase()}`
    if (residencias.some((x) => `${x.uf}|${x.municipio.toLowerCase()}` === chave)) continue
    residencias.push({ uf, municipio, atual: Boolean(r?.atual), evidencia: texto(r?.evidencia) })
  }
  const atual = residencias.findIndex((r) => r.atual)
  residencias.forEach((r, i) => (r.atual = i === (atual >= 0 ? atual : 0)))

  const doModelo = texto(bruto?.aviso, 400)
  if (doModelo) avisos.push(doModelo)

  return { cedente, estado_civil, conjuge, residencias, avisos }
}
