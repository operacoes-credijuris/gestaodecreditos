import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFocoPreso, useTravaScroll } from '@/lib/dialogo'
import { useAuth } from '@/contexts/AuthContext'
import { NAVIGATION, NAV_CONFIG } from './navigation'
import marca from '@/assets/marca-credijuris.png'

function LeafLink({
  to,
  label,
  icon: Icon,
  onNavigate,
}: {
  to: string
  label: string
  icon: LucideIcon
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          // borda esquerda sempre presente (transparente) para o item não
          // "pular" quando o indicador verde do ativo aparece
          'flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'border-verde-400 bg-brand-700 text-white'
            : 'border-transparent text-brand-100 hover:bg-brand-800/60 hover:text-white',
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="leading-tight">{label}</span>
    </NavLink>
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

  // Drawer mobile animado: `rendered` mantém o nó montado durante a saída;
  // `visible` controla as classes de "aberto" (translate/fade).
  const [rendered, setRendered] = useState(mobileOpen)
  const [visible, setVisible] = useState(mobileOpen)
  const painelRef = useRef<HTMLDivElement>(null)
  useFocoPreso(mobileOpen, painelRef)
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
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen, onClose])

  const content = (
    <div className="flex h-full flex-col bg-gradient-to-b from-brand-900 to-brand-950 text-white">
      <div className="flex items-center justify-between gap-2 border-b border-brand-800 px-5 py-4">
        <div className="flex items-center gap-2.5">
          {/* A logomarca real (o "U" azul #0B81C5) sobre placa branca: é a
              única forma fiel de exibi-la no fundo navy sem recolorir a marca. */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white p-1.5 shadow-sm">
            <img src={marca} alt="" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="text-base font-bold leading-tight tracking-tight">
              Credijuris
            </p>
            <p className="text-xs text-brand-300">Gestão de Créditos</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-brand-300 hover:bg-brand-800 lg:hidden"
          aria-label="Fechar menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4 scrollbar-thin">
        {NAVIGATION.map((section, idx) => {
          // A seção que contém a rota ativa fica mais visível — responde
          // "em que setor do negócio estou?" sem varrer a lista inteira.
          const sectionActive = section.items.some(
            (i) => pathname === i.to || pathname.startsWith(`${i.to}/`),
          )
          return (
            <div key={idx} className="space-y-1">
              {section.title && (
                <p
                  className={cn(
                    'px-3 pb-1 text-xs font-semibold uppercase tracking-wider',
                    sectionActive ? 'text-verde-400' : 'text-brand-300',
                  )}
                >
                  {section.title}
                </p>
              )}
              {section.items.map((item) => (
                <LeafLink key={item.to} {...item} onNavigate={onClose} />
              ))}
            </div>
          )
        })}
      </nav>

      {isAdmin && (
        <div className="border-t border-brand-800 px-3 py-3">
          <LeafLink {...NAV_CONFIG} onNavigate={onClose} />
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-64 shrink-0 lg:block">{content}</aside>

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
              'absolute inset-0 bg-slate-900/50 transition-opacity duration-200',
              visible ? 'opacity-100' : 'opacity-0',
            )}
            onClick={onClose}
          />
          <div
            ref={painelRef}
            tabIndex={-1}
            className={cn(
              'absolute inset-y-0 left-0 w-64 outline-none transition-transform duration-200',
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
