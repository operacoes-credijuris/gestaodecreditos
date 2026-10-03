import { Routes, Route, Navigate } from 'react-router-dom'
import { INICIO } from '@/components/layout/navigation'
import { ProtectedRoute, AdminRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'
import MolduraDoQuadro from '@/pages/inteligencia/Moldura'
import { telaSobDemanda } from '@/lib/telaSobDemanda'

// AS TELAS VÊM SOB DEMANDA (lib/telaSobDemanda.ts): cada uma é um pedaço do
// pacote, baixado quando se abre. Ficam no pacote de entrada só o Entrar (a
// primeira coisa que quem está sem sessão vê), a página não encontrada e a
// moldura do Quadro (as abas continuam à vista enquanto a aba aberta chega). A
// Análise de crédito é o início: começa a baixar já, junto com a sessão.
const InteligenciaVisaoGeral = telaSobDemanda(() => import('@/pages/inteligencia/VisaoGeral'))
const InteligenciaPerformance = telaSobDemanda(() => import('@/pages/inteligencia/Performance'))
const InteligenciaPrevisoes = telaSobDemanda(() => import('@/pages/inteligencia/Previsoes'))
const InteligenciaRecortes = telaSobDemanda(() => import('@/pages/inteligencia/Recortes'))
const GeracaoContratos = telaSobDemanda(() => import('@/pages/comercial/GeracaoContratos'))
const CarteirasInvestidores = telaSobDemanda(() => import('@/pages/comercial/CarteirasInvestidores'))
const DadosPessoaisBancarios = telaSobDemanda(() => import('@/pages/comercial/DadosPessoaisBancarios'))
const AnaliseCredito = telaSobDemanda(() => import('@/pages/operacional/AnaliseCredito'), {
  adiantar: true,
})
const PublicacoesMovimentacoes = telaSobDemanda(
  () => import('@/pages/operacional/execucao/PublicacoesMovimentacoes'),
)
const TarefasAdvbox = telaSobDemanda(() => import('@/pages/operacional/execucao/TarefasAdvbox'))
const Processos = telaSobDemanda(() => import('@/pages/operacional/execucao/Processos'))
const Requerimentos = telaSobDemanda(() => import('@/pages/operacional/execucao/Requerimentos'))
const ContatosServentias = telaSobDemanda(() => import('@/pages/operacional/execucao/ContatosServentias'))
const Configuracoes = telaSobDemanda(() => import('@/pages/configuracoes/Configuracoes'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to={INICIO} replace />} />
        {/* A GESTÃO ESTRATÉGICA SAIU (30/09/2026): o endereço antigo, salvo em
            favorito ou histórico, leva ao início. */}
        <Route path="/estrategica" element={<Navigate to={INICIO} replace />} />

        {/* Quadro econômico: UMA MOLDURA COM ABAS, e cada aba é uma rota filha
            — os endereços de antes continuam os mesmos (/inteligencia,
            /inteligencia/previsoes…), e trocar de aba entra no histórico. Na
            ordem das abas (ABAS_DO_QUADRO, em navigation.ts); o react-router não
            depende dela. Subcaminho que nenhuma aba declara, como
            /inteligencia/recortes/x, continua indo à página não encontrada. */}
        <Route path="/inteligencia" element={<MolduraDoQuadro />}>
          <Route index element={<InteligenciaVisaoGeral />} />
          <Route path="previsoes" element={<InteligenciaPrevisoes />} />
          <Route path="performance" element={<InteligenciaPerformance />} />
          <Route path="recortes" element={<InteligenciaRecortes />} />
          {/* Saiu do Comercial: é relatório econômico por investidor, e consome o
              mesmo núcleo de cálculo das demais telas de Inteligência. */}
          <Route path="carteiras" element={<CarteirasInvestidores />} />
        </Route>

        {/* Comercial */}
        <Route path="/comercial/contratos" element={<GeracaoContratos />} />
        {/* Rota antiga preservada: links salvos continuam funcionando. */}
        <Route
          path="/comercial/carteiras"
          element={<Navigate to="/inteligencia/carteiras" replace />}
        />
        <Route
          path="/comercial/dados-pessoais"
          element={<DadosPessoaisBancarios />}
        />

        {/* Operacional */}
        <Route path="/operacional/analise" element={<AnaliseCredito />} />
        <Route
          path="/operacional/execucao/publicacoes"
          element={<PublicacoesMovimentacoes />}
        />
        <Route path="/operacional/execucao/tarefas" element={<TarefasAdvbox />} />
        <Route path="/operacional/execucao/processos" element={<Processos />} />
        <Route
          path="/operacional/execucao/requerimentos"
          element={<Requerimentos />}
        />
        <Route
          path="/operacional/execucao/contatos"
          element={<ContatosServentias />}
        />

        {/* Configurações (admin gerencia usuários dentro da página) */}
        <Route
          path="/configuracoes"
          element={
            <AdminRoute>
              <Configuracoes />
            </AdminRoute>
          }
        />

        {/* Rota desconhecida: página 404 dentro do layout (com sidebar),
            em vez de redirecionar silenciosamente para o dashboard. O ranking
            do React Router mantém /login e as rotas específicas acima do "*". */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
