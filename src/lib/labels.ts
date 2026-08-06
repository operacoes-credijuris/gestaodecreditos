// Rótulos e cores de badges por status. Centraliza a apresentação.
//
// Convenção semântica de cores:
//   verde (green)     = concluído / positivo
//   azul (blue)       = em andamento
//   âmbar (yellow)    = atenção
//   vermelho (red)    = bloqueio / crítico
//   cinza (gray)      = neutro / encerrado
//   roxo (purple)     = categoria especial
// Mapas categóricos (tipos, fontes) usam cores apenas para distinguir.

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

export const STATUS_PROCESSO: Record<string, LabelDef> = {
  ativo: { label: 'Ativo', tone: 'green' },
  complementar: { label: 'Complementar', tone: 'yellow' },
  encerrado: { label: 'Encerrado', tone: 'gray' },
}

// Tipos que um crédito pode acumular (marcáveis em conjunto).
export const TIPO_CREDITO: Record<string, LabelDef> = {
  principal: { label: 'Crédito principal', tone: 'blue' },
  honorarios_contratuais: { label: 'Honorários contratuais', tone: 'purple' },
  honorarios_advocaticios: { label: 'Honorários advocatícios', tone: 'orange' },
}

export const INDICE_ATUALIZACAO: Record<string, LabelDef> = {
  selic: { label: 'SELIC', tone: 'blue' },
  ipca_2: { label: 'IPCA + 2% a.a.', tone: 'purple' },
}

export const INSTRUMENTO: Record<string, LabelDef> = {
  particular: { label: 'Particular', tone: 'gray' },
  registro_publico: { label: 'Registro público', tone: 'blue' },
  escritura_publica: { label: 'Escritura pública', tone: 'purple' },
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
  liquidado: { label: 'Liquidado', tone: 'gray' },
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
