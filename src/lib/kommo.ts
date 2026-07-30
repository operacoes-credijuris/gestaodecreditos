// Mapeamento entre as colunas do kanban do Kommo e as telas da Análise de
// Crédito, mais as consultas ao espelho local (public.kommo_leads).
//
// A UI nunca fala com a API do Kommo: ela não devolve headers de CORS e o token
// tem direitos de administrador. Quem busca é a Edge Function kommo-sync; quem
// escreve é a kommo-mover.
//
// Fluxo do operacional:
//   Pendentes  a IA analisa o card, que fica aqui até a equipe de revisão
//              considerar a análise boa
//        ↓     "Enviar para decisão"
//   Decisão    três saídas
//        ↓
//   Aprovados | Diligência | Reprovados
//
// Toda tela corresponde a exatamente uma coluna do Kommo. Não há estado que
// exista só na nossa base — o kanban é a fonte de verdade.
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { KommoLead } from './types'

// Funis que o operacional usa, na conta contatocredijuriscom.
export const FUNIL_RPV = 13901939
export const FUNIL_PRECATORIO = 13971995

/** Estágios do Funil Geral RPV que interessam ao operacional. */
export const ST_ANALISE = 107272803 // Análise Jurídica-Econômico
export const ST_DECISAO = 107272807 // Revisão e Decisão do Pedro
export const ST_DILIGENCIA = 107830027 // Diligência
export const ST_PROPOSTA = 107830035 // Apresentação de Proposta
export const ST_REPROVADO = 107830031 // Reprovados Operacional

export type TelaAnalise =
  | 'pendentes'
  | 'decisao'
  | 'aprovados'
  | 'diligencia'
  | 'reprovados'

/**
 * Etapa exibida ao usuário, por coluna do Kommo. Usa o vocabulário DA
 * PLATAFORMA, não o do Kommo: quem opera aqui não precisa saber que "Aprovados"
 * é "Apresentação de Proposta" no CRM do comercial.
 *
 * A anotação gravada no card do Kommo usa o nome de lá, de propósito — quem a
 * lê é o comercial, dentro do Kommo.
 */
export const NOME_STATUS: Record<number, string> = {
  [ST_ANALISE]: 'Pendentes',
  [ST_DECISAO]: 'Decisão',
  [ST_DILIGENCIA]: 'Diligência',
  [ST_PROPOSTA]: 'Aprovados',
  [ST_REPROVADO]: 'Reprovados',
}

export interface DefTela {
  key: TelaAnalise
  label: string
  statusId: number
  descricaoVazia: string
}

export const TELAS: DefTela[] = [
  {
    key: 'pendentes',
    label: 'Pendentes',
    statusId: ST_ANALISE,
    descricaoVazia:
      'Nenhum card aguardando revisão. Quando o comercial mover um crédito para análise no Kommo, ele aparece aqui.',
  },
  {
    key: 'decisao',
    label: 'Decisão',
    statusId: ST_DECISAO,
    descricaoVazia: 'Nenhum crédito aguardando decisão.',
  },
  {
    key: 'aprovados',
    label: 'Aprovados',
    statusId: ST_PROPOSTA,
    descricaoVazia: 'Nenhum crédito aprovado nesta etapa.',
  },
  {
    key: 'diligencia',
    label: 'Diligência',
    statusId: ST_DILIGENCIA,
    descricaoVazia: 'Nenhum crédito em diligência.',
  },
  {
    key: 'reprovados',
    label: 'Reprovados',
    statusId: ST_REPROVADO,
    descricaoVazia: 'Nenhum crédito reprovado.',
  },
]

export interface AcaoTela {
  statusId: number
  label: string
  variant: 'primary' | 'outline' | 'danger'
}

/**
 * Botões de ação por tela: em vez de um "Mover" genérico que obriga a escolher
 * o destino numa lista, cada etapa oferece direto as saídas que fazem sentido
 * nela. As telas terminais ficam sem ação — de Aprovados e Reprovados o card não
 * volta pelo app, e de Diligência a saída depende do resultado da diligência,
 * que ainda não foi definido.
 */
export const ACOES: Record<TelaAnalise, AcaoTela[]> = {
  pendentes: [
    { statusId: ST_DECISAO, label: 'Enviar para decisão', variant: 'primary' },
  ],
  decisao: [
    { statusId: ST_PROPOSTA, label: 'Aprovar', variant: 'primary' },
    { statusId: ST_DILIGENCIA, label: 'Diligência', variant: 'outline' },
    { statusId: ST_REPROVADO, label: 'Reprovar', variant: 'danger' },
  ],
  aprovados: [],
  diligencia: [],
  reprovados: [],
}

/** Reprovar exige justificativa. Espelha o EXIGE_MOTIVO da Edge Function. */
export function exigeMotivo(statusId: number): boolean {
  return statusId === ST_REPROVADO
}

// ---------- Consultas ----------

/** Cards do funil informado (espelho local). */
export function useKommoLeads(pipelineId: number) {
  return useQuery({
    queryKey: ['kommo_leads', pipelineId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kommo_leads')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('atualizado_em', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as KommoLead[]
    },
  })
}

/** Separa os cards de um funil nas telas definidas em TELAS. */
export function agruparPorTela(
  leads: KommoLead[],
): Record<TelaAnalise, KommoLead[]> {
  const out = {
    pendentes: [],
    decisao: [],
    aprovados: [],
    diligencia: [],
    reprovados: [],
  } as Record<TelaAnalise, KommoLead[]>

  for (const tela of TELAS) {
    for (const l of leads) {
      if (l.status_id === tela.statusId) out[tela.key].push(l)
    }
  }
  return out
}
