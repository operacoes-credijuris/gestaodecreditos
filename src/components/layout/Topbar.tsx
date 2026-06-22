import { useState } from 'react'
import { Menu, LogOut, ChevronDown } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/Badge'

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, profile, isAdmin, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  const nome = profile?.nome || user?.email || 'Usuário'
  const iniciais = nome
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
      <button
        onClick={onOpenMenu}
        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex-1" />

      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">
            {iniciais}
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-sm font-medium leading-tight text-slate-800">
              {nome}
            </p>
            <p className="text-xs leading-tight text-slate-500">
              {user?.email}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
              <div className="px-2 py-2">
                <p className="text-sm font-medium text-slate-800">{nome}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
                <div className="mt-1">
                  <Badge tone={isAdmin ? 'purple' : 'gray'}>
                    {isAdmin ? 'Administrador' : 'Usuário'}
                  </Badge>
                </div>
              </div>
              <div className="my-1 border-t border-slate-100" />
              <button
                onClick={() => {
                  setMenuOpen(false)
                  void signOut()
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
