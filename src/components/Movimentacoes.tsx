// Movimentações de UM processo (e seus apensos) dentro da ficha lateral.
//
// Lê do cache local (public.advbox_movimentacoes), que desde a migração 0016
// guarda o histórico INTEIRO — quem o mantém é a Edge Function
// advbox-movimentacoes, pelo cron e pela sincronização da aba Movimentações.
// Esta ficha só consulta; não dispara sincronização, para abrir a ficha não
// custar uma varredura do ADVBOX.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DrawerSection } from '@/components/ui/Drawer'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/format'

interface MovLinha {
  id: string
  numero_digits: string | null
  data: string | null
  data_ts: string | null
  conteudo: string | null
}

const onlyDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

// Teto da consulta. PostgREST corta em 1000 de qualquer forma; explícito aqui
// para o aviso de truncamento não depender de configuração do servidor.
const LIMITE = 1000

/**
 * Seção "Movimentações" da ficha. `principal` é o número do processo da ficha;
 * `numeros` inclui também os apensos — movimentação de apenso ganha selo.
 */
export function DrawerMovimentacoes({
  principal,
  numeros,
}: {
  principal?: string | null
  numeros: (string | null | undefined)[]
}) {
  // Dígitos normalizados, deduplicados, na MESMA regra da Edge Function
  // (>= 6 dígitos) — números curtos são lixo de digitação.
  const digits = useMemo(
    () =>
      [...new Set(numeros.map(onlyDigits).filter((d) => d.length >= 6))],
    [numeros],
  )
  const digPrincipal = onlyDigits(principal)

  const q = useQuery({
    queryKey: ['advbox_movimentacoes', 'ficha', digits],
    enabled: digits.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advbox_movimentacoes')
        .select('id, numero_digits, data, data_ts, conteudo')
        .in('numero_digits', digits)
        .order('data', { ascending: false })
        .order('data_ts', { ascending: false })
        .limit(LIMITE)
      if (error) throw new Error(error.message)
      return (data ?? []) as MovLinha[]
    },
  })

  const lista = q.data ?? []
  const titulo =
    'Movimentações' + (q.data ? ` (${lista.length === LIMITE ? `${LIMITE}+` : lista.length})` : '')

  return (
    <DrawerSection title={titulo}>
      <div className="col-span-2 space-y-2">
        {q.isLoading ? (
          <>
            <div className="skeleton h-12 w-full rounded-lg" />
            <div className="skeleton h-12 w-11/12 rounded-lg" />
          </>
        ) : q.isError ? (
          <p className="text-sm text-red-600">{(q.error as Error).message}</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhuma movimentação sincronizada para este processo. O histórico é
            atualizado pelo cron e ao abrir a aba Movimentações.
          </p>
        ) : (
          <>
            {lista.length === LIMITE && (
              <p className="text-xs text-slate-500">
                Mostrando as {LIMITE} mais recentes.
              </p>
            )}
            {lista.map((m) => (
              <div key={m.id} className="rounded-lg border border-slate-200 p-2.5">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {m.data ? formatDate(m.data) : '—'}
                  {digits.length > 1 && m.numero_digits !== digPrincipal && (
                    <Badge size="sm" tone="gray">
                      apenso
                    </Badge>
                  )}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">
                  {m.conteudo}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </DrawerSection>
  )
}
