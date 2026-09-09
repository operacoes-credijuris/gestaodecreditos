// Índices oficiais do Banco Central, para a auditoria refazer conta de verdade.
//
// POR QUE EXISTE. O prompt da auditoria manda, quando o título pede um índice e
// a conta aplicou outro — ou quando o termo inicial está errado —, refazer o
// valor. Só que o modelo NÃO TEM série histórica: uma variação acumulada de
// IPCA-E de sete anos "lembrada" sai errada e sai com cara de exata, que é o
// pior dos dois mundos. Aqui a conta é feita com o dado oficial, em código, e a
// memória sai conferível.
//
// A IA DECLARA, O CÓDIGO CALCULA. Não há ferramenta de consulta no laço da IA de
// propósito: a extração roda com tool_choice forçado numa ferramenta só, e abrir
// turnos para consulta custaria justamente o tempo de parede que a divisão da
// leitura acabou de recuperar.
//
// CORREÇÃO E JUROS NÃO SE CALCULAM IGUAL, e esta é a razão de o módulo falar em
// REGIME. Correção monetária CAPITALIZA: o fator é o produto de (1 + i) mês a
// mês. Juros de mora contra a Fazenda, no regime dos Temas 810/STF e 905/STJ,
// são SIMPLES: somam-se as taxas do período e o resultado incide uma vez sobre o
// valor corrigido. Tratar juros como composto superestima — em sete anos de
// poupança a diferença passa de cinco pontos percentuais —, e superestimar
// juros infla o crédito, que é a direção que prejudica quem compra.
//
// AS SÉRIES SÃO AS MENSAIS, E ISSO NÃO É DETALHE. TR e poupança têm série DIÁRIA
// por aniversário (226 e 195) — a que se acha primeiro procurando — e ela traz
// um ponto por dia útil, cada um cobrindo dia-a-dia-do-mês-seguinte. Duas
// consequências, ambas medidas: sete anos dão 2.604 pontos e a requisição leva
// de 17 a 21 SEGUNDOS (contra 300 ms das mensais); e compor os 2.604 como se
// fossem taxas mensais dá um número absurdo. As mensais (7811 e 196) devolvem o
// MESMO valor, um ponto por mês, em 300 ms.
//
// Módulo PURO: sem npm:, sem fetch. Quem busca é a Edge Function; aqui só entram
// o JSON já parseado e a aritmética — é o que permite testar a composição, o
// corte por período e a recusa de série diária sem tocar na rede.

/** Os índices que a auditoria pode citar, e a série do SGS de cada um. */
export const SERIE_DO_INDICE = {
  // O "IPCA-E" dos Temas 810/STF e 905/STJ é o IPCA-15.
  'IPCA-E': 7478,
  IPCA: 433,
  INPC: 188,
  'IGP-M': 189,
  // Selic ACUMULADA NO MÊS (% a.m.), que é o que se compõe. A série de meta
  // (432) é taxa anual e não serve para compor período.
  SELIC: 4390,
  // MENSAIS, e não as diárias 226/195. Ver a nota no topo.
  TR: 7811,
  POUPANCA: 196,
} as const

export type NomeDeIndice = keyof typeof SERIE_DO_INDICE

/**
 * Taxa FIXA, que não vem de série nenhuma.
 *
 * Não é conveniência: juros de mora de 0,5% ou 1% ao mês, fixados no título ou
 * no art. 406 do Código Civil, são o caso mais comum de todos em condenação
 * antiga. Sem isto, a auditoria acharia o erro de termo e não teria como refazer
 * a conta — que é precisamente o que este módulo existe para resolver.
 */
export const INDICE_FIXO = 'FIXO' as const
export type IndiceDeclarado = NomeDeIndice | typeof INDICE_FIXO

export function ehIndiceDeSerie(v: unknown): v is NomeDeIndice {
  return typeof v === 'string' && v in SERIE_DO_INDICE
}
export function ehIndiceDeclarado(v: unknown): v is IndiceDeclarado {
  return v === INDICE_FIXO || ehIndiceDeSerie(v)
}

/** Como a taxa se acumula no período. */
export type Regime = 'composto' | 'simples'

export function ehRegime(v: unknown): v is Regime {
  return v === 'composto' || v === 'simples'
}

/**
 * O regime que a natureza pede, quando a IA não disser.
 *
 * Correção capitaliza; juros de mora contra a Fazenda, não. Errar o padrão erra
 * para o lado que infla o crédito, então o default segue a prática judicial e
 * não a conveniência.
 */
export function regimePadrao(natureza: 'correcao' | 'juros'): Regime {
  return natureza === 'juros' ? 'simples' : 'composto'
}

/** Um ponto mensal da série: competência e variação percentual do mês. */
export interface PontoMensal {
  ano: number
  mes: number
  /** Variação do mês, em porcento (0,42 = 0,42%). */
  pct: number
}

/**
 * O JSON do SGS virando pontos mensais.
 *
 * RECUSA SÉRIE DIÁRIA em vez de compor errado. O SGS marca os pontos de série
 * diária com `dataFim` (o aniversário no mês seguinte); tratá-los como mensais
 * multiplicaria vinte taxas por mês. Como o erro seria de ordem de grandeza e
 * silencioso — um número grande é tão plausível quanto um pequeno numa conta que
 * ninguém refaz —, aqui ele vira exceção.
 */
export function pontosMensais(json: unknown): PontoMensal[] {
  if (!Array.isArray(json)) throw new Error('resposta do BCB não é uma lista')
  const out: PontoMensal[] = []
  for (const r of json as Array<{ data?: string; dataFim?: string; valor?: string }>) {
    if (r?.dataFim) {
      throw new Error(
        'a série devolvida é DIÁRIA (os pontos têm dataFim) e não pode ser composta como mensal — ' +
        'use a série mensal do índice (TR: 7811, poupança: 196)',
      )
    }
    const [, mm, yyyy] = String(r?.data ?? '').split('/')
    // VAZIO NÃO É ZERO, e a diferença é silenciosa. O BCB devolve valor "" em
    // mês que ainda não publicou, e `Number('')` é 0 — que passa por
    // Number.isFinite e entra na conta como "não variou". Pior: o ponto EXISTE,
    // então a conferência de meses faltantes não acusa nada. Um mês de inflação
    // virando zero encolhe o acumulado sem deixar rastro. Por isso o texto é
    // testado antes da conversão: sem valor, o ponto não existe, e aí o aviso de
    // série incompleta faz o seu trabalho.
    const cru = String(r?.valor ?? '').trim()
    if (!mm || !yyyy || !cru) continue
    const pct = Number(cru.replace(',', '.'))
    if (!Number.isFinite(pct)) continue
    out.push({ ano: Number(yyyy), mes: Number(mm), pct })
  }
  // Do mais antigo para o mais novo: a acumulação é comutativa, mas o corte por
  // período e as mensagens de faixa incompleta dependem da ordem.
  return out.sort((a, b) => a.ano - b.ano || a.mes - b.mes)
}

/** Competência como número comparável: 2015-01 -> 24181. */
const chave = (ano: number, mes: number) => ano * 12 + mes

/**
 * 'MM/AAAA' -> {ano, mes}, ou null. Aceita 'M/AAAA', 'AAAA-MM', 'AAAA-MM-DD' e
 * 'DD/MM/AAAA'.
 *
 * AS DUAS ÚLTIMAS PORQUE O RESTO DO ESQUEMA USA DATA COMPLETA. O modelo devolve
 * "12/05/2019" no termo inicial de um consectário com a mesma naturalidade com
 * que devolve "05/2019", e o item era descartado — em silêncio, porque só a
 * base maior que o bruto gerava aviso. O dia não interessa: a série do SGS é
 * MENSAL, e a competência é o mês.
 */
export function competencia(txt: unknown): { ano: number; mes: number } | null {
  const s = String(txt ?? '').trim()
  let m = s.match(/^(\d{1,2})\/(\d{4})$/)
  if (m) {
    const mes = Number(m[1]), ano = Number(m[2])
    return mes >= 1 && mes <= 12 && ano >= 1980 && ano <= 2100 ? { ano, mes } : null
  }
  m = s.match(/^\d{1,2}\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const mes = Number(m[1]), ano = Number(m[2])
    return mes >= 1 && mes <= 12 && ano >= 1980 && ano <= 2100 ? { ano, mes } : null
  }
  m = s.match(/^(\d{4})-(\d{1,2})-\d{1,2}$/)
  if (m) {
    const ano = Number(m[1]), mes = Number(m[2])
    return mes >= 1 && mes <= 12 && ano >= 1980 && ano <= 2100 ? { ano, mes } : null
  }
  m = s.match(/^(\d{4})-(\d{1,2})$/)
  if (m) {
    const ano = Number(m[1]), mes = Number(m[2])
    return mes >= 1 && mes <= 12 && ano >= 1980 && ano <= 2100 ? { ano, mes } : null
  }
  return null
}

export interface Acumulado {
  /** O fator, já somado 1: 1,5087 para 50,87% acumulados. */
  fator: number
  regime: Regime
  /** Quantos meses entraram na conta. */
  meses: number
  /** A primeira e a última competência efetivamente usadas. */
  de: string
  ate: string
  /**
   * A série não cobre todo o período pedido.
   *
   * Vai como aviso e não como erro: meio período com origem clara é melhor que
   * nenhum número, e quem lê precisa saber que faltou pedaço para decidir se
   * usa. O caso real é o índice que só começa depois do termo inicial do título.
   */
  incompleto: string | null
}

/** Quantos meses há de `de` a `ate`, inclusive. */
export function mesesEntre(de: { ano: number; mes: number }, ate: { ano: number; mes: number }): number {
  return chave(ate.ano, ate.mes) - chave(de.ano, de.mes) + 1
}

/**
 * Acumula a taxa do índice entre duas competências, inclusive.
 *
 * COMPOSTO COMPÕE, SIMPLES SOMA. Compor variações mensais é o certo para
 * correção monetária — juro sobre juro não é soma, e em sete anos a diferença
 * passa de dez pontos percentuais. Somar é o certo para juros de mora contra a
 * Fazenda, que não capitalizam. Usar um no lugar do outro erra sempre para o
 * lado de inflar o crédito.
 */
export function acumular(
  pontos: PontoMensal[],
  de: { ano: number; mes: number },
  ate: { ano: number; mes: number },
  regime: Regime,
): Acumulado {
  const kDe = chave(de.ano, de.mes)
  const kAte = chave(ate.ano, ate.mes)
  if (kAte < kDe) throw new Error('o termo final é anterior ao inicial')

  const dentro = pontos.filter((p) => {
    const k = chave(p.ano, p.mes)
    return k >= kDe && k <= kAte
  })
  if (!dentro.length) throw new Error('a série não tem nenhum mês no período pedido')

  const fator = regime === 'composto'
    ? dentro.reduce((f, p) => f * (1 + p.pct / 100), 1)
    : 1 + dentro.reduce((soma, p) => soma + p.pct, 0) / 100

  const fmt = (p: PontoMensal) => `${String(p.mes).padStart(2, '0')}/${p.ano}`
  const primeiro = dentro[0]
  const ultimo = dentro[dentro.length - 1]
  const esperados = mesesEntre(de, ate)

  const faltas: string[] = []
  if (chave(primeiro.ano, primeiro.mes) > kDe) {
    faltas.push(`a série começa em ${fmt(primeiro)}, depois do termo inicial pedido`)
  }
  if (chave(ultimo.ano, ultimo.mes) < kAte) {
    faltas.push(`a série termina em ${fmt(ultimo)}, antes do termo final pedido`)
  }
  if (dentro.length < esperados && !faltas.length) {
    faltas.push(`faltam ${esperados - dentro.length} mês(es) dentro do período`)
  }

  return {
    fator,
    regime,
    meses: dentro.length,
    de: fmt(primeiro),
    ate: fmt(ultimo),
    incompleto: faltas.length ? faltas.join('; ') : null,
  }
}

/**
 * O acumulado de uma taxa FIXA, sem ir ao Banco Central.
 *
 * O caso típico: 1% ao mês do art. 406 do Código Civil, ou o 0,5% que o próprio
 * título fixou. Composto ou simples pela mesma regra do resto.
 */
export function acumularFixo(
  taxaMensalPct: number,
  de: { ano: number; mes: number },
  ate: { ano: number; mes: number },
  regime: Regime,
): Acumulado {
  const meses = mesesEntre(de, ate)
  if (meses < 1) throw new Error('o termo final é anterior ao inicial')
  if (!Number.isFinite(taxaMensalPct) || taxaMensalPct < 0 || taxaMensalPct > 20) {
    throw new Error('taxa mensal fixa fora do razoável (0 a 20% ao mês)')
  }
  const fator = regime === 'composto'
    ? Math.pow(1 + taxaMensalPct / 100, meses)
    : 1 + (taxaMensalPct / 100) * meses
  const fmt = (c: { ano: number; mes: number }) => `${String(c.mes).padStart(2, '0')}/${c.ano}`
  return { fator, regime, meses, de: fmt(de), ate: fmt(ate), incompleto: null }
}

/**
 * Fatores muito fora do razoável não entram no preço.
 *
 * Este número multiplica o crédito, então um fator absurdo — série trocada,
 * valores em base diferente, resposta corrompida — não estraga um campo: estraga
 * o preço. Cinquenta vezes cobre trinta anos de inflação brasileira pós-Real com
 * folga; abaixo de 0,5 seria deflação acumulada de metade, que não acontece em
 * série de correção nem em juros.
 */
export const FATOR_MIN = 0.5
export const FATOR_MAX = 50

export function fatorPlausivel(f: number): boolean {
  return Number.isFinite(f) && f >= FATOR_MIN && f <= FATOR_MAX
}

/** O que a auditoria pediu para refazer, já com os acumulados nas mãos. */
export interface PedidoDeRecalculo {
  natureza: 'correcao' | 'juros'
  /** O valor sobre o qual a taxa incide. */
  base: number
  titulo: { indice: IndiceDeclarado; acumulado: Acumulado }
  conta: { indice: IndiceDeclarado; acumulado: Acumulado }
}

export interface ItemRecalculado {
  natureza: 'correcao' | 'juros'
  /** O que a taxa do título produz sobre a base. */
  valorTitulo: number
  /** O que a taxa da conta produziu. */
  valorConta: number
  /**
   * A diferença, com sinal: NEGATIVA quando a conta inflou o crédito.
   *
   * O sinal é o que decide se o achado mexe no preço. Negativo significa que
   * corrigir DERRUBA o valor, e é o que se desconta; positivo significa que a
   * conta subestimou, e ganho eventual do cessionário não se compra.
   */
  delta: number
  memoria: string
  aviso: string | null
}

const pctTexto = (a: Acumulado) => `${((a.fator - 1) * 100).toFixed(2).replace('.', ',')}%`
const brlTexto = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const nomeDaSerie = (i: IndiceDeclarado) =>
  i === INDICE_FIXO ? 'taxa fixa' : `série ${SERIE_DO_INDICE[i]}`
const nomeDoRegime = (r: Regime) => (r === 'composto' ? 'capitalizada' : 'simples, sem capitalização')

/**
 * Refaz um item trocando o que a conta aplicou pelo que o título manda.
 *
 * OS DOIS LADOS TÊM PERÍODO PRÓPRIO, e é isso que faz o erro de TERMO se
 * consertar pelo mesmo caminho do erro de índice: mesmo índice nos dois lados,
 * períodos diferentes, e o delta é exatamente o efeito do termo errado. Foi o
 * caso que motivou este módulo — juros de dano emergente contados do evento
 * danoso quando o título os fixou da citação.
 *
 * NÃO DECIDE SE O RESULTADO ENTRA NO PREÇO. Devolve o delta e a memória; quem
 * chama soma os deltas ao bruto e a regra da casa decide (auditoria nunca
 * aumenta crédito — ver aplicarAuditoria).
 */
export function recalcularItem(p: PedidoDeRecalculo): ItemRecalculado {
  if (!(p.base > 0)) throw new Error('base do recálculo tem de ser positiva')
  if (!fatorPlausivel(p.titulo.acumulado.fator) || !fatorPlausivel(p.conta.acumulado.fator)) {
    throw new Error('fator acumulado fora da faixa plausível — série ou período suspeitos')
  }

  const valorTitulo = p.base * p.titulo.acumulado.fator
  const valorConta = p.base * p.conta.acumulado.fator
  const delta = valorTitulo - valorConta

  const lado = (rot: string, l: { indice: IndiceDeclarado; acumulado: Acumulado }) =>
    `${rot}: ${l.indice} de ${l.acumulado.de} a ${l.acumulado.ate} = ${pctTexto(l.acumulado)} ` +
    `(${nomeDaSerie(l.indice)}, ${l.acumulado.meses} meses, ${nomeDoRegime(l.acumulado.regime)})`

  const memoria =
    `${p.natureza === 'juros' ? 'JUROS' : 'CORREÇÃO'} recalculada com índice oficial (Banco Central, SGS). ` +
    `${lado('O título manda', p.titulo)}; ${lado('a conta aplicou', p.conta)}. ` +
    `Sobre ${brlTexto(p.base)}: ${brlTexto(valorTitulo)} contra ${brlTexto(valorConta)} — ` +
    `diferença de ${brlTexto(delta)} (${delta < 0 ? 'a conta inflou o crédito' : 'a conta subestimou'}).`

  const avisos = [p.titulo.acumulado.incompleto, p.conta.acumulado.incompleto].filter(Boolean)
  return {
    natureza: p.natureza,
    valorTitulo,
    valorConta,
    delta,
    memoria,
    aviso: avisos.length
      ? `A série não cobre o período inteiro: ${avisos.join('; ')}. O recálculo vale para o trecho coberto.`
      : null,
  }
}

/**
 * A janela de datas no formato que o SGS aceita.
 *
 * Do dia 1 da competência inicial ao ÚLTIMO dia da final — dia 0 do mês seguinte
 * é o último do mês, e não há mês com número fixo de dias que sirva para todos.
 */
export function janelaSgs(
  de: { ano: number; mes: number },
  ate: { ano: number; mes: number },
): { dataInicial: string; dataFinal: string } {
  const dd = (n: number) => String(n).padStart(2, '0')
  const ultimoDia = new Date(Date.UTC(ate.ano, ate.mes, 0)).getUTCDate()
  return {
    dataInicial: `01/${dd(de.mes)}/${de.ano}`,
    dataFinal: `${dd(ultimoDia)}/${dd(ate.mes)}/${ate.ano}`,
  }
}

/** A URL da série no SGS, para a faixa pedida. */
export function urlSgs(serie: number, janela: { dataInicial: string; dataFinal: string }): string {
  return (
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados` +
    `?formato=json&dataInicial=${janela.dataInicial}&dataFinal=${janela.dataFinal}`
  )
}

/** Chave de deduplicação: a mesma série no mesmo período se busca uma vez. */
export function chaveDaBusca(serie: number, janela: { dataInicial: string; dataFinal: string }): string {
  return `${serie}|${janela.dataInicial}|${janela.dataFinal}`
}
