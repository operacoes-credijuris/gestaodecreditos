/**
 * Tipos de domínio do Radar de Precatórios — Fase 1 (modo agregado).
 *
 * Convenções:
 * - Dinheiro é sempre `Centavos`: número INTEIRO de centavos de real.
 * - Taxas e percentuais de cenário são frações (0,05 = 5%).
 * - Alíquotas e limiares constitucionais são pontos-base inteiros (100 = 1%).
 * - Datas são strings ISO `aaaa-mm-dd`; a interface exibe dd/mm/aaaa.
 */

export type Centavos = number;
export type PontosBase = number;

/** Natureza do número, exibida em toda a interface (requisito 9 / T24). */
export type Origem = 'oficial' | 'analista' | 'hipotese' | 'estimado' | 'ausente';

export type Confianca = 'alta' | 'media' | 'baixa';

/** Todo número que entra no cálculo carrega procedência. */
export interface DadoRastreado<T = Centavos> {
  valor: T | null;
  origem: Origem;
  fonte?: string;
  dataBase?: string;
  periodoReferencia?: string;
  dataColeta?: string;
  confianca?: Confianca;
  observacao?: string;
  responsavel?: string;
}

export type CampoRastreado =
  | 'rclAnterior'
  | 'moraEm1Jan'
  | 'totalPendente1Jan'
  | 'aVencerExercicioSeguinte'
  | 'saldoContaEspecial1Jan'
  | 'planoAnual';

/** Registro de cada fonte consultada para um campo — nunca sobrescrito em silêncio (T22). */
export interface ObservacaoFonte {
  id: string;
  campo: CampoRastreado;
  valor: Centavos;
  origem: Origem;
  fonte: string;
  dataBase?: string;
  dataColeta?: string;
  observacao?: string;
}

export type Esfera = 'municipio' | 'estado' | 'df';
export type Regime = 'geral' | 'especial' | 'nao_informado';

export interface Ente {
  nome: string;
  esfera: Esfera;
  uf: string;
  codIbge: string;
  regime: Regime;
  fonteRegime: string;
  tribunal: string;
  abrangencia: string;
  observacoes: string;
}

export interface DadosIniciais {
  /** RCL realizada no exercício anterior ao ano-base. */
  rclAnterior: DadoRastreado;
  /** Estoque EM MORA, atualizado e com juros, em 1º/jan do ano-base. */
  moraEm1Jan: DadoRastreado;
  /** Estoque total ainda pendente em 1º/jan (mora + a vencer). */
  totalPendente1Jan: DadoRastreado;
  /** Parte do "a vencer" já apresentada para o orçamento do exercício seguinte. */
  aVencerExercicioSeguinte: DadoRastreado;
  /** Saldo já aportado nas contas especiais e ainda não pago (Livro B). */
  saldoContaEspecial1Jan: DadoRastreado;
  /** Plano anual homologado para o ano-base, se houver. */
  planoAnual: DadoRastreado;
  /** Alíquota informada manualmente quando a faixa legal não é calculável. */
  aliquotaManual: DadoRastreado<PontosBase>;
}

export type TipoChoque = 'queda_rcl' | 'aumento_inscricoes' | 'precatorio_excepcional' | 'execucao_depositos';

export interface Choque {
  id: string;
  tipo: TipoChoque;
  anoInicio: number;
  duracaoAnos: number;
  /** Fração para quedas/aumentos/execução; centavos para precatório excepcional. */
  valor: number;
}

export type IdCenario = 'conservador' | 'base' | 'favoravel';
export type BaseDeposito = 'limite' | 'plano' | 'valor_fixo' | 'pct_exigivel';
export type MomentoDeposito = 'inicio' | 'mensal' | 'meio' | 'fim';

export interface Cenario {
  id: IdCenario;
  nome: string;
  crescimentoRCL: number;
  novasInscricoesAno: Centavos;
  crescimentoInscricoes: number;
  /** Fração das novas inscrições apresentada até 1º/fev (orçamento do ano seguinte). */
  pctApresentadoAteCorte: number;
  /** Atualização dos créditos a vencer (período do § 5º: só correção). */
  taxaAVencer: number;
  /** Atualização do estoque em mora (IPCA + 2% a.a., limitado à Selic). */
  taxaMora: number;
  baseDeposito: BaseDeposito;
  valorDepositoFixo: Centavos;
  pctExigivel: number;
  execucaoDepositos: number;
  momentoDeposito: MomentoDeposito;
  /** Pagamentos acima do limite com dotação específica (§ 28). */
  extraordinariosAno: Centavos;
  /** Fração dos aportes destinada à conta de acordos diretos (§ 29). */
  pctAcordos: number;
  desagioAcordos: number;
  /** Fração do saldo em conta efetivamente paga aos credores no ano. */
  taxaDistribuicao: number;
  /** Remuneração bancária da conta especial (Provimento CNJ 207/2025, art. 10, § 2º). */
  remuneracaoConta: number;
  /** Extinções sem passagem pelas contas: §§ 11 e 21 (§ 26), cancelamentos. */
  outrasExtincoesAno: Centavos;
  choques: Choque[];
}

export type Leitura24 = 'fixa' | 'cumulativa' | 'desligada';
export type Verificacao24 = 'anual' | 'inicio_decenio';

export interface ConfigJuridicaProjeto {
  versaoRegras: string;
  leitura24: Leitura24;
  verificacao24: Verificacao24;
  /** Cenário normativo: EC 136 vigente (teto aplicado) ou teto afastado (ADI 7873). */
  aplicarTeto: boolean;
}

export interface ConfigProjecao {
  horizonteAnos: number;
  /** Tolerância relativa para o semáforo "Estável" (fração do passivo inicial). */
  toleranciaEstavel: number;
  cenarioAtivo: IdCenario;
}

/** Linha do histórico: cada coluna tem natureza declarada (saldo, movimento, fluxo). */
export interface LinhaHistorico {
  id: string;
  exercicio: number;
  rcl: Centavos | null;
  moraEm1Jan: Centavos | null;
  estoqueInicial: Centavos | null;
  novasInscricoes: Centavos | null;
  atualizacao: Centavos | null;
  depositos: Centavos | null;
  pagamentos: Centavos | null;
  baixas: Centavos | null;
  estoqueFinal: Centavos | null;
  origem: Origem;
  fonte: string;
}

export type TipoMovimento =
  | 'deposito_conta_especial'
  | 'pagamento_da_conta'
  | 'nova_inscricao'
  | 'atualizacao'
  | 'acordo_direto'
  | 'extincao_sem_caixa'
  | 'estorno';

export interface Movimento {
  id: string;
  data: string;
  tipo: TipoMovimento;
  valor: Centavos;
  conta?: 'cronologica' | 'acordos';
  /** Para acordos: valor de face extinto (o valor é o dinheiro pago). */
  valorFace?: Centavos;
  referencia?: string;
  origem: Origem;
}

export interface LivroInicial {
  estoqueForaDasContas: Centavos;
  saldoContaCronologica: Centavos;
  saldoContaAcordos: Centavos;
}

export type TipoSerie = 'nao_informado' | 'fotografia' | 'lote';

export interface SerieInterpretavel {
  tipo: TipoSerie;
  pontos: { ano: number; valor: Centavos }[];
}

export interface ResumoSnapshot {
  limiteAnoBase: Centavos | null;
  aliquotaAnoBaseBp: PontosBase | null;
  passivoInicial: Centavos | null;
  passivoFinal: Centavos | null;
  anoZeragemMora: number | null;
  trajetoria: string;
}

export interface Snapshot {
  id: string;
  criadoEm: string;
  rotulo: string;
  versaoRegras: string;
  hashEntradas: string;
  cenario: IdCenario;
  resumo: ResumoSnapshot;
  /** Projeto congelado (sem os próprios snapshots), em JSON. */
  projetoCongelado: string;
}

export interface Projeto {
  schemaVersao: 1;
  id: string;
  nome: string;
  criadoEm: string;
  atualizadoEm: string;
  ehExemplo: boolean;
  ente: Ente;
  anoBase: number;
  dados: DadosIniciais;
  observacoes: ObservacaoFonte[];
  historico: LinhaHistorico[];
  serie: SerieInterpretavel;
  livroInicial: LivroInicial;
  movimentos: Movimento[];
  cenarios: Cenario[];
  config: ConfigProjecao;
  juridico: ConfigJuridicaProjeto;
  snapshots: Snapshot[];
}
