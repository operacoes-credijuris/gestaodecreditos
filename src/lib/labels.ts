// Rótulos e cores de badges por status. Centraliza a apresentação.

type BadgeTone =
  | 'gray'
  | 'green'
  | 'red'
  | 'yellow'
  | 'blue'
  | 'purple'
  | 'orange'

interface LabelDef {
  label: string
  tone: BadgeTone
}

export const STATUS_ANALISE: Record<string, LabelDef> = {
  pendente: { label: 'Pendente', tone: 'gray' },
  em_analise: { label: 'Em análise', tone: 'blue' },
  aprovada: { label: 'Aprovada', tone: 'green' },
  reprovada: { label: 'Reprovada', tone: 'red' },
}

export const RISCO_ANALISE: Record<string, LabelDef> = {
  baixo: { label: 'Baixo', tone: 'green' },
  medio: { label: 'Médio', tone: 'yellow' },
  alto: { label: 'Alto', tone: 'red' },
}

export const STATUS_PROCESSO: Record<string, LabelDef> = {
  ativo: { label: 'Ativo', tone: 'green' },
  complementar: { label: 'Complementar', tone: 'yellow' },
  encerrado: { label: 'Encerrado', tone: 'gray' },
}

export const INSTRUMENTO: Record<string, LabelDef> = {
  particular: { label: 'Particular', tone: 'gray' },
  registro_publico: { label: 'Registro público', tone: 'blue' },
  escritura_publica: { label: 'Escritura pública', tone: 'purple' },
}

export const STATUS_REQUERIMENTO: Record<string, LabelDef> = {
  pendente: { label: 'Pendente', tone: 'gray' },
  protocolado: { label: 'Protocolado', tone: 'blue' },
  em_analise: { label: 'Em análise', tone: 'yellow' },
  deferido: { label: 'Deferido', tone: 'green' },
  indeferido: { label: 'Indeferido', tone: 'red' },
}

export const TIPO_PUBLICACAO: Record<string, LabelDef> = {
  publicacao: { label: 'Publicação', tone: 'blue' },
  movimentacao: { label: 'Movimentação', tone: 'purple' },
}

export const FONTE_PUBLICACAO: Record<string, LabelDef> = {
  djen: { label: 'DJEN', tone: 'blue' },
  advbox: { label: 'ADVBOX', tone: 'orange' },
  manual: { label: 'Manual', tone: 'gray' },
}

export const STATUS_TAREFA: Record<string, LabelDef> = {
  pendente: { label: 'Pendente', tone: 'gray' },
  em_andamento: { label: 'Em andamento', tone: 'blue' },
  concluida: { label: 'Concluída', tone: 'green' },
  atrasada: { label: 'Atrasada', tone: 'red' },
}

export const PRIORIDADE_TAREFA: Record<string, LabelDef> = {
  baixa: { label: 'Baixa', tone: 'gray' },
  media: { label: 'Média', tone: 'yellow' },
  alta: { label: 'Alta', tone: 'red' },
}

export const TIPO_CONTATO: Record<string, LabelDef> = {
  serventia: { label: 'Serventia', tone: 'blue' },
  gabinete: { label: 'Gabinete', tone: 'purple' },
  cartorio: { label: 'Cartório', tone: 'orange' },
  vara: { label: 'Vara', tone: 'green' },
  outro: { label: 'Outro', tone: 'gray' },
}

export const STATUS_INVESTIDOR: Record<string, LabelDef> = {
  ativo: { label: 'Ativo', tone: 'green' },
  inativo: { label: 'Inativo', tone: 'gray' },
}

export const TIPO_PESSOA: Record<string, LabelDef> = {
  pf: { label: 'Pessoa Física', tone: 'blue' },
  pj: { label: 'Pessoa Jurídica', tone: 'purple' },
}

export const STATUS_CESSAO: Record<string, LabelDef> = {
  disponivel: { label: 'Disponível', tone: 'green' },
  parcial: { label: 'Captação parcial', tone: 'yellow' },
  captado: { label: 'Captado', tone: 'blue' },
  liquidado: { label: 'Liquidado', tone: 'gray' },
}

export const STATUS_INVESTIMENTO: Record<string, LabelDef> = {
  ativo: { label: 'Ativo', tone: 'green' },
  liquidado: { label: 'Liquidado', tone: 'blue' },
  cancelado: { label: 'Cancelado', tone: 'red' },
}

export const TIPO_CONTRATO: Record<string, LabelDef> = {
  cessao: { label: 'Cessão', tone: 'blue' },
  investimento: { label: 'Investimento', tone: 'purple' },
  outro: { label: 'Outro', tone: 'gray' },
}

export const STATUS_CONTRATO: Record<string, LabelDef> = {
  rascunho: { label: 'Rascunho', tone: 'gray' },
  gerado: { label: 'Gerado', tone: 'blue' },
  assinado: { label: 'Assinado', tone: 'green' },
  cancelado: { label: 'Cancelado', tone: 'red' },
}

export function getLabel(
  map: Record<string, LabelDef>,
  key: string | null | undefined,
): LabelDef {
  if (!key) return { label: '—', tone: 'gray' }
  return map[key] ?? { label: key, tone: 'gray' }
}
