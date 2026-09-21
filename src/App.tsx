import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import './App.css'
import Login from './pages/Login/Login'
import Dashboard from './pages/Dashboard/Dashboard'
import PDV from './pages/PDV/PDV'
import Produtos from './pages/Produtos/Produtos'
import HistoricoVendas from './pages/HistoricoVendas/HistoricoVendas'
import Fechamento from './pages/Fechamento/Fechamento'
import HistoricoFechamentos from './pages/HistoricoFechamentos/HistoricoFechamentos'
import Relatorios from './pages/Relatorios/Relatorios'
import Configuracoes from './pages/Configuracoes/Configuracoes'
import { getAuthenticatedUser } from './utils/auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true'

  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function RoleRoute({ allowedRole, redirectTo, children }: {
  allowedRole: 'owner' | 'cashier'
  redirectTo: string
  children: React.ReactNode
}) {
  const authenticatedUser = getAuthenticatedUser()

  return authenticatedUser?.role === allowedRole ? children : <Navigate to={redirectTo} replace />
}


function App() {
  return (
    <BrowserRouter>
      <Routes>
       
        {/* Rota principal */}
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* Tela de Login */}
        <Route path="/login" element={<Login />} />

        {/* Dashboard protegido */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <RoleRoute allowedRole="owner" redirectTo="/pdv">
                <Dashboard />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Ponto de venda protegido */}
        <Route
          path="/pdv"
          element={
            <ProtectedRoute>
              <RoleRoute allowedRole="cashier" redirectTo="/dashboard">
                <PDV />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Catálogo de produtos protegido */}
        <Route
          path="/produtos"
          element={
            <ProtectedRoute>
              <RoleRoute allowedRole="cashier" redirectTo="/dashboard">
                <Produtos />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Histórico de vendas protegido */}
        <Route
          path="/historico-vendas"
          element={
            <ProtectedRoute>
              <RoleRoute allowedRole="owner" redirectTo="/pdv">
                <HistoricoVendas />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Resumo do fechamento protegido */}
        <Route
          path="/fechamento"
          element={
            <ProtectedRoute>
              <RoleRoute allowedRole="cashier" redirectTo="/dashboard">
                <Fechamento />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Histórico de fechamentos protegido */}
        <Route
          path="/historico-fechamentos"
          element={
            <ProtectedRoute>
              <RoleRoute allowedRole="owner" redirectTo="/pdv">
                <HistoricoFechamentos />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Relatórios protegido */}
        <Route
          path="/relatorios"
          element={
            <ProtectedRoute>
              <RoleRoute allowedRole="owner" redirectTo="/pdv">
                <Relatorios />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Configurações protegidas */}
        <Route
          path="/configuracoes"
          element={
            <ProtectedRoute>
              <RoleRoute allowedRole="owner" redirectTo="/pdv">
                <Configuracoes />
              </RoleRoute>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
