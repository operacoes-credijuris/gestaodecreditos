import type { ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import { perguntarDescarte } from '@/lib/descarte'

/**
 * Modal acessível com focus trap.
 *
 * - Fecha com Escape, clique no overlay ou no botão X.
 * - Ao abrir, foca o primeiro elemento focável do painel; Tab/Shift+Tab
 *   circulam apenas entre os focáveis do modal; ao fechar, o foco volta ao
 *   elemento que estava focado antes da abertura.
 * - `dirty`: quando true, QUALQUER tentativa de fechar (X, overlay, Escape)
 *   pede confirmação ("Descartar alterações?", a janela de lib/descarte.ts)
 *   antes de chamar `onClose`. Útil em formulários com alterações pendentes.
 *
 * VAI PARA O <body> POR PORTAL, e isto não é preferência de organização — é o que
 * faz o escurecimento cobrir a tela INTEIRA.
 *
 * O defeito que isso conserta: `position: fixed` não se mede pela janela quando
 * algum ancestral tem `transform`; passa a se medir por esse ancestral. O
 * AppLayout envolve toda página num `.animate-page`, que anima com
 * `translateY(4px)` a cada troca de rota — e, renderizado ali dentro, o overlay
 * saía com o tamanho do conteúdo e começando ABAIXO da barra do topo, deixando
 * uma faixa clara em cima. Medido no navegador: com o transform ativo o overlay
 * ficava 961x54 em top:52; no <body>, 961x910, a janela toda.
 *
 * Mesmo raciocínio vale para qualquer `hover:-translate-y` de cartão ou
 * `active:scale` de botão que venha a envolver um modal no futuro: no <body>,
 * nada disso alcança o overlay.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dirty = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Quando true, fechar exige confirmação antes de descartar alterações. */
  dirty?: boolean
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Foco inicial no primeiro CAMPO (não no X) e preso ao painel; scroll do fundo
  // travado. As três regras moram em lib/dialogo.ts, compartilhadas com o Drawer
  // e com o menu lateral do celular.
  const ehTopo = useFocoPreso(open, panelRef, true)
  useTravaScroll(open)

  // Centraliza a checagem de "dirty" para todas as formas de fechar
  // (X, overlay e Escape passam TODOS por aqui — uma única fonte da regra).
  // A PERGUNTA É A JANELA DA CASA (lib/descarte.ts), por cima desta, e não mais
  // o `window.confirm`; o momento em que ela aparece é o mesmo.
  const requestClose = useCallback(async () => {
    if (dirty && !(await perguntarDescarte())) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      // SÓ A JANELA DE CIMA RESPONDE. Ver a pilha em lib/dialogo.ts: sem este
      // teste, um Escape na janela de reprovar fechava também a análise atrás
      // dela — sem perguntar, quando a análise não estava suja — e o texto
      // digitado ia com ela.
      if (e.key === 'Escape' && ehTopo()) requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, requestClose, ehTopo])

  if (!open) return null

  // AS LARGURAS DA AMOSTRA, EM PX. As da escala (max-w-md…) são em rem e, com o
  // <html> em 12px, encolhiam um quarto: a janela média tinha 432px, e a pequena,
  // 336px — estreita a ponto de quebrar o título da confirmação em três linhas.
  const sizes = {
    sm: 'max-w-[420px]',
    md: 'max-w-[560px]',
    lg: 'max-w-[820px]',
    xl: 'max-w-[1080px]',
  }

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-veu/50 p-4 backdrop-blur-[2px] sm:p-6"
      onClick={(e) => {
        // Fecha só quando o clique é no próprio overlay, não dentro do painel.
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          // `my-auto` CENTRA a janela (como na amostra) sem cortar o topo: se ela
          // for mais alta que a tela, as margens automáticas viram zero e o
          // fundo rola, em vez de a janela sair por cima.
          'animate-modal-in my-auto w-full rounded-janela bg-superficie shadow-nivel-3 outline-none',
          sizes[size],
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Cabeçalho sem divisória, como na amostra: o rodapé é que se separa,
            porque é ele que fica parado enquanto o corpo rola. */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="font-display text-xl font-extrabold tracking-tight text-texto"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-corpo text-texto-2">{description}</p>
            )}
          </div>
          <button
            onClick={requestClose}
            className="-mr-2 -mt-1 shrink-0 rounded-controle p-1.5 text-texto-2 transition-colors hover:bg-superficie-3 hover:text-texto"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 scrollbar-thin">
          {children}
        </div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-borda px-6 pb-6 pt-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
