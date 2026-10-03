import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Info, PieChart, ScanSearch, Search, Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { haDialogoAberto, useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import {
  AVISO_DA_BUSCA_COM_JANELA_ALTERADA,
  decidirAtalho,
  LISTA_DE_ATALHOS,
  qualAtalho,
} from '@/lib/atalhos'
import { perguntaDeDescarteAberta } from '@/lib/descarte'
import {
  estadoDasJanelas,
  fecharJanelasAbertas,
  janelasAbertas,
  useJanelaAberta,
} from '@/lib/janelasAbertas'
import { filtrarGlossario, NOVIDADES } from '@/lib/ajudaDaPlataforma'
import { pecaSobDemanda } from '@/lib/telaSobDemanda'
import {
  armazenamentoDisponivel,
  gravarPreferencia,
  lerPreferencia,
  PREF_NOVIDADES_VISTAS,
} from '@/lib/preferencias'

// A BUSCA GERAL VEM SOB DEMANDA: ela traz junto o núcleo do Kommo (funis,
// colunas, leitura do título do card), que só a Análise usa — importada direto,
// ia no pacote de entrada de toda tela. Para o Ctrl+K não esperar a rede na
// primeira vez, ela é baixada sozinha logo depois de a tela abrir (ver abaixo).
const importarBusca = () => import('./BuscaGeral')
const BuscaGeral = pecaSobDemanda(() => importarBusca().then((m) => m.BuscaGeral), BuscaIndisponivel)

/** Se a busca não chegar (rede, versão nova publicada): avisa e se fecha. */
function BuscaIndisponivel({ onFechar }: { onFechar: () => void }) {
  const toast = useToast()
  useEffect(() => {
    toast.error('Não foi possível abrir a busca agora. Recarregue a página e tente de novo.')
    onFechar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/**
 * As CONSULTAS da plataforma (itens "Novo" da amostra): a busca geral (Ctrl+K),
 * o glossário, os atalhos de teclado e as novidades desta versão — e os atalhos
 * de teclado que as abrem.
 *
 * Moram juntas porque abrem dos mesmos lugares (o "?" da tela, o menu do
 * usuário, o teclado) e seguem a mesma regra: o glossário e os atalhos abrem POR
 * CIMA da janela que já estiver aberta (são consulta, e consultar não custa o
 * que foi digitado embaixo); a busca, não — ela leva a outra tela.
 */
interface Consultas {
  abrirBusca: () => void
  abrirGlossario: () => void
  abrirAtalhos: () => void
  abrirNovidades: () => void
}

const ContextoDasConsultas = createContext<Consultas | null>(null)

/** As consultas, para o "?" da tela e o menu do usuário. */
export function useConsultas(): Consultas {
  const c = useContext(ContextoDasConsultas)
  if (!c) throw new Error('useConsultas fora do ProvedorDeConsultas')
  return c
}

/** O `kbd` da amostra: a tecla desenhada. */
export function Tecla({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-borda-forte bg-superficie px-1.5 py-0.5 font-sans text-xs font-semibold text-texto-2">
      {children}
    </kbd>
  )
}

export function ProvedorDeConsultas({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [busca, setBusca] = useState(false)
  const [glossario, setGlossario] = useState(false)
  const [atalhos, setAtalhos] = useState(false)
  const [novidades, setNovidades] = useState(false)

  const valor = useMemo<Consultas>(
    () => ({
      abrirBusca: () => setBusca(true),
      abrirGlossario: () => setGlossario(true),
      abrirAtalhos: () => setAtalhos(true),
      abrirNovidades: () => setNovidades(true),
    }),
    [],
  )

  // OS ATALHOS DE TECLADO. As regras de quando NÃO agir estão em lib/atalhos.ts
  // (digitando, ou com janela aberta).
  const atalhosAbertos = useRef(false)
  atalhosAbertos.current = atalhos
  const buscaAberta = useRef(false)
  buscaAberta.current = busca
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      const atalho = qualAtalho(e)
      if (!atalho) return
      if (atalho === 'busca') {
        // SEMPRE, até num campo: o Ctrl+K do navegador leva o foco à barra de
        // endereço, e quem o aperta aqui quer a busca da plataforma.
        e.preventDefault()
        // A busca já aberta: o atalho não a abre de novo nem a fecha.
        if (buscaAberta.current) return
        const janelas = janelasAbertas()
        const estado = estadoDasJanelas(janelas, haDialogoAberto(), perguntaDeDescarteAberta())
        const decisao = decidirAtalho(
          atalho,
          e.target as HTMLElement | null,
          estado !== 'nenhuma',
          estado === 'alterada',
        )
        // JANELA ALTERADA: AVISA E A DEIXA ABERTA — o que foi digitado não se
        // perde por um atalho.
        if (decisao === 'avisar') {
          toast.info(AVISO_DA_BUSCA_COM_JANELA_ALTERADA)
          return
        }
        // SEM ALTERAÇÃO, A BUSCA TOMA O LUGAR DA JANELA (como na amostra): não
        // há nada a perder, e a busca leva a outra tela.
        if (decisao === 'substituir') fecharJanelasAbertas()
        setBusca(true)
        return
      }
      const decisao = decidirAtalho(atalho, e.target as HTMLElement | null, haDialogoAberto())
      if (decisao === 'ignorar') return
      if (atalho === 'filtro') {
        // O FILTRO DA TELA é o campo marcado com `data-filtro-tela`. A Análise de
        // crédito tem o seu próprio "/" e não o marca — então aqui nada acontece
        // lá, e o dela age sozinho.
        const campo = document.querySelector<HTMLElement>('[data-filtro-tela]')
        if (!campo) return
        e.preventDefault()
        campo.focus()
        return
      }
      // "?": a lista de atalhos, por cima do que estiver aberto; já aberta, nada.
      if (atalhosAbertos.current) return
      e.preventDefault()
      setAtalhos(true)
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [toast])

  // A BUSCA BAIXADA DE ANTEMÃO: três segundos depois de a tela abrir, sem
  // disputar a rede com ela. Falhando (rede), a busca tenta de novo ao abrir.
  useEffect(() => {
    const t = window.setTimeout(() => {
      importarBusca().catch(() => {})
    }, 3000)
    return () => window.clearTimeout(t)
  }, [])

  // AS NOVIDADES ABREM SOZINHAS UMA VEZ para cada pessoa — e só se der para
  // lembrar que já foram vistas; senão abririam a cada visita. Depois, ficam no
  // menu do usuário.
  useEffect(() => {
    if (!armazenamentoDisponivel() || lerPreferencia(PREF_NOVIDADES_VISTAS, false)) return
    const t = window.setTimeout(() => setNovidades(true), 600)
    return () => window.clearTimeout(t)
  }, [])
  const fecharNovidades = useCallback(() => {
    gravarPreferencia(PREF_NOVIDADES_VISTAS, true)
    setNovidades(false)
  }, [])

  return (
    <ContextoDasConsultas.Provider value={valor}>
      {children}
      {busca && (
        <Suspense fallback={null}>
          <BuscaGeral onFechar={() => setBusca(false)} />
        </Suspense>
      )}
      <JanelaDoGlossario aberta={glossario} onFechar={() => setGlossario(false)} />
      <JanelaDosAtalhos aberta={atalhos} onFechar={() => setAtalhos(false)} />
      {novidades && <JanelaDasNovidades onFechar={fecharNovidades} />}
    </ContextoDasConsultas.Provider>
  )
}

/** O glossário dos termos da casa, com filtro. Procurar não é alterar: fechar não pergunta nada. */
function JanelaDoGlossario({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const [filtro, setFiltro] = useState('')
  useEffect(() => {
    if (!aberta) setFiltro('')
  }, [aberta])
  const termos = filtrarGlossario(filtro)
  return (
    <Modal
      open={aberta}
      onClose={onFechar}
      title="Glossário"
      description="Os termos que aparecem na plataforma, em poucas palavras."
      footer={<Button onClick={onFechar}>Fechar</Button>}
    >
      <label className="relative mb-4 block">
        <span className="sr-only">Procurar termo</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-texto-3"
        />
        <input
          type="search"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Procurar termo…"
          className="h-11 w-full rounded-campo border border-borda-controle bg-superficie pl-9 pr-3 text-corpo text-texto outline-none focus:border-anel focus:ring-[3px] focus:ring-anel/20"
        />
      </label>
      {termos.length ? (
        <dl className="grid gap-3">
          {termos.map((t) => (
            <div key={t.termo} className="border-b border-borda pb-2.5 last:border-b-0">
              <dt className="text-corpo font-bold text-texto">{t.termo}</dt>
              <dd className="mt-0.5 text-corpo text-texto-2">{t.definicao}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-corpo text-texto-2">Nenhum termo com esse nome.</p>
      )}
    </Modal>
  )
}

/** A lista de atalhos de teclado. */
function JanelaDosAtalhos({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  return (
    <Modal
      open={aberta}
      onClose={onFechar}
      title="Atalhos de teclado"
      footer={<Button onClick={onFechar}>Fechar</Button>}
    >
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-3">
        {LISTA_DE_ATALHOS.map((a) => (
          <div key={a.descricao} className="contents">
            <dt className="flex gap-1 whitespace-nowrap">
              {a.teclas.map((k) => (
                <Tecla key={k}>{k}</Tecla>
              ))}
            </dt>
            <dd className="text-corpo text-texto-2">{a.descricao}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}

const ICONE_DA_NOVIDADE = {
  novo: Sparkles,
  busca: Search,
  funis: ScanSearch,
  acao: ArrowRight,
  quadro: PieChart,
  ajuda: Info,
} as const

/**
 * As novidades desta versão, em seis passos curtos (o tour da amostra).
 *
 * Janela própria, e não o Modal: o desenho é outro (ícone grande, texto
 * centrado, pontos de progresso), mas as regras são as mesmas — foco preso,
 * rolagem travada, pilha de diálogos, Escape fecha.
 */
function JanelaDasNovidades({ onFechar }: { onFechar: () => void }) {
  const [i, setI] = useState(0)
  const painelRef = useRef<HTMLDivElement>(null)
  const ehTopo = useFocoPreso(true, painelRef)
  useTravaScroll(true)
  // Nada digitado aqui: o Ctrl+K fecha as novidades e abre a busca no lugar.
  useJanelaAberta(true, false, onFechar)
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape' && ehTopo()) onFechar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [ehTopo, onFechar])

  const passo = NOVIDADES[i]
  const Icone = ICONE_DA_NOVIDADE[passo.icone]
  const ultimo = i === NOVIDADES.length - 1
  const tituloId = 'novidades-titulo'

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-veu/50 p-4 backdrop-blur-[2px] scrollbar-thin"
      onClick={(e) => {
        if (e.target === e.currentTarget) onFechar()
      }}
    >
      <div
        ref={painelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Novidades desta versão"
        aria-describedby={tituloId}
        className="animate-modal-in w-full max-w-[520px] rounded-janela bg-superficie text-center shadow-nivel-3 outline-none"
      >
        <div className="mx-auto mb-1 mt-9 grid h-[76px] w-[76px] place-items-center rounded-[22px] bg-marca-suave text-marca-texto">
          <Icone className="h-9 w-9" aria-hidden />
        </div>
        <div className="px-9 pt-2">
          <p className="text-xs font-bold uppercase tracking-wider text-texto-3">
            Novidades · {i + 1} de {NOVIDADES.length}
          </p>
          <h2 id={tituloId} className="font-display mb-2 mt-1 text-xl font-extrabold text-texto">
            {passo.titulo}
          </h2>
          <p className="mx-auto max-w-[400px] text-corpo text-texto-2">{passo.texto}</p>
        </div>
        <div className="mb-2 mt-6 flex justify-center gap-2" aria-hidden>
          {NOVIDADES.map((_, j) => (
            <i
              key={j}
              className={cn(
                'block h-[7px] rounded-full',
                j === i ? 'w-[20px] bg-marca-viva' : 'w-[7px] bg-borda-forte',
              )}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-6 pb-6 pt-4">
          <Button variant="ghost" onClick={onFechar}>
            Pular
          </Button>
          <div className="flex-1" />
          {i > 0 && (
            <Button variant="outline" onClick={() => setI(i - 1)}>
              Voltar
            </Button>
          )}
          <Button onClick={() => (ultimo ? onFechar() : setI(i + 1))}>
            {ultimo ? 'Começar' : 'Próximo'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
