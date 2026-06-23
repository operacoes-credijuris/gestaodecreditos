import { Routes, Route, Navigate } from 'react-router-dom'
import { ProtectedRoute, AdminRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import Login from '@/pages/Login'
import Dashboard from '@/pages/estrategica/Dashboard'
import GeracaoContratos from '@/pages/comercial/GeracaoContratos'
import CarteirasInvestidores from '@/pages/comercial/CarteirasInvestidores'
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

        {/* Comercial */}
        <Route path="/comercial/contratos" element={<GeracaoContratos />} />
        <Route path="/comercial/carteiras" element={<CarteirasInvestidores />} />

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
      </Route>

      <Route path="*" element={<Navigate to="/estrategica" replace />} />
    </Routes>
  )
}
