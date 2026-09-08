// Índices oficiais do Banco Central, para a auditoria refazer conta de verdade.
//
// POR QUE EXISTE. O prompt da auditoria manda, quando o título pede um índice e
// a conta aplicou outro, refazer o valor por proporção. Só que o modelo NÃO TEM
// série histórica: uma variação acumulada de IPCA-E de sete anos "lembrada" sai
// errada e sai com cara de exata, que é o pior dos dois mundos. Aqui a conta é
// feita com o dado oficial, em código, e a memória sai conferível.
//
// A IA DECLARA, O CÓDIGO CALCULA. Não há ferramenta de consulta no laço da IA
// de propósito: a extração roda com tool_choice forçado numa ferramenta só, e
// abrir turnos para consulta custaria justamente o tempo de parede que a divisão
// da leitura acabou de recuperar.
//
// AS SÉRIES SÃO AS MENSAIS, E ISSO NÃO É DETALHE. TR e poupança têm série
// DIÁRIA por aniversário (226 e 195) — a que se acha primeiro procurando — e ela
// traz um ponto por dia útil, cada um cobrindo dia-a-dia-do-mês-seguinte. Duas
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

export function ehIndiceConhecido(v: unknown): v is NomeDeIndice {
  return typeof v === 'string' && v in SERIE_DO_INDICE
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
    // Number.isFinite e entra na composição como "não variou". Pior: o ponto
    // EXISTE, então a conferência de meses faltantes não acusa nada. Um mês de
    // inflação virando zero encolhe o acumulado sem deixar rastro. Por isso o
    // teste do texto vem antes da conversão: sem valor, o ponto não existe, e
    // aí o aviso de série incompleta faz o seu trabalho.
    const cru = String(r?.valor ?? '').trim()
    if (!mm || !yyyy || !cru) continue
    const pct = Number(cru.replace(',', '.'))
    if (!Number.isFinite(pct)) continue
    out.push({ ano: Number(yyyy), mes: Number(mm), pct })
  }
  // Do mais antigo para o mais novo: a composição é comutativa, mas o corte por
  // período e as mensagens de faixa incompleta dependem da ordem.
  return out.sort((a, b) => a.ano - b.ano || a.mes - b.mes)
}

/** Competência como número comparável: 2015-01 -> 24181. */
const chave = (ano: number, mes: number) => ano * 12 + mes

/** 'MM/AAAA' -> {ano, mes}, ou null. Aceita 'M/AAAA' e 'AAAA-MM'. */
export function competencia(txt: unknown): { ano: number; mes: number } | null {
  const s = String(txt ?? '').trim()
  let m = s.match(/^(\d{1,2})\/(\d{4})$/)
  if (m) {
    const mes = Number(m[1]), ano = Number(m[2])
    return mes >= 1 && mes <= 12 && ano >= 1980 && ano <= 2100 ? { ano, mes } : null
  }
  m = s.match(/^(\d{4})-(\d{1,2})$/)
  if (m) {
    const ano = Number(m[1]), mes = Number(m[2])
    return mes >= 1 && mes <= 12 && ano >= 1980 && ano <= 2100 ? { ano, mes } : null
  }
  return null
}

export interface FatorAcumulado {
  /** O fator, já somado 1: 1,5087 para 50,87% acumulados. */
  fator: number
  /** Quantos meses entraram na composição. */
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

/**
 * Compõe a variação acumulada do índice entre duas competências, inclusive.
 *
 * COMPÕE, NÃO SOMA. Somar variações mensais subestima o acumulado — juro sobre
 * juro não é soma —, e em sete anos a diferença passa de dez pontos percentuais.
 * A mesma razão pela qual a SELIC de doze meses em parametros-bcb é composta.
 */
export function fatorAcumulado(
  pontos: PontoMensal[],
  de: { ano: number; mes: number },
  ate: { ano: number; mes: number },
): FatorAcumulado {
  const kDe = chave(de.ano, de.mes)
  const kAte = chave(ate.ano, ate.mes)
  if (kAte < kDe) throw new Error('o termo final é anterior ao inicial')

  const dentro = pontos.filter((p) => {
    const k = chave(p.ano, p.mes)
    return k >= kDe && k <= kAte
  })
  if (!dentro.length) {
    throw new Error('a série não tem nenhum mês no período pedido')
  }

  const fator = dentro.reduce((f, p) => f * (1 + p.pct / 100), 1)
  const fmt = (p: PontoMensal) => `${String(p.mes).padStart(2, '0')}/${p.ano}`
  const primeiro = dentro[0]
  const ultimo = dentro[dentro.length - 1]
  const esperados = kAte - kDe + 1

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
    meses: dentro.length,
    de: fmt(primeiro),
    ate: fmt(ultimo),
    incompleto: faltas.length ? faltas.join('; ') : null,
  }
}

/**
 * Fatores muito fora do razoável não entram no preço.
 *
 * Este número multiplica o crédito, então um fator absurdo — série trocada,
 * valores em base diferente, resposta corrompida — não estraga um campo: estraga
 * o preço. Cinquenta vezes cobre trinta anos de inflação brasileira pós-Real com
 * folga; abaixo de 1 seria deflação acumulada, que não acontece em série de
 * correção monetária no período que nos interessa.
 */
export const FATOR_MIN = 0.5
export const FATOR_MAX = 50

export function fatorPlausivel(f: number): boolean {
  return Number.isFinite(f) && f >= FATOR_MIN && f <= FATOR_MAX
}

export interface Recalculo {
  /** O valor revisado. */
  valor: number
  /** A memória da conta, em uma frase — vai para a justificativa e para a nota da célula. */
  memoria: string
  /** O que ficou incerto, quando ficou. */
  aviso: string | null
}

/**
 * Refaz o valor trocando o índice que a conta aplicou pelo que o título manda.
 *
 * POR PROPORÇÃO, e não recompondo a conta do zero: a base histórica quase nunca
 * está nos autos em forma utilizável, mas o valor ATUALIZADO está, e ele é a base
 * histórica multiplicada pelo fator que a conta usou. Dividir por esse fator e
 * multiplicar pelo certo dá o valor que a conta teria produzido — usando os
 * números do próprio processo, que é o que torna a conta conferível.
 *
 * NÃO DECIDE SE O RESULTADO ENTRA NO PREÇO. Devolve o número e a memória; quem
 * chama compara com o bruto dos autos e aplica a regra da casa (auditoria nunca
 * aumenta crédito — ver aplicarAuditoria).
 */
export function recalcularPorIndice(o: {
  /** O valor atualizado que a conta produziu. */
  base: number
  indiceTitulo: NomeDeIndice
  indiceConta: NomeDeIndice
  fatorTitulo: FatorAcumulado
  fatorConta: FatorAcumulado
}): Recalculo {
  if (!(o.base > 0)) throw new Error('base do recálculo tem de ser positiva')
  if (!fatorPlausivel(o.fatorTitulo.fator) || !fatorPlausivel(o.fatorConta.fator)) {
    throw new Error('fator acumulado fora da faixa plausível — série ou período suspeitos')
  }

  const valor = (o.base * o.fatorTitulo.fator) / o.fatorConta.fator
  const pct = (f: FatorAcumulado) => `${((f.fator - 1) * 100).toFixed(2).replace('.', ',')}%`
  const brl = (n: number) =>
    n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })

  const memoria =
    `Recalculado com índice oficial (Banco Central, SGS): ` +
    `${o.indiceTitulo} acumulado de ${o.fatorTitulo.de} a ${o.fatorTitulo.ate} = ${pct(o.fatorTitulo)} ` +
    `(série ${SERIE_DO_INDICE[o.indiceTitulo]}, ${o.fatorTitulo.meses} meses compostos); ` +
    `${o.indiceConta} no mesmo período = ${pct(o.fatorConta)} ` +
    `(série ${SERIE_DO_INDICE[o.indiceConta]}, ${o.fatorConta.meses} meses). ` +
    `${brl(o.base)} × ${o.fatorTitulo.fator.toFixed(6)} ÷ ${o.fatorConta.fator.toFixed(6)} = ${brl(valor)}.`

  const avisos = [o.fatorTitulo.incompleto, o.fatorConta.incompleto].filter(Boolean)
  return {
    valor,
    memoria,
    aviso: avisos.length
      ? `A série do índice não cobre o período inteiro: ${avisos.join('; ')}. O valor recalculado vale para o trecho coberto.`
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
