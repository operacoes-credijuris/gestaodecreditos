import { makeCrud } from './crud'
import type {
  AnaliseCredito,
  Cessao,
  ContatoServentia,
  Contrato,
  ContratoTemplate,
  Investidor,
  Investimento,
  Processo,
  Publicacao,
  Tarefa,
} from './types'

export const analisesCrud = makeCrud<AnaliseCredito, Partial<AnaliseCredito>>(
  'analises_credito',
)

export const processosCrud = makeCrud<Processo, Partial<Processo>>('processos')

export const publicacoesCrud = makeCrud<Publicacao, Partial<Publicacao>>(
  'publicacoes',
  { orderBy: 'data_publicacao' },
)

export const tarefasCrud = makeCrud<Tarefa, Partial<Tarefa>>('tarefas', {
  orderBy: 'prazo',
  ascending: true,
})

export const contatosCrud = makeCrud<ContatoServentia, Partial<ContatoServentia>>(
  'contatos_serventias',
  { orderBy: 'nome', ascending: true },
)

export const investidoresCrud = makeCrud<Investidor, Partial<Investidor>>(
  'investidores',
  { orderBy: 'nome', ascending: true },
)

export const cessoesCrud = makeCrud<Cessao, Partial<Cessao>>('cessoes')

export const investimentosCrud = makeCrud<Investimento, Partial<Investimento>>(
  'investimentos',
)

export const templatesCrud = makeCrud<ContratoTemplate, Partial<ContratoTemplate>>(
  'contrato_templates',
  { orderBy: 'nome', ascending: true },
)

export const contratosCrud = makeCrud<Contrato, Partial<Contrato>>('contratos')
