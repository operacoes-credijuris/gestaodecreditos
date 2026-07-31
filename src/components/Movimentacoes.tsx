// Movimentações de UM processo dentro da ficha lateral.
//
// Separação total por autos: a ficha do principal mostra SÓ os andamentos do
// principal, e a ficha de cada apenso mostra só os dele (o apenso é um processo
// por direito próprio — decisão de produto, 2026-07). É a Edge Function
// advbox-movimentacoes que garante isso, carimbando cada andamento com o número
// do processo A QUE ELE PERTENCE, mesmo quando o ADVBOX entrega andamentos do
// apenso dentro do feed do principal.
//
// Lê do cache local (public.advbox_movimentacoes), que guarda o histórico
// INTEIRO — mantido pelo cron e pela sincronização da aba Movimentações. Esta
// ficha só consulta; não dispara sincronização, para abrir a ficha não custar
// uma varredura do ADVBOX.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { DrawerSection } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { formatDate, onlyDigits } from '@/lib/format'

interface MovLinha {
  id: string
  data: string | null
  conteudo: string | null
}

// Teto da consulta. PostgREST corta em 1000 de qualquer forma; explícito aqui
// para o aviso de truncamento não depender de configuração do servidor.
const LIMITE = 1000

// Renderização progressiva: histórico integral pode ter centenas de itens, e
// montar tudo de uma vez trava a abertura da ficha.
const PAGINA = 50

// Acima disso o texto abre recolhido (andamento de diário costuma ser longo).
const CLAMP_CHARS = 280

// Um andamento na linha do tempo. Cada item controla o próprio "ler mais" —
// estado global de expansão obrigaria a rolar a lista toda ao alternar um.
function MovItem({ mov, primeiro }: { mov: MovLinha; primeiro: boolean }) {
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
      <div className="text-xs font-semibold tabular-nums text-slate-600">
        {mov.data ? formatDate(mov.data) : 'sem data'}
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
          {expandido ? 'ler menos' : 'ler mais'}
        </button>
      )}
    </li>
  )
}

/** Seção "Movimentações" da ficha: os andamentos DESTE número, e só dele. */
export function DrawerMovimentacoes({ numero }: { numero?: string | null }) {
  const digits = onlyDigits(numero)
  const [visiveis, setVisiveis] = useState(PAGINA)

  const q = useQuery({
    queryKey: ['advbox_movimentacoes', 'ficha', digits],
    // Mesma regra da Edge Function (>= 6 dígitos) — menos que isso é lixo.
    enabled: digits.length >= 6,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('advbox_movimentacoes')
        .select('id, data, conteudo')
        .eq('numero_digits', digits)
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
                <MovItem key={m.id} mov={m} primeiro={i === 0} />
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
