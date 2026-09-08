// As anotações que a análise escreve de volta no card do Kommo.
//
// É O ÚNICO PEDAÇO DA ANÁLISE QUE O COMERCIAL LÊ. Ele não abre a planilha nem a
// janela de análise: vê o card, e o que estiver escrito ali é o resultado. Por
// isso o texto tem forma fixa e curta, e por isso ele mora aqui, num módulo puro
// que o vitest alcança — o formato é regra de negócio, não detalhe de tela.
//
// DUAS ANOTAÇÕES SEPARADAS, e não uma com duas partes:
//
//   1. a FICHA DO CRÉDITO — o que foi negociado, nos rótulos do cadastro
//   2. o VEREDITO — aprovado, o link do Drive e os alertas
//
// Separadas porque duram coisas diferentes. A ficha é o retrato do crédito e
// serve de referência para o resto da conversa no card; o veredito é um evento,
// e cada nova análise gera outro. Numa anotação só, reanalisar o mesmo crédito
// repetia a ficha inteira a cada vez.
//
// A ficha repetir os rótulos do cadastro é de propósito: ela vira a conferência
// do card. Se o comercial escreveu "PARCELA CEDIDA: principal" e a ficha volta
// "Crédito principal + Honorários", o cadastro estava errado — e isso se lê sem
// abrir nada.
//
// A ASSINATURA VAI SÓ NO VEREDITO. Quem analisou é atributo do ato, não do
// crédito: a ficha do mesmo processo é a mesma independentemente de quem rodou.
import { formatBRL, formatPercent } from './format'

/** Os campos do cadastro do comercial, preenchidos com o que a análise leu dos autos. */
export interface FichaDoCredito {
  tipo?: string
  processo?: string
  tribunal?: string
  /** O titular do crédito, lido dos autos. */
  cedente?: string
  entidade_devedora?: string
  parcela_cedida?: string
  /** UF de tramitação, que junto do tribunal diz onde o crédito vive. */
  uf?: string
  /** Fase processual de hoje, em poucas palavras. */
  fase?: string
  /** Os honorários contratuais foram destacados do principal? Null = não apurado. */
  honorarios_destacados?: boolean | null
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
  /** Quem rodou a análise. Assina o veredito; a ficha não leva assinatura. */
  analista?: string
  /**
   * A primeira linha da segunda anotação. Padrão: aprovado na análise
   * automática.
   *
   * Existe porque NÃO TODO FLUXO APROVA. A análise jurídica do precatório
   * preenche um questionário e para ali: o bloco "Critérios de Aceitação e
   * Recusa" do modelo é régua que uma PESSOA aplica, e aprovar ou reprovar é
   * clique de gente — decisão do dono, e o oposto do RPV, que tem portão
   * automático. Escrever "APROVADO" ali afirmaria uma decisão que ninguém
   * tomou, e o comercial age sobre o que está escrito no card.
   */
  veredito?: string
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
    ['CEDENTE', f.cedente ?? ''],
    ['ENTIDADE DEVEDORA', f.entidade_devedora ?? ''],
    ['PARCELA CEDIDA', f.parcela_cedida ?? ''],
    ['VALOR CEDIDO', f.valor_cedido ? formatBRL(f.valor_cedido) : ''],
    ['HONORÁRIOS C.', pct == null ? '' : formatPercent(pct)],
  ]
  return pares.filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v}`)
}

/** O que o resumo da oportunidade precisa além da ficha do crédito. */
export interface EntradaOportunidade {
  ficha?: FichaDoCredito
  /** Pasta ou arquivo no Drive. Vazio antes de a análise ser salva. */
  link?: string
  /** Meses até o pagamento, do prazo aferido pela análise. */
  prazoMeses?: number | null
  /** Mês/ano projetado do pagamento. */
  dataPagamento?: string | null
}

/**
 * O RESUMO DA OPORTUNIDADE — a passagem de Pendentes para Validação.
 *
 * Quem lê é quem decide, e decide sem abrir a planilha: precisa do link da
 * pasta e, numa tela, do que está comprando. A forma é fixa de propósito, para
 * a coluna do CRM ficar comparável de cima a baixo.
 *
 * MONTADO EM CÓDIGO, e não redigido pela IA. São valores que a análise já
 * apurou; mandar o modelo transcrevê-los é convidar paráfrase em cima de
 * número — e é o número que decide a compra.
 *
 * LINHA SEM VALOR SAI FORA, como na ficha. A DA CESSÃO É A EXCEÇÃO: a extensão
 * da cessão (integral ou parcial, e em que porcentagem) não é campo da análise
 * — ela não olha para isso em lugar nenhum. Omitir a linha daria a entender que
 * foi verificada e não havia nada; "a confirmar" diz a verdade, e o campo em
 * que este texto nasce é editável justamente para quem sabe a resposta.
 */
export function resumoDaOportunidade(e: EntradaOportunidade): string {
  const f = e.ficha ?? {}
  const tribunalUf = [f.tribunal?.trim(), f.uf?.trim()].filter(Boolean).join('/')
  const cabeca = ['Oportunidade Credijuris', [f.tipo?.trim(), tribunalUf].filter(Boolean).join(' · ')]
    .filter((p) => p.trim())
    .join(' — ')

  const meses = e.prazoMeses
  const recebimento = [
    meses != null && meses > 0 ? `${meses} ${meses === 1 ? 'mês' : 'meses'}` : '',
    e.dataPagamento?.trim() ? `previsão ${e.dataPagamento.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const pares: Array<[string, string]> = [
    [
      'Cedente',
      [f.cedente?.trim(), f.processo?.trim() ? `Proc. nº ${f.processo.trim()}` : '']
        .filter(Boolean)
        .join(' · '),
    ],
    ['Ente devedor', f.entidade_devedora?.trim() ?? ''],
    // A CESSÃO PENDE DO OBJETO: "a confirmar" é constante, então esta linha
    // nunca seria filtrada por falta de valor. Sem objeto lido, ela sobraria
    // sozinha afirmando algo sobre um crédito que a análise não leu.
    [
      'Cessão',
      f.parcela_cedida?.trim() ? `a confirmar · Objeto: ${f.parcela_cedida.trim()}` : '',
    ],
    [
      'Honorários destacados',
      f.honorarios_destacados == null ? '' : f.honorarios_destacados ? 'sim' : 'não',
    ],
    ['Valor líquido validado', f.valor_cedido ? formatBRL(f.valor_cedido) : ''],
    ['Fase processual', f.fase?.trim() ?? ''],
    ['Recebimento', recebimento],
  ]

  const corpo = pares.filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v}`)
  const link = e.link?.trim() ? `Planilha e análise no Drive: ${e.link.trim()}` : ''
  return [link, [cabeca, ...corpo].join('\n')].filter(Boolean).join('\n\n')
}

/** Prefixo de autoria, quando se sabe quem rodou. */
const assinado = (analista: string | undefined, texto: string) =>
  analista?.trim() ? `(${analista.trim()}) ${texto}` : texto

/**
 * As anotações a escrever no card, NA ORDEM em que devem ser postadas.
 *
 * Uma lista, e não um par, porque o número de anotações depende do caso:
 * crédito recusado gera SÓ o motivo — não há ficha de um crédito que não foi
 * precificado, e "VALOR CEDIDO" de uma recusa não quer dizer nada. Quem chama
 * percorre a lista e posta uma por uma, sem saber quantas são.
 */
export function anotacoesDaAnalise(e: EntradaAnotacao): string[] {
  if (e.reprovado) {
    const motivo =
      e.motivo || (e.motivos ?? []).join(' ') || 'Crédito reprovado na análise.'
    return [assinado(e.analista, `❌ RECUSADO na análise automática.\nMotivo: ${motivo}`)]
  }

  const ficha = linhasDaFicha(e.ficha).join('\n')
  const cabeca = e.veredito?.trim() || '✅ APROVADO na análise automática.'
  const veredito = [
    e.link ? `${cabeca}\nPlanilha e análise no Drive: ${e.link}` : `${cabeca} (Confira a pasta do Drive.)`,
    alertasDaAnotacao(e.avisos).join('\n'),
  ]
    .filter((b) => b.trim())
    .join('\n\n')

  // Ficha primeiro: no feed do Kommo ela fica acima do veredito, que é a ordem
  // de leitura — o que é o crédito, e depois o que se decidiu sobre ele.
  return [ficha, assinado(e.analista, veredito)].filter((t) => t.trim())
}
