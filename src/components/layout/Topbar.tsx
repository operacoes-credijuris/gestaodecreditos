import { Fragment, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu, LogOut, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/components/ui/Toast'
import { caminhoNoTopo } from './navigation'

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, profile, isAdmin, signOut } = useAuth()
  const toast = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  const partes = caminhoNoTopo(pathname)

  const nome = profile?.nome || user?.email || 'Usuário'
  const iniciais = nome
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    // O `.topbar` da amostra: 64px, a superfície quase opaca com desfoque (o
    // conteúdo passa por baixo sem sumir de vez) e 24px de margem lateral.
    // A BUSCA GERAL (Ctrl+K) da amostra é item "Novo" e entra na onda 3; até lá
    // o caminho ocupa o espaço dela.
    <header className="sticky top-0 z-30 flex h-[64px] shrink-0 items-center justify-between gap-3 border-b border-borda bg-superficie/[0.86] px-4 backdrop-blur-[10px] lg:px-8">
      <button
        onClick={onOpenMenu}
        className="rounded-controle p-2 text-texto-2 transition-colors hover:bg-superficie-3 hover:text-texto lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-6 w-6" />
      </button>

      {/* Breadcrumb de localização: "Setor › Página", e "› Aba" numa moldura
          ("Operacional › Quadro econômico › Previsões"). A Análise de crédito,
          sem setor, mostra só o próprio nome. No celular, só a última parte.
          Como na amostra: o caminho no cinza de metadado e o lugar atual em
          negrito na fonte de display. */}
      <nav
        aria-label="Você está em"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-corpo text-texto-3"
      >
        {partes.map((parte, i) =>
          i === partes.length - 1 ? (
            <span
              key={i}
              aria-current="page"
              className="font-display truncate text-lg font-bold tracking-tight text-texto"
            >
              {parte}
            </span>
          ) : (
            <Fragment key={i}>
              <span className="hidden shrink-0 sm:inline">{parte}</span>
              <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 sm:inline" aria-hidden />
            </Fragment>
          ),
        )}
      </nav>

      <div className="relative">
        {/* O `.user-btn` da amostra: pílula com as iniciais na placa azul-clara,
            nome e e-mail; o contorno só aparece sob o mouse. */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          className="flex items-center gap-2 rounded-full border border-transparent py-0.5 pl-0.5 pr-2 transition-colors hover:border-borda hover:bg-superficie-3"
        >
          <div className="font-display flex h-11 w-11 items-center justify-center rounded-full bg-marca-suave text-sm font-bold text-marca-texto">
            {iniciais}
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-sm font-bold leading-tight text-texto">
              {nome}
            </p>
            <p className="text-xs leading-tight text-texto-3">
              {user?.email}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 text-texto-3" aria-hidden />
        </button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setMenuOpen(false)}
            />
            {/* O `.pop` da amostra: cartão de 12px de raio com sombra de
                elemento flutuante; os itens com 36px de altura. */}
            <div className="absolute right-0 z-20 mt-2 w-[240px] rounded-2xl border border-borda bg-superficie p-1.5 shadow-nivel-2">
              <div className="px-2.5 py-2">
                <p className="text-corpo font-bold text-texto">{nome}</p>
                <p className="truncate text-xs text-texto-3">{user?.email}</p>
                <div className="mt-1.5">
                  <Badge tone={isAdmin ? 'purple' : 'gray'}>
                    {isAdmin ? 'Administrador' : 'Usuário'}
                  </Badge>
                </div>
              </div>
              <div className="mx-1 my-1.5 border-t border-borda" />
              <button
                onClick={async () => {
                  setMenuOpen(false)
                  // Saída que falha no servidor tem de aparecer: em terminal
                  // compartilhado, "achei que saí" é o cenário que expõe a conta.
                  const { error } = await signOut()
                  if (error) toast.error(error)
                }}
                className="flex h-12 w-full items-center gap-3 rounded-controle px-2.5 text-corpo text-texto transition-colors hover:bg-superficie-3"
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
