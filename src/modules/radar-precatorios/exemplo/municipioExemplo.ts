/**
 * Projeto de exemplo — Município Exemplo (FICTÍCIO).
 * Números do enunciado: RCL 2025 de R$ 30 mi; mora em 1º/1/2026 de R$ 2,5 mi;
 * novas entradas de R$ 500 mil; redução de R$ 300 mil antes da correção.
 * Todos marcados como hipótese. Nenhum dado real ou pessoal.
 */
import type { Cenario, DadoRastreado, Projeto } from '../dominio/tipos';
import { reais } from '../dominio/dinheiro';
import { REGRAS_V1 } from '../regras/regrasJuridicas';

const ausente = (): DadoRastreado => ({ valor: null, origem: 'ausente' });

export function cenariosPadrao(): Cenario[] {
  const comum = {
    pctApresentadoAteCorte: 1 / 12,
    baseDeposito: 'limite' as const,
    valorDepositoFixo: 0,
    pctExigivel: 1,
    momentoDeposito: 'mensal' as const,
    desagioAcordos: 0.3,
    remuneracaoConta: 0,
    outrasExtincoesAno: 0,
    choques: [],
  };
  return [
    { ...comum, id: 'conservador', nome: 'Conservador', crescimentoRCL: 0.03, novasInscricoesAno: reais(600_000), crescimentoInscricoes: 0.06, taxaAVencer: 0.055, taxaMora: 0.075, execucaoDepositos: 0.85, extraordinariosAno: 0, pctAcordos: 0, taxaDistribuicao: 0.9 },
    { ...comum, id: 'base', nome: 'Base', crescimentoRCL: 0.05, novasInscricoesAno: reais(500_000), crescimentoInscricoes: 0.04, taxaAVencer: 0.045, taxaMora: 0.065, execucaoDepositos: 1, extraordinariosAno: 0, pctAcordos: 0, taxaDistribuicao: 1 },
    { ...comum, id: 'favoravel', nome: 'Favorável', crescimentoRCL: 0.07, novasInscricoesAno: reais(400_000), crescimentoInscricoes: 0.02, taxaAVencer: 0.035, taxaMora: 0.055, execucaoDepositos: 1, extraordinariosAno: reais(100_000), pctAcordos: 0.2, taxaDistribuicao: 1 },
  ];
}

export function projetoExemplo(agoraISO = '2026-10-14T12:00:00.000Z'): Projeto {
  const fonteHip = 'Enunciado do projeto Credijuris (número hipotético)';
  return {
    schemaVersao: 1,
    id: 'exemplo-municipio-ficticio',
    nome: 'Município Exemplo — simulação do enunciado',
    criadoEm: agoraISO,
    atualizadoEm: agoraISO,
    ehExemplo: true,
    ente: {
      nome: 'Município Exemplo (fictício)',
      esfera: 'municipio',
      uf: 'MG',
      codIbge: '0000000',
      regime: 'especial',
      fonteRegime: 'Exemplo fictício: sem fonte oficial',
      tribunal: 'Tribunal de Justiça (fictício)',
      abrangencia: '',
      observacoes: 'Projeto de demonstração com os números hipotéticos do enunciado. Não representa ente real.',
    },
    anoBase: 2026,
    dados: {
      rclAnterior: { valor: reais(30_000_000), origem: 'hipotese', fonte: fonteHip, periodoReferencia: 'Exercício 2025', dataBase: '2025-12-31', dataColeta: '2026-10-14', confianca: 'baixa' },
      moraEm1Jan: { valor: reais(2_500_000), origem: 'hipotese', fonte: fonteHip, dataBase: '2026-01-01', dataColeta: '2026-10-14', confianca: 'baixa' },
      totalPendente1Jan: { valor: reais(3_200_000), origem: 'hipotese', fonte: 'Histórico fictício (saldo final de 2025)', dataBase: '2026-01-01', dataColeta: '2026-10-14', confianca: 'baixa' },
      aVencerExercicioSeguinte: { valor: 0, origem: 'hipotese', fonte: 'Exemplo: nenhum crédito do orçamento 2027 considerado em 1º/1/2026' },
      saldoContaEspecial1Jan: ausente(),
      planoAnual: ausente(),
      aliquotaManual: { valor: null, origem: 'ausente' },
    },
    observacoes: [],
    historico: [
      { id: 'h2023', exercicio: 2023, rcl: reais(26_000_000), moraEm1Jan: reais(1_900_000), estoqueInicial: reais(2_100_000), novasInscricoes: reais(450_000), atualizacao: reais(150_000), depositos: reais(260_000), pagamentos: reais(250_000), baixas: reais(20_000), estoqueFinal: reais(2_430_000), origem: 'hipotese', fonte: 'Série fictícia de demonstração' },
      { id: 'h2024', exercicio: 2024, rcl: reais(28_200_000), moraEm1Jan: reais(2_100_000), estoqueInicial: reais(2_430_000), novasInscricoes: reais(480_000), atualizacao: reais(170_000), depositos: reais(280_000), pagamentos: reais(270_000), baixas: reais(10_000), estoqueFinal: reais(2_800_000), origem: 'hipotese', fonte: 'Série fictícia de demonstração' },
      { id: 'h2025', exercicio: 2025, rcl: reais(30_000_000), moraEm1Jan: reais(2_300_000), estoqueInicial: reais(2_800_000), novasInscricoes: reais(500_000), atualizacao: reais(190_000), depositos: reais(300_000), pagamentos: reais(290_000), baixas: 0, estoqueFinal: reais(3_200_000), origem: 'hipotese', fonte: 'Série fictícia de demonstração' },
    ],
    serie: { tipo: 'nao_informado', pontos: [{ ano: 2024, valor: reais(1_000_000) }, { ano: 2025, valor: reais(1_500_000) }] },
    livroInicial: { estoqueForaDasContas: reais(1_000_000), saldoContaCronologica: 0, saldoContaAcordos: 0 },
    movimentos: [
      { id: 'MOV-001', data: '2026-03-10', tipo: 'deposito_conta_especial', valor: reais(100_000), conta: 'cronologica', referencia: 'Aporte mensal (exemplo)', origem: 'hipotese' },
      { id: 'MOV-002', data: '2026-06-15', tipo: 'pagamento_da_conta', valor: reais(70_000), conta: 'cronologica', referencia: 'Pagamento da conta (exemplo)', origem: 'hipotese' },
    ],
    cenarios: cenariosPadrao(),
    config: { horizonteAnos: 30, toleranciaEstavel: 0.02, cenarioAtivo: 'base' },
    juridico: { versaoRegras: REGRAS_V1.versao, leitura24: REGRAS_V1.adicionalDecenal.leituraPadrao, verificacao24: REGRAS_V1.adicionalDecenal.verificacaoPadrao, aplicarTeto: true },
    snapshots: [],
  };
}

export function projetoEmBranco(anoBase: number, agoraISO: string): Projeto {
  const p = projetoExemplo(agoraISO);
  return {
    ...p,
    id: `projeto-${agoraISO.replace(/\D/g, '').slice(0, 14)}`,
    nome: 'Novo ente',
    ehExemplo: false,
    ente: { nome: 'Novo ente', esfera: 'municipio', uf: '', codIbge: '', regime: 'nao_informado', fonteRegime: '', tribunal: '', abrangencia: '', observacoes: '' },
    anoBase,
    dados: {
      rclAnterior: ausente(),
      moraEm1Jan: ausente(),
      totalPendente1Jan: ausente(),
      aVencerExercicioSeguinte: ausente(),
      saldoContaEspecial1Jan: ausente(),
      planoAnual: ausente(),
      aliquotaManual: { valor: null, origem: 'ausente' },
    },
    observacoes: [],
    historico: [],
    serie: { tipo: 'nao_informado', pontos: [] },
    livroInicial: { estoqueForaDasContas: 0, saldoContaCronologica: 0, saldoContaAcordos: 0 },
    movimentos: [],
    cenarios: cenariosPadrao().map((c) => ({ ...c, novasInscricoesAno: 0, extraordinariosAno: 0, pctAcordos: 0 })),
    snapshots: [],
  };
}
