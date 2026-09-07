// A anotação que a análise escreve de volta no card do Kommo.
//
// É O ÚNICO PEDAÇO DA ANÁLISE QUE O COMERCIAL LÊ. Ele não abre a planilha nem a
// janela de análise: vê o card, e o que estiver escrito ali é o resultado. Por
// isso o texto tem forma fixa e curta, e por isso ele mora aqui, num módulo puro
// que o vitest alcança — o formato é regra de negócio, não detalhe de tela.
//
// Três blocos, separados por linha em branco (o Kommo não formata nada, então a
// linha em branco é o que dá estrutura):
//
//   1. o veredito e o link do Drive
//   2. a FICHA DO CRÉDITO, nos mesmos rótulos que o comercial usa no cadastro
//   3. os ALERTAS, e só eles
//
// A ficha repetir os rótulos do cadastro é de propósito: a anotação vira a
// conferência do card. Se ele escreveu "PARCELA CEDIDA: principal" e a ficha
// volta "Crédito principal + Honorários", o cadastro estava errado — e isso se
// lê sem abrir nada.
import { formatBRL, formatPercent } from './format'

/** Os campos do cadastro do comercial, preenchidos com o que a análise leu dos autos. */
export interface FichaDoCredito {
  tipo?: string
  processo?: string
  tribunal?: string
  entidade_devedora?: string
  parcela_cedida?: string
  /** O valor do crédito NEGOCIADO — a soma dos líquidos das verbas do negócio, não o preço. */
  valor_cedido?: number
  /** Porcentagem dos honorários contratuais, em pontos (30 = 30%). */
  honorarios_pct?: number | null
}

export interface EntradaAnotacao {
  reprovado?: boolean
  motivo?: string
  motivos?: string[]
  /** Pasta ou arquivo no Drive. Vazio quando o upload não deu link. */
  link?: string
  ficha?: FichaDoCredito
  avisos?: unknown
}

/**
 * Quantos alertas cabem na anotação.
 *
 * A anotação é lida no feed do Kommo, entre mensagens — não é relatório. Mais de
 * quatro linhas de alerta ninguém lê, e o que fica de fora está na janela e na
 * planilha, com o fundamento inteiro.
 */
export const MAX_ALERTAS = 4

/**
 * As observações que valem a anotação: só os ALERTAS.
 *
 * O marcador ⚠️ é o que a função de análise usa para separar alerta de nota, e a
 * diferença é de destinatário. Alerta é o que muda a decisão de fechar: teto da
 * RPV excedido, cartório fora do preço, RPV já em fase de pagamento, preço no
 * cenário conservador. Nota é procedência de valor e detalhe de cálculo, que
 * interessa a quem confere a planilha.
 *
 * Antes ia o `aviso` — os dois tipos colados num parágrafo só, com a
 * fundamentação por extenso. No card virava uma parede de texto que ninguém
 * rolava até o fim, e o alerta que importava ficava enterrado nela.
 */
export function alertasDaAnotacao(avisos: unknown): string[] {
  return (Array.isArray(avisos) ? avisos : [])
    .map((a) => String(a).trim())
    .filter((a) => a.startsWith('⚠️'))
    .slice(0, MAX_ALERTAS)
}

/**
 * A ficha, uma linha por campo.
 *
 * LINHA SEM VALOR É OMITIDA, e não vai como "—": rótulo vazio ocupa a linha
 * inteira e não informa nada. O que a análise não achou nos autos fica de fora,
 * e a ausência é o próprio recado.
 */
export function linhasDaFicha(ficha: FichaDoCredito | undefined): string[] {
  const f = ficha ?? {}
  const pct = f.honorarios_pct
  const pares: Array<[string, string]> = [
    ['TIPO', f.tipo ?? ''],
    ['PROCESSO', f.processo ?? ''],
    ['TRIBUNAL', f.tribunal ?? ''],
    ['ENTIDADE DEVEDORA', f.entidade_devedora ?? ''],
    ['PARCELA CEDIDA', f.parcela_cedida ?? ''],
    ['VALOR CEDIDO', f.valor_cedido ? formatBRL(f.valor_cedido) : ''],
    ['HONORÁRIOS C.', pct == null ? '' : formatPercent(pct)],
  ]
  return pares.filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v}`)
}

/** O texto inteiro da anotação, pronto para o card. */
export function anotacaoDaAnalise(e: EntradaAnotacao): string {
  if (e.reprovado) {
    const motivo =
      e.motivo || (e.motivos ?? []).join(' ') || 'Crédito reprovado na análise.'
    return `❌ RECUSADO na análise automática.\nMotivo: ${motivo}`
  }
  const blocos = [
    e.link
      ? `✅ APROVADO na análise automática.\nPlanilha e análise no Drive: ${e.link}`
      : '✅ APROVADO na análise automática. (Confira a pasta do Drive.)',
    linhasDaFicha(e.ficha).join('\n'),
    alertasDaAnotacao(e.avisos).join('\n'),
  ]
  return blocos.filter((b) => b.trim()).join('\n\n')
}
