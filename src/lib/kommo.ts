// Mapeamento entre as colunas do kanban do Kommo e as telas da Análise de
// Crédito, mais as consultas ao espelho local (public.kommo_leads).
//
// A UI nunca fala com a API do Kommo: ela não devolve headers de CORS e o token
// tem direitos de administrador. Quem busca é a Edge Function kommo-sync.
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { KommoLead, KommoAnaliseInterna } from './types'

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
  | 'revisao'
  | 'decisao'
  | 'aprovados'
  | 'diligencia'
  | 'reprovados'

export interface DefTela {
  key: TelaAnalise
  label: string
  /** Colunas do Kommo que alimentam a tela. */
  status: number[]
  /**
   * Pendentes e Revisão saem da MESMA coluna do Kommo (Análise
   * Jurídica-Econômico) e se distinguem pela marcação interna: sem marcação é
   * pendente, com marcação está aguardando revisão. Nas outras telas a coluna
   * do Kommo já basta, e a marcação é irrelevante.
   */
  exigeMarcacao?: boolean
  descricaoVazia: string
}

export const TELAS: DefTela[] = [
  {
    key: 'pendentes',
    label: 'Pendentes',
    status: [ST_ANALISE],
    exigeMarcacao: false,
    descricaoVazia:
      'Nenhum card aguardando análise. Quando o comercial mover um crédito para "Análise Jurídica-Econômico" no Kommo, ele aparece aqui.',
  },
  {
    key: 'revisao',
    label: 'Revisão',
    status: [ST_ANALISE],
    exigeMarcacao: true,
    descricaoVazia:
      'Nenhuma análise aguardando revisão. Os cards chegam aqui quando a análise automática é produzida — ainda não implementada.',
  },
  {
    key: 'decisao',
    label: 'Decisão',
    status: [ST_DECISAO],
    descricaoVazia: 'Nenhum crédito em "Revisão e Decisão do Pedro" no Kommo.',
  },
  {
    key: 'aprovados',
    label: 'Aprovados',
    status: [ST_PROPOSTA],
    descricaoVazia: 'Nenhum crédito em "Apresentação de Proposta" no Kommo.',
  },
  {
    key: 'diligencia',
    label: 'Diligência',
    status: [ST_DILIGENCIA],
    descricaoVazia: 'Nenhum crédito em "Diligência" no Kommo.',
  },
  {
    key: 'reprovados',
    label: 'Reprovados',
    status: [ST_REPROVADO],
    descricaoVazia: 'Nenhum crédito em "Reprovados Operacional" no Kommo.',
  },
]

/** Nome da coluna do Kommo, para exibir a origem do card. */
export const NOME_STATUS: Record<number, string> = {
  [ST_ANALISE]: 'Análise Jurídica-Econômico',
  [ST_DECISAO]: 'Revisão e Decisão do Pedro',
  [ST_DILIGENCIA]: 'Diligência',
  [ST_PROPOSTA]: 'Apresentação de Proposta',
  [ST_REPROVADO]: 'Reprovados Operacional',
}

/**
 * Destinos oferecidos ao mover um card. A ordem segue o fluxo do operacional.
 * Precisa espelhar o COLUNAS da Edge Function kommo-mover, que rejeita destino
 * desconhecido — a validação de verdade é lá, isto é só a lista da interface.
 */
export const DESTINOS: { statusId: number; label: string }[] = [
  { statusId: ST_ANALISE, label: 'Análise Jurídica-Econômico' },
  { statusId: ST_DECISAO, label: 'Revisão e Decisão do Pedro' },
  { statusId: ST_DILIGENCIA, label: 'Diligência' },
  { statusId: ST_PROPOSTA, label: 'Apresentação de Proposta' },
  { statusId: ST_REPROVADO, label: 'Reprovados Operacional' },
]

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

/** Marcações internas (quais cards já tiveram a análise concluída). */
export function useMarcacoes() {
  return useQuery({
    queryKey: ['kommo_analise_interna'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('kommo_analise_interna')
        .select('*')
      if (error) throw new Error(error.message)
      return (data ?? []) as KommoAnaliseInterna[]
    },
  })
}

// A marcação em kommo_analise_interna é escrita pelo processo de análise
// automática (IA), do lado servidor, e apagada pela kommo-mover quando o card
// troca de coluna. A interface só LÊ: não existe caminho manual para marcar ou
// desmarcar, de propósito — se a análise da IA sair errada, o revisor corrige e
// segue para Decisão, sem devolver o card para a fila.

/**
 * Uma marcação só vale enquanto o card estiver na coluna em que foi marcado.
 * Se alguém o moveu direto no Kommo, a marcação é ignorada — é o que evita a
 * tela de Revisão mostrar card que já seguiu adiante.
 */
export function marcacaoValida(
  lead: KommoLead,
  marcacao: KommoAnaliseInterna | undefined,
): boolean {
  return !!marcacao && marcacao.status_id_quando_marcado === lead.status_id
}

/** Separa os cards de um funil nas telas definidas em TELAS. */
export function agruparPorTela(
  leads: KommoLead[],
  marcacoes: KommoAnaliseInterna[],
): Record<TelaAnalise, KommoLead[]> {
  const porLead = new Map(marcacoes.map((m) => [m.kommo_lead_id, m]))
  const out = {
    pendentes: [],
    revisao: [],
    decisao: [],
    aprovados: [],
    diligencia: [],
    reprovados: [],
  } as Record<TelaAnalise, KommoLead[]>

  for (const tela of TELAS) {
    for (const l of leads) {
      if (!tela.status.includes(l.status_id)) continue
      if (tela.exigeMarcacao !== undefined) {
        const temMarcacao = marcacaoValida(l, porLead.get(l.kommo_lead_id))
        if (temMarcacao !== tela.exigeMarcacao) continue
      }
      out[tela.key].push(l)
    }
  }
  return out
}
