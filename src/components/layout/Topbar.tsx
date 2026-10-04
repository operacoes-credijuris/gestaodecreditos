import { Fragment, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu, LogOut, ChevronDown, ChevronRight, Search, Sparkles, Command, BookOpen, Moon, Sun } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/IconButton'
import { Tecla } from '@/components/ui/Tecla'
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
  // NO BOTÃO, SÓ O PRIMEIRO NOME (auditoria visual, M1): nome e e-mail eram
  // cerca de 200px de ruído no topo. O nome inteiro e o e-mail ficam no menu.
  const primeiroNome = profile?.nome?.trim().split(/\s+/)[0] || nome
  const iniciais = nome
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    // O `.topbar` da amostra: 64px, a superfície quase opaca com desfoque (o
    // conteúdo passa por baixo sem sumir de vez).
    //
    // TRÊS COLUNAS NO COMPUTADOR (auditoria visual, M1): o caminho à esquerda,
    // a BUSCA SEMPRE NO MEIO e as ações à direita. Antes a busca era `flex-1`
    // com `mx-auto`, e o lugar dela dependia do comprimento do caminho: começava
    // em x≈538 em Configurações e em x≈645 em Publicações — um alvo usado toda
    // hora não pode andar. No celular, a fila de sempre.
    <header className="sticky top-0 z-topo flex h-[64px] shrink-0 items-center gap-s2 border-b border-borda bg-superficie/[0.86] px-s3 backdrop-blur-[10px] md:grid md:grid-cols-[minmax(0,1fr)_minmax(240px,460px)_minmax(0,1fr)] md:gap-s4 md:px-s6">
      <div className="flex min-w-0 flex-1 items-center gap-s2">
        <button
          onClick={onOpenMenu}
          className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-controle text-texto-2 transition-colors hover:bg-superficie-3 hover:text-texto lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu className="h-[20px] w-[20px]" aria-hidden />
        </button>

        {/* Breadcrumb de localização: "Setor › Página", e "› Aba" numa moldura
            ("Operacional › Quadro econômico › Previsões"). A Análise de
            crédito, sem setor, mostra só o próprio nome. No celular, só a
            última parte. O LUGAR ATUAL SEM A FONTE DE TÍTULO (auditoria visual,
            M1): em 16px de display ele competia com o h1 da tela, logo abaixo,
            que diz a mesma coisa. Fica no seminegrito do texto — ainda útil
            quando o h1 sai da tela na rolagem. */}
        <nav
          aria-label="Você está em"
          className="flex min-w-0 items-center gap-s1.5 text-corpo text-texto-3"
        >
          {partes.map((parte, i) =>
            i === partes.length - 1 ? (
              <span key={i} aria-current="page" className="truncate font-semibold text-texto-2">
                {parte}
              </span>
            ) : (
              <Fragment key={i}>
                <span className="hidden shrink-0 whitespace-nowrap sm:inline">{parte}</span>
                <ChevronRight className="hidden h-[14px] w-[14px] shrink-0 sm:inline" aria-hidden />
              </Fragment>
            ),
          )}
        </nav>
      </div>

      {/* O `.cmdk` da amostra: no meio do topo, de 240 a 460px; no celular, só
          a lupa, sem contorno, igual aos botões vizinhos. */}
      <button
        type="button"
        onClick={abrirBusca}
        aria-label="Buscar em toda a plataforma"
        title="Buscar em toda a plataforma (Ctrl + K)"
        aria-keyshortcuts="Control+K"
        className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-controle text-texto-2 transition-colors hover:bg-superficie-3 hover:text-texto md:flex md:h-controle md:w-full md:items-center md:justify-start md:gap-s2 md:rounded-campo md:border md:border-borda md:bg-superficie-2 md:px-s3 md:text-corpo md:text-texto-3 md:hover:border-borda-forte md:hover:bg-superficie"
      >
        <Search className="h-[16px] w-[16px] shrink-0" aria-hidden />
        <span className="hidden flex-1 truncate text-left md:block">
          Buscar crédito, card, contato ou tela…
        </span>
        <span className="hidden md:block">
          <Tecla>Ctrl K</Tecla>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-s1 md:justify-self-end">
        {/* O `#btnTheme` da amostra: a lua liga o escuro, o sol volta ao claro.
            O nome diz o que o clique FAZ, como o título da amostra ("Modo
            escuro" / "Modo claro"). Sem atalho de teclado: a amostra não tem.
            O "Do sistema" mora no menu do usuário, ao lado. */}
        <IconButton
          label={escuro ? 'Modo claro' : 'Modo escuro'}
          icon={escuro ? <Sun className="h-[20px] w-[20px]" aria-hidden /> : <Moon className="h-[20px] w-[20px]" aria-hidden />}
          onClick={() => escolher(alternarTema(tema))}
          className="grid h-[36px] w-[36px] shrink-0 place-items-center p-0"
        />

        <div ref={caixaDoMenuRef} className="relative shrink-0">
          {/* O `.user-btn` da amostra: pílula com as iniciais na placa
              azul-clara e o primeiro nome; o contorno só aparece sob o mouse. */}
          <button
            ref={botaoDoMenuRef}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={`Menu de ${nome}`}
            className="flex items-center gap-s2 rounded-full border border-transparent py-s0.5 pl-s0.5 pr-s2 transition-colors hover:border-borda hover:bg-superficie-3"
          >
            <div
              className="font-display flex h-[32px] w-[32px] items-center justify-center rounded-full bg-marca-suave text-xs font-bold text-marca-texto"
              aria-hidden
            >
              {iniciais}
            </div>
            <span className="hidden max-w-[140px] truncate text-sm font-semibold text-texto sm:block">
              {primeiroNome}
            </span>
            <ChevronDown className="h-[16px] w-[16px] text-texto-3" aria-hidden />
          </button>

          {menuOpen && (
            // O `.pop` da amostra: o raio dos flutuantes (12px) e a sombra de
            // elemento flutuante; no escuro, o anel claro que o separa da
            // página (auditoria visual, E3). Itens com 36px de altura.
            <div className="absolute right-0 z-20 mt-s2 w-[240px] rounded-flutuante border border-borda bg-superficie p-s1.5 shadow-nivel-2 dark:ring-1 dark:ring-white/[0.06]">
              {/* O `.user-card` da amostra: o avatar ao lado do nome e do
                  e-mail, e o papel logo abaixo. */}
              <div className="flex items-center gap-s2 px-s2 py-s2">
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
              <div className="px-s2 pb-s2">
                <Badge tone={isAdmin ? 'purple' : 'gray'}>
                  {isAdmin ? 'Administrador' : 'Usuário'}
                </Badge>
              </div>
              <div className="mx-s1 my-s1.5 border-t border-borda" />
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
                  className="flex h-12 w-full items-center gap-s3 rounded-controle px-s2 text-corpo text-texto transition-colors hover:bg-superficie-3"
                >
                  <Icone className="h-[16px] w-[16px]" aria-hidden />
                  {rotulo}
                </button>
              ))}
              <div className="mx-s1 my-s1.5 border-t border-borda" />
              {/* O TEMA COM AS TRÊS ESCOLHAS. A amostra só tem o botão da lua
                  (claro↔escuro); o "Do sistema", que acompanha o claro/escuro
                  do computador ao vivo, precisava de um lugar, e o menu de quem
                  está logado é onde moram as escolhas pessoais. O menu fica
                  aberto: a pessoa vê a troca e pode voltar atrás. */}
              <div className="px-s2 pb-s1.5 pt-s1">
                <p id="rotulo-do-tema" className="mb-s1.5 text-xs font-semibold text-texto-3">
                  Tema
                </p>
                <div
                  role="group"
                  aria-labelledby="rotulo-do-tema"
                  className="grid grid-cols-3 gap-s0.5 rounded-campo border border-borda bg-superficie-3 p-s1"
                >
                  {OPCOES_DE_TEMA.map((o) => (
                    <button
                      key={o.chave}
                      type="button"
                      aria-pressed={preferencia === o.chave}
                      onClick={() => escolher(o.chave)}
                      className={cn(
                        'h-[30px] whitespace-nowrap rounded-controle px-s1 text-sm font-semibold transition-colors',
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
              <div className="mx-s1 my-s1.5 border-t border-borda" />
              <button
                onClick={async () => {
                  setMenuOpen(false)
                  // Saída que falha no servidor tem de aparecer: em terminal
                  // compartilhado, "achei que saí" é o cenário que expõe a conta.
                  const { error } = await signOut()
                  if (error) toast.error(error)
                }}
                className="flex h-12 w-full items-center gap-s3 rounded-controle px-s2 text-corpo text-texto transition-colors hover:bg-superficie-3"
              >
                <LogOut className="h-[16px] w-[16px]" aria-hidden />
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
