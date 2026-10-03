import { Fragment, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu, LogOut, ChevronDown, ChevronRight, Search, Sparkles, Command, BookOpen, Moon, Sun } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/IconButton'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/cn'
import { haDialogoAberto } from '@/lib/dialogo'
import { alternarTema, OPCOES_DE_TEMA, useTema } from '@/lib/tema'
import { caminhoNoTopo } from './navigation'
import { useConsultas } from './Consultas'

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { user, profile, isAdmin, signOut } = useAuth()
  const toast = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const botaoDoMenuRef = useRef<HTMLButtonElement>(null)
  const caixaDoMenuRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  const partes = caminhoNoTopo(pathname)
  const { abrirBusca, abrirNovidades, abrirAtalhos, abrirGlossario } = useConsultas()
  const { preferencia, tema, escolher } = useTema()
  const escuro = tema === 'escuro'

  // ESC FECHA O MENU DO USUÁRIO e devolve o foco ao botão que o abriu, como
  // todo menu da amostra. Só a camada de cima responde: com uma janela aberta
  // por cima (a busca do Ctrl+K), o Escape é dela. E PARA AQUI — sem isso, o
  // mesmo Escape fechava também o assistente aberto ao lado.
  useEffect(() => {
    if (!menuOpen) return
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== 'Escape' || haDialogoAberto()) return
      e.stopPropagation()
      setMenuOpen(false)
      botaoDoMenuRef.current?.focus()
    }
    // CLIQUE FORA FECHA. Era uma camada `fixed inset-0` atrás do menu, mas o
    // topo tem `backdrop-blur`, e um filtro no ancestral faz o `fixed` se medir
    // por ELE, e não pela janela: a camada cobria só os 64px do topo. Clicar na
    // página deixava o menu aberto (e o clique passava para a tela). Agora é o
    // mesmo jeito do "?" da tela e dos menus do assistente: o toque fora do
    // menu, em qualquer lugar.
    function aoTocarFora(e: MouseEvent) {
      if (!caixaDoMenuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', aoTeclar)
    document.addEventListener('mousedown', aoTocarFora)
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.removeEventListener('mousedown', aoTocarFora)
    }
  }, [menuOpen])

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
    // No meio, a BUSCA GERAL (Ctrl+K, item "Novo" da amostra).
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
        className="flex min-w-0 shrink items-center gap-1.5 text-corpo text-texto-3"
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

      {/* O `.cmdk` da amostra: no meio do topo, até 460px; no celular, só a lupa. */}
      <button
        type="button"
        onClick={abrirBusca}
        aria-label="Buscar em toda a plataforma"
        title="Buscar em toda a plataforma (Ctrl + K)"
        aria-keyshortcuts="Control+K"
        className="ml-auto flex h-[38px] w-[38px] shrink-0 items-center justify-center gap-3 rounded-campo border border-borda bg-superficie-2 text-corpo text-texto-3 transition-colors hover:border-borda-forte hover:bg-superficie md:mx-auto md:w-auto md:min-w-0 md:max-w-[460px] md:flex-1 md:shrink md:justify-start md:px-4"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden flex-1 truncate text-left md:block">
          Buscar crédito, card, contato ou tela…
        </span>
        <kbd className="hidden rounded-md border border-borda-forte bg-superficie px-1.5 py-0.5 font-sans text-xs font-semibold text-texto-2 md:block">
          Ctrl K
        </kbd>
      </button>

      {/* O `#btnTheme` da amostra: a lua liga o escuro, o sol volta ao claro.
          O nome diz o que o clique FAZ, como o título da amostra ("Modo
          escuro" / "Modo claro"). Sem atalho de teclado: a amostra não tem. O
          "Do sistema" mora no menu do usuário, ao lado. */}
      <IconButton
        label={escuro ? 'Modo claro' : 'Modo escuro'}
        icon={escuro ? <Sun className="h-[20px] w-[20px]" aria-hidden /> : <Moon className="h-[20px] w-[20px]" aria-hidden />}
        onClick={() => escolher(alternarTema(tema))}
        className="grid h-[36px] w-[36px] shrink-0 place-items-center p-0"
      />

      <div ref={caixaDoMenuRef} className="relative shrink-0">
        {/* O `.user-btn` da amostra: pílula com as iniciais na placa azul-clara,
            nome e e-mail; o contorno só aparece sob o mouse. */}
        <button
          ref={botaoDoMenuRef}
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
            {/* O `.pop` da amostra: cartão de 12px de raio com sombra de
                elemento flutuante; os itens com 36px de altura. */}
            <div className="absolute right-0 z-20 mt-2 w-[240px] rounded-2xl border border-borda bg-superficie p-1.5 shadow-nivel-2">
              {/* O `.user-card` da amostra: o avatar ao lado do nome e do
                  e-mail, e o papel logo abaixo. */}
              <div className="flex items-center gap-2.5 px-2.5 py-2">
                <div
                  className="font-display flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-marca-suave text-xs font-bold text-marca-texto"
                  aria-hidden
                >
                  {iniciais}
                </div>
                <div className="min-w-0">
                  <p className="text-corpo font-bold text-texto">{nome}</p>
                  <p className="truncate text-xs text-texto-3">{user?.email}</p>
                </div>
              </div>
              <div className="px-2.5 pb-2">
                <Badge tone={isAdmin ? 'purple' : 'gray'}>
                  {isAdmin ? 'Administrador' : 'Usuário'}
                </Badge>
              </div>
              <div className="mx-1 my-1.5 border-t border-borda" />
              {/* A AJUDA DA PLATAFORMA (itens "Novo" da amostra): as novidades
                  voltam a qualquer hora daqui, e os atalhos e o glossário
                  também abrem pelo "?" de cada tela. */}
              {(
                [
                  [Sparkles, 'Novidades desta versão', abrirNovidades],
                  [Command, 'Atalhos de teclado', abrirAtalhos],
                  [BookOpen, 'Glossário', abrirGlossario],
                ] as const
              ).map(([Icone, rotulo, abrir]) => (
                <button
                  key={rotulo}
                  onClick={() => {
                    setMenuOpen(false)
                    abrir()
                  }}
                  className="flex h-12 w-full items-center gap-3 rounded-controle px-2.5 text-corpo text-texto transition-colors hover:bg-superficie-3"
                >
                  <Icone className="h-4 w-4" aria-hidden />
                  {rotulo}
                </button>
              ))}
              <div className="mx-1 my-1.5 border-t border-borda" />
              {/* O TEMA COM AS TRÊS ESCOLHAS. A amostra só tem o botão da lua
                  (claro↔escuro); o "Do sistema", que acompanha o claro/escuro do
                  computador ao vivo, precisava de um lugar, e o menu de quem
                  está logado é onde moram as escolhas pessoais. O menu fica
                  aberto: a pessoa vê a troca e pode voltar atrás. */}
              <div className="px-2.5 pb-1.5 pt-1">
                <p id="rotulo-do-tema" className="mb-1.5 text-xs font-semibold text-texto-3">
                  Tema
                </p>
                <div
                  role="group"
                  aria-labelledby="rotulo-do-tema"
                  className="grid grid-cols-3 gap-0.5 rounded-campo border border-borda bg-superficie-3 p-1"
                >
                  {OPCOES_DE_TEMA.map((o) => (
                    <button
                      key={o.chave}
                      type="button"
                      aria-pressed={preferencia === o.chave}
                      onClick={() => escolher(o.chave)}
                      className={cn(
                        'h-[30px] whitespace-nowrap rounded-controle px-1 text-sm font-semibold transition-colors',
                        preferencia === o.chave
                          ? 'bg-superficie text-marca-texto shadow-nivel-1'
                          : 'text-texto-2 hover:text-texto',
                      )}
                    >
                      {o.rotulo}
                    </button>
                  ))}
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
