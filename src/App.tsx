import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import {
  clearAuthenticatedUser,
  setAuthenticatedUser,
} from './utils/auth'
import {
  getUserProfile,
  onAuthStateChange,
  signOut,
  type AuthenticatedUser,
} from './services/auth'

function ProtectedRoute({ children, authenticatedUser, isLoading }: {
  children: React.ReactNode
  authenticatedUser: AuthenticatedUser | null
  isLoading: boolean
}) {
  if (isLoading) return null

  return authenticatedUser ? children : <Navigate to="/login" replace />
}

function RoleRoute({ allowedRole, redirectTo, children, authenticatedUser }: {
  allowedRole: 'owner' | 'cashier'
  redirectTo: string
  children: React.ReactNode
  authenticatedUser: AuthenticatedUser | null
}) {
  const navigate = useNavigate()
  const hasCashierAccess = authenticatedUser?.role === 'cashier'

  useEffect(() => {
    if (allowedRole !== 'cashier' || !hasCashierAccess) return

    function handleCashierShortcut(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (document.querySelector('[role="dialog"]')) return

      const targetByKey: Record<string, string> = {
        F2: '/produtos',
        F3: '/fechamento',
        F4: '/pdv',
      }
      const target = targetByKey[event.key]

      if (!target) return

      event.preventDefault()
      navigate(target)
    }

    document.addEventListener('keydown', handleCashierShortcut)
    return () => document.removeEventListener('keydown', handleCashierShortcut)
  }, [allowedRole, hasCashierAccess, navigate])

  return authenticatedUser?.role === allowedRole ? children : <Navigate to={redirectTo} replace />
}


function App() {
  const [authenticatedUser, setAuthenticatedUserState] = useState<AuthenticatedUser | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  useEffect(() => {
    let isActive = true
    let authEventVersion = 0
    const subscription = onAuthStateChange((_event, session) => {
      const eventVersion = ++authEventVersion

      if (!session) {
        clearAuthenticatedUser()
        setAuthenticatedUserState(null)
        setIsAuthLoading(false)
        return
      }

      setIsAuthLoading(true)
      window.setTimeout(() => {
        void getUserProfile(session.user.id).then((user) => {
          if (!isActive || eventVersion !== authEventVersion) return
          setAuthenticatedUser(user)
          setAuthenticatedUserState(user)
          setIsAuthLoading(false)
        }).catch(async (error: unknown) => {
          console.error('Não foi possível carregar o perfil do usuário.', error)
          if (!isActive || eventVersion !== authEventVersion) return

          clearAuthenticatedUser()
          setAuthenticatedUserState(null)
          setIsAuthLoading(false)
          try {
            await signOut()
          } catch (signOutError) {
            console.error('Não foi possível encerrar a sessão sem perfil.', signOutError)
          }
        })
      }, 0)
    })

    return () => {
      isActive = false
      subscription.unsubscribe()
    }
  }, [])

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
            <ProtectedRoute authenticatedUser={authenticatedUser} isLoading={isAuthLoading}>
              <RoleRoute allowedRole="owner" redirectTo="/pdv" authenticatedUser={authenticatedUser}>
                <Dashboard />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Ponto de venda protegido */}
        <Route
          path="/pdv"
          element={
            <ProtectedRoute authenticatedUser={authenticatedUser} isLoading={isAuthLoading}>
              <RoleRoute allowedRole="cashier" redirectTo="/dashboard" authenticatedUser={authenticatedUser}>
                <PDV />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Catálogo de produtos protegido */}
        <Route
          path="/produtos"
          element={
            <ProtectedRoute authenticatedUser={authenticatedUser} isLoading={isAuthLoading}>
              <RoleRoute allowedRole="cashier" redirectTo="/dashboard" authenticatedUser={authenticatedUser}>
                <Produtos />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Histórico de vendas protegido */}
        <Route
          path="/historico-vendas"
          element={
            <ProtectedRoute authenticatedUser={authenticatedUser} isLoading={isAuthLoading}>
              <RoleRoute allowedRole="owner" redirectTo="/pdv" authenticatedUser={authenticatedUser}>
                <HistoricoVendas />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Resumo do fechamento protegido */}
        <Route
          path="/fechamento"
          element={
            <ProtectedRoute authenticatedUser={authenticatedUser} isLoading={isAuthLoading}>
              <RoleRoute allowedRole="cashier" redirectTo="/dashboard" authenticatedUser={authenticatedUser}>
                <Fechamento />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Histórico de fechamentos protegido */}
        <Route
          path="/historico-fechamentos"
          element={
            <ProtectedRoute authenticatedUser={authenticatedUser} isLoading={isAuthLoading}>
              <RoleRoute allowedRole="owner" redirectTo="/pdv" authenticatedUser={authenticatedUser}>
                <HistoricoFechamentos />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Relatórios protegido */}
        <Route
          path="/relatorios"
          element={
            <ProtectedRoute authenticatedUser={authenticatedUser} isLoading={isAuthLoading}>
              <RoleRoute allowedRole="owner" redirectTo="/pdv" authenticatedUser={authenticatedUser}>
                <Relatorios />
              </RoleRoute>
            </ProtectedRoute>
          }
        />

        {/* Configurações protegidas */}
        <Route
          path="/configuracoes"
          element={
            <ProtectedRoute authenticatedUser={authenticatedUser} isLoading={isAuthLoading}>
              <RoleRoute allowedRole="owner" redirectTo="/pdv" authenticatedUser={authenticatedUser}>
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
