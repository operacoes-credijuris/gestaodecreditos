import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import { perguntarDescarte } from '@/lib/descarte'
import { useJanelaAberta } from '@/lib/janelasAbertas'

/**
 * Painel lateral (slide-over) para exibir detalhes de um registro sem sair da
 * listagem. Desliza da direita com overlay desfocado; fecha por X, overlay ou
 * Escape. Use para "ficha" de leitura — edição continua nos modais. Com algo
 * digitado na ficha, passe `dirty`: fechar pergunta antes (lib/descarte.ts).
 *
 * Vai para o <body> por portal, pelo mesmo motivo do Modal: `fixed inset-0` deixa
 * de se medir pela janela quando algum ancestral tem `transform`, e o
 * `.animate-page` do AppLayout tem um a cada troca de rota. Ver o comentário em
 * Modal.tsx para o defeito medido.
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  rodapeInicio,
  dirty = false,
  ariaLabel,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  /** O rodapé, à direita: `[Cancelar/Fechar] [Primário]` (ver o `Modal`). */
  footer?: ReactNode
  /** À esquerda do rodapé: a ação destrutiva ou alternativa (ver o `Modal`). */
  rodapeInicio?: ReactNode
  /**
   * Quando true, fechar (X, fundo ou Escape) pergunta antes "Descartar
   * alterações?", com o texto "nesta ficha" — o item "Novo" da amostra para a
   * ficha lateral com algo digitado. Sem ela, fecha direto, como sempre.
   */
  dirty?: boolean
  /**
   * O nome do painel para o leitor de tela. Sem ele, o nome é o próprio
   * `title` (aria-labelledby); passe-o quando o título não for texto que se
   * leia bem sozinho.
   */
  ariaLabel?: string
}) {
  // Mantém o nó montado durante a animação de saída (mesmo padrão do drawer
  // mobile da sidebar).
  const [rendered, setRendered] = useState(open)
  const [visible, setVisible] = useState(open)
  const painelRef = useRef<HTMLDivElement>(null)
  const tituloId = useId()
  const ehTopo = useFocoPreso(open, painelRef)
  useTravaScroll(open)
  // O Ctrl+K pergunta aqui se a ficha está alterada (lib/janelasAbertas.ts).
  useJanelaAberta(open, dirty, onClose)

  // TODAS AS FORMAS DE FECHAR PASSAM POR AQUI (X, fundo e Escape), como no
  // Modal: uma regra só para o "Descartar alterações?".
  const pedirFechar = useCallback(async () => {
    if (dirty && !(await perguntarDescarte('ficha'))) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    if (open) {
      setRendered(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setVisible(false)
    const timer = setTimeout(() => setRendered(false), 200)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && ehTopo()) pedirFechar()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pedirFechar, ehTopo])

  if (!rendered) return null

  return createPortal(
    <div className="fixed inset-0 z-janela">
      <div
        className={cn(
          'absolute inset-0 bg-veu/40 backdrop-blur-[2px] transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        // CLIQUE FORA NÃO FECHA (07/10/2026): só o X, o Fechar ou o Esc — ver ui/Modal.
      />
      {/* O DIÁLOGO É O PAINEL, e não a camada inteira: o fundo escurecido não
          faz parte dele. O nome vem do título (ou de `ariaLabel`) — antes o
          leitor de tela anunciava só "diálogo", sem dizer de quê. */}
      <div
        ref={painelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : tituloId}
        className={cn(
          // 520px, o painel lateral da amostra: a ficha usa grid de 2 colunas
          // (DrawerSection) e estreito os valores longos quebravam demais. Em px
          // porque a escala em rem (max-w-2xl) encolhe com o <html> de 12px.
          'absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-borda bg-superficie shadow-nivel-3 outline-none transition-transform duration-200 dark:ring-1 dark:ring-white/[0.06]',
          visible ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-borda px-6 py-5">
          <div id={tituloId} className="min-w-0 flex-1">
            {title}
          </div>
          <button
            onClick={pedirFechar}
            aria-label="Fechar painel"
            className="-mr-s2 -mt-s1 grid h-[32px] w-[32px] shrink-0 place-items-center rounded-controle text-texto-2 transition-colors hover:bg-superficie-3 hover:text-texto"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
          {children}
        </div>
        {(footer || rodapeInicio) && (
          <div className="flex flex-wrap items-center justify-end gap-s2 border-t border-borda px-6 py-4">
            {rodapeInicio && <div className="mr-auto flex flex-wrap items-center gap-s2">{rodapeInicio}</div>}
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Par rótulo/valor para fichas dentro do Drawer. */
export function DrawerField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      {/* O cinza de metadado (texto-3, 5,2:1) e não o slate-400 de antes:
          rótulo de 12px em caixa alta com slate-400 dava 2,34:1 sobre branco,
          menos da metade do mínimo de 4,5. Era o texto menos legível da
          plataforma, e justamente o que diz ao usuário qual campo ele está
          lendo. O texto-3 é o cinza mais claro que os tokens permitem para
          texto, e continua secundário diante do valor, que é `texto`. */}
      <dt className="text-xs font-semibold uppercase tracking-wide text-texto-3">
        {label}
      </dt>
      <dd className="mt-0.5 text-corpo text-texto">{children ?? '—'}</dd>
    </div>
  )
}

/** Seção titulada da ficha (agrupa DrawerFields). */
export function DrawerSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-borda py-4 first:pt-0 last:border-b-0">
      {/* O `.dsec` da amostra: título de seção na fonte de display, em caixa
          alta e no cinza de metadado — quem chama a atenção é o valor. */}
      <h3 className="font-display mb-3 text-xs font-bold uppercase tracking-wider text-texto-3">
        {title}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
    </section>
  )
}
