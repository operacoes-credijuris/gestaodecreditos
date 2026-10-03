import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { hojeISO } from '@/lib/format'
import {
  DIAS_DA_JANELA_DAS_PUBLICACOES,
  INTERVALO_DOS_CONTADORES,
  isoDiasAtras,
  type Contador,
} from '@/lib/contadoresDoMenu'

/**
 * As duas contagens do menu: publicações novas e tarefas vencidas.
 *
 * CONTAGEM LEVE (`head: true`): o banco devolve só o número, nenhuma linha. A
 * cada 5 minutos, e não com a aba do navegador escondida (o React Query pausa o
 * intervalo em segundo plano).
 *
 * AS CHAVES COMEÇAM COMO AS DAS TELAS ('djen_publicacoes', 'advbox_tarefas') DE
 * PROPÓSITO: o `invalidateQueries` casa por prefixo, então marcar uma publicação
 * como tratada (e a sincronização com o DJEN) já atualiza o contador junto,
 * sem nenhuma ligação nova entre a tela e o menu.
 */
export function useContadoresDoMenu(): Partial<Record<Contador, number>> {
  const publicacoes = useQuery({
    queryKey: ['djen_publicacoes', 'novas-do-menu'],
    queryFn: async () => {
      // A MESMA REGRA DA TELA (PublicacoesMovimentacoes): disponibilizada nos
      // últimos 30 dias, pelo fuso local; "nova" é a não tratada.
      const { count, error } = await supabase
        .from('djen_publicacoes')
        .select('id', { count: 'exact', head: true })
        .gte('data_disponibilizacao', isoDiasAtras(DIAS_DA_JANELA_DAS_PUBLICACOES))
        .eq('tratada', false)
      if (error) throw new Error(error.message)
      return count ?? 0
    },
    refetchInterval: INTERVALO_DOS_CONTADORES,
    staleTime: INTERVALO_DOS_CONTADORES,
    retry: false,
  })

  const tarefas = useQuery({
    queryKey: ['advbox_tarefas', 'vencidas-do-menu'],
    queryFn: async () => {
      // DO CACHE, NUNCA DO ADVBOX AO VIVO (a ação `list` baixa tudo). Vencida =
      // em aberto, com prazo fatal antes de hoje — o grupo "Vencidas" da tela.
      const { count, error } = await supabase
        .from('advbox_tarefas')
        .select('id', { count: 'exact', head: true })
        .eq('concluida', false)
        .lt('date_deadline', hojeISO())
      if (error) throw new Error(error.message)
      return count ?? 0
    },
    refetchInterval: INTERVALO_DOS_CONTADORES,
    staleTime: INTERVALO_DOS_CONTADORES,
    retry: false,
  })

  return { publicacoes: publicacoes.data, tarefas: tarefas.data }
}
