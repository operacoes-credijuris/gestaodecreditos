/**
 * Configuração jurídica versionada (camada 2 da especificação).
 *
 * Regra de ouro: nenhuma norma fica embutida nos motores. Os motores leem
 * limiares, alíquotas, datas e leituras daqui. Cada regra tem fonte,
 * vigência, data de revisão, responsável e status. Alterar uma regra exige
 * nova versão; os snapshots guardam a versão usada (T20).
 */
import type { Leitura24, PontosBase, Verificacao24 } from '../dominio/tipos';

export type StatusRegra = 'vigente' | 'vigente_sob_controle' | 'pendente_revisao' | 'informativa';

export interface RegraBase {
  id: string;
  titulo: string;
  dispositivo: string;
  fonte: string;
  urlFonte?: string;
  vigenciaInicio: string;
  status: StatusRegra;
  nota?: string;
}

export interface RegraFaixas extends RegraBase {
  /** Limiares superiores (inclusivos) da razão mora/RCL, em pontos-base. */
  limiaresBp: PontosBase[];
  /** Alíquotas sobre a RCL do exercício anterior, em pontos-base (uma a mais que os limiares). */
  aliquotasBp: PontosBase[];
  natureza: 'teto';
}

export interface RegraAdicional extends RegraBase {
  anoInicio: number;
  periodoAnos: number;
  acrescimoBp: PontosBase;
  leituras: Record<Leitura24, string>;
  verificacoes: Record<Verificacao24, string>;
  leituraPadrao: Leitura24;
  verificacaoPadrao: Verificacao24;
}

export interface RegraDataCorte extends RegraBase {
  dia: number;
  mes: number;
}

export interface RegrasJuridicas {
  versao: string;
  dataRevisao: string;
  responsavelRevisao: string;
  aprovacao: 'pendente' | 'aprovada';
  faixas: RegraFaixas;
  adicionalDecenal: RegraAdicional;
  dataCorte: RegraDataCorte;
  complementares: RegraBase[];
  controleConcentrado: RegraBase & { acao: string; autor: string; relator: string; situacao: string; consultadoEm: string };
}

const URL_EC136 = 'https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc136.htm';
const URL_PROV207 = 'https://atos.cnj.jus.br/atos/detalhar/6404';

export const REGRAS_V1: RegrasJuridicas = {
  versao: '1.0.0',
  dataRevisao: '2026-10-14',
  responsavelRevisao: 'Pendente — aprovação do Head Jurídico',
  aprovacao: 'pendente',
  faixas: {
    id: 'cf-100-23',
    titulo: 'Limite anual de pagamento por faixas',
    dispositivo: 'CF, art. 100, § 23 (EC 136/2025)',
    fonte: 'Emenda Constitucional 136, de 9/9/2025 (DOU 10/9/2025)',
    urlFonte: URL_EC136,
    vigenciaInicio: '2025-09-10',
    status: 'vigente_sob_controle',
    natureza: 'teto',
    limiaresBp: [1500, 2500, 3500, 4500, 5500, 6500, 7500, 8500],
    aliquotasBp: [100, 150, 200, 250, 300, 350, 400, 450, 500],
    nota:
      'Os pagamentos de precatórios dos Estados, DF e Municípios "estão limitados" a percentuais da RCL do exercício anterior, ' +
      'conforme o estoque em mora (atualizado e com juros) apurado em 1º de janeiro. É teto, não pagamento esperado. ' +
      'Aplica-se também ao regime especial (ADCT, art. 101, § 6º) e aos precatórios já inscritos (EC 136, art. 8º).',
  },
  adicionalDecenal: {
    id: 'cf-100-24',
    titulo: 'Acréscimo decenal de 0,5 ponto percentual',
    dispositivo: 'CF, art. 100, § 24 (EC 136/2025)',
    fonte: 'Emenda Constitucional 136/2025',
    urlFonte: URL_EC136,
    vigenciaInicio: '2036-01-01',
    status: 'pendente_revisao',
    anoInicio: 2036,
    periodoAnos: 10,
    acrescimoBp: 50,
    leituraPadrao: 'fixa',
    verificacaoPadrao: 'anual',
    leituras: {
      fixa: '+0,5 p.p. a partir de 2036, sem novos acréscimos nos decênios seguintes.',
      cumulativa: '+0,5 p.p. em 2036, +1,0 p.p. em 2046 e assim por diante.',
      desligada: 'Nenhum acréscimo até a aprovação de uma interpretação pelo jurídico.',
    },
    verificacoes: {
      anual: 'Exige estoque em mora em 1º/jan de cada exercício.',
      inicio_decenio: 'Verifica o estoque em mora só em 1º/jan do início do decênio (2036, 2046…) e mantém o resultado no decênio.',
    },
    nota:
      'O texto prevê o acréscimo "a partir de 1º de janeiro de 2036 e em cada decênio subsequente", "caso seja verificada a existência ' +
      'de estoque de precatórios em mora". Não diz se o acréscimo se acumula nem quando a mora é verificada. Interpretação não pacificada.',
  },
  dataCorte: {
    id: 'cf-100-5',
    titulo: 'Data de apresentação para o orçamento seguinte',
    dispositivo: 'CF, art. 100, § 5º (EC 136/2025)',
    fonte: 'Emenda Constitucional 136/2025',
    urlFonte: URL_EC136,
    vigenciaInicio: '2025-09-10',
    status: 'vigente_sob_controle',
    dia: 1,
    mes: 2,
    nota:
      'Precatórios apresentados até 1º de fevereiro entram no orçamento do exercício seguinte e devem ser pagos até o fim dele. ' +
      'Não pagos, entram em mora em 1º de janeiro do exercício posterior. TCE-PR (Acórdão 730/26): o corte de 1º/2/2026 vale para a LOA 2027.',
  },
  complementares: [
    {
      id: 'cf-100-25', titulo: 'Medidas efetivas de redução do estoque', dispositivo: 'CF, art. 100, § 25',
      fonte: 'EC 136/2025; Provimento CNJ 207/2025, art. 6º', urlFonte: URL_PROV207, vigenciaInicio: '2025-09-10', status: 'vigente',
      nota: 'Contam para o plano anual mediante requerimento com comprovação e aceite da autoridade competente. Lançamento da equipe não basta.',
    },
    {
      id: 'cf-100-26', titulo: 'Pagamentos fora do limite', dispositivo: 'CF, art. 100, § 26',
      fonte: 'EC 136/2025', urlFonte: URL_EC136, vigenciaInicio: '2025-09-10', status: 'vigente',
      nota: 'Pagamentos nas modalidades dos §§ 11 e 21 não compõem o limite do § 23. No modelo: "outras extinções", fora das contas especiais.',
    },
    {
      id: 'cf-100-27', titulo: 'Atraso na liberação dos recursos', dispositivo: 'CF, art. 100, § 27',
      fonte: 'EC 136/2025; Provimento CNJ 207/2025, art. 9º, § 2º', urlFonte: URL_EC136, vigenciaInicio: '2025-09-10', status: 'vigente',
      nota: 'Suspende os limites e permite sequestro, responsabilização do gestor e vedação de transferências voluntárias. Registrar fatos e decisões; não supor sequestro automático.',
    },
    {
      id: 'cf-100-28', titulo: 'Pagamentos acima do limite', dispositivo: 'CF, art. 100, § 28',
      fonte: 'EC 136/2025', urlFonte: URL_EC136, vigenciaInicio: '2025-09-10', status: 'vigente',
      nota: 'Permitidos com dotação orçamentária específica. No modelo: campo "extraordinários".',
    },
    {
      id: 'cf-100-29', titulo: 'Acordos diretos', dispositivo: 'CF, art. 100, § 29; Provimento CNJ 207/2025, art. 8º',
      fonte: 'EC 136/2025; Provimento CNJ 207/2025', urlFonte: URL_PROV207, vigenciaInicio: '2025-09-10', status: 'vigente',
      nota: 'Opção do credor, em juízo de conciliação, parcela única, com renúncia. O Provimento 207 afastou o limite máximo de renúncia. O deságio não é dispêndio do plano.',
    },
    {
      id: 'cf-100-30', titulo: 'Valores aportados saem do estoque', dispositivo: 'CF, art. 100, § 30; Provimento CNJ 207/2025, arts. 10 e 11',
      fonte: 'EC 136/2025; Provimento CNJ 207/2025', urlFonte: URL_PROV207, vigenciaInicio: '2025-09-10', status: 'vigente',
      nota: 'Aporte efetivo sai do estoque (até 5 dias úteis após a certificação) e deixa de receber juros e correção; entre depósito e alvará, só remuneração bancária. Depósito não é pagamento ao credor.',
    },
    {
      id: 'adct-97-16', titulo: 'Atualização dos requisitórios subnacionais', dispositivo: 'ADCT, art. 97, §§ 16 e 16-A; Provimento CNJ 207/2025, art. 3º',
      fonte: 'EC 136/2025; Provimento CNJ 207/2025', urlFonte: URL_PROV207, vigenciaInicio: '2025-08-01', status: 'vigente',
      nota: 'Desde 1º/8/2025: IPCA + juros simples de 2% a.a., substituídos pela Selic quando esta for menor que o resultado. No período do § 5º, só correção, sem juros. No modelo: duas taxas de cenário, sem valor homologável.',
    },
    {
      id: 'prov207-4', titulo: 'Precatórios tributários', dispositivo: 'Provimento CNJ 207/2025, art. 4º',
      fonte: 'Provimento CNJ 207/2025', urlFonte: URL_PROV207, vigenciaInicio: '2025-10-30', status: 'informativa',
      nota: 'Atualização exclusivamente pela Selic. A Fase 1 não separa a natureza tributária; tratar na Fase 2.',
    },
    {
      id: 'ec136-7', titulo: 'Fim do prazo de quitação do art. 101 do ADCT', dispositivo: 'EC 136/2025, art. 7º',
      fonte: 'EC 136/2025', urlFonte: URL_EC136, vigenciaInicio: '2025-09-10', status: 'vigente',
      nota: 'O prazo de quitação do regime especial deixou de ser aplicável desde a promulgação. Séries históricas anteriores refletem outra regra.',
    },
  ],
  controleConcentrado: {
    id: 'adi-7873',
    titulo: 'Controle de constitucionalidade da EC 136/2025',
    dispositivo: 'ADI 7873 (STF)',
    fonte: 'Acompanhamento processual do STF; PRECAPP (atualizado em 18/08/2026)',
    urlFonte: 'https://portal.stf.jus.br/',
    vigenciaInicio: '2025-09-10',
    status: 'informativa',
    acao: 'ADI 7873',
    autor: 'Conselho Federal da OAB',
    relator: 'Min. Luiz Fux',
    situacao: 'Rito do art. 12 da Lei 9.868/99; sem liminar; parecer da PGR pela procedência parcial (25/06/2026); sem julgamento até a última consulta.',
    consultadoEm: '2026-10-14',
    nota: 'Questiona o teto anual, a nova data de corte e os critérios de atualização. Uma decisão pode afastar o § 23: use o cenário normativo "teto afastado" para medir o efeito.',
  },
};

export const REGRAS_DISPONIVEIS: Record<string, RegrasJuridicas> = { [REGRAS_V1.versao]: REGRAS_V1 };

export function obterRegras(versao: string): RegrasJuridicas {
  return REGRAS_DISPONIVEIS[versao] ?? REGRAS_V1;
}
