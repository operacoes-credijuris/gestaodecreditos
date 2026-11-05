/**
 * motorEstoque — estoques, coortes e histórico. Funções puras.
 *
 * Distingue SALDO (fotografia numa data), MOVIMENTO (entrada/saída no
 * período) e FLUXO ANUAL (RCL). Nunca soma fotografias sucessivas do
 * mesmo passivo como se fossem novos títulos (T10).
 */
import type { Centavos, LinhaHistorico, SerieInterpretavel } from '../dominio/tipos';
import type { RegrasJuridicas } from '../regras/regrasJuridicas';
import { arred } from '../dominio/dinheiro';

/* ------------------------------------------------------------------ */
/* Série de valores anuais: fotografia × lote (T10)                    */
/* ------------------------------------------------------------------ */

export type InterpretacaoSerie =
  | { status: 'pendente'; pergunta: string }
  | { status: 'fotografia'; estoqueMaisRecente: Centavos; anoMaisRecente: number; variacoes: { ano: number; variacao: Centavos }[]; somaIndevida: Centavos; texto: string }
  | { status: 'lote'; agregadoLotes: Centavos; texto: string };

export function interpretarSerie(serie: SerieInterpretavel): InterpretacaoSerie {
  const pontos = [...serie.pontos].sort((a, b) => a.ano - b.ano);
  if (serie.tipo === 'nao_informado' || pontos.length === 0) {
    return {
      status: 'pendente',
      pergunta: 'Esses valores são fotografias do estoque total em cada data ou lotes de novos precatórios de cada exercício? Sem essa resposta, a série não é usada.',
    };
  }
  if (serie.tipo === 'fotografia') {
    const variacoes = pontos.slice(1).map((p, i) => ({ ano: p.ano, variacao: p.valor - pontos[i].valor }));
    const ultimo = pontos[pontos.length - 1];
    const soma = pontos.reduce((s, p) => s + p.valor, 0);
    return {
      status: 'fotografia',
      estoqueMaisRecente: ultimo.valor,
      anoMaisRecente: ultimo.ano,
      variacoes,
      somaIndevida: soma,
      texto: 'Fotografias do mesmo passivo: o estoque é o valor mais recente; a diferença entre fotos é crescimento líquido (já com correção e pagamentos). Somar as fotos seria erro.',
    };
  }
  const agregado = pontos.reduce((s, p) => s + p.valor, 0);
  return {
    status: 'lote',
    agregadoLotes: agregado,
    texto: 'Lotes distintos: o agregado conhecido é a soma, antes de qualquer ajuste. Ainda não se sabe quanto está em mora, quanto precede o alvo nem se há preferências.',
  };
}

/* ------------------------------------------------------------------ */
/* Cronologia orçamentária (§ 5º) — T23                                */
/* ------------------------------------------------------------------ */

/**
 * Exercício em que o precatório deve ser pago: apresentado até a data de
 * corte (1º/fev) do ano y → exercício y+1; depois dela → y+2.
 * Usa a data de APRESENTAÇÃO do requisitório, nunca sentença ou trânsito.
 */
export function exercicioDePagamento(dataApresentacaoISO: string, regras: RegrasJuridicas): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataApresentacaoISO);
  if (!m) throw new Error('Data de apresentação inválida (use aaaa-mm-dd).');
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const { mes: mc, dia: dc } = regras.dataCorte;
  const ateCorte = mes < mc || (mes === mc && dia <= dc);
  return ateCorte ? ano + 1 : ano + 2;
}

/** Ano em que um título não pago entra no estoque em mora (1º/jan seguinte ao exercício de pagamento). */
export function anoEntradaEmMora(exercicioPagamento: number): number {
  return exercicioPagamento + 1;
}

/**
 * Distribui as inscrições apresentadas no ano t entre as coortes de
 * pagamento: fração até o corte → t+1; restante → t+2.
 */
export function distribuirInscricoes(valor: Centavos, ano: number, pctAteCorte: number): Record<number, Centavos> {
  const ateCorte = arred(valor * pctAteCorte);
  return { [ano + 1]: ateCorte, [ano + 2]: valor - ateCorte };
}

/* ------------------------------------------------------------------ */
/* Histórico: conciliação linha a linha                                 */
/* ------------------------------------------------------------------ */

export type StatusConciliacao = 'conciliado' | 'divergente' | 'incompleto';

export interface ConciliacaoLinha {
  id: string;
  exercicio: number;
  status: StatusConciliacao;
  calculado: Centavos | null;
  diferenca: Centavos | null;
  continuidade: 'ok' | 'quebra' | 'sem_anterior';
  mensagem: string;
}

/**
 * Visão "saldo pendente para credores":
 *   final = inicial + novas inscrições + atualização − pagamentos − baixas.
 * Depósitos não entram (depósito não é pagamento). Tolerância: R$ 1,00.
 */
export function conciliarHistorico(linhas: LinhaHistorico[], toleranciaCentavos = 100): ConciliacaoLinha[] {
  const ordenadas = [...linhas].sort((a, b) => a.exercicio - b.exercicio);
  return ordenadas.map((l, i) => {
    const anterior = i > 0 ? ordenadas[i - 1] : null;
    let continuidade: ConciliacaoLinha['continuidade'] = 'sem_anterior';
    if (anterior && anterior.exercicio === l.exercicio - 1 && anterior.estoqueFinal !== null && l.estoqueInicial !== null) {
      continuidade = Math.abs(anterior.estoqueFinal - l.estoqueInicial) <= toleranciaCentavos ? 'ok' : 'quebra';
    }
    const campos = [l.estoqueInicial, l.novasInscricoes, l.atualizacao, l.pagamentos, l.baixas, l.estoqueFinal];
    if (campos.some((c) => c === null)) {
      return { id: l.id, exercicio: l.exercicio, status: 'incompleto', calculado: null, diferenca: null, continuidade, mensagem: 'Faltam colunas para conciliar.' };
    }
    const calc = (l.estoqueInicial as number) + (l.novasInscricoes as number) + (l.atualizacao as number) - (l.pagamentos as number) - (l.baixas as number);
    const dif = (l.estoqueFinal as number) - calc;
    const ok = Math.abs(dif) <= toleranciaCentavos;
    return {
      id: l.id,
      exercicio: l.exercicio,
      status: ok ? 'conciliado' : 'divergente',
      calculado: calc,
      diferenca: dif,
      continuidade,
      mensagem: ok ? 'Saldo final confere com os movimentos.' : 'Saldo final não confere com os movimentos: há evento não lançado ou base diferente.',
    };
  });
}

export interface EstatisticasHistoricas {
  anos: number;
  mediaInscricoes: Centavos | null;
  cagrRCL: number | null;
  crescimentoRCLMin: number | null;
  crescimentoRCLMax: number | null;
  serieRCL: { ano: number; rcl: Centavos }[];
}

export function estatisticasHistoricas(linhas: LinhaHistorico[]): EstatisticasHistoricas {
  const ord = [...linhas].sort((a, b) => a.exercicio - b.exercicio);
  const insc = ord.map((l) => l.novasInscricoes).filter((v): v is number => v !== null);
  const rcls = ord.filter((l) => l.rcl !== null && (l.rcl as number) > 0).map((l) => ({ ano: l.exercicio, rcl: l.rcl as number }));
  let cagr: number | null = null;
  let min: number | null = null;
  let max: number | null = null;
  if (rcls.length >= 2) {
    const a = rcls[0];
    const b = rcls[rcls.length - 1];
    const n = b.ano - a.ano;
    if (n > 0) cagr = Math.pow(b.rcl / a.rcl, 1 / n) - 1;
    const vars: number[] = [];
    for (let i = 1; i < rcls.length; i++) {
      if (rcls[i].ano === rcls[i - 1].ano + 1) vars.push(rcls[i].rcl / rcls[i - 1].rcl - 1);
    }
    if (vars.length) { min = Math.min(...vars); max = Math.max(...vars); }
  }
  return {
    anos: ord.length,
    mediaInscricoes: insc.length ? arred(insc.reduce((s, v) => s + v, 0) / insc.length) : null,
    cagrRCL: cagr,
    crescimentoRCLMin: min,
    crescimentoRCLMax: max,
    serieRCL: rcls,
  };
}
