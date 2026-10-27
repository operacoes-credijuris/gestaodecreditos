/**
 * motorProjecao — modelo anual agregado (Modo A da especificação, seção 6.2).
 *
 * Estado em 1º/jan de cada exercício t (centavos inteiros):
 *   M      estoque em mora (vencido)                         — Livro A
 *   C[e]   coortes a vencer, por exercício de pagamento e ≥ t — Livro A
 *   Bc, Ba saldos das contas especiais (cronológica, acordos) — Livro B
 *
 * Sequência do ano t:
 *   1. RCL(t−1) → faixa do § 23 com a MORA de 1º/jan (nunca o estoque total).
 *   2. Limite = RCL(t−1) × (alíquota-base + adicional decenal).
 *   3. Aporte ordinário = base × execução, limitado ao teto (se aplicado);
 *      + extraordinários (§ 28); tudo limitado ao exigível do ano
 *      (mora + coorte do exercício) — sem obrigação fictícia (T07).
 *   4. Aportes saem do Livro A pela ordem cronológica (mora primeiro) e
 *      deixam de ser atualizados a partir da data do aporte (T18).
 *   5. Contas pagam aos credores (taxa de distribuição). Pagamento reduz só
 *      o Livro B (T12). Acordos pagos extinguem também a renúncia (deságio).
 *   6. Novas inscrições do ano entram nas coortes t+1 (até 1º/fev) e t+2.
 *   7. Coorte do exercício não paga vira mora em 1º/jan de t+1 (T23).
 *   8. Conservação conferida: passivo final = inicial + novos + atualização
 *      − pagamentos − renúncias − outras extinções (diferença deve ser zero).
 */
import type { Cenario, Centavos, IdCenario, Origem, Projeto } from '../dominio/tipos';
import type { RegrasJuridicas } from '../regras/regrasJuridicas';
import { arred } from '../dominio/dinheiro';
import { calcularEnquadramento, type ResultadoEnquadramento } from './motorPercentualRCL';
import { aporteMaximoParaQuitar, atualizacaoComAporte } from './motorAtualizacao';
import { distribuirInscricoes } from './motorEstoque';

export interface ValorComOrigem {
  valor: Centavos | null;
  origem: Origem;
}

export interface LinhaProjecao {
  ano: number;
  rclAnterior: ValorComOrigem;
  rclDoAno: Centavos;
  moraEm1Jan: ValorComOrigem;
  aVencerNoAno: Centavos;
  aVencerFuturo: Centavos;
  saldoContas1Jan: Centavos;
  passivoInicial: Centavos;
  enquadramento: ResultadoEnquadramento;
  limite: Centavos | null;
  baseDeposito: Centavos;
  execucao: number;
  depositoOrdinarioPlanejado: Centavos;
  depositoOrdinario: Centavos;
  limitadoPeloTeto: boolean;
  extraordinario: Centavos;
  exigivelAtualizado: Centavos;
  limitadoAoExigivel: boolean;
  depositoTotal: Centavos;
  depositoCronologica: Centavos;
  depositoAcordos: Centavos;
  aporteMora: Centavos;
  aporteAVencer: Centavos;
  atualizacaoMora: Centavos;
  atualizacaoAVencer: Centavos;
  atualizacaoFuturos: Centavos;
  remuneracaoContas: Centavos;
  atualizacaoTotal: Centavos;
  novosCreditos: Centavos;
  pagamentoCronologica: Centavos;
  pagamentoAcordos: Centavos;
  pagamentosCredores: Centavos;
  renunciaAcordos: Centavos;
  outrasExtincoes: Centavos;
  reducoes: Centavos;
  variacaoAntesAtualizacao: Centavos;
  estoqueForaContasFinal: Centavos;
  saldoContasFinal: Centavos;
  passivoFinal: Centavos;
  variacaoLiquida: Centavos;
  moraProximo1Jan: Centavos | null;
  coberturaEntradas: number | null;
  conservacao: { ok: boolean; diferenca: Centavos };
  avisos: string[];
}

export type Trajetoria = 'encolhendo' | 'estavel' | 'crescendo' | 'nao_mensuravel';

export interface ResultadoProjecao {
  status: 'ok' | 'parametrica' | 'bloqueada';
  motivoBloqueio?: string;
  cenario: IdCenario;
  versaoRegras: string;
  aplicarTeto: boolean;
  anoInicial: number;
  anoFinal: number;
  linhas: LinhaProjecao[];
  semMoraInicial: boolean;
  anoZeragemMora: number | null;
  moraReapareceEm: number | null;
  convergiu: boolean;
  mensagemConvergencia: string;
  trajetoria: Trajetoria;
  variacaoHorizonte: Centavos | null;
  variacaoRelativa: number | null;
  conservacaoOk: boolean;
  avisos: string[];
}

function bloqueada(projeto: Projeto, cen: Cenario, regras: RegrasJuridicas, motivo: string): ResultadoProjecao {
  return {
    status: 'bloqueada',
    motivoBloqueio: motivo,
    cenario: cen.id,
    versaoRegras: regras.versao,
    aplicarTeto: projeto.juridico.aplicarTeto,
    anoInicial: projeto.anoBase,
    anoFinal: projeto.anoBase + projeto.config.horizonteAnos - 1,
    linhas: [],
    semMoraInicial: false,
    anoZeragemMora: null,
    moraReapareceEm: null,
    convergiu: false,
    mensagemConvergencia: 'Projeção bloqueada: ' + motivo,
    trajetoria: 'nao_mensuravel',
    variacaoHorizonte: null,
    variacaoRelativa: null,
    conservacaoOk: false,
    avisos: [],
  };
}

function choqueAtivo(cen: Cenario, tipo: Cenario['choques'][number]['tipo'], ano: number) {
  return cen.choques.find((c) => c.tipo === tipo && ano >= c.anoInicio && ano < c.anoInicio + Math.max(1, c.duracaoAnos));
}

export interface OpcoesProjecao {
  /** Soma um aporte extraordinário anual (§ 28) — usado pela busca de "aporte necessário". */
  extraordinarioAdicional?: Centavos;
}

export function projetar(projeto: Projeto, cen: Cenario, regras: RegrasJuridicas, opcoes: OpcoesProjecao = {}): ResultadoProjecao {
  const t0 = projeto.anoBase;
  const H = Math.max(1, Math.min(60, Math.round(projeto.config.horizonteAnos)));
  const d = projeto.dados;
  const jur = projeto.juridico;
  const avisos: string[] = [];

  // ---- Validações que bloqueiam (T08, T09) ----
  const rcl0 = d.rclAnterior.valor;
  if (rcl0 === null) return bloqueada(projeto, cen, regras, `RCL de ${t0 - 1} não informada. A faixa constitucional não é calculável e nenhuma alíquota é presumida.`);
  if (rcl0 <= 0) return bloqueada(projeto, cen, regras, `RCL de ${t0 - 1} igual a zero ou negativa. Corrija a fonte antes de simular.`);

  const moraConhecida = d.moraEm1Jan.valor !== null;
  const manualBp = d.aliquotaManual.valor;
  const parametrica = !moraConhecida;
  if (parametrica && !(manualBp && manualBp > 0)) {
    return bloqueada(projeto, cen, regras, `Estoque em mora em 1º/1/${t0} não informado: faixa indeterminada. Informe a mora ou uma alíquota manual (simulação não verificada). O estoque total não substitui a mora.`);
  }
  const total = d.totalPendente1Jan.valor;
  const aVencerSeg = d.aVencerExercicioSeguinte.valor ?? 0;
  let M: number;
  const C = new Map<number, number>();
  if (parametrica) {
    if (total === null) return bloqueada(projeto, cen, regras, 'Sem estoque em mora e sem estoque total: não há passivo para projetar.');
    M = total; // estoque sem classificação, tratado como um único conjunto
    avisos.push('Simulação parametrizada: mora desconhecida; todo o estoque total é tratado como um único conjunto e a alíquota manual é aplicada em todos os anos, sem verificação legal.');
  } else {
    M = d.moraEm1Jan.valor as number;
    if (M < 0) return bloqueada(projeto, cen, regras, 'Estoque em mora negativo.');
    if (total === null) {
      avisos.push('Estoque total ausente: a projeção considera apenas o estoque em mora como passivo inicial (sem créditos a vencer).');
    } else {
      if (total < M) return bloqueada(projeto, cen, regras, 'Estoque total menor que o estoque em mora: as duas grandezas são incompatíveis. Confira datas-base e abrangência.');
      const aVencerAno = total - M - aVencerSeg;
      if (aVencerAno < 0) return bloqueada(projeto, cen, regras, 'Créditos a vencer do exercício seguinte maiores que (total − mora). Confira os dados.');
      C.set(t0, aVencerAno);
      if (aVencerSeg > 0) C.set(t0 + 1, aVencerSeg);
    }
  }
  let Bc = d.saldoContaEspecial1Jan.valor ?? 0;
  let Ba = 0;
  if (Bc < 0) return bloqueada(projeto, cen, regras, 'Saldo das contas especiais negativo.');
  if (cen.pctAcordos > 0 && projeto.ente.regime === 'geral') {
    avisos.push('Acordos diretos simulados para ente em regime geral: confira a base normativa e a conta de acordos do tribunal.');
  }

  const rM = cen.taxaMora;
  const rC = cen.taxaAVencer;
  const rB = cen.remuneracaoConta;
  const mom = cen.momentoDeposito;
  const extraAdic = opcoes.extraordinarioAdicional ?? 0;

  const linhas: LinhaProjecao[] = [];
  let rclAnt = rcl0;
  const moraInicioDecenio = new Map<number, number>();
  let conservacaoOk = true;

  for (let i = 0; i < H; i++) {
    const t = t0 + i;
    const av: string[] = [];
    const origemRcl: Origem = i === 0 ? d.rclAnterior.origem : 'estimado';
    const origemMora: Origem = parametrica ? 'ausente' : i === 0 ? d.moraEm1Jan.origem : 'estimado';

    // § 24, verificação no início do decênio
    const ad = regras.adicionalDecenal;
    if (t >= ad.anoInicio && (t - ad.anoInicio) % ad.periodoAnos === 0) moraInicioDecenio.set(t, M);
    const inicioDec = t >= ad.anoInicio ? ad.anoInicio + Math.floor((t - ad.anoInicio) / ad.periodoAnos) * ad.periodoAnos : null;

    const enq = calcularEnquadramento({
      ano: t,
      rclAnterior: rclAnt,
      moraEm1Jan: parametrica ? null : M,
      regras,
      leitura24: jur.leitura24,
      verificacao24: jur.verificacao24,
      moraInicioDecenio: inicioDec !== null ? moraInicioDecenio.get(inicioDec) ?? M : null,
      aliquotaManualBp: parametrica ? manualBp : null,
    });
    if (enq.status === 'bloqueada' || enq.status === 'indeterminada') {
      avisos.push(`Projeção interrompida em ${t}: ${enq.mensagem}`);
      break;
    }
    const limite = enq.limite;

    const CsT = C.get(t) ?? 0;
    const futurosIni = [...C.entries()].filter(([e]) => e > t).reduce((s, [, v]) => s + v, 0);
    const passivoInicial = M + CsT + futurosIni + Bc + Ba;

    const maxM = aporteMaximoParaQuitar(M, rM, mom);
    const maxC = aporteMaximoParaQuitar(CsT, rC, mom);
    const exig = maxM + maxC;

    const chExec = choqueAtivo(cen, 'execucao_depositos', t);
    const execucao = chExec ? chExec.valor : cen.execucaoDepositos;

    let base: number;
    switch (cen.baseDeposito) {
      case 'plano':
        if (i === 0 && d.planoAnual.valor !== null) base = d.planoAnual.valor;
        else {
          base = limite;
          av.push(i === 0 ? 'Plano anual não informado: usado o limite constitucional.' : `Plano só informado para ${t0}: em ${t} usado o limite constitucional.`);
        }
        break;
      case 'valor_fixo':
        base = cen.valorDepositoFixo;
        break;
      case 'pct_exigivel':
        base = arred(exig * cen.pctExigivel);
        break;
      default:
        base = limite;
    }
    const planejado = arred(base * execucao);
    let ordinario = planejado;
    let limitadoTeto = false;
    if (jur.aplicarTeto && planejado > limite) {
      ordinario = limite;
      limitadoTeto = true;
      av.push('Aporte planejado acima do teto do § 23: limitado ao teto (excedente só com dotação específica, § 28).');
    }
    const extra = cen.extraordinariosAno + extraAdic;
    const bruto = ordinario + extra;
    const dep = Math.min(bruto, exig);
    const limitadoExig = bruto > exig;
    if (limitadoExig) av.push('Aporte limitado ao exigível do ano (mora + coorte do exercício): não se cria obrigação fictícia.');
    const depAc = arred(dep * cen.pctAcordos);
    const depCr = dep - depAc;

    // Livro A — ordem cronológica: mora primeiro
    const aM = Math.min(dep, maxM);
    const aC = dep - aM;
    let updM = atualizacaoComAporte(M, rM, aM, mom);
    let M1 = M + updM - aM;
    if (M1 < 0) { updM -= M1; M1 = 0; }
    let updC = atualizacaoComAporte(CsT, rC, aC, mom);
    let C1 = CsT + updC - aC;
    if (C1 < 0) { updC -= C1; C1 = 0; }
    let updF = 0;
    for (const [e, v] of C.entries()) {
      if (e > t) {
        const u = arred(v * rC);
        C.set(e, v + u);
        updF += u;
      }
    }

    // Livro B — contas especiais
    const remCr = arred(Bc * rB);
    const remAc = arred(Ba * rB);
    const Bc1 = Bc + remCr + depCr;
    const Ba1 = Ba + remAc + depAc;
    const pagCr = arred(Bc1 * cen.taxaDistribuicao);
    const pagAc = arred(Ba1 * cen.taxaDistribuicao);
    const Bc2 = Bc1 - pagCr;
    const Ba2 = Ba1 - pagAc;

    // Renúncia (deságio) dos acordos pagos: extingue dívida, não é dispêndio (T17)
    const des = cen.desagioAcordos;
    const renDesej = pagAc > 0 && des > 0 && des < 1 ? arred((pagAc * des) / (1 - des)) : 0;
    const rM1 = Math.min(renDesej, M1);
    M1 -= rM1;
    const rC1 = Math.min(renDesej - rM1, C1);
    C1 -= rC1;
    const ren = rM1 + rC1;
    if (ren < renDesej) av.push('Renúncia dos acordos maior que o estoque exigível remanescente: limitada.');

    // Outras extinções válidas (§ 26, cancelamentos), sem passar pelas contas
    const outDesej = cen.outrasExtincoesAno;
    const oM = Math.min(outDesej, M1);
    M1 -= oM;
    const oC = Math.min(outDesej - oM, C1);
    C1 -= oC;
    const outras = oM + oC;
    if (outras < outDesej) av.push('Outras extinções maiores que o estoque exigível remanescente: limitadas.');

    // Novas inscrições apresentadas no ano t
    let I = arred(cen.novasInscricoesAno * Math.pow(1 + cen.crescimentoInscricoes, i));
    const chInsc = choqueAtivo(cen, 'aumento_inscricoes', t);
    if (chInsc) I = arred(I * (1 + chInsc.valor));
    const chExc = cen.choques.find((c) => c.tipo === 'precatorio_excepcional' && c.anoInicio === t);
    if (chExc) { I += Math.round(chExc.valor); av.push(`Precatório excepcional incluído em ${t}.`); }
    const coortes = distribuirInscricoes(I, t, cen.pctApresentadoAteCorte);
    for (const [e, v] of Object.entries(coortes)) {
      const ano = Number(e);
      C.set(ano, (C.get(ano) ?? 0) + v);
    }

    // Coorte do exercício não paga entra em mora em 1º/jan de t+1
    C.delete(t);
    const Mnext = M1 + C1;
    const futurosFim = [...C.values()].reduce((s, v) => s + v, 0);
    const Afim = Mnext + futurosFim;
    const passivoFinal = Afim + Bc2 + Ba2;
    const atualizacaoTotal = updM + updC + updF + remCr + remAc;
    const pagCred = pagCr + pagAc;
    const reducoes = pagCred + ren + outras;
    const esperado = passivoInicial + I + atualizacaoTotal - reducoes;
    const dif = passivoFinal - esperado;
    if (dif !== 0) conservacaoOk = false;
    const entradas = I + atualizacaoTotal;

    // RCL do ano t (será a "RCL anterior" de t+1)
    const chRcl = choqueAtivo(cen, 'queda_rcl', t);
    const g = chRcl ? -chRcl.valor : cen.crescimentoRCL;
    const rclDoAno = arred(rclAnt * (1 + g));

    linhas.push({
      ano: t,
      rclAnterior: { valor: rclAnt, origem: origemRcl },
      rclDoAno,
      moraEm1Jan: { valor: parametrica ? null : M, origem: origemMora },
      aVencerNoAno: CsT,
      aVencerFuturo: futurosIni,
      saldoContas1Jan: Bc + Ba,
      passivoInicial,
      enquadramento: enq,
      limite,
      baseDeposito: base,
      execucao,
      depositoOrdinarioPlanejado: planejado,
      depositoOrdinario: ordinario,
      limitadoPeloTeto: limitadoTeto,
      extraordinario: extra,
      exigivelAtualizado: exig,
      limitadoAoExigivel: limitadoExig,
      depositoTotal: dep,
      depositoCronologica: depCr,
      depositoAcordos: depAc,
      aporteMora: aM,
      aporteAVencer: aC,
      atualizacaoMora: updM,
      atualizacaoAVencer: updC,
      atualizacaoFuturos: updF,
      remuneracaoContas: remCr + remAc,
      atualizacaoTotal,
      novosCreditos: I,
      pagamentoCronologica: pagCr,
      pagamentoAcordos: pagAc,
      pagamentosCredores: pagCred,
      renunciaAcordos: ren,
      outrasExtincoes: outras,
      reducoes,
      variacaoAntesAtualizacao: I - reducoes,
      estoqueForaContasFinal: Afim,
      saldoContasFinal: Bc2 + Ba2,
      passivoFinal,
      variacaoLiquida: passivoFinal - passivoInicial,
      moraProximo1Jan: parametrica ? null : Mnext,
      coberturaEntradas: entradas > 0 ? reducoes / entradas : null,
      conservacao: { ok: dif === 0, diferenca: dif },
      avisos: av,
    });

    M = Mnext;
    Bc = Bc2;
    Ba = Ba2;
    rclAnt = rclDoAno;
  }

  // ---- Convergência (T14): nunca fabricar ano de zeragem ----
  const anoFinal = linhas.length ? linhas[linhas.length - 1].ano : t0;
  const semMoraInicial = !parametrica && (d.moraEm1Jan.valor ?? 0) <= 100;
  let anoZeragem: number | null = null;
  let reaparece: number | null = null;
  if (!parametrica) {
    for (const l of linhas) {
      const m = l.moraProximo1Jan ?? 0;
      if (semMoraInicial) {
        if (reaparece === null && m > 100) reaparece = l.ano + 1;
      } else if (anoZeragem === null && m <= 100) anoZeragem = l.ano + 1;
      else if (anoZeragem !== null && reaparece === null && m > 100) reaparece = l.ano + 1;
    }
  }
  let mensagem: string;
  if (parametrica) mensagem = 'Quitação do estoque em mora: indeterminada (mora desconhecida; simulação parametrizada).';
  else if (semMoraInicial) mensagem = `Sem estoque em mora em 1º/1/${t0}.` + (reaparece ? ` Sob estas hipóteses, a mora surge em 1º/1/${reaparece}.` : ' Sob estas hipóteses, o ente se mantém em dia no horizonte.');
  else if (anoZeragem !== null) mensagem = `Estoque em mora zerado em 1º/1/${anoZeragem} sob estas hipóteses.` + (reaparece ? ` A mora volta a surgir em 1º/1/${reaparece}.` : '');
  else mensagem = `Não há quitação do estoque em mora projetada até ${anoFinal} sob estas hipóteses.`;

  let trajetoria: Trajetoria = 'nao_mensuravel';
  let variacao: number | null = null;
  let rel: number | null = null;
  if (linhas.length && conservacaoOk) {
    const ini = linhas[0].passivoInicial;
    const fim = linhas[linhas.length - 1].passivoFinal;
    variacao = fim - ini;
    rel = ini > 0 ? variacao / ini : null;
    if (ini === 0) trajetoria = fim === 0 ? 'estavel' : 'crescendo';
    else if (Math.abs(rel as number) <= projeto.config.toleranciaEstavel) trajetoria = 'estavel';
    else trajetoria = variacao < 0 ? 'encolhendo' : 'crescendo';
  }
  if (!conservacaoOk) avisos.push('A equação de conservação não fechou em algum exercício: resultado não conciliado.');

  return {
    status: parametrica ? 'parametrica' : 'ok',
    cenario: cen.id,
    versaoRegras: regras.versao,
    aplicarTeto: jur.aplicarTeto,
    anoInicial: t0,
    anoFinal,
    linhas,
    semMoraInicial,
    anoZeragemMora: anoZeragem,
    moraReapareceEm: reaparece,
    convergiu: semMoraInicial ? reaparece === null : anoZeragem !== null,
    mensagemConvergencia: mensagem,
    trajetoria,
    variacaoHorizonte: variacao,
    variacaoRelativa: rel,
    conservacaoOk,
    avisos,
  };
}

export const ROTULO_TRAJETORIA: Record<Trajetoria, string> = {
  encolhendo: 'Encolhendo',
  estavel: 'Estável',
  crescendo: 'Crescendo',
  nao_mensuravel: 'Não mensurável',
};
