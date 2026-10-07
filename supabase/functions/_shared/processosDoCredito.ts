// OS PROCESSOS DE UM CRÉDITO — quais autos pedir ao Escavador.
//
// UM CRÉDITO JUDICIAL COSTUMA SER TRÊS PROCESSOS, e o título do card traz um só:
//
//   conhecimento   a ação em que o direito foi reconhecido (a sentença)
//   cumprimento    o cumprimento de sentença ou a execução contra a Fazenda —
//                  às vezes nos mesmos autos do conhecimento, às vezes com
//                  número próprio
//   requisitório   os autos administrativos do precatório (ou da RPV), no
//                  tribunal que paga
//
// Antes de a rotina pagar um pedido, um agente de IA lê o título, as anotações e
// os PDFs anexados ao card e diz quais são os processos DESTE crédito. Este
// arquivo é o que se pode testar sem conta nenhuma: as instruções, a conferência
// do que a IA devolve, e a impressão do card que decide quando ler de novo.
//
// A IA SUGERE; O CÓDIGO CONFERE. Cada número pedido custa R$ 1,34, e número
// inventado é pedido pago para o processo de outra pessoa. Por isso:
//   - todo CNJ tem de ter o dígito verificador certo (módulo 97, Res. CNJ 65/2008)
//     — número plausível e inventado reprova aqui 99 vezes em 100;
//   - o que a IA diz ter lido no título ou nas anotações tem de estar LÁ;
//   - o CNJ do título do card entra sempre: é o cadastro do card.
//
// SEM `Deno.` E SEM `npm:`.

import { cnjsNoTexto, digitosDoCnj, mascaraCnj } from './nucleo/cnj.ts'
import { ehParteJuntada } from './autosJuntos.ts'

export type Papel = 'conhecimento' | 'cumprimento' | 'requisitorio'
const PAPEIS = new Set<string>(['conhecimento', 'cumprimento', 'requisitorio'])

export interface ProcessoDoCredito {
  /** Pontuado: 1006377-08.2020.4.01.3814. */
  cnj: string
  papeis: Papel[]
  /** 'titulo' | 'anotacao' | 'anexo' — de onde o número saiu. */
  fonte: string
  evidencia: string
}

/** Dígito verificador do CNJ: NNNNNNN AAAA J TR OOOO DD, módulo 97, resto 1. */
export function cnjComDvValido(v: unknown): boolean {
  const d = digitosDoCnj(v)
  if (d.length !== 20) return false
  const s = d.slice(0, 7) + d.slice(9) + d.slice(7, 9)
  let resto = 0
  for (const c of s) resto = (resto * 10 + Number(c)) % 97
  return resto === 1
}

/** Teto de processos por card: os três papéis, e folga para um número a mais. */
export const MAX_PROCESSOS = 4

export const SISTEMA_PROCESSOS = `Você identifica os PROCESSOS JUDICIAIS de um crédito que a Credijuris está comprando (precatório ou RPV), para baixar os autos de cada um.

UM CRÉDITO COSTUMA TER ATÉ TRÊS PROCESSOS:
- "conhecimento": a ação em que o direito foi reconhecido — procedimento comum, ação ordinária, JEF, mandado de segurança — onde saiu a sentença;
- "cumprimento": o cumprimento de sentença ou a execução contra a Fazenda Pública. Muitas vezes corre NOS MESMOS AUTOS do conhecimento (mesmo número); às vezes tem número próprio (incidente, execução autônoma, processo de cumprimento distribuído por dependência);
- "requisitorio": os autos administrativos do precatório ou da RPV, no tribunal que paga (Presidência do TJ, TRF, TRT). Costuma aparecer no ofício requisitório, na expedição do precatório ou na autuação na Presidência.

ONDE PROCURAR: no título do card, nas anotações do comercial e nos documentos anexados (ofício requisitório, petições, decisões, cálculos, extratos do tribunal).

REGRAS DURAS:
- SÓ NÚMEROS ESCRITOS nas fontes, no formato CNJ de 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO). NUNCA invente, complete ou corrija dígito. Número que você não viu escrito não entra.
- SÓ OS PROCESSOS DESTE CRÉDITO. Fora: processos citados como jurisprudência, processos de outros credores, ações conexas que não geram este crédito, execuções contra o credor, recursos que não mudam o número (agravo, apelação no mesmo número entram uma vez só pelo número do processo).
- Se o mesmo número é o conhecimento e o cumprimento, devolva UMA linha com os dois papéis.
- No máximo ${MAX_PROCESSOS} processos. Na dúvida sobre um número, deixe-o de fora e explique no "aviso".
- "fonte": "titulo", "anotacao" ou "anexo". "evidencia": o trecho literal de onde saiu o número, até 200 caracteres (com o nome do anexo, se for de anexo).

Responda APENAS com JSON válido, sem markdown:
{"processos":[{"cnj":"","papeis":["conhecimento"],"fonte":"anexo","evidencia":""}],"aviso":""}`

const texto = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * O que a IA devolveu, conferido.
 *
 * `titulo` e `anotacoes` são os textos que a IA recebeu: número que ela diz ter
 * tirado deles precisa estar neles. Número de anexo não se confere assim (o PDF
 * foi lido por ela, não por nós) — e é aí que o dígito verificador pesa.
 */
export function normalizarProcessos(
  bruto: unknown,
  fontes: { titulo: string; anotacoes: string; cnjDoTitulo?: string | null },
): { processos: ProcessoDoCredito[]; avisos: string[] } {
  const avisos: string[] = []
  const lista = Array.isArray((bruto as { processos?: unknown })?.processos)
    ? ((bruto as { processos: unknown[] }).processos)
    : []
  const noTitulo = cnjsNoTexto(fontes.titulo)
  const nasAnotacoes = cnjsNoTexto(fontes.anotacoes)
  const porCnj = new Map<string, ProcessoDoCredito>()

  for (const b of lista) {
    const i = (b ?? {}) as Record<string, unknown>
    const d = digitosDoCnj(i.cnj)
    if (d.length !== 20) continue
    if (!cnjComDvValido(d)) {
      avisos.push(`A IA leu ${mascaraCnj(d)}, mas o dígito verificador não confere — descartado.`)
      continue
    }
    const fonte = ['titulo', 'anotacao', 'anexo'].includes(String(i.fonte)) ? String(i.fonte) : 'anexo'
    if (fonte === 'titulo' && !noTitulo.has(d) && !nasAnotacoes.has(d)) {
      avisos.push(`A IA disse ter lido ${mascaraCnj(d)} no título, e ele não está lá — descartado.`)
      continue
    }
    if (fonte === 'anotacao' && !nasAnotacoes.has(d) && !noTitulo.has(d)) {
      avisos.push(`A IA disse ter lido ${mascaraCnj(d)} nas anotações, e ele não está lá — descartado.`)
      continue
    }
    const papeis = (Array.isArray(i.papeis) ? i.papeis : [i.papel])
      .map((p) => String(p ?? '').toLowerCase().trim())
      .filter((p): p is Papel => PAPEIS.has(p))
    const atual = porCnj.get(d)
    if (atual) {
      atual.papeis = [...new Set([...atual.papeis, ...papeis])]
      continue
    }
    porCnj.set(d, {
      cnj: mascaraCnj(d),
      papeis: papeis.length ? papeis : ['conhecimento'],
      fonte,
      evidencia: texto(i.evidencia, 200),
    })
  }

  // O NÚMERO DO TÍTULO ENTRA SEMPRE. É o cadastro do card, e o comercial o pôs
  // ali por ser o processo do crédito — se a IA o deixou de fora, quem erra é
  // ela. Entra sem papel afirmado ("Processo"), e o papel que a IA der a ele,
  // se der, vence.
  const dTitulo = digitosDoCnj(fontes.cnjDoTitulo)
  if (dTitulo.length === 20 && cnjComDvValido(dTitulo) && !porCnj.has(dTitulo)) {
    porCnj.set(dTitulo, { cnj: mascaraCnj(dTitulo), papeis: [], fonte: 'titulo', evidencia: texto(fontes.titulo, 200) })
  }

  let processos = [...porCnj.values()]
  if (processos.length > MAX_PROCESSOS) {
    avisos.push(`A IA indicou ${processos.length} processos; ficaram os ${MAX_PROCESSOS} primeiros.`)
    processos = processos.slice(0, MAX_PROCESSOS)
  }
  const doModelo = texto((bruto as { aviso?: unknown })?.aviso, 400)
  if (doModelo) avisos.push(doModelo)
  return { processos, avisos }
}

/** Os processos de antes com os de agora: número já conhecido ganha só os papéis novos. */
export function mesclarProcessos(antes: ProcessoDoCredito[], agora: ProcessoDoCredito[]): ProcessoDoCredito[] {
  const m = new Map(antes.map((p) => [digitosDoCnj(p.cnj), { ...p, papeis: [...p.papeis] }]))
  for (const p of agora) {
    const d = digitosDoCnj(p.cnj)
    const velho = m.get(d)
    if (velho) velho.papeis = [...new Set([...velho.papeis, ...p.papeis])]
    else m.set(d, p)
  }
  return [...m.values()].slice(0, MAX_PROCESSOS)
}

/** Falta algum dos três papéis? É o que justifica ler o card de novo quando ele muda. */
export function faltaPapel(processos: ProcessoDoCredito[]): boolean {
  const tem = new Set(processos.flatMap((p) => p.papeis))
  return !(tem.has('conhecimento') && tem.has('cumprimento') && tem.has('requisitorio'))
}

/**
 * O rótulo que abre o nome dos anexos daquele processo no card:
 * "Conhecimento 001 - …", "Precatório 001 - …".
 */
export function rotuloDoProcesso(papeis: Papel[], rpv: boolean): string {
  const tem = new Set(papeis)
  if (tem.has('requisitorio')) return rpv ? 'RPV' : 'Precatório'
  if (tem.has('conhecimento') && tem.has('cumprimento')) return 'Conhecimento e cumprimento'
  if (tem.has('cumprimento')) return 'Cumprimento'
  if (tem.has('conhecimento')) return 'Conhecimento'
  return 'Processo'
}

/** A nota do card quando a leitura define (ou amplia) os processos do crédito. */
export function notaDosProcessos(processos: ProcessoDoCredito[], rpv: boolean, novos: number): string {
  const linhas = processos.map((p) => `• ${rotuloDoProcesso(p.papeis, rpv)}: ${p.cnj}`)
  return [
    novos === processos.length
      ? '🔎 Processos deste crédito, identificados para baixar os autos:'
      : `🔎 ${novos} processo(s) novo(s) identificado(s) neste crédito. Todos, até agora:`,
    ...linhas,
    'Os autos de cada um são pedidos ao Escavador e sobem a este card juntados num PDF por processo ' +
      '(em partes, se for muito grande), no chat e na área Arquivos. ' +
      'Se algum número estiver errado, corrija o título ou as anotações do card.',
  ].join('\n')
}

/**
 * Anexo que a própria rotina subiu — não se lê para achar processo.
 *
 * OS DOIS FORMATOS: o documento solto de antes de 07/10/2026 ("Conhecimento
 * 001 - …") e a parte juntada ("Conhecimento - autos (parte 1 de 3) - CNJ.pdf").
 * Faltar o segundo aqui seria caro: a nota de anexo de cada parte entra no
 * chat do card, mudaria a impressão dele, e cada parte que sobe pediria uma
 * nova leitura paga pela IA. O CLIPE na frente é o do espelho ("📎 nome"),
 * que é como a nota de anexo chega em `notas`.
 */
export function ehAnexoDosAutos(nome: string): boolean {
  const n = nome.trim().replace(/^📎\s*/u, '')
  return /^(Autos|Processo|Conhecimento|Cumprimento|Precatório|RPV)( e cumprimento)? \d{3,}\b/i.test(n) || ehParteJuntada(n)
}

/**
 * A impressão do card: o que a IA leu, resumido num número. Mudou a impressão,
 * mudou o que há para ler — é o que autoriza uma nova leitura.
 *
 * SÓ O QUE É DE GENTE: título, anotações do comercial e os anexos. As notas
 * automáticas — inclusive as desta rotina — ficam fora, senão cada nota que ela
 * escreve mudaria o card e pediria uma nova leitura paga.
 *
 * O ANEXO ENTRA MESMO SENDO "AUTOMÁTICO": o kommo-sync marca como automática
 * toda nota que não é `common`, e a nota de anexo é uma delas. Deixá-la de fora
 * seria justamente não perceber o PDF novo do comercial. Fica fora só o anexo que
 * a própria rotina subiu.
 */
export function impressaoDoCard(
  titulo: string,
  notas: { texto?: string; automatica?: boolean; arquivo_uuid?: string | null }[],
): string {
  const partes = [
    titulo ?? '',
    ...notas
      .filter((n) => !n.automatica || (n.arquivo_uuid && !ehAnexoDosAutos(String(n.texto ?? ''))))
      .map((n) => `${n.texto ?? ''}|${n.arquivo_uuid ?? ''}`),
  ]
  let h = 0x811c9dc5
  for (const c of partes.join('\n')) {
    h ^= c.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
