// Tipos de domínio do sistema Credijuris.
// Espelham as tabelas da migração 0001_init.sql. Para tipagem 100% gerada
// pelo banco, opcionalmente rode: supabase gen types typescript --linked

export type UUID = string

export type PerfilUsuario = 'admin' | 'usuario'

export interface Profile {
  id: UUID
  email: string
  nome: string | null
  role: PerfilUsuario
  ativo: boolean
  created_at: string
}

// ---------- Operacional: Análise de Crédito ----------
export type RiscoAnalise = 'baixo' | 'medio' | 'alto'
export type StatusAnalise = 'pendente' | 'em_analise' | 'aprovada' | 'reprovada'

export interface AnaliseCredito {
  id: UUID
  numero_processo: string | null
  cedente: string | null
  devedor: string | null
  tribunal: string | null
  valor_face: number | null
  valor_avaliado: number | null
  risco: RiscoAnalise | null
  status: StatusAnalise
  observacoes: string | null
  responsavel_id: UUID | null
  /** Card do Kommo que originou esta análise. Nulo nas linhas antigas. */
  kommo_lead_id: number | null
  created_at: string
  updated_at: string
}

/** Uma anotação de um card do Kommo. */
export interface KommoNota {
  id: number
  texto: string
  criado_em: string | null
  /** Nulo quando a anotação veio de automação do Kommo, não de uma pessoa. */
  autor: string | null
}

/**
 * Espelho local de um card do Kommo, mantido pela Edge Function kommo-sync.
 * A chave é kommo_lead_id (bigint), não um uuid `id` — por isso esta tabela
 * não usa makeCrud, que pressupõe `id: string`.
 */
export interface KommoLead {
  kommo_lead_id: number
  pipeline_id: number
  status_id: number
  nome: string | null
  responsavel_id: number | null
  responsavel_nome: string | null
  /** PRIMEIRA anotação: os dados do crédito, em texto livre. É de onde sai o CNJ. */
  nota_texto: string | null
  /** Todas as anotações do card, da mais antiga para a mais recente. */
  notas: KommoNota[]
  processo_cnj: string | null
  tags: string[]
  criado_em: string | null
  atualizado_em: string | null
  sincronizado_em: string
}

/**
 * Registro de que a análise automática (IA) de um card ficou pronta — escrita
 * SÓ do lado servidor. A interface lê apenas a presença de kommo_lead_id (via
 * useAnalisesProntas): linha presente = "Finalizado", ausente = "Em curso".
 * A kommo-mover e o kommo-sync apagam a linha quando o card sai da análise.
 * Os demais campos espelham a tabela da migração 0014 por fidelidade ao
 * schema, ainda que a UI não os leia.
 */
export interface KommoAnaliseInterna {
  kommo_lead_id: number
  etapa_interna: 'em_revisao'
  status_id_quando_marcado: number
  marcado_por: UUID | null
  marcado_em: string
}

// ---------- Operacional: Processos ----------
export type StatusProcesso = 'ativo' | 'complementar' | 'encerrado'
export type Instrumento = 'particular' | 'registro_publico' | 'escritura_publica'
/** Um crédito pode acumular mais de um tipo — daí ser lista, não valor único. */
export type TipoCredito =
  | 'principal'
  | 'honorarios_contratuais'
  | 'honorarios_advocaticios'
export type IndiceAtualizacao = 'selic' | 'ipca_2'
/** Espécie do requisitório. Decide a pasta de topo do Drive nas petições. */
export type EspecieRequisitorio = 'rpv' | 'precatorio'

export interface Processo {
  id: UUID
  numero_cnj: string
  /**
   * Número do processo ADMINISTRATIVO do precatório no tribunal — o segundo número
   * que um precatório tem, além do judicial, e por onde ele é acompanhado na fila
   * de pagamento. Só se aplica a precatório; nulo em RPV (migração 0037).
   */
  numero_processo_administrativo: string | null
  tribunal: string | null
  comarca: string | null
  vara: string | null
  cedente: string | null
  cedente_advogado: string | null
  cessionario: string | null
  /**
   * Quem originou a aquisição. Como o cessionário, é TEXTO no crédito, e a
   * ligação com a ficha se faz pelo nome normalizado (ver lib/pessoas.ts).
   */
  originador: string | null
  entidade_devedora: string | null
  data_aquisicao: string | null
  expectativa_liquidacao: string | null
  instrumento: Instrumento | null
  numero_rtdpj: string | null
  status: StatusProcesso
  data_liquidacao: string | null
  /** RPV ou precatório. Nulo nos créditos cadastrados antes da migração 0032. */
  especie_requisitorio: EspecieRequisitorio | null
  // Financeiro — só na ficha lateral ("Aquisição e liquidação"), fora da tabela.
  tipo_credito: TipoCredito[]
  capital_investido: number | null
  valor_face: number | null
  data_referencia: string | null
  indice_atualizacao: IndiceAtualizacao | null
  ja_recebido: number | null
  valor_estimado_complementar: number | null
  advbox_lawsuit_id: string | null
  /**
   * Cache do id da pasta deste crédito no Drive. USO INTERNO — não exibir em tela:
   * é atalho para o número do processo virar link direto, não informação.
   */
  drive_pasta_id: string | null
  created_at: string
  updated_at: string
}

// ---------- Operacional: Requerimentos administrativos ----------
export interface Requerimento {
  id: UUID
  numero_protocolo: string | null
  orgao: string | null
  tribunal_entidade: string | null
  /**
   * Partes do requerimento (migração 0039). Texto livre, como cedente e cessionário
   * em `processos`: as partes de um requerimento administrativo não estão cadastradas
   * em nenhuma tabela da plataforma.
   */
  requerente: string | null
  requerido: string | null
  materia: string | null
  classe_processual: string | null
  data_protocolo: string | null
  observacoes: string | null
  /**
   * Id do registro correspondente na ADVBOX (migração 0038). Criado por
   * protocol_number, não process_number: o número é de protocolo do órgão, e a
   * ADVBOX valida process_number contra as bases dos tribunais.
   */
  advbox_lawsuit_id: string | null
  created_at: string
  updated_at: string
}

// ---------- Operacional: Apensos (incidentes/recursos do principal) ----------
export interface Apenso {
  id: UUID
  processo_id: UUID | null
  requerimento_id: UUID | null
  numero: string | null
  /**
   * Id do registro correspondente na ADVBOX (migração 0041). Apenso tem CNJ e
   * andamento próprios, então é cadastrado lá como qualquer processo — é isso que
   * faz a sincronização de movimentações encontrar o histórico dele.
   */
  advbox_lawsuit_id: string | null
  classe_processual: string | null
  tribunal: string | null
  comarca: string | null
  vara: string | null
  polo_ativo: string | null
  polo_passivo: string | null
  created_at: string
  updated_at: string
}

// ---------- Operacional: Publicações e Movimentações ----------
export type FontePublicacao = 'djen' | 'advbox' | 'manual'
export type TipoPublicacao = 'publicacao' | 'movimentacao'

export interface Publicacao {
  id: UUID
  processo_id: UUID | null
  numero_processo: string | null
  fonte: FontePublicacao
  tipo: TipoPublicacao
  tribunal: string | null
  data_publicacao: string | null
  conteudo: string | null
  lida: boolean
  tratada: boolean
  responsavel_id: UUID | null
  external_id: string | null
  created_at: string
}

// ---------- Operacional: Tarefas (ADVBOX) ----------
export type StatusTarefa =
  | 'pendente'
  | 'em_andamento'
  | 'concluida'
  | 'atrasada'
export type PrioridadeTarefa = 'baixa' | 'media' | 'alta'

export interface Tarefa {
  id: UUID
  advbox_id: string | null
  processo_id: UUID | null
  titulo: string
  descricao: string | null
  responsavel: string | null
  prazo: string | null
  status: StatusTarefa
  prioridade: PrioridadeTarefa
  sincronizado_em: string | null
  created_at: string
  updated_at: string
}

// ---------- Operacional: Contatos (por órgão) ----------
// Julgadores são puxados de Créditos/Requerimentos; auxiliares são manuais.
// Cada órgão guarda telefone, WhatsApp e e-mail da serventia e do gabinete.
export type TipoOrgaoContato = 'julgador' | 'auxiliar'

export interface ContatoServentia {
  id: UUID
  orgao: string | null
  tribunal: string | null
  tipo: TipoOrgaoContato
  serventia_telefone: string | null
  serventia_whatsapp: string | null
  serventia_email: string | null
  gabinete_telefone: string | null
  gabinete_whatsapp: string | null
  gabinete_email: string | null
  created_at: string
  updated_at: string
}

// ---------- Comercial: Investidores ----------
export type TipoPessoa = 'pf' | 'pj'
export type StatusInvestidor = 'ativo' | 'inativo'

export interface Investidor {
  id: UUID
  nome: string
  documento: string | null
  email: string | null
  telefone: string | null
  tipo: TipoPessoa
  status: StatusInvestidor
  observacoes: string | null
  created_at: string
  updated_at: string
}

// ---------- Comercial: Cessões (inventário de créditos) ----------
export type StatusCessao =
  | 'disponivel'
  | 'parcial'
  | 'captado'
  | 'liquidado'

export interface Cessao {
  id: UUID
  codigo: string
  processo_id: UUID | null
  analise_id: UUID | null
  descricao: string | null
  valor_face: number | null
  valor_aquisicao: number | null
  valor_cessao: number | null
  desagio: number | null
  data_cessao: string | null
  status: StatusCessao
  created_at: string
  updated_at: string
}

// ---------- Comercial: Investimentos (carteira) ----------
export type StatusInvestimento = 'ativo' | 'liquidado' | 'cancelado'

export interface Investimento {
  id: UUID
  investidor_id: UUID
  cessao_id: UUID | null
  valor_investido: number
  percentual: number | null
  rentabilidade_esperada: number | null
  data_investimento: string | null
  status: StatusInvestimento
  created_at: string
  updated_at: string
}

// ---------- Comercial: Contratos ----------
// 'cessao' | 'investimento' | 'outro' são do rascunho antigo ({{var}} em texto
// livre, aba "Modelos"). Os outros 5 são os tipos reais que gerar-contrato
// produz (.docx via Drive) — ver supabase/functions/gerar-contrato/index.ts.
export type TipoContrato =
  | 'cessao'
  | 'investimento'
  | 'outro'
  | 'cessao_credito'
  | 'cessao_honorarios_contratuais'
  | 'cessao_honorarios_sucumbenciais'
  | 'intermediacao'
  | 'procuracao'
export type StatusContrato = 'rascunho' | 'gerado' | 'assinado' | 'cancelado'

export interface ContratoTemplate {
  id: UUID
  nome: string
  tipo: TipoContrato
  conteudo: string
  created_at: string
  updated_at: string
}

export interface Contrato {
  id: UUID
  numero: string | null
  tipo: TipoContrato
  investidor_id: UUID | null
  cessao_id: UUID | null
  template_id: UUID | null
  dados: Record<string, string> | null
  conteudo_final: string | null
  status: StatusContrato
  arquivo_url: string | null
  /** Agrupa as linhas geradas numa mesma chamada de gerar-contrato (migração 0047). */
  job_id: UUID | null
  /** Nome do investidor vindo de investidor_dados — usado pela geração real (migração 0047). */
  investidor_nome: string | null
  /** Link da pasta "2. Contratos assinados" no Drive (migração 0047). */
  drive_folder_url: string | null
  created_at: string
  updated_at: string
}

// ---------- Configurações / Integrações ----------
export type ServicoIntegracao = 'advbox' | 'djen' | 'kommo' | 'anthropic'

export interface Integracao {
  id: UUID
  servico: ServicoIntegracao
  config: Record<string, unknown>
  ativo: boolean
  atualizado_em: string | null
  atualizado_por: UUID | null
}

export interface ConfigAdvbox {
  base_url?: string
  /**
   * Cadastro automático do processo na ADVBOX ao salvar um crédito.
   *
   * Os quatro IDs são exigidos pela API da ADVBOX e precisam existir na conta —
   * por isso são ESCOLHIDOS na tela, a partir das listas da própria conta, e não
   * digitados. Sem os quatro, ou com `ativo` falso, nada é criado.
   */
  criar_processo?: {
    ativo?: boolean
    users_id?: number | string
    stages_id?: number | string
    type_lawsuits_id?: number | string
    customers_id?: number | string
    /** Só para a tela mostrar os escolhidos sem consultar a ADVBOX de novo. */
    customer_nome?: string
    user_nome?: string
  }
}

export interface ConfigDjen {
  oabs?: string[]
  numeros_processo?: string[]
  tribunais?: string[]
  dias_retroativos?: number
}

/**
 * Anthropic: só o indicador de que a chave está gravada. A chave em si vive na
 * tabela integracao_anthropic_secret, inacessível ao cliente.
 */
export interface ConfigAnthropic {
  configurado?: boolean
}

export interface ConfigKommo {
  /** Subdomínio da conta (a API resolve a conta pelo host, não pelo token). */
  subdominio?: string
  configurado?: boolean
  /** Última gravação conseguiu falar com a API do Kommo. */
  validado?: boolean
}
