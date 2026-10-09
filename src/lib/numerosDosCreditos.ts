// Os quatro cartões de números no topo de Créditos (item "Novo" da amostra
// aprovada): quantos créditos, capital investido, expectativas vencidas e o que
// liquida em 90 dias.
//
// ELES SEGUEM A LISTA DA TELA, já com filtro de status e busca: o número é sempre
// "da seleção", e a mesma tabela logo abaixo é a prova dele. Nenhuma consulta nova
// — os valores já vêm em cada crédito.
import { formatBRL } from './format'
import type { Processo } from './types'

/** A partir daqui o valor em "mil" arredondaria para 1.000: passa a "mi". */
const MIL_VIRA_MILHAO = 999_500

export interface NumerosDaSelecao {
  quantidade: number
  /** Soma do capital investido; crédito sem o valor conta zero. */
  capital: number
  /** Ativos com a expectativa de liquidação já passada. */
  vencidas: number
  /** Expectativa de hoje até 89 dias à frente, nos créditos ainda a receber. */
  liquidamEm90: number
}

const DIA = 86400000

/**
 * @param hoje data local em ISO (hojeISO), a mesma régua do selo da expectativa.
 *
 * "EXPECTATIVA VENCIDA" SÓ EM ATIVO, como na amostra: Complementar e Encerrado já
 * receberam, e a expectativa antiga deles não pede acompanhamento.
 *
 * "LIQUIDAM EM 90 DIAS" CONTA DIAS CORRIDOS (a janela do cartão é 90 dias, como na
 * amostra), enquanto o selo da expectativa usa 3 meses de calendário — diferença
 * registrada no estudo, que não muda dado. Encerrado fica de fora: já liquidou, e
 * uma expectativa esquecida no cadastro dele não é dinheiro por vir.
 */
export function numerosDaSelecao(
  lista: readonly Pick<Processo, 'status' | 'capital_investido' | 'expectativa_liquidacao'>[],
  hoje: string,
): NumerosDaSelecao {
  const base = new Date(`${hoje}T00:00:00`).getTime()
  let capital = 0
  let vencidas = 0
  let liquidamEm90 = 0
  for (const p of lista) {
    capital += Number(p.capital_investido ?? 0) || 0
    const exp = (p.expectativa_liquidacao ?? '').slice(0, 10)
    if (!exp) continue
    if (p.status === 'ativo' && exp < hoje) vencidas++
    if (p.status === 'encerrado') continue
    const dias = Math.round((new Date(`${exp}T00:00:00`).getTime() - base) / DIA)
    if (dias >= 0 && dias < 90) liquidamEm90++
  }
  return { quantidade: lista.length, capital, vencidas, liquidamEm90 }
}

/** Antecedência que acende o âmbar da expectativa — régua num só lugar. */
export const MESES_ALERTA_EXPECTATIVA = 3

export type TomDaExpectativa = 'vencida' | 'alerta' | 'folga'

/**
 * O semáforo da expectativa de liquidação (o `corExpectativa` de Créditos, que
 * agora a tabela e a ficha mostram como selo): vencida, dentro da janela de
 * alerta (até `limiteAlerta`, inclusive) ou com folga. Comparação por texto ISO
 * contra hoje — a cor vira sozinha na virada do dia. Sem data, sem selo.
 */
export function tomDaExpectativa(
  data: string | null | undefined,
  hoje: string,
  limiteAlerta: string,
): TomDaExpectativa | null {
  const d = (data ?? '').slice(0, 10)
  if (!d) return null
  if (d < hoje) return 'vencida'
  if (d <= limiteAlerta) return 'alerta'
  return 'folga'
}

/** A dica do selo, para quem não distingue as cores. */
export const DICA_EXPECTATIVA: Record<TomDaExpectativa, string> = {
  vencida: 'Expectativa vencida',
  alerta: `Vence em até ${MESES_ALERTA_EXPECTATIVA} meses`,
  folga: `Vence em mais de ${MESES_ALERTA_EXPECTATIVA} meses`,
}

/**
 * "R$ 1,3 mi", "R$ 840 mil" — o valor do cartão, curto (o `brlK` da amostra).
 * Abaixo de mil, o valor inteiro, como a plataforma escreve dinheiro.
 */
export function brlCurto(v: number): string {
  const abs = Math.abs(v)
  const fmt = (n: number, casas: number) =>
    n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas })
  // A FAIXA SAI DO VALOR JÁ ARREDONDADO: R$ 999.700 em "mil" daria "1.000 mil".
  if (abs >= MIL_VIRA_MILHAO) return `R$ ${fmt(v / 1e6, 1)} mi`
  if (abs >= 1e3) return `R$ ${fmt(v / 1e3, 0)} mil`
  return formatBRL(v)
}
