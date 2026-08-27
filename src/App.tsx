import { Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute, AdminRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'
import Dashboard from '@/pages/estrategica/Dashboard'
import InteligenciaVisaoGeral from '@/pages/inteligencia/VisaoGeral'
import InteligenciaPerformance from '@/pages/inteligencia/Performance'
import InteligenciaPrevisoes from '@/pages/inteligencia/Previsoes'
import InteligenciaRecortes from '@/pages/inteligencia/Recortes'
import InteligenciaAnomalias from '@/pages/inteligencia/Anomalias'
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
        <Route index element={<Navigate to="/estrategica" replace />} />
        <Route path="/estrategica" element={<Dashboard />} />

        {/* Inteligência Econômica */}
        <Route path="/inteligencia" element={<InteligenciaVisaoGeral />} />
        <Route path="/inteligencia/performance" element={<InteligenciaPerformance />} />
        <Route path="/inteligencia/previsoes" element={<InteligenciaPrevisoes />} />
        <Route path="/inteligencia/recortes" element={<InteligenciaRecortes />} />
        {/* Saiu do Comercial: é relatório econômico por investidor, e consome o
            mesmo núcleo de cálculo das demais telas de Inteligência. */}
        <Route path="/inteligencia/carteiras" element={<CarteirasInvestidores />} />
        <Route path="/inteligencia/anomalias" element={<InteligenciaAnomalias />} />

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
