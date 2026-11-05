/**
 * Casos de aceitação T01–T24 (seção 14 da especificação).
 * Os mesmos casos rodam no Vitest (tests/) e na aba "Testes" da interface,
 * para o analista verificar o comportamento sem ferramentas de programação.
 */
import type { Cenario, Projeto } from '../dominio/tipos';
import { formatarBRL, formatarBp, reais } from '../dominio/dinheiro';
import { REGRAS_V1 } from '../regras/regrasJuridicas';
import { adicionalDecenal, calcularEnquadramento } from '../motores/motorPercentualRCL';
import { atualizacaoComAporte } from '../motores/motorAtualizacao';
import { exercicioDePagamento, interpretarSerie } from '../motores/motorEstoque';
import { aplicarMovimentos } from '../motores/motorFluxoCaixa';
import { projetar } from '../motores/motorProjecao';
import { preverRecebimentoIndividual, TEXTO_INDETERMINADO } from '../motores/motorFila';
import { detectarConflitos } from '../motores/motorRiscos';
import { criarSnapshot } from '../persistencia/projetoJSON';
import { projetoExemplo } from '../exemplo/municipioExemplo';

export interface ResultadoCaso {
  ok: boolean;
  esperado: string;
  obtido: string;
}

export interface CasoAceite {
  id: string;
  titulo: string;
  comportamento: string;
  escopo: 'fase1' | 'fase1_parcial' | 'fase2';
  executar?: () => ResultadoCaso;
}

const R = REGRAS_V1;

function enq(ano: number, rcl: number | null, mora: number | null, manual?: number) {
  return calcularEnquadramento({ ano, rclAnterior: rcl, moraEm1Jan: mora, regras: R, leitura24: 'fixa', verificacao24: 'anual', aliquotaManualBp: manual ?? null });
}

function aliquotaPara(pctMora: string): number | null {
  // RCL de R$ 30 mi; mora = RCL × pct exato, em centavos inteiros
  const rcl = reais(30_000_000);
  const [int, dec = ''] = pctMora.split('.');
  const casas = dec.length;
  const num = BigInt(int + dec);
  const den = BigInt(100) * BigInt(10) ** BigInt(casas);
  const mora = Number((BigInt(rcl) * num) / den);
  const r = enq(2026, rcl, mora);
  return r.status === 'calculada' ? r.aliquotaAplicavelBp : null;
}

function casoFaixa(id: string, pct: string, esperadoBp: number, titulo: string, comportamento: string): CasoAceite {
  return {
    id, titulo, comportamento, escopo: 'fase1',
    executar: () => {
      const a = aliquotaPara(pct);
      return { ok: a === esperadoBp, esperado: formatarBp(esperadoBp), obtido: formatarBp(a) };
    },
  };
}

/** Projeto mínimo para testes: exemplo com taxas zeradas e sem choques. */
export function projetoTeste(over: Partial<Projeto> = {}, cen: Partial<Cenario> = {}): { projeto: Projeto; cenario: Cenario } {
  const base = projetoExemplo();
  const cenario: Cenario = {
    ...base.cenarios[1],
    crescimentoRCL: 0, crescimentoInscricoes: 0, taxaAVencer: 0, taxaMora: 0, execucaoDepositos: 1,
    extraordinariosAno: 0, pctAcordos: 0, taxaDistribuicao: 1, remuneracaoConta: 0, outrasExtincoesAno: 0, choques: [],
    momentoDeposito: 'mensal', baseDeposito: 'limite',
    ...cen,
  };
  const projeto: Projeto = {
    ...base,
    dados: { ...base.dados, totalPendente1Jan: { valor: null, origem: 'ausente' }, aVencerExercicioSeguinte: { valor: null, origem: 'ausente' } },
    ...over,
  };
  projeto.cenarios = [{ ...cenario, id: 'conservador' }, cenario, { ...cenario, id: 'favoravel' }];
  return { projeto, cenario };
}

export const CASOS: CasoAceite[] = [
  casoFaixa('T01', '15', 100, 'Mora/RCL exatamente 15%', 'Faixa 1%, sem pular para 1,5%'),
  casoFaixa('T02', '15.0001', 150, 'Mora/RCL de 15,0001%', 'Faixa 1,5%'),
  casoFaixa('T03', '25', 150, 'Mora/RCL exatamente 25%', 'Faixa 1,5%'),
  casoFaixa('T04', '25.0001', 200, 'Mora/RCL de 25,0001%', 'Faixa 2%'),
  casoFaixa('T05', '85', 450, 'Mora/RCL exatamente 85%', 'Faixa 4,5%'),
  casoFaixa('T06', '85.0001', 500, 'Mora/RCL acima de 85%', 'Faixa 5%'),
  {
    id: 'T07', titulo: 'Mora zero com RCL válida', escopo: 'fase1',
    comportamento: 'Regra-base de 1%, sem obrigação fictícia de pagar saldo inexistente',
    executar: () => {
      const { projeto, cenario } = projetoTeste({}, { novasInscricoesAno: 0 });
      projeto.dados = { ...projeto.dados, moraEm1Jan: { valor: 0, origem: 'hipotese' }, totalPendente1Jan: { valor: 0, origem: 'hipotese' } };
      const r = projetar(projeto, cenario, R);
      const l = r.linhas[0];
      const ok = l?.enquadramento.status === 'calculada' && l.enquadramento.aliquotaAplicavelBp === 100 && l.limite === reais(300_000) && l.depositoTotal === 0;
      return { ok, esperado: 'alíquota 1%, limite R$ 300.000,00, aporte R$ 0,00', obtido: l ? `alíquota ${formatarBp(l.enquadramento.status === 'calculada' ? l.enquadramento.aliquotaAplicavelBp : null)}, limite ${formatarBRL(l.limite)}, aporte ${formatarBRL(l.depositoTotal)}` : 'sem linha' };
    },
  },
  {
    id: 'T08', titulo: 'RCL ausente, zero ou negativa', escopo: 'fase1',
    comportamento: 'Bloquear a faixa e explicar o problema',
    executar: () => {
      const a = enq(2026, null, reais(1_000));
      const b = enq(2026, 0, reais(1_000));
      const c = enq(2026, -reais(10), reais(1_000));
      const ok = a.status === 'bloqueada' && b.status === 'bloqueada' && c.status === 'bloqueada' && a.motivo === 'rcl_ausente' && b.motivo === 'rcl_invalida';
      return { ok, esperado: 'bloqueada nos três casos', obtido: [a.status, b.status, c.status].join(' / ') };
    },
  },
  {
    id: 'T09', titulo: 'Estoque total presente, mora ausente', escopo: 'fase1',
    comportamento: 'Não substituir uma grandeza pela outra',
    executar: () => {
      const { projeto, cenario } = projetoTeste();
      projeto.dados = { ...projeto.dados, moraEm1Jan: { valor: null, origem: 'ausente' }, totalPendente1Jan: { valor: reais(3_200_000), origem: 'hipotese' } };
      const e = enq(2026, reais(30_000_000), null);
      const r = projetar(projeto, cenario, R);
      const ok = e.status === 'indeterminada' && r.status === 'bloqueada';
      return { ok, esperado: 'faixa indeterminada e projeção bloqueada', obtido: `faixa ${e.status}, projeção ${r.status}` };
    },
  },
  {
    id: 'T10', titulo: 'Saldo 2024 = R$ 1 mi, 2025 = R$ 1,5 mi', escopo: 'fase1',
    comportamento: 'Não somar as fotografias como novos títulos',
    executar: () => {
      const i = interpretarSerie({ tipo: 'fotografia', pontos: [{ ano: 2024, valor: reais(1_000_000) }, { ano: 2025, valor: reais(1_500_000) }] });
      const ok = i.status === 'fotografia' && i.estoqueMaisRecente === reais(1_500_000) && i.variacoes[0].variacao === reais(500_000);
      return { ok, esperado: 'estoque R$ 1.500.000,00; variação +R$ 500.000,00', obtido: i.status === 'fotografia' ? `estoque ${formatarBRL(i.estoqueMaisRecente)}; variação ${formatarBRL(i.variacoes[0].variacao)}` : i.status };
    },
  },
  {
    id: 'T11', titulo: 'Ano 2035 × 2036', escopo: 'fase1',
    comportamento: 'Avaliar o adicional decenal conforme a regra versionada',
    executar: () => {
      const a35 = adicionalDecenal(2035, reais(1_000_000), 'fixa', 'anual', R).bp;
      const a36 = adicionalDecenal(2036, reais(1_000_000), 'fixa', 'anual', R).bp;
      const a46c = adicionalDecenal(2046, reais(1_000_000), 'cumulativa', 'anual', R).bp;
      const a36z = adicionalDecenal(2036, 0, 'fixa', 'anual', R).bp;
      const ok = a35 === 0 && a36 === 50 && a46c === 100 && a36z === 0;
      return { ok, esperado: '2035: 0; 2036: +0,5 p.p.; 2046 cumulativa: +1,0 p.p.; sem mora: 0', obtido: `2035: ${a35 / 100}; 2036: ${a36 / 100}; 2046c: ${a46c / 100}; sem mora: ${a36z / 100}` };
    },
  },
  {
    id: 'T12', titulo: 'Depósito de R$ 100 mil e pagamento de R$ 70 mil do mesmo caixa', escopo: 'fase1',
    comportamento: 'Saldo pendente para credores cai R$ 70 mil, não R$ 170 mil',
    executar: () => {
      const r = aplicarMovimentos({ estoqueForaDasContas: reais(1_000_000), saldoContaCronologica: 0, saldoContaAcordos: 0 }, [
        { id: 'd', data: '2026-03-01', tipo: 'deposito_conta_especial', valor: reais(100_000), conta: 'cronologica', origem: 'hipotese' },
        { id: 'p', data: '2026-06-01', tipo: 'pagamento_da_conta', valor: reais(70_000), conta: 'cronologica', origem: 'hipotese' },
      ]);
      const i = r.indicadores;
      const ok = i.estoqueForaDasContas === reais(900_000) && i.saldoNasContas === reais(30_000) && i.pagoAosCredores === reais(70_000) && i.obrigacaoNaoRecebida === reais(930_000);
      return { ok, esperado: 'fora das contas 900 mil; em conta 30 mil; pago 70 mil; pendente 930 mil', obtido: `${formatarBRL(i.estoqueForaDasContas)}; ${formatarBRL(i.saldoNasContas)}; ${formatarBRL(i.pagoAosCredores)}; ${formatarBRL(i.obrigacaoNaoRecebida)}` };
    },
  },
  {
    id: 'T13', titulo: 'Entradas R$ 500 mil, amortização R$ 300 mil, sem correção', escopo: 'fase1',
    comportamento: 'Aumento líquido de R$ 200 mil',
    executar: () => {
      const { projeto, cenario } = projetoTeste({}, { novasInscricoesAno: reais(500_000) });
      const l = projetar(projeto, cenario, R).linhas[0];
      const ok = !!l && l.reducoes === reais(300_000) && l.variacaoLiquida === reais(200_000) && l.conservacao.ok;
      return { ok, esperado: 'redução R$ 300.000,00; variação +R$ 200.000,00', obtido: l ? `redução ${formatarBRL(l.reducoes)}; variação ${formatarBRL(l.variacaoLiquida)}` : 'sem linha' };
    },
  },
  {
    id: 'T14', titulo: 'Entradas + atualização > baixas por 30 anos', escopo: 'fase1',
    comportamento: 'Sem ano fictício de zeragem no horizonte',
    executar: () => {
      const { projeto, cenario } = projetoTeste({ config: { horizonteAnos: 30, toleranciaEstavel: 0.02, cenarioAtivo: 'base' } }, { novasInscricoesAno: reais(500_000), crescimentoInscricoes: 0.05, taxaMora: 0.065, taxaAVencer: 0.045, crescimentoRCL: 0.05 });
      const r = projetar(projeto, cenario, R);
      const premissa = r.linhas.length === 30 && r.linhas.every((l) => l.novosCreditos + l.atualizacaoTotal > l.reducoes);
      const ok = premissa && r.anoZeragemMora === null && !r.convergiu && r.mensagemConvergencia.includes('Não há quitação') && r.mensagemConvergencia.includes('2055');
      return { ok, esperado: 'premissa válida nos 30 anos; "Não há quitação … até 2055"', obtido: `premissa ${premissa ? 'válida' : 'não satisfeita'}; ${r.mensagemConvergencia}` };
    },
  },
  {
    id: 'T15', titulo: 'Título sem classe nem posição à frente', escopo: 'fase1',
    comportamento: 'Não exibir ano individual como certeza',
    executar: () => {
      const p = preverRecebimentoIndividual({});
      const ok = p.status === 'indeterminado' && p.texto === TEXTO_INDETERMINADO && !/\b20\d{2}\b/.test(p.texto);
      return { ok, esperado: TEXTO_INDETERMINADO, obtido: p.texto };
    },
  },
  { id: 'T16', titulo: 'Credor com parcela superpreferencial e saldo residual', escopo: 'fase2', comportamento: 'Projetar as duas trilhas separadamente (exige fila individual)' },
  {
    id: 'T17', titulo: 'Regime especial com acordos', escopo: 'fase1_parcial',
    comportamento: 'Recursos alocados por conta; deságio não contado como dinheiro gasto no plano',
    executar: () => {
      const { projeto, cenario } = projetoTeste({}, { novasInscricoesAno: 0, pctAcordos: 0.5, desagioAcordos: 0.4 });
      const l = projetar(projeto, cenario, R).linhas[0];
      const ok = !!l && l.depositoAcordos === reais(150_000) && l.depositoCronologica === reais(150_000) && l.pagamentosCredores === reais(300_000) && l.renunciaAcordos === reais(100_000) && l.reducoes === reais(400_000) && l.conservacao.ok;
      return { ok, esperado: 'contas 150 mil + 150 mil; dinheiro pago 300 mil; renúncia 100 mil (fora do dispêndio)', obtido: l ? `contas ${formatarBRL(l.depositoCronologica)} + ${formatarBRL(l.depositoAcordos)}; pago ${formatarBRL(l.pagamentosCredores)}; renúncia ${formatarBRL(l.renunciaAcordos)}` : 'sem linha' };
    },
  },
  {
    id: 'T18', titulo: 'Transferência à conta especial no meio do ano', escopo: 'fase1',
    comportamento: 'Sem correção sobre o valor transferido após a data (§ 30)',
    executar: () => {
      const u = atualizacaoComAporte(reais(1_000_000), 0.1, reais(100_000), 'meio');
      return { ok: u === reais(95_000), esperado: 'atualização R$ 95.000,00 (R$ 100 mil − R$ 5 mil não incidentes)', obtido: formatarBRL(u) };
    },
  },
  { id: 'T19', titulo: 'Crédito parcialmente pago', escopo: 'fase2', comportamento: 'Primeira liberação e quitação integral distintas (exige fila individual)' },
  {
    id: 'T20', titulo: 'Regra ou dado oficial modificado', escopo: 'fase1',
    comportamento: 'Guardar versão e resultado anterior para auditoria',
    executar: () => {
      const { projeto, cenario } = projetoTeste({}, { novasInscricoesAno: reais(500_000) });
      const r1 = projetar(projeto, cenario, R);
      const snap = criarSnapshot(projeto, r1, 'antes', '2026-10-14T12:00:00.000Z', 'base');
      const alterado: Projeto = { ...projeto, dados: { ...projeto.dados, rclAnterior: { ...projeto.dados.rclAnterior, valor: reais(60_000_000) } } };
      const r2 = projetar(alterado, cenario, R);
      const ok = snap.resumo.limiteAnoBase === reais(300_000) && r2.linhas[0].limite === reais(600_000) && snap.versaoRegras === R.versao && Object.isFrozen(snap);
      return { ok, esperado: 'snapshot mantém limite de R$ 300 mil e versão das regras; novo cálculo R$ 600 mil', obtido: `snapshot ${formatarBRL(snap.resumo.limiteAnoBase)} (v${snap.versaoRegras}); novo ${formatarBRL(r2.linhas[0].limite)}` };
    },
  },
  {
    id: 'T21', titulo: 'RCL cresce e a mora cai de faixa', escopo: 'fase1',
    comportamento: 'Recalcular a faixa para cada exercício',
    executar: () => {
      const { projeto, cenario } = projetoTeste({}, { novasInscricoesAno: 0, crescimentoRCL: 0.2 });
      projeto.dados = { ...projeto.dados, moraEm1Jan: { valor: reais(7_800_000), origem: 'hipotese' } };
      const r = projetar(projeto, cenario, R);
      const [a, b] = r.linhas;
      const fa = a.enquadramento.status === 'calculada' ? a.enquadramento.faixa : 0;
      const fb = b.enquadramento.status === 'calculada' ? b.enquadramento.faixa : 0;
      return { ok: fa === 3 && fb === 2, esperado: '2026: inciso III (2%); 2027: inciso II (1,5%)', obtido: `2026: faixa ${fa}; 2027: faixa ${fb}` };
    },
  },
  {
    id: 'T22', titulo: 'Fonte defasada conflita com fonte recente', escopo: 'fase1',
    comportamento: 'Alertar divergência, sem sobrescrever em silêncio',
    executar: () => {
      const { projeto } = projetoTeste();
      projeto.dados = { ...projeto.dados, rclAnterior: { ...projeto.dados.rclAnterior, valor: reais(30_000_000), fonte: 'RGF 2025 (3º quadrimestre)', dataBase: '2025-12-31' } };
      projeto.observacoes = [{ id: 'o1', campo: 'rclAnterior', valor: reais(28_000_000), origem: 'oficial', fonte: 'RGF 2025 (2º quadrimestre)', dataBase: '2025-08-31' }];
      const c = detectarConflitos(projeto);
      const defasada = c[0]?.valores.find((v) => v.valor === reais(28_000_000))?.possivelmenteDefasada;
      const ok = c.length === 1 && projeto.dados.rclAnterior.valor === reais(30_000_000) && defasada === true;
      return { ok, esperado: '1 conflito; valor em uso mantido; fonte antiga marcada como defasada', obtido: `${c.length} conflito(s); em uso ${formatarBRL(projeto.dados.rclAnterior.valor)}; defasada: ${defasada ? 'sim' : 'não'}` };
    },
  },
  {
    id: 'T23', titulo: 'Entrada nova após o marco orçamentário', escopo: 'fase1',
    comportamento: 'Respeitar cronologia e elegibilidade, sem pagamento antecipado',
    executar: () => {
      const e1 = exercicioDePagamento('2026-02-01', R);
      const e2 = exercicioDePagamento('2026-02-02', R);
      const { projeto, cenario } = projetoTeste({}, { novasInscricoesAno: reais(1_000_000), crescimentoInscricoes: -1, pctApresentadoAteCorte: 0 });
      projeto.dados = { ...projeto.dados, moraEm1Jan: { valor: 0, origem: 'hipotese' }, rclAnterior: { ...projeto.dados.rclAnterior, valor: reais(300_000_000) } };
      const r = projetar(projeto, cenario, R);
      const d27 = r.linhas[1].depositoTotal;
      const d28 = r.linhas[2].depositoTotal;
      const ok = e1 === 2027 && e2 === 2028 && d27 === 0 && d28 === reais(1_000_000);
      return { ok, esperado: '01/02/2026 → 2027; 02/02/2026 → 2028; nada pago em 2027; R$ 1 mi em 2028', obtido: `${e1}; ${e2}; 2027: ${formatarBRL(d27)}; 2028: ${formatarBRL(d28)}` };
    },
  },
  {
    id: 'T24', titulo: 'Cenário manual diferente de valor oficial', escopo: 'fase1',
    comportamento: 'Exibir etiquetas e fontes distintas',
    executar: () => {
      const { projeto, cenario } = projetoTeste();
      projeto.dados = { ...projeto.dados, rclAnterior: { ...projeto.dados.rclAnterior, origem: 'oficial', fonte: 'RGF/Siconfi' } };
      const r = projetar(projeto, cenario, R);
      const m = enq(2026, reais(30_000_000), null, 150);
      const ok = r.linhas[0].rclAnterior.origem === 'oficial' && r.linhas[1].rclAnterior.origem === 'estimado' && r.linhas[1].moraEm1Jan.origem === 'estimado' && m.status === 'manual';
      return { ok, esperado: '2026: oficial; 2027: estimado; alíquota manual marcada como não verificada', obtido: `2026: ${r.linhas[0].rclAnterior.origem}; 2027: ${r.linhas[1].rclAnterior.origem}; manual: ${m.status}` };
    },
  },
];

export function executarCasos(): (CasoAceite & { resultado?: ResultadoCaso; erro?: string })[] {
  return CASOS.map((c) => {
    if (!c.executar) return { ...c };
    try {
      return { ...c, resultado: c.executar() };
    } catch (e) {
      return { ...c, erro: e instanceof Error ? e.message : String(e) };
    }
  });
}
