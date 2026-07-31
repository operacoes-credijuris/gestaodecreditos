// Movimentações de UM processo (e seus apensos) dentro da ficha lateral.
//
// Lê do cache local (public.advbox_movimentacoes), que desde a migração 0016
// guarda o histórico INTEIRO — quem o mantém é a Edge Function
// advbox-movimentacoes, pelo cron e pela sincronização da aba Movimentações.
// Esta ficha só consulta; não dispara sincronização, para abrir a ficha não
// custar uma varredura do ADVBOX.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { DrawerSection } from '@/components/ui/Drawer'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatCNJ, formatDate } from '@/lib/format'

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

// Renderização progressiva: histórico integral pode ter centenas de itens, e
// montar tudo de uma vez trava a abertura da ficha.
const PAGINA = 50

// Acima disso o texto abre recolhido (andamento de diário costuma ser longo).
const CLAMP_CHARS = 280

// Um andamento na linha do tempo. Cada item controla o próprio "ver mais" —
// estado global de expansão obrigaria a rolar a lista toda ao alternar um.
function MovItem({
  mov,
  numeroApenso,
  primeiro,
}: {
  mov: MovLinha
  /** Número do apenso dono do andamento, ou null quando é do principal. */
  numeroApenso: string | null
  primeiro: boolean
}) {
  const [expandido, setExpandido] = useState(false)
  const texto = mov.conteudo ?? ''
  const longo = texto.length > CLAMP_CHARS

  return (
    <li className="relative">
      {/* Bolinha sobre o trilho; a borda branca impede a linha de atravessá-la.
          A primeira (andamento mais recente) é destacada para ancorar o olhar. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute -left-[21.5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white',
          primeiro ? 'bg-brand-500' : 'bg-slate-300',
        )}
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <span className="font-semibold tabular-nums text-slate-600">
          {mov.data ? formatDate(mov.data) : 'sem data'}
        </span>
        {/* Não só "apenso": com mais de um apenso, saber QUAL é o que separa
            os autos de verdade. */}
        {numeroApenso && (
          <>
            <Badge size="sm" tone="gray">
              apenso
            </Badge>
            <span className="tabular-nums text-slate-400">
              {formatCNJ(numeroApenso)}
            </span>
          </>
        )}
      </div>
      <p
        className={cn(
          'mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700',
          longo && !expandido && 'line-clamp-4',
        )}
      >
        {texto}
      </p>
      {longo && (
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          className="mt-0.5 text-xs font-medium text-brand-600 hover:underline"
        >
          {expandido ? 'ver menos' : 'ver mais'}
        </button>
      )}
    </li>
  )
}

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
    () => [...new Set(numeros.map(onlyDigits).filter((d) => d.length >= 6))],
    [numeros],
  )
  const digPrincipal = onlyDigits(principal)
  const [visiveis, setVisiveis] = useState(PAGINA)

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
  const mostradas = lista.slice(0, visiveis)
  const restantes = lista.length - mostradas.length
  const titulo =
    'Movimentações' +
    (q.data ? ` (${lista.length === LIMITE ? `${LIMITE}+` : lista.length})` : '')

  return (
    <DrawerSection title={titulo}>
      <div className="col-span-2">
        {q.isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-12 w-full rounded-lg" />
            <div className="skeleton h-12 w-11/12 rounded-lg" />
          </div>
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
              <p className="mb-3 text-xs text-slate-500">
                Mostrando as {LIMITE} mais recentes.
              </p>
            )}
            {/* Linha do tempo: trilho à esquerda, mais recente no topo. */}
            <ol className="ml-1.5 space-y-4 border-l border-slate-200 pl-4">
              {mostradas.map((m, i) => (
                <MovItem
                  key={m.id}
                  mov={m}
                  primeiro={i === 0}
                  numeroApenso={
                    digits.length > 1 && m.numero_digits !== digPrincipal
                      ? m.numero_digits
                      : null
                  }
                />
              ))}
            </ol>
            {restantes > 0 && (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVisiveis((v) => v + PAGINA * 2)}
                >
                  Mostrar mais ({restantes} restantes)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </DrawerSection>
  )
}
