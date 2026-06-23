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
  created_at: string
  updated_at: string
}

// ---------- Operacional: Processos ----------
export type StatusProcesso = 'ativo' | 'complementar' | 'encerrado'
export type Instrumento = 'particular' | 'registro_publico' | 'escritura_publica'

export interface Processo {
  id: UUID
  numero_cnj: string
  tribunal: string | null
  comarca: string | null
  vara: string | null
  cedente: string | null
  cedente_advogado: string | null
  cessionario: string | null
  entidade_devedora: string | null
  data_aquisicao: string | null
  expectativa_liquidacao: string | null
  instrumento: Instrumento | null
  numero_rtdpj: string | null
  status: StatusProcesso
  data_liquidacao: string | null
  advbox_lawsuit_id: string | null
  created_at: string
  updated_at: string
}

// ---------- Operacional: Requerimentos administrativos ----------
export type StatusRequerimento =
  | 'pendente'
  | 'protocolado'
  | 'em_analise'
  | 'deferido'
  | 'indeferido'

export interface Requerimento {
  id: UUID
  assunto: string
  orgao: string | null
  numero_protocolo: string | null
  data_protocolo: string | null
  status: StatusRequerimento
  observacoes: string | null
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

// ---------- Operacional: Contatos de Serventias e Gabinetes ----------
export type TipoContato =
  | 'serventia'
  | 'gabinete'
  | 'cartorio'
  | 'vara'
  | 'outro'

export interface ContatoServentia {
  id: UUID
  tipo: TipoContato
  nome: string
  tribunal: string | null
  comarca: string | null
  telefone: string | null
  email: string | null
  horario_atendimento: string | null
  observacoes: string | null
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
export type TipoContrato = 'cessao' | 'investimento' | 'outro'
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
  created_at: string
  updated_at: string
}

// ---------- Configurações / Integrações ----------
export type ServicoIntegracao = 'advbox' | 'djen'

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
}

export interface ConfigDjen {
  oabs?: string[]
  numeros_processo?: string[]
  tribunais?: string[]
  dias_retroativos?: number
}
