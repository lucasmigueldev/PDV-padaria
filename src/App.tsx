import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isNetworkError, reportNetworkFailure, startConnectionMonitor } from './services/connection'
import { startSalesSync } from './services/syncOfflineSales'
import { startPdvHeartbeat } from './services/pdvHeartbeat'
import './App.css'
import Login from './pages/Login/Login'
import Dashboard from './pages/Dashboard/Dashboard'
import PDV from './pages/PDV/PDV'
import Produtos from './pages/Produtos/Produtos'
import HistoricoVendas from './pages/HistoricoVendas/HistoricoVendas'
import Fechamento from './pages/Fechamento/Fechamento'
import HistoricoFechamentos from './pages/HistoricoFechamentos/HistoricoFechamentos'
import Relatorios from './pages/Relatorios/Relatorios'
import RelatorioOffline from './pages/RelatorioOffline/RelatorioOffline'
import Configuracoes from './pages/Configuracoes/Configuracoes'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from './contexts/AuthContext'
import { BluetoothPrinterProvider } from './contexts/BluetoothPrinterContext'
import { PWAInstallPrompt } from './components/PWAInstallPrompt/PWAInstallPrompt'
import { MobileBottomNav } from './components/MobileBottomNav/MobileBottomNav'
import {
  getCurrentSession,
  isCashierBakeryActive,
  isOperatorSessionValid,
  getUserProfile,
  onAuthStateChange,
  signOutLocalSession,
  UnavailableBakeryError,
  UserProfileNotFoundError,
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
        F6: '/historico-vendas',
      }
      const target = targetByKey[event.key]

      if (!target) return
      if (
        event.key === 'F6' &&
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement)
      ) return

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
    if (user.role !== 'cashier' || !user.activeBakeryId) return
    const bakeryId = user.activeBakeryId

    const MAX_CONSECUTIVE_FAILURES = 3
    let isActive = true
    let isChecking = false
    let hasEndedSession = false
    let consecutiveFailureCount = 0

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
        consecutiveFailureCount = 0
        if (isActive && !isBakeryActive) {
          await endSession('A unidade vinculada ao seu usuário está indisponível.')
          return
        }

        // O proprietário pode desativar o operador ou alterar as credenciais
        // dele a qualquer momento; a sessão é encerrada em todos os
        // dispositivos e o operador precisa entrar novamente.
        const isSessionValid = await isOperatorSessionValid()
        if (isActive && !isSessionValid) {
          await endSession('Seu acesso foi alterado ou desativado pelo proprietário. Entre novamente com suas credenciais atuais.')
        }
      } catch (error) {
        console.error('Não foi possível verificar a disponibilidade da unidade do operador.', error)
        if (isNetworkError(error)) {
          // Rede instável ou offline: mantém a sessão do operador e
          // apenas reporta a falha de conexão.
          reportNetworkFailure()
          return
        }
        // Erro de aplicação do servidor: tolera falhas seguidas para não
        // encerrar a sessão por um transitório (ex.: gateway 5xx ou falha
        // pontual no momento em que o foco volta para a aba).
        consecutiveFailureCount += 1
        if (isActive && consecutiveFailureCount >= MAX_CONSECUTIVE_FAILURES) {
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
  }, [navigate, onUnavailable, user.activeBakeryId, user.role])

  return null
}

function App() {
  const [authenticatedUser, setAuthenticatedUserState] = useState<AuthenticatedUser | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  // Espelho síncrono do usuário autenticado para que callbacks assíncronos
  // saibam se já existe uma sessão renderizada (sem depender de closures).
  const authenticatedUserRef = useRef<AuthenticatedUser | null>(null)
  const setAuthenticatedUser = useCallback((user: AuthenticatedUser | null) => {
    authenticatedUserRef.current = user
    setAuthenticatedUserState(user)
  }, [])
  const clearAuthMessage = useCallback(() => setAuthMessage(null), [])
  const handleCashierUnavailable = useCallback((message: string) => {
    setAuthenticatedUser(null)
    setIsAuthLoading(false)
    setAuthMessage(message)
  }, [setAuthenticatedUser])

  useEffect(() => {
    let isActive = true
    let authEventVersion = 0

    function loadProfileForSession(session: Session | null, eventVersion: number) {
      if (!session) {
        setAuthenticatedUser(null)
        setIsAuthLoading(false)
        return
      }

      // Eventos posteriores de autenticação (TOKEN_REFRESHED, SIGNED_IN
      // vindos de outra aba, recuperação de sessão ao voltar o foco etc.)
      // não podem desmontar a UI: `isAuthLoading` só importa no boot, quando
      // ainda não existe usuário renderizado.
      window.setTimeout(() => {
        if (!isActive || eventVersion !== authEventVersion) return

        void getUserProfile(session.user.id, session.user.created_at).then((user) => {
          if (!isActive || eventVersion !== authEventVersion) return
          setAuthenticatedUser(user)
          setIsAuthLoading(false)
          setAuthMessage(null)
        }).catch(async (error: unknown) => {
          if (!isActive || eventVersion !== authEventVersion) return

          const isDefinitiveError = error instanceof UnavailableBakeryError
            || error instanceof UserProfileNotFoundError

          if (!isDefinitiveError) {
            // Falha transitória (rede/gateway): preserva a sessão e a tela
            // atual em vez de deslogar o usuário.
            console.error('Não foi possível atualizar o perfil do usuário; mantendo a sessão atual.', error)
            if (authenticatedUserRef.current === null) {
              // Boot sem usuário renderizado: sai do loading e mostra o aviso.
              setIsAuthLoading(false)
              setAuthMessage('Não foi possível carregar seus dados de acesso. Verifique a conexão e tente novamente.')
            }
            return
          }

          console.error('Não foi possível carregar o perfil do usuário.', error)
          setAuthenticatedUser(null)
          setIsAuthLoading(false)
          if (error instanceof UnavailableBakeryError) {
            setAuthMessage('A unidade vinculada à sua conta está indisponível. Solicite ajuda ao proprietário.')
          } else {
            setAuthMessage('Esta conta ainda não está configurada para acessar o sistema. Solicite ajuda ao proprietário.')
          }
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
      setAuthenticatedUser(null)
      setIsAuthLoading(false)
      setAuthMessage('Não foi possível verificar seus dados de acesso. Tente entrar novamente. Se o problema continuar, solicite ajuda ao proprietário.')
    })

    return () => {
      isActive = false
      subscription.unsubscribe()
    }
  }, [setAuthenticatedUser])

  useEffect(() => {
    const stopMonitor = startConnectionMonitor()
    return () => stopMonitor()
  }, [])

  useEffect(() => {
    if (authenticatedUser?.role !== 'cashier' || !authenticatedUser.activeBakeryId) return
    const stopHeartbeat = startPdvHeartbeat(authenticatedUser.activeBakeryId)
    const stopSalesSync = startSalesSync()
    return () => {
      stopHeartbeat()
      stopSalesSync()
    }
  }, [authenticatedUser?.role, authenticatedUser?.activeBakeryId])

  return (
    <AuthContext.Provider value={{ authenticatedUser, isAuthLoading, authMessage, clearAuthMessage, setAuthenticatedUser }}>
      <BluetoothPrinterProvider>
        <BrowserRouter>
        {authenticatedUser?.role === 'cashier' && (
          <CashierSessionMonitor
            user={authenticatedUser}
            onUnavailable={handleCashierUnavailable}
          />
        )}
        <PWAInstallPrompt />
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
              <RoleRoute allowedRole="cashier" redirectTo="/dashboard" authenticatedUser={authenticatedUser}>
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

        {/* Relatório de interrupções de conexão (fora do ar) protegido */}
        <Route
          path="/relatorios-offline"
          element={
            <ProtectedRoute authenticatedUser={authenticatedUser} isLoading={isAuthLoading}>
              <RoleRoute allowedRole="owner" redirectTo="/pdv" authenticatedUser={authenticatedUser}>
                <RelatorioOffline />
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
        <MobileBottomNav />
        </BrowserRouter>
      </BluetoothPrinterProvider>
    </AuthContext.Provider>
  )
}

export default App
