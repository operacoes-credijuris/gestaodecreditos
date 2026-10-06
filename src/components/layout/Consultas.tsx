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
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Info, PieChart, Search, Sparkles, SquareKanban } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Tecla } from '@/components/ui/Tecla'
import { CampoDeBusca } from '@/components/ui/CampoDeBusca'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { haDialogoAberto, useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import {
  AVISO_DA_BUSCA_COM_JANELA_ALTERADA,
  decidirAtalho,
  destinoDaSequencia,
  LISTA_DE_ATALHOS,
  NAVEGACAO_POR_LETRA,
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

/** O `kbd` da amostra: a tecla desenhada (mora em `ui/Tecla.tsx`). */
export { Tecla }

export function ProvedorDeConsultas({ children }: { children: ReactNode }) {
  const toast = useToast()
  const navigate = useNavigate()
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
  // O "G" ESPERANDO A LETRA DA TELA (lib/atalhos.ts): quando foi apertado, ou null.
  const prefixoEm = useRef<number | null>(null)
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      // A SEGUNDA TECLA DO "G e a letra". Qualquer tecla encerra a espera — a
      // que não é letra de tela também (e segue o caminho normal abaixo).
      if (prefixoEm.current !== null) {
        const destino = destinoDaSequencia(e, prefixoEm.current, Date.now())
        prefixoEm.current = null
        if (destino && decidirAtalho('navegar', e.target as HTMLElement | null, haDialogoAberto()) === 'agir') {
          e.preventDefault()
          navigate(destino)
          return
        }
      }
      const atalho = qualAtalho(e)
      // O "[" É DO MENU LATERAL, que guarda se está recolhido (layout/Sidebar.tsx).
      if (!atalho || atalho === 'menu') return
      if (atalho === 'navegar') {
        // Só começa a sequência longe dos campos e sem janela aberta.
        if (decidirAtalho(atalho, e.target as HTMLElement | null, haDialogoAberto()) === 'agir') {
          prefixoEm.current = Date.now()
        }
        return
      }
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
  }, [toast, navigate])

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
      {/* A BUSCA DAS LISTAS (ui/CampoDeBusca, revisão visual 2): 36px, a lupa de
          16px e o Escape que limpa — era um campo à parte, de 33px. Sem o "/":
          o filtro da tela é o da página atrás da janela. */}
      <CampoDeBusca
        valor={filtro}
        onMudar={setFiltro}
        atalho={false}
        placeholder="Procurar termo…"
        aria-label="Procurar termo"
        classeDaCaixa="mb-s4"
      />
      {termos.length ? (
        <dl className="grid gap-s3">
          {termos.map((t) => (
            <div key={t.termo} className="border-b border-borda pb-s3 last:border-b-0">
              <dt className="text-corpo font-bold text-texto">{t.termo}</dt>
              <dd className="mt-s0.5 text-corpo text-texto-2">{t.definicao}</dd>
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
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-s4 gap-y-s3">
        {LISTA_DE_ATALHOS.map((a) => (
          <div key={a.descricao} className="contents">
            <dt className="flex gap-s1 whitespace-nowrap">
              {a.teclas.map((k) => (
                <Tecla key={k}>{k}</Tecla>
              ))}
            </dt>
            <dd className="text-corpo text-texto-2">{a.descricao}</dd>
          </div>
        ))}
      </dl>
      {/* "G E DEPOIS A LETRA" (lib/atalhos.ts): as telas em duas colunas, para a
          lista não dobrar de altura. */}
      <h3 className="mb-s3 mt-s5 text-sm font-bold text-texto">Ir para uma tela: G e depois a letra</h3>
      <dl className="grid grid-cols-1 gap-x-s5 gap-y-s2 sm:grid-cols-2">
        {NAVEGACAO_POR_LETRA.map((n) => (
          <div key={n.letra} className="flex items-center gap-s2">
            <dt className="flex gap-s1 whitespace-nowrap">
              <Tecla>G</Tecla>
              <Tecla>{n.letra.toUpperCase()}</Tecla>
            </dt>
            <dd className="text-corpo text-texto-2">{n.rotulo}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}

const ICONE_DA_NOVIDADE = {
  novo: Sparkles,
  busca: Search,
  // O ÍCONE DA ANÁLISE DE CRÉDITO no menu (navigation.ts).
  funis: SquareKanban,
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
      className="animate-fade-in fixed inset-0 z-janela flex items-center justify-center overflow-y-auto bg-veu/50 p-4 backdrop-blur-[2px] scrollbar-thin"
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
        className="animate-modal-in w-full max-w-[520px] rounded-janela bg-superficie text-center shadow-nivel-3 outline-none dark:ring-1 dark:ring-white/[0.06]"
      >
        <div className="mx-auto mb-s1 mt-s8 grid h-[76px] w-[76px] place-items-center rounded-janela bg-marca-suave text-marca-texto">
          <Icone className="h-[32px] w-[32px]" aria-hidden />
        </div>
        <div className="px-s8 pt-s2">
          <p className="font-display text-xs font-bold uppercase tracking-[0.06em] text-texto-3">
            Novidades · {i + 1} de {NOVIDADES.length}
          </p>
          <h2 id={tituloId} className="font-display mb-s2 mt-s1 text-xl font-extrabold text-texto">
            {passo.titulo}
          </h2>
          <p className="mx-auto max-w-[400px] text-corpo text-texto-2">{passo.texto}</p>
        </div>
        <div className="mb-s2 mt-s5 flex justify-center gap-s2" aria-hidden>
          {NOVIDADES.map((_, j) => (
            <i
              key={j}
              className={cn(
                'block h-[8px] rounded-full',
                j === i ? 'w-[20px] bg-marca-viva' : 'w-[8px] bg-borda-forte',
              )}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-s2 px-s5 pb-s5 pt-s4">
          <Button variant="ghost" onClick={onFechar}>
            Pular
          </Button>
          <div className="flex-1" />
          {i > 0 && (
            <Button variant="secondary" onClick={() => setI(i - 1)}>
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
