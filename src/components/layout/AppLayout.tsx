import { Suspense, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { itemAtivo } from './navigation'
import { Assistente } from '@/components/Assistente'
import { FaixaBeta } from './FaixaBeta'
import { AcessorioDoTitulo } from '@/components/ui/PageHeader'
import { Loading } from '@/components/ui/Table'
import { ajudaDaRota } from '@/lib/ajudaDaPlataforma'
import { ProvedorDeConsultas } from './Consultas'
import { AjudaDaTela } from './AjudaDaTela'
import { LimiteDeErro } from './LimiteDeErro'
import { AvisoDeVersaoNova } from './AvisoDeVersaoNova'

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()

  // O TÍTULO DA ABA DO NAVEGADOR mora acima das rotas (TituloDaAba, no App):
  // aqui ele só aparecia depois da sessão e ficava velho na tela de Entrar.

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
      {/* `relative` NA MOLDURA E NO <main>: todo elemento `absolute` lá dentro
          (os `sr-only` dos leitores de tela, dicas, selos) passa a ter a moldura
          como referência e é cortado por ela. Sem isso, um `sr-only` abaixo da
          dobra ficava preso à página, não ao <main>: a página crescia além da
          janela, rolava, e a tela inteira subia deixando uma faixa vazia embaixo
          (visto em 03/10/2026).
          A ALTURA É A DA JANELA VISÍVEL (`dvh`), e não `100vh`: no celular o
          `100vh` é a altura com a barra de endereço ESCONDIDA, e com ela à vista
          o rodapé da tela ficava atrás da barra do navegador. Navegador sem
          `dvh` fica no `h-screen` de antes. */}
      <div className="relative flex h-screen overflow-hidden bg-papel supports-[height:100dvh]:h-dvh">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <FaixaBeta />
          <Topbar onOpenMenu={() => setMobileOpen(true)} />
          <main className="relative flex-1 overflow-y-auto scrollbar-thin">
            {/* max-width evita tabelas esticadas de ponta a ponta em monitores
                largos; a chave re-anima a entrada a cada troca de tela. Medidas
                do `.content` da amostra: 1360px no máximo e 24px de respiro
                (15px no celular). */}
            <div
              key={chave}
              className="animate-page mx-auto w-full max-w-[1360px] px-5 py-8 lg:px-8"
            >
              <AcessorioDoTitulo.Provider value={frases ? <AjudaDaTela frases={frases} /> : null}>
                {/* A TELA CHEGA SOB DEMANDA (App.tsx): enquanto o pedaço dela
                    baixa, o esqueleto de carregamento; se falhar ao desenhar —
                    ou o pedaço não vier —, o aviso do limite de erro, com o menu
                    e o topo de pé. A chave do limite é a mesma da tela: ir a
                    outra tela o desfaz. */}
                <LimiteDeErro key={chave}>
                  <Suspense fallback={<Loading />}>
                    <Outlet />
                  </Suspense>
                </LimiteDeErro>
              </AcessorioDoTitulo.Provider>
            </div>
          </main>
        </div>
        {/* Fora do <main>: é fixo na tela e acompanha a pessoa em todas as
            páginas, em vez de rolar junto com o conteúdo. */}
        <Assistente />
        {/* "Há uma versão nova — recarregar": avisa e espera a pessoa (lib/versaoNova.ts). */}
        <AvisoDeVersaoNova />
      </div>
    </ProvedorDeConsultas>
  )
}
