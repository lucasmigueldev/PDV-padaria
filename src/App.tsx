import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
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
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from './contexts/AuthContext'
import { BluetoothPrinterProvider } from './contexts/BluetoothPrinterContext'
import {
  getCurrentSession,
  isCashierBakeryActive,
  getUserProfile,
  onAuthStateChange,
  signOutLocalSession,
  UnavailableBakeryError,
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

function CashierSessionMonitor({ user, onUnavailable }: {
  user: AuthenticatedUser
  onUnavailable: (message: string) => void
}) {
  const navigate = useNavigate()

  useEffect(() => {
    if (user.role !== 'cashier' || !user.bakeryId) return
    const bakeryId = user.bakeryId

    let isActive = true
    let isChecking = false
    let hasEndedSession = false

    async function endSession(message: string) {
      if (hasEndedSession) return

      hasEndedSession = true
      onUnavailable(message)
      navigate('/login', { replace: true })

      try {
        await signOutLocalSession()
      } catch (error) {
        console.error('Não foi possível encerrar a sessão local do operador.', error)
      }
    }

    async function verifyBakeryStatus() {
      if (isChecking || hasEndedSession) return
      isChecking = true

      try {
        const isBakeryActive = await isCashierBakeryActive(bakeryId)
        if (isActive && !isBakeryActive) {
          await endSession('A unidade vinculada ao seu usuário está indisponível.')
        }
      } catch (error) {
        console.error('Não foi possível verificar a disponibilidade da unidade do operador.', error)
        if (isActive) {
          await endSession('Não foi possível confirmar a disponibilidade da sua unidade. Entre novamente.')
        }
      } finally {
        isChecking = false
      }
    }

    const intervalId = window.setInterval(() => {
      void verifyBakeryStatus()
    }, 10_000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void verifyBakeryStatus()
    }
    const handleWindowFocus = () => {
      void verifyBakeryStatus()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      isActive = false
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [navigate, onUnavailable, user.bakeryId, user.role])

  return null
}


function App() {
  const [authenticatedUser, setAuthenticatedUserState] = useState<AuthenticatedUser | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const clearAuthMessage = useCallback(() => setAuthMessage(null), [])
  const handleCashierUnavailable = useCallback((message: string) => {
    setAuthenticatedUserState(null)
    setIsAuthLoading(false)
    setAuthMessage(message)
  }, [])

  useEffect(() => {
    let isActive = true
    let authEventVersion = 0

    function loadProfileForSession(session: Session | null, eventVersion: number) {
      if (!session) {
        setAuthenticatedUserState(null)
        setIsAuthLoading(false)
        return
      }

      setIsAuthLoading(true)
      window.setTimeout(() => {
        if (!isActive || eventVersion !== authEventVersion) return

        void getUserProfile(session.user.id, session.user.created_at).then((user) => {
          if (!isActive || eventVersion !== authEventVersion) return
          setAuthenticatedUserState(user)
          setIsAuthLoading(false)
          setAuthMessage(null)
        }).catch(async (error: unknown) => {
          console.error('Não foi possível carregar o perfil do usuário.', error)
          if (!isActive || eventVersion !== authEventVersion) return

          setAuthenticatedUserState(null)
          setIsAuthLoading(false)
          if (error instanceof UnavailableBakeryError) setAuthMessage(error.message)
          try {
            await signOutLocalSession()
          } catch (signOutError) {
            console.error('Não foi possível encerrar a sessão sem perfil.', signOutError)
          }
        })
      }, 0)
    }

    const subscription = onAuthStateChange((_event, session) => {
      const eventVersion = ++authEventVersion
      loadProfileForSession(session, eventVersion)
    })

    void getCurrentSession().then((session) => {
      if (!isActive || authEventVersion > 0) return
      const eventVersion = ++authEventVersion
      loadProfileForSession(session, eventVersion)
    }).catch((error: unknown) => {
      if (!isActive || authEventVersion > 0) return
      console.error('Não foi possível recuperar a sessão Supabase.', error)
      setAuthenticatedUserState(null)
      setIsAuthLoading(false)
    })

    return () => {
      isActive = false
      subscription.unsubscribe()
    }
  }, [])

  return (
    <AuthContext.Provider value={{ authenticatedUser, isAuthLoading, authMessage, clearAuthMessage }}>
      <BluetoothPrinterProvider>
        <BrowserRouter>
        {authenticatedUser?.role === 'cashier' && (
          <CashierSessionMonitor
            user={authenticatedUser}
            onUnavailable={handleCashierUnavailable}
          />
        )}
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
              <Produtos />
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
      </BluetoothPrinterProvider>
    </AuthContext.Provider>
  )
}

export default App
