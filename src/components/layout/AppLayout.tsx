import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { findNavLocation } from './navigation'
import { Assistente } from '@/components/Assistente'

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
    <div className="flex h-screen overflow-hidden bg-papel">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          {/* max-width evita tabelas esticadas de ponta a ponta em monitores
              largos; key={pathname} re-anima a entrada a cada troca de rota. */}
          <div
            key={pathname}
            className="animate-page mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8"
          >
            <Outlet />
          </div>
        </main>
      </div>
      {/* Fora do <main>: é fixo na tela e acompanha a pessoa em todas as
          páginas, em vez de rolar junto com o conteúdo. */}
      <Assistente />
    </div>
  )
}
