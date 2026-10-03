import { Routes, Route, Navigate } from 'react-router-dom'
import { INICIO } from '@/components/layout/navigation'
import { ProtectedRoute, AdminRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'
import MolduraDoQuadro from '@/pages/inteligencia/Moldura'
import InteligenciaVisaoGeral from '@/pages/inteligencia/VisaoGeral'
import InteligenciaPerformance from '@/pages/inteligencia/Performance'
import InteligenciaPrevisoes from '@/pages/inteligencia/Previsoes'
import InteligenciaRecortes from '@/pages/inteligencia/Recortes'
import GeracaoContratos from '@/pages/comercial/GeracaoContratos'
import CarteirasInvestidores from '@/pages/comercial/CarteirasInvestidores'
import DadosPessoaisBancarios from '@/pages/comercial/DadosPessoaisBancarios'
import AnaliseCredito from '@/pages/operacional/AnaliseCredito'
import PublicacoesMovimentacoes from '@/pages/operacional/execucao/PublicacoesMovimentacoes'
import TarefasAdvbox from '@/pages/operacional/execucao/TarefasAdvbox'
import Processos from '@/pages/operacional/execucao/Processos'
import Requerimentos from '@/pages/operacional/execucao/Requerimentos'
import ContatosServentias from '@/pages/operacional/execucao/ContatosServentias'
import Configuracoes from '@/pages/configuracoes/Configuracoes'

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
