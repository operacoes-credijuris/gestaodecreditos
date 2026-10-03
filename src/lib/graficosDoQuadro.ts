// As contas dos três gráficos novos do Quadro econômico (itens "Novo" da
// amostra: evolução, histograma e ranking). NENHUM DADO NOVO: tudo sai das
// operações que o núcleo já monta (`montarPainel`), com as datas e os valores
// já cadastrados. Ficam aqui, puras e testadas (graficosDoQuadro.test.ts), e
// não dentro das telas, para a conta não depender de quem desenha.

import type { OperacaoAnalitica } from '../../supabase/functions/_shared/nucleo/tipos.ts'

const soma = (vs: Array<number | null | undefined>) =>
  vs.reduce<number>((t, v) => t + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0)

/** Último dia do mês `ym` ("2026-10" → "2026-10-31"). */
function fimDoMes(ano: number, mes: number): string {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return `${ano}-${String(mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`
}

export interface PontoDaEvolucao {
  /** "2026-10" */
  mes: string
  /** Capital ACUMULADO das operações cedidas até o fim do mês. */
  capital: number
  /** Recebido ACUMULADO das operações liquidadas até o fim do mês. */
  recebido: number
}

/**
 * "Capital investido e já recebido": os dois ACUMULADOS no fim de cada um dos
 * últimos `meses` meses, o mês de `hoje` incluído.
 *
 * O capital entra pela DATA DE CESSÃO (aquisição) e o recebido pela DATA DE
 * LIQUIDAÇÃO — cada dinheiro no dia em que de fato saiu ou voltou. Operação sem
 * a data, ou sem o valor, fica fora da linha correspondente: pô-la num mês
 * qualquer seria inventar quando o dinheiro andou. É acumulado, e não por mês,
 * porque a pergunta do gráfico é "quanto já foi e quanto já voltou".
 */
export function evolucaoDaCarteira(
  operacoes: readonly Pick<OperacaoAnalitica, 'dataAquisicao' | 'capitalInvestido' | 'dataLiquidacao' | 'jaRecebido'>[],
  hoje: string,
  meses = 12,
): PontoDaEvolucao[] {
  const [anoHoje, mesHoje] = hoje.slice(0, 7).split('-').map(Number)
  return Array.from({ length: meses }, (_, i) => {
    // Do mais antigo (i = 0) ao mês de hoje (i = meses − 1).
    const seq = anoHoje * 12 + (mesHoje - 1) - (meses - 1 - i)
    const ano = Math.floor(seq / 12)
    const mes = (seq % 12) + 1
    const fim = fimDoMes(ano, mes)
    const data = (d: string | null) => (d ?? '').slice(0, 10)
    return {
      mes: `${ano}-${String(mes).padStart(2, '0')}`,
      capital: soma(
        operacoes
          .filter((o) => data(o.dataAquisicao) && data(o.dataAquisicao) <= fim)
          .map((o) => o.capitalInvestido),
      ),
      recebido: soma(
        operacoes
          .filter((o) => data(o.dataLiquidacao) && data(o.dataLiquidacao) <= fim)
          .map((o) => o.jaRecebido),
      ),
    }
  })
}

export interface FaixaDoHistograma {
  rotulo: string
  operacoes: number
}

/**
 * As faixas de rentabilidade total do histograma da Performance. Os limites
 * são os da amostra: abaixo de zero, de 20 em 20 pontos até 100% (o 100%
 * fechado fica na última faixa de dentro) e acima de 100%.
 */
const FAIXAS: Array<[string, (r: number) => boolean]> = [
  ['< 0%', (r) => r < 0],
  ['0–20%', (r) => r >= 0 && r < 0.2],
  ['20–40%', (r) => r >= 0.2 && r < 0.4],
  ['40–60%', (r) => r >= 0.4 && r < 0.6],
  ['60–80%', (r) => r >= 0.6 && r < 0.8],
  ['80–100%', (r) => r >= 0.8 && r <= 1],
  ['> 100%', (r) => r > 1],
]

/**
 * Quantas operações caem em cada faixa de rentabilidade total (`retorno`, em
 * FRAÇÃO). As mesmas operações da tabela de encerradas logo abaixo, então a
 * soma das barras é o número de linhas dela com retorno calculado; operação
 * sem retorno não vai a faixa nenhuma (zero afirmaria um resultado).
 */
export function distribuicaoDoRetorno(
  operacoes: readonly Pick<OperacaoAnalitica, 'retorno'>[],
): FaixaDoHistograma[] {
  const validos = operacoes
    .map((o) => o.retorno)
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r))
  return FAIXAS.map(([rotulo, cabe]) => ({ rotulo, operacoes: validos.filter(cabe).length }))
}

/**
 * Valor curto para o eixo e para a ponta das barras dos gráficos: "R$ 16,5 mi",
 * "R$ 820 mil". O exato continua nas tabelas e na dica — dinheiro abreviado só
 * dentro de gráfico, como já era nas Previsões.
 */
export function brlAbreviado(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (abs >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`
}
