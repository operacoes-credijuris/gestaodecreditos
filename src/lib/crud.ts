import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { supabase } from './supabase'

export interface ListOptions {
  /** Coluna usada na ordenação (default: created_at). */
  orderBy?: string
  ascending?: boolean
  /** select() customizado (joins, etc.). Default: '*'. */
  select?: string
}

/**
 * Cria um conjunto de hooks CRUD para uma tabela do Supabase.
 * Mantém o cache do react-query coerente por tabela.
 */
export function makeCrud<
  TRow extends { id: string },
  TInsert extends Record<string, unknown>,
>(table: string, options: ListOptions = {}) {
  const {
    orderBy = 'created_at',
    ascending = false,
    select = '*',
  } = options
  const key: QueryKey = [table]

  function useList(extraSelect?: string) {
    return useQuery({
      queryKey: extraSelect ? [table, extraSelect] : key,
      queryFn: async () => {
        const { data, error } = await supabase
          .from(table)
          .select(extraSelect ?? select)
          .order(orderBy, { ascending })
        if (error) throw new Error(error.message)
        return (data ?? []) as unknown as TRow[]
      },
    })
  }

  function useCreate() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: async (payload: TInsert) => {
        const { data, error } = await supabase
          .from(table)
          // client não-tipado: cast necessário para o builder do supabase-js
          .insert(payload as Record<string, unknown>)
          .select()
          .single()
        if (error) throw new Error(error.message)
        return data as unknown as TRow
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    })
  }

  function useUpdate() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: async ({
        id,
        changes,
      }: {
        id: string
        changes: Partial<TInsert>
      }) => {
        const { data, error } = await supabase
          .from(table)
          .update(changes as Record<string, unknown>)
          .eq('id', id)
          .select()
          .single()
        if (error) throw new Error(error.message)
        return data as unknown as TRow
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    })
  }

  function useRemove() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: async (id: string) => {
        const { error } = await supabase.from(table).delete().eq('id', id)
        if (error) throw new Error(error.message)
        return id
      },
      onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
    })
  }

  return { table, key, useList, useCreate, useUpdate, useRemove }
}
