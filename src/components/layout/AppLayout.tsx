import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { findNavLocation } from './navigation'

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()

  // Título da aba do navegador acompanha a página ("Tarefas — Credijuris").
  useEffect(() => {
    const nav = findNavLocation(pathname)
    document.title = nav
      ? `${nav.leaf.label} — Credijuris`
      : 'Credijuris — Gestão de Cessões'
  }, [pathname])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          {/* max-width evita tabelas esticadas de ponta a ponta em monitores largos */}
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
