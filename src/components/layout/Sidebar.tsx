import { NavLink } from 'react-router-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/contexts/AuthContext'
import { NAVIGATION, NAV_CONFIG } from './navigation'

function LeafLink({
  to,
  label,
  icon: Icon,
  onNavigate,
}: {
  to: string
  label: string
  icon: typeof NAV_CONFIG.icon
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-brand-700 text-white'
            : 'text-brand-100 hover:bg-brand-800/60 hover:text-white',
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="truncate">{label}</span>
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
  const content = (
    <div className="flex h-full flex-col bg-brand-900 text-white">
      <div className="flex items-center justify-between gap-2 border-b border-brand-800 px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 font-bold text-gold-400">
            C
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Credijuris</p>
            <p className="text-xs text-brand-300">Gestão de Cessões</p>
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
        {NAVIGATION.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {section.title && (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-brand-400">
                {section.title}
              </p>
            )}
            {section.items.map((item) => (
              <LeafLink key={item.to} {...item} onNavigate={onClose} />
            ))}
          </div>
        ))}
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
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={onClose}
          />
          <div className="absolute inset-y-0 left-0 w-64">{content}</div>
        </div>
      )}
    </>
  )
}
