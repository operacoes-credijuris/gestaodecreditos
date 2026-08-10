import { useQuery } from '@tanstack/react-query'
import { makeCrud } from './crud'
import { supabase } from './supabase'
import { onlyDigits } from './format'
import type {
  AnaliseCredito,
  Apenso,
  Cessao,
  ContatoServentia,
  Contrato,
  ContratoTemplate,
  Investidor,
  Investimento,
  Processo,
  Requerimento,
} from './types'

/**
 * Data da última movimentação por processo, vinda do cache que a Edge Function
 * advbox-movimentacoes mantém (sincronizado pelo cron de 2h e ao abrir a aba
 * Movimentações). Casa por DÍGITOS porque o número que o ADVBOX devolve tem
 * formatação própria, diferente do numero_cnj cadastrado aqui.
 *
 * Falha em silêncio (mapa vazio): a coluna mostra "—" e o resto da tela segue
 * funcionando — nenhuma tela depende do ADVBOX estar de pé.
 *
 * Compartilhado entre a tabela de Créditos e a carteira do investidor: as duas
 * mostram a mesma data e devem concordar sempre.
 */
export interface CarteiraResumo {
  processo_id: string
  estagio_processual: string | null
  providencias: string | null
  erro: string | null
  gerado_em: string
}

/**
 * Estágio processual e providências por crédito, escritos pela Edge Function
 * carteira-resumo (Claude) a partir das movimentações e tarefas do ADVBOX.
 * Indexado por processo_id — a carteira lê direto pelo id da linha.
 */
export function useCarteiraResumos(poll = false) {
  return useQuery({
    queryKey: ['carteira_resumos', 'mapa'],
    queryFn: async () => {
      const { data } = await supabase
        .from('carteira_resumos')
        .select('processo_id, estagio_processual, providencias, erro, gerado_em')
      const m = new Map<string, CarteiraResumo>()
      for (const r of (data ?? []) as CarteiraResumo[]) m.set(r.processo_id, r)
      return m
    },
    // A varredura roda em lotes auto-encadeados no servidor: a resposta da
    // primeira chamada volta antes do fim. Com `poll`, a tela acompanha os
    // textos chegando em vez de exigir recarregar a página.
    staleTime: poll ? 0 : 60 * 1000,
    refetchInterval: poll ? 5000 : false,
  })
}

export function useUltimaMovimentacao() {
  return useQuery({
    queryKey: ['advbox_processo_status', 'mapa'],
    queryFn: async () => {
      const { data } = await supabase
        .from('advbox_processo_status')
        .select('numero_processo, ultima_movimentacao')
      const m = new Map<string, string>()
      for (const r of (data ?? []) as {
        numero_processo: string | null
        ultima_movimentacao: string | null
      }[]) {
        const d = onlyDigits(r.numero_processo)
        if (d.length >= 6 && r.ultima_movimentacao) m.set(d, r.ultima_movimentacao)
      }
      return m
    },
    staleTime: 5 * 60 * 1000,
  })
}

export const analisesCrud = makeCrud<AnaliseCredito, Partial<AnaliseCredito>>(
  'analises_credito',
)

export const processosCrud = makeCrud<Processo, Partial<Processo>>('processos')

export const requerimentosCrud = makeCrud<Requerimento, Partial<Requerimento>>(
  'requerimentos',
)

export const apensosCrud = makeCrud<Apenso, Partial<Apenso>>('apensos', {
  orderBy: 'created_at',
  ascending: true,
})

export const contatosCrud = makeCrud<ContatoServentia, Partial<ContatoServentia>>(
  'contatos_serventias',
  { orderBy: 'orgao', ascending: true },
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
