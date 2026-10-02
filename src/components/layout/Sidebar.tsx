import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import { useAuth } from '@/contexts/AuthContext'
import { NAVIGATION, NAV_CONFIG, itemAtivo, type NavLeaf } from './navigation'
import marca from '@/assets/marca-credijuris.png'

function LeafLink({
  item: { to, label, icon: Icon },
  ativo,
  forte = false,
  onNavigate,
}: {
  item: NavLeaf
  /** Se o item está aceso — decidido por `itemAtivo`, um só para o menu inteiro. */
  ativo: boolean
  /** Em negrito: o item do topo, fora das seções (o `.sb-topo` da amostra). */
  forte?: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      to={to}
      // QUEM ACENDE O ITEM É `itemAtivo` (navigation.ts), não o casamento do
      // NavLink. O Quadro econômico é um item só que precisa ficar aceso nas
      // cinco abas, e o NavLink só faz isso por PREFIXO (sem o `end`) — o
      // defeito corrigido em e9c405e, em que "Visão Geral" (/inteligencia) ficava
      // aceso junto com as subtelas embaixo dele. `itemAtivo` acende pelos
      // endereços que cada item declara, por igualdade.
      aria-current={ativo ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        // O `.sb-link` da amostra: 38px, 14px, o azul-claro do menu e, aceso,
        // o fundo azul do item com a BARRA VERDE NA BORDA DO MENU — o `before`
        // fica 12px para fora do item, encostado na lateral (o `px-4` do <nav>).
        // A barra é desenhada por cima, então o rótulo não "pula" quando ela
        // aparece. O rótulo longo quebra em duas linhas em vez de sumir em "…".
        'relative flex min-h-[38px] items-center gap-3 rounded-controle px-3 py-1.5 text-corpo transition-colors',
        forte ? 'font-bold' : 'font-medium',
        ativo
          ? 'bg-nav-ativo text-white before:absolute before:-left-4 before:inset-y-2 before:w-[3px] before:rounded-r before:bg-acento'
          : 'text-nav-texto hover:bg-white/[0.06] hover:text-white',
      )}
    >
      <Icon className="h-6 w-6 shrink-0" aria-hidden />
      <span className="leading-tight">{label}</span>
    </Link>
  )
}

export function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean
  onClose: () => void
}) {
  const { isAdmin } = useAuth()
  const { pathname } = useLocation()
  // UM ITEM ACESO, NO MÁXIMO, para o menu inteiro (ver `itemAtivo`).
  const ativo = itemAtivo(pathname)

  // Drawer mobile animado: `rendered` mantém o nó montado durante a saída;
  // `visible` controla as classes de "aberto" (translate/fade).
  const [rendered, setRendered] = useState(mobileOpen)
  const [visible, setVisible] = useState(mobileOpen)
  const painelRef = useRef<HTMLDivElement>(null)
  const ehTopo = useFocoPreso(mobileOpen, painelRef)
  useTravaScroll(mobileOpen)

  useEffect(() => {
    if (mobileOpen) {
      setRendered(true)
      // Dois rAFs garantem que o navegador pinte o estado inicial (fechado)
      // antes de aplicar as classes de aberto — senão a transição não ocorre.
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
    // Desmonta só depois da animação de saída (mesma duração do duration-200).
    const timer = setTimeout(() => setRendered(false), 200)
    return () => clearTimeout(timer)
  }, [mobileOpen])

  // Fecha o drawer mobile com Escape.
  useEffect(() => {
    if (!mobileOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && ehTopo()) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen, onClose])

  const content = (
    // O navy chapado da amostra (--nav-bg), e não o degradê de antes.
    <div className="flex h-full flex-col bg-nav text-white">
      <div className="flex h-[64px] shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] px-5">
        <div className="flex min-w-0 items-center gap-3">
          {/* A logomarca real (o "U" azul #0B81C5) sobre placa branca: é a
              única forma fiel de exibi-la no fundo navy sem recolorir a marca.
              BRANCO FIXO, e não `bg-superficie`: no modo escuro a superfície
              escurece, e a placa tem de continuar branca. */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm">
            <img src={marca} alt="" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-xl font-extrabold leading-tight tracking-tight">
              Credijuris
            </p>
            <p className="text-xs text-nav-apagado">Gestão de Créditos</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-controle p-1.5 text-nav-apagado transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Fechar menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-4 pb-5 pt-4 scrollbar-thin">
        {NAVIGATION.map((section, idx) => {
          // A seção que contém a rota ativa fica mais visível — responde
          // "em que setor do negócio estou?" sem varrer a lista inteira. Pelo
          // MESMO item aceso, para o título do setor e o item nunca discordarem.
          const sectionActive = section.items.some((i) => i.to === ativo)
          return (
            <div
              key={idx}
              className={cn(
                'space-y-0.5',
                // A seção sem título (a Análise de crédito, no topo) fica
                // separada das outras por uma linha, com o item em negrito.
                !section.title && 'border-b border-white/10 pb-4',
              )}
            >
              {/* A seção sem título desenha só o item. */}
              {section.title && (
                <p
                  className={cn(
                    'font-display px-3 pb-1.5 text-xs font-bold uppercase tracking-wider',
                    sectionActive ? 'text-acento' : 'text-nav-apagado',
                  )}
                >
                  {section.title}
                </p>
              )}
              {section.items.map((item) => (
                <LeafLink
                  key={item.to}
                  item={item}
                  ativo={item.to === ativo}
                  forte={!section.title}
                  onNavigate={onClose}
                />
              ))}
            </div>
          )
        })}
      </nav>

      {isAdmin && (
        <div className="border-t border-white/[0.07] px-4 py-3">
          <LeafLink item={NAV_CONFIG} ativo={NAV_CONFIG.to === ativo} onNavigate={onClose} />
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop: 256px, a largura do menu da amostra. Em px porque o w-64 da
          escala vale 192px com o <html> em 12px, e os nomes longos quebravam. */}
      <aside className="hidden w-[256px] shrink-0 lg:block">{content}</aside>

      {/* Mobile drawer */}
      {rendered && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navegação"
        >
          <div
            className={cn(
              'absolute inset-0 bg-veu/50 transition-opacity duration-200',
              visible ? 'opacity-100' : 'opacity-0',
            )}
            onClick={onClose}
          />
          <div
            ref={painelRef}
            tabIndex={-1}
            className={cn(
              'absolute inset-y-0 left-0 w-[272px] max-w-[85vw] outline-none transition-transform duration-200',
              visible ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            {content}
          </div>
        </div>
      )}
    </>
  )
}
