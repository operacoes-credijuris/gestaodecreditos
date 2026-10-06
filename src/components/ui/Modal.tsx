import type { ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import { perguntarDescarte } from '@/lib/descarte'
import { useJanelaAberta } from '@/lib/janelasAbertas'

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
  rodapeInicio,
  size = 'md',
  dirty = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  /**
   * O rodapé, À DIREITA: `[Cancelar/Fechar] [Primário]`, nessa ordem — o
   * primário por último, no canto (auditoria visual de 03/10/2026, §0.6/C8).
   */
  footer?: ReactNode
  /**
   * O que vai À ESQUERDA do rodapé: a ação destrutiva ou alternativa
   * ("Reprovar", "Exigir diligência"), longe do primário. Antes havia três
   * ordens de rodapé, e na due diligence o "Seguir" (primário) ficava à
   * esquerda.
   */
  rodapeInicio?: ReactNode
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
  // O CTRL+K PERGUNTA AQUI se a janela está alterada (o mesmo `dirty` do
  // "Descartar alterações?"): alterada, ele avisa; sem alteração, fecha esta
  // janela e abre a busca no lugar dela (lib/janelasAbertas.ts).
  useJanelaAberta(open, dirty, onClose)

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

  // AS LARGURAS, EM PX (auditoria visual de 03/10/2026, C8): confirmação,
  // formulário, consulta e a due diligence/certidões. As da escala (max-w-md…)
  // são em rem e, com o <html> em 12px, encolhiam um quarto.
  const sizes = {
    sm: 'max-w-[480px]',
    md: 'max-w-[640px]',
    lg: 'max-w-[960px]',
    xl: 'max-w-[1080px]',
  }

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-janela flex items-start justify-center overflow-y-auto bg-veu/50 p-4 backdrop-blur-[2px] scrollbar-thin sm:p-6"
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
          // No escuro, a sombra não separa a janela da página: o anel claro sim
          // (auditoria visual, E3).
          'animate-modal-in my-auto w-full rounded-janela bg-superficie shadow-nivel-3 outline-none dark:ring-1 dark:ring-white/[0.06]',
          sizes[size],
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Cabeçalho sem divisória, como na amostra: o rodapé é que se separa,
            porque é ele que fica parado enquanto o corpo rola. */}
        <div className="flex items-start justify-between gap-s3 px-s5 pt-s5">
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
          {/* O X COM ALVO DE 32PX e ícone de 18px (era 24px de alvo). */}
          <button
            onClick={requestClose}
            className="-mr-s2 -mt-s1 grid h-[32px] w-[32px] shrink-0 place-items-center rounded-controle text-texto-2 transition-colors hover:bg-superficie-3 hover:text-texto"
            aria-label="Fechar"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
        {/* `relative` NO CORPO QUE ROLA: um `sr-only` (ou outro `absolute` sem
            caixa posicionada em volta) abaixo da dobra se media pelo FUNDO da
            janela, que também rola — o fundo crescia, rolava, e a janela subia
            deixando um vão embaixo. O mesmo defeito da moldura do layout. */}
        <div className="relative max-h-[70vh] overflow-y-auto px-s5 py-s4 scrollbar-thin">
          {children}
        </div>
        {(footer || rodapeInicio) && (
          <div className="flex flex-wrap items-center justify-end gap-s2 border-t border-borda px-s5 pb-s5 pt-s3">
            {rodapeInicio && <div className="mr-auto flex flex-wrap items-center gap-s2">{rodapeInicio}</div>}
            {/* CANCELAR E A AÇÃO PRINCIPAL ANDAM JUNTOS: sem o grupo, no celular
                cada botão quebrava a linha sozinho e o par se separava (revisão
                visual 2, 05/10/2026). */}
            {footer && <div className="ml-auto flex flex-wrap items-center justify-end gap-s2">{footer}</div>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
