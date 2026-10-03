import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { itemAtivo, tituloDaAba } from './navigation'
import { Assistente } from '@/components/Assistente'
import { FaixaBeta } from './FaixaBeta'
import { tituloDoCanal } from '@/lib/canal'
import { AcessorioDoTitulo } from '@/components/ui/PageHeader'
import { ajudaDaRota } from '@/lib/ajudaDaPlataforma'
import { ProvedorDeConsultas } from './Consultas'
import { AjudaDaTela } from './AjudaDaTela'

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()

  // Título da aba do navegador acompanha a página ("Tarefas — Credijuris") e,
  // no Quadro econômico, a aba aberta ("Previsões — Credijuris").
  useEffect(() => {
    document.title = tituloDoCanal(tituloDaAba(pathname))
  }, [pathname])

  // A CHAVE É A DO ITEM DO MENU, e não o endereço: as cinco abas do Quadro são
  // cinco endereços de um item só, e trocar de aba não pode desmontar a moldura.
  // Desmontada, ela levaria junto a aba que acabou de receber o foco pela seta
  // (o Tabs foca a aba nova logo depois de navegar), e o teclado cairia no topo
  // da página. A troca de aba anima só o painel, dentro da moldura. Endereço sem
  // item (a página não encontrada) segue com a chave do próprio endereço.
  const chave = itemAtivo(pathname) ?? pathname

  // O "?" DA TELA (item "Novo" da amostra), ao lado do título de toda tela que
  // tem ajuda — posto aqui, pelo contexto do PageHeader, sem cada tela passá-lo.
  const frases = ajudaDaRota(pathname)

  return (
    <ProvedorDeConsultas>
      <div className="flex h-screen overflow-hidden bg-papel">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <FaixaBeta />
          <Topbar onOpenMenu={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-y-auto scrollbar-thin">
            {/* max-width evita tabelas esticadas de ponta a ponta em monitores
                largos; a chave re-anima a entrada a cada troca de tela. Medidas
                do `.content` da amostra: 1360px no máximo e 24px de respiro
                (15px no celular). */}
            <div
              key={chave}
              className="animate-page mx-auto w-full max-w-[1360px] px-5 py-8 lg:px-8"
            >
              <AcessorioDoTitulo.Provider value={frases ? <AjudaDaTela frases={frases} /> : null}>
                <Outlet />
              </AcessorioDoTitulo.Provider>
            </div>
          </main>
        </div>
        {/* Fora do <main>: é fixo na tela e acompanha a pessoa em todas as
            páginas, em vez de rolar junto com o conteúdo. */}
        <Assistente />
      </div>
    </ProvedorDeConsultas>
  )
}
