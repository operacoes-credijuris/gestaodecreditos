// Quadro econômico — a moldura das cinco abas.
//
// O QUADRO ERA UMA SEÇÃO DO MENU, com cinco itens para a mesma carteira. Virou
// um item só (Operacional › Quadro econômico) e esta moldura: o título, as abas
// e, embaixo, a tela da aba aberta (o <Outlet>).
//
// CADA ABA É UMA ROTA, não um estado da tela: trocar de aba NAVEGA e cria entrada
// no histórico — o Voltar volta à aba anterior —, e os endereços de antes
// (/inteligencia, /inteligencia/previsoes…) continuam abrindo a mesma tela, com
// favorito e link colado valendo. As abas e a ordem delas moram em
// `ABAS_DO_QUADRO` (navigation.ts), a mesma lista que acende o item do menu e
// dá o caminho no topo e o título da aba do navegador.
//
// A moldura não lê dado nenhum: cada aba continua buscando a carteira como
// antes (`usePainel`), e abrir o Quadro não faz consulta nova.

import { Suspense, useEffect, useId, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs, idDaAba } from '@/components/ui/Tabs'
import { Loading } from '@/components/ui/Table'
import { ABAS_DO_QUADRO, findNavLocation } from '@/components/layout/navigation'
import { LimiteDeErro } from '@/components/layout/LimiteDeErro'
import { cn } from '@/lib/cn'
import { gravarPreferencia, PREF_QUADRO_ABA } from '@/lib/preferencias'

const ITENS = ABAS_DO_QUADRO.map((a) => ({ key: a.to, label: a.label }))

export default function Moldura() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const painel = useId()
  // A aba vem do ENDEREÇO, pela mesma conta do caminho no topo: as duas nunca
  // discordam. A moldura só é montada nos cinco endereços dela; a Visão geral é
  // a reserva para o tipo, não um caso que aconteça.
  const ativa = findNavLocation(pathname)?.aba ?? ABAS_DO_QUADRO[0]
  const indice = ABAS_DO_QUADRO.findIndex((a) => a.to === ativa.to)

  // A ÚLTIMA ABA FICA LEMBRADA (revisão de qualidade de vida): o item do menu
  // volta a ela, e quem sempre olha as Previsões não passa pela Visão geral a
  // cada visita. Os endereços continuam os mesmos — o link para
  // /inteligencia segue abrindo a Visão geral.
  useEffect(() => {
    gravarPreferencia(PREF_QUADRO_ABA, ativa.to)
  }, [ativa.to])

  // SÓ A TROCA DE ABA ANIMA O PAINEL. A primeira aba entra junto com a página,
  // e o AppLayout já anima essa entrada; animar os dois somaria os movimentos.
  // (Guardar "já trocou" no estado durante a renderização é a forma que o React
  // recomenda para valor que depende da renderização anterior.)
  const [entrada] = useState(pathname)
  const [trocou, setTrocou] = useState(false)
  if (!trocou && pathname !== entrada) setTrocou(true)

  return (
    <div>
      <PageHeader
        title="Quadro econômico"
        description="Os números da carteira: o que foi investido, o que já voltou e o que ainda vai voltar."
      />
      <Tabs
        rotulo="Seções do quadro"
        idDoPainel={painel}
        items={ITENS}
        value={ativa.to}
        // A aba já aberta não navega de novo: seria uma entrada repetida no
        // histórico, e o Voltar pareceria não fazer nada.
        onChange={(to) => {
          if (to !== ativa.to) navigate(to)
        }}
      />
      <div
        // A chave refaz o painel a cada aba, para a animação de entrada valer
        // também na troca. A moldura e as abas ficam: o foco que a seta pôs na
        // aba nova continua nela (o AppLayout dá a mesma chave às cinco abas).
        key={pathname}
        id={painel}
        role="tabpanel"
        aria-labelledby={idDaAba(painel, indice)}
        className={cn('pt-s5', trocou && 'animate-page')}
      >
        {/* A ABA CHEGA SOB DEMANDA (App.tsx). A espera e o erro ficam AQUI,
            dentro do painel, e não no layout: lá eles trocariam a moldura
            inteira, e as abas sumiriam enquanto a aba nova baixa. E o limite do
            layout tem a mesma chave nas cinco abas — sem este, uma aba que
            falhou seguiria falhando ao trocar de aba. */}
        <LimiteDeErro>
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </LimiteDeErro>
      </div>
    </div>
  )
}
