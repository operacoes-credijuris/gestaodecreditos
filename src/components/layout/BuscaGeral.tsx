import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, FolderKanban, Loader2, Phone, ScanSearch, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/ui/Toast'
import { Badge } from '@/components/ui/Badge'
import { useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import {
  FUNIL_PRECATORIO_EXTERNO,
  FUNIL_PRECATORIO_INTERNO,
  FUNIL_RPV,
  useKommoEtapas,
} from '@/lib/kommo'
import {
  ESPERA_MS,
  filtroDosCards,
  filtroDosContatos,
  filtroDosCreditos,
  LIMITE_POR_FONTE,
  lerTermo,
  MIN_LETRAS,
  montarResultados,
  telasBuscaveis,
  type CardAchado,
  type ContatoAchado,
  type CreditoAchado,
  type PedidoDaBusca,
  type ResultadoDaBusca,
  type TipoDoResultado,
} from '@/lib/buscaGeral'

/** Os funis da Análise de crédito — os únicos de onde a busca traz card. */
const FUNIS_DA_ANALISE: Readonly<Record<number, string>> = {
  [FUNIL_RPV]: 'RPV',
  [FUNIL_PRECATORIO_INTERNO]: 'Precatório interno',
  [FUNIL_PRECATORIO_EXTERNO]: 'Precatório externo',
}

const ICONE: Record<TipoDoResultado, typeof ArrowRight> = {
  tela: ArrowRight,
  card: ScanSearch,
  credito: FolderKanban,
  contato: Phone,
}

/** O texto digitado, só depois de uma pausa na digitação. */
function useEsperado(valor: string, ms: number): string {
  const [v, setV] = useState(valor)
  useEffect(() => {
    const t = window.setTimeout(() => setV(valor), ms)
    return () => window.clearTimeout(t)
  }, [valor, ms])
  return v
}

/**
 * A BUSCA GERAL (Ctrl+K, item "Novo" da amostra): créditos, cards, contatos e
 * telas, de qualquer lugar.
 *
 * SÓ EXISTE ABERTA: montada quando se abre, desmontada quando fecha — nenhuma
 * consulta roda com ela fechada. As consultas e a ordem dos resultados estão em
 * lib/buscaGeral.ts.
 */
export function BuscaGeral({ onFechar }: { onFechar: () => void }) {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [digitado, setDigitado] = useState('')
  const [sel, setSel] = useState(0)
  const painelRef = useRef<HTMLDivElement>(null)
  const listaId = useId()
  const ehTopo = useFocoPreso(true, painelRef, true)
  useTravaScroll(true)

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape' && ehTopo()) onFechar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [ehTopo, onFechar])

  const termo = lerTermo(useEsperado(digitado, ESPERA_MS))
  // O QUE ESTÁ NA CAIXA AGORA ainda não consultou (a pausa não passou)?
  const esperando = lerTermo(digitado).texto !== termo.texto

  const consulta = useQuery({
    queryKey: ['busca-geral', termo.texto],
    enabled: termo.consulta,
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      // TRÊS CONSULTAS PEQUENAS, cada uma com limite e só as colunas que a lista
      // mostra. Uma que falhe não derruba as outras.
      const [creditos, cards, contatos] = await Promise.allSettled([
        supabase
          .from('processos')
          .select('id, numero_cnj, cedente, entidade_devedora')
          .or(filtroDosCreditos(termo))
          .limit(LIMITE_POR_FONTE)
          .abortSignal(signal),
        supabase
          .from('kommo_leads')
          .select('kommo_lead_id, pipeline_id, status_id, nome, processo_cnj')
          .in('pipeline_id', Object.keys(FUNIS_DA_ANALISE).map(Number))
          .or(filtroDosCards(termo))
          .order('atualizado_em', { ascending: false })
          .limit(LIMITE_POR_FONTE)
          .abortSignal(signal),
        supabase
          .from('contatos_serventias')
          .select('id, orgao, tribunal')
          .or(filtroDosContatos(termo))
          .limit(LIMITE_POR_FONTE)
          .abortSignal(signal),
      ])
      const falhas: string[] = []
      const linhas = <T,>(r: PromiseSettledResult<{ data: unknown; error: { message: string } | null }>, nome: string): T[] => {
        if (r.status === 'rejected' || r.value.error) {
          falhas.push(nome)
          return []
        }
        return (r.value.data ?? []) as T[]
      }
      return {
        creditos: linhas<CreditoAchado>(creditos, 'créditos'),
        cards: linhas<CardAchado>(cards, 'cards'),
        contatos: linhas<ContatoAchado>(contatos, 'contatos'),
        falhas,
      }
    },
  })

  // O NOME DA COLUNA de cada card. A lista das colunas é pequena e é a mesma
  // consulta (e o mesmo cache) que a Análise de crédito já usa.
  const etapas = useKommoEtapas()
  const onde = useMemo(
    () => ({
      funil: (p: number) => FUNIS_DA_ANALISE[p] ?? '',
      coluna: (p: number, s: number) =>
        etapas.data?.find((e) => e.pipeline_id === p && e.status_id === s)?.nome ?? null,
    }),
    [etapas.data],
  )

  const telas = useMemo(() => telasBuscaveis(isAdmin), [isAdmin])
  const dados = termo.consulta && !esperando ? consulta.data : undefined
  const resultados = montarResultados({
    digitado,
    telas,
    creditos: dados?.creditos,
    cards: dados?.cards,
    contatos: dados?.contatos,
    onde,
  })
  const atual = Math.min(sel, Math.max(0, resultados.length - 1))
  useEffect(() => setSel(0), [digitado])

  const opcaoId = (i: number) => `${listaId}-op-${i}`
  useEffect(() => {
    document.getElementById(opcaoId(atual))?.scrollIntoView({ block: 'nearest' })
  })

  function escolher(r: ResultadoDaBusca) {
    onFechar()
    if (r.tipo === 'tela') {
      navigate(r.alvo)
    } else if (r.tipo === 'credito') {
      const pedido: PedidoDaBusca = { abrirCredito: r.alvo }
      navigate('/operacional/execucao/processos', { state: pedido })
    } else if (r.tipo === 'contato') {
      const pedido: PedidoDaBusca = { filtrarContatos: r.titulo }
      navigate('/operacional/execucao/contatos', { state: pedido })
    } else {
      // O CARD SÓ É REALÇADO E ROLADO ATÉ A VISTA — NUNCA SE ABRE JANELA dele
      // daqui: a due diligence busca no Escavador sozinha ao abrir, e cada
      // consulta custa. Card fora da etapa à vista: o aviso diz onde ele está.
      navigate('/operacional/analise')
      realcarCard(Number(r.alvo), () =>
        toast.info(
          `O card de ${r.titulo} está em ${[onde.funil(cardDoResultado(r, dados)), r.onde]
            .filter(Boolean)
            .join(' › ')}. Escolha o funil e a etapa no quadro para vê-lo.`,
        ),
      )
    }
  }

  const carregando = termo.consulta && (esperando || consulta.isFetching)
  const curta = digitado.trim().length > 0 && lerTermo(digitado).texto.length < MIN_LETRAS

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-veu/50 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar()
      }}
    >
      <div
        ref={painelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Buscar em toda a plataforma"
        className="animate-modal-in mt-[10vh] w-full max-w-[620px] overflow-hidden rounded-janela bg-superficie shadow-nivel-3 outline-none"
      >
        <div className="flex h-[56px] items-center gap-3 border-b border-borda px-5 text-texto-3">
          <Search className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={listaId}
            aria-autocomplete="list"
            aria-activedescendant={resultados.length ? opcaoId(atual) : undefined}
            aria-label="Buscar"
            autoComplete="off"
            spellCheck={false}
            value={digitado}
            onChange={(e) => setDigitado(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel(Math.min(resultados.length - 1, atual + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel(Math.max(0, atual - 1))
              } else if (e.key === 'Enter' && resultados[atual]) {
                e.preventDefault()
                escolher(resultados[atual])
              }
            }}
            placeholder="Cedente, nº do processo, contato, tela…"
            className="min-w-0 flex-1 bg-transparent text-lg text-texto outline-none placeholder:text-texto-3"
          />
          {carregando && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />}
          <kbd className="rounded-md border border-borda-forte bg-superficie px-1.5 py-0.5 font-sans text-xs font-semibold text-texto-2">
            Esc
          </kbd>
        </div>

        <ul id={listaId} role="listbox" aria-label="Resultados" className="max-h-[50vh] overflow-y-auto p-2 scrollbar-thin">
          {resultados.map((r, i) => {
            const Icone = ICONE[r.tipo]
            return (
              <li
                key={r.chave}
                id={opcaoId(i)}
                role="option"
                aria-selected={i === atual}
                // O FOCO FICA NA CAIXA: o clique escolhe sem tirá-lo de lá.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => i !== atual && setSel(i)}
                onClick={() => escolher(r)}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5',
                  i === atual && 'bg-superficie-3',
                )}
              >
                <Icone className="h-4 w-4 shrink-0 text-texto-3" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-corpo font-semibold text-texto">{r.titulo}</span>
                  {r.sub && <span className="block truncate text-xs text-texto-3">{r.sub}</span>}
                </span>
                <Badge tone="gray">{r.onde}</Badge>
              </li>
            )
          })}
        </ul>

        {/* O QUE A LISTA NÃO DIZ SOZINHA: por que só há telas, que está buscando, que não achou. */}
        <p role="status" className="px-5 pb-3 text-corpo text-texto-3 empty:hidden">
          {curta
            ? `Digite ${MIN_LETRAS} letras ou mais para buscar também créditos, cards e contatos.`
            : termo.consulta && !carregando && consulta.isError
              ? 'Não foi possível buscar agora. Tente de novo.'
              : termo.consulta && !carregando && dados?.falhas.length
                ? `Não foi possível buscar em ${dados.falhas.join(', ')}.`
                : !carregando && digitado.trim() && resultados.length === 0
                  ? 'Nada com esse termo.'
                  : ''}
        </p>

        <div className="flex flex-wrap gap-4 border-t border-borda px-5 py-3 text-xs text-texto-3">
          <span>
            <kbd className="font-sans">↑</kbd> <kbd className="font-sans">↓</kbd> navegar
          </span>
          <span>
            <kbd className="font-sans">Enter</kbd> abrir
          </span>
          <span>créditos, cards, contatos e telas da plataforma</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** O funil do card escolhido, para o aviso de onde ele está. */
function cardDoResultado(
  r: ResultadoDaBusca,
  dados: { cards: CardAchado[] } | undefined,
): number {
  return dados?.cards.find((c) => String(c.kommo_lead_id) === r.alvo)?.pipeline_id ?? 0
}

/**
 * Realça o card na Análise de crédito, se ele estiver à vista: rola até ele,
 * põe o foco nele e o contorna por um instante. Espera a tela montar e os cards
 * chegarem (até alguns segundos); não achando, avisa onde ele está.
 *
 * SÓ OLHA A TELA (o `data-lead` que o card já tem): não abre nada, não consulta
 * nada, não muda o funil nem a etapa escolhidos.
 */
function realcarCard(leadId: number, naoAchou: () => void) {
  const inicio = Date.now()
  const procurar = () => {
    const el = document.querySelector<HTMLElement>(`article[data-lead="${leadId}"]`)
    if (el) {
      const suave = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'center', behavior: suave ? 'smooth' : 'auto' })
      el.focus({ preventScroll: true })
      el.classList.add('realce-da-busca')
      window.setTimeout(() => el.classList.remove('realce-da-busca'), 2500)
      return
    }
    if (Date.now() - inicio > 4000) return naoAchou()
    window.setTimeout(procurar, 150)
  }
  window.setTimeout(procurar, 50)
}
