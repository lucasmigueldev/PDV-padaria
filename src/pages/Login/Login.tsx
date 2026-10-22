import { useRef, useState } from 'react'
import { Mail, Lock, Eye, EyeOff, LogIn, Store } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../contexts/AuthContext'
import {
  getAuthenticatedUser,
  getUserProfile,
  signInWithEmailPassword,
  signOutLocalSession,
  UnavailableBakeryError,
  UserProfileNotFoundError,
} from '../../services/auth'
import { lookupLoginAccess } from '../../services/loginLookup'
import { getActiveBakeriesByIds, persistActiveBakeryId } from '../../services/userBakeries'
import type { Bakery } from '../../types/Bakery'
import './Login.css'

function getLoginErrorMessage(error: unknown): string {
  const authError = typeof error === 'object' && error !== null
    ? error as { code?: string; status?: number; name?: string }
    : {}

  if (authError.code === 'invalid_credentials') {
    return 'E-mail ou senha incorretos. Confira os dados e tente novamente.'
  }
  if (authError.code === '42501' || authError.status === 403) {
    return 'Seu acesso não está autorizado. Solicite ajuda ao proprietário.'
  }
  if (authError.name === 'AuthRetryableFetchError' || error instanceof TypeError) {
    return 'Não foi possível conectar ao sistema. Verifique sua conexão e tente novamente.'
  }
  if (typeof authError.status === 'number' && authError.status >= 500) {
    return 'O sistema está temporariamente indisponível. Tente novamente em alguns instantes.'
  }

  return 'Não foi possível entrar. Tente novamente. Se o problema continuar, solicite ajuda ao proprietário.'
}

type PendingUnitSelection = {
  userId: string
  createdAt?: string
  bakeries: Bakery[]
}

const Login = () => {
  const navigate = useNavigate()
  const { authMessage, clearAuthMessage, setAuthenticatedUser } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingUnitSelection, setPendingUnitSelection] = useState<PendingUnitSelection | null>(null)
  const [selectedBakeryId, setSelectedBakeryId] = useState('')
  // Unidades do operador descobertas antes do login (blur do e-mail).
  const [preLoginBakeries, setPreLoginBakeries] = useState<Bakery[]>([])
  const [preLoginBakeryId, setPreLoginBakeryId] = useState('')
  const emailRef = useRef('')
  const isSubmittingRef = useRef(false)
  const isCredentialsReady = email.trim().length > 0 && password.length > 0
  const hasPreLoginUnitChoice = preLoginBakeries.length > 0
  const isFormReady = pendingUnitSelection
    ? selectedBakeryId.length > 0
    : isCredentialsReady && (!hasPreLoginUnitChoice || preLoginBakeryId.length > 0)

  async function handleProfileError(error: unknown) {
    console.error('Não foi possível carregar o perfil do usuário.', error)
    try {
      await signOutLocalSession()
    } catch (signOutError) {
      console.error('Não foi possível encerrar a sessão sem perfil.', signOutError)
    }
    setPendingUnitSelection(null)
    setSelectedBakeryId('')
    setErrorMessage(error instanceof UnavailableBakeryError
      ? 'A unidade vinculada à sua conta está indisponível. Solicite ajuda ao proprietário.'
      : error instanceof UserProfileNotFoundError
        ? 'Esta conta ainda não está configurada para acessar o sistema. Solicite ajuda ao proprietário.'
        : 'Não foi possível carregar seus dados de acesso. Tente entrar novamente. Se o problema continuar, solicite ajuda ao proprietário.')
  }

  async function handleUnitSelectionSubmit(pending: PendingUnitSelection) {
    if (!selectedBakeryId) {
      setErrorMessage('Selecione a unidade para continuar.')
      return
    }

    try {
      persistActiveBakeryId(pending.userId, selectedBakeryId)
      const authenticatedUser = await getUserProfile(pending.userId, pending.createdAt, selectedBakeryId)
      setAuthenticatedUser(authenticatedUser)
      setPendingUnitSelection(null)
      setSelectedBakeryId('')
      navigate('/pdv', { replace: true })
    } catch (error) {
      await handleProfileError(error)
    }
  }

  async function handleEmailBlur() {
    const targetEmail = emailRef.current.trim().toLowerCase()
    if (!targetEmail) return

    try {
      const lookup = await lookupLoginAccess(targetEmail)

      // O e-mail mudou durante a consulta: descarta o resultado antigo.
      if (emailRef.current.trim().toLowerCase() !== targetEmail) return

      if (lookup.role === 'cashier' && lookup.bakeries.length > 0) {
        setPreLoginBakeries(lookup.bakeries)
        // Unidade única já vem escolhida; múltiplas exigem seleção explícita.
        setPreLoginBakeryId(lookup.bakeries.length === 1 ? lookup.bakeries[0].id : '')
      } else {
        setPreLoginBakeries([])
        setPreLoginBakeryId('')
      }
    } catch (error) {
      // A verificação pré-login é só um adiantamento de UX: se falhar, o
      // fluxo normal continua e a seleção acontece depois da autenticação.
      console.error('Não foi possível verificar as unidades do usuário.', error)
      if (emailRef.current.trim().toLowerCase() === targetEmail) {
        setPreLoginBakeries([])
        setPreLoginBakeryId('')
      }
    }
  }

  async function handleCredentialsSubmit() {
    try {
      await signInWithEmailPassword(email.trim().toLowerCase(), password)
    } catch (error) {
      console.error('Falha na autenticação pelo Supabase.', error)
      setErrorMessage(getLoginErrorMessage(error))
      return
    }

    try {
      const preLoginOverride = hasPreLoginUnitChoice && preLoginBakeryId ? preLoginBakeryId : null
      const authenticatedUser = await getAuthenticatedUser(preLoginOverride)
      if (!authenticatedUser) throw new UserProfileNotFoundError()

      if (authenticatedUser.role === 'owner') {
        navigate('/dashboard', { replace: true })
        return
      }

      const activeBakeries = await getActiveBakeriesByIds(authenticatedUser.bakeryIds)
      if (activeBakeries.length === 0) throw new UnavailableBakeryError()

      // Verifica se o usuário já está logado em outra unidade
      // Para caixas, impedimos login em unidade diferente sem derrubar a sessão anterior
      if (authenticatedUser.role === "cashier" && authenticatedUser.activeBakeryId) {
        const bakeryAtualId = authenticatedUser.activeBakeryId
        const novaBakeryId = preLoginOverride || ""

        // Se a unidade tentar fazer login for diferente da atual
        if (novaBakeryId && novaBakeryId !== bakeryAtualId) {
          const unidadeDiferente = activeBakeries.some((b) => b.id !== bakeryAtualId)

          if (unidadeDiferente) {
            const confirmar = window.confirm(
              `O usuário ${authenticatedUser.name} já está logado na unidade ${bakeryAtualId}. ` +
              `Deseja derrubar esta sessão e fazer login na nova unidade ${novaBakeryId}?`
            )
            if (!confirmar) {
              await signOutLocalSession()
              setErrorMessage('Login cancelado.')
              return
            }
            await signOutLocalSession()
          }
          }
      }

      const usedPreLoginChoice = Boolean(preLoginOverride)
        && authenticatedUser.activeBakeryId === preLoginOverride

      // Unidade escolhida antes do login (blur do e-mail) ou unidade única
      // do operador: entra direto, sem a tela de seleção pós-login. Se a
      // unidade escolhida foi desativada no meio do caminho, o override é
      // ignorado pelo perfil e o fluxo cai na seleção normal.
      if (usedPreLoginChoice || activeBakeries.length === 1) {
        setAuthenticatedUser(authenticatedUser)
        setPreLoginBakeries([])
        setPreLoginBakeryId('')
        navigate('/pdv', { replace: true })
        return
      }

      setPendingUnitSelection({
        userId: authenticatedUser.id,
        createdAt: authenticatedUser.createdAt,
        bakeries: activeBakeries,
      })
      setSelectedBakeryId('')
    } catch (error) {
      await handleProfileError(error)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmittingRef.current) return

    isSubmittingRef.current = true
    setIsSubmitting(true)
    setErrorMessage('')
    clearAuthMessage()

    try {
      if (pendingUnitSelection) {
        await handleUnitSelectionSubmit(pendingUnitSelection)
      } else {
        await handleCredentialsSubmit()
      }
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">

      <div className="login-card">

        {/* Cabeçalho */}
        <div className="login-header">
          <h1>PDV<span className="brand-accent">360</span></h1>
          <p>Entre com suas credenciais para continuar</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>

          {/* Usuário */}
          <div className="form-group">
            <label htmlFor="email">E-mail</label>

            <div className="input-wrapper">
              <Mail className="input-icon" size={18} />

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => {
                  emailRef.current = event.target.value
                  setEmail(event.target.value)
                  setErrorMessage('')
                  setPreLoginBakeries([])
                  setPreLoginBakeryId('')
                }}
                onBlur={handleEmailBlur}
                placeholder="Digite seu e-mail"
                autoComplete="email"
                required
              />
            </div>
          </div>

          {/* Unidade do operador (antes da senha, via lookup no e-mail) */}
          {!pendingUnitSelection && preLoginBakeries.length > 0 && (
            <div className="form-group">
              <label htmlFor="pre-login-bakery">Unidade</label>

              <div className="input-wrapper">
                <Store className="input-icon" size={18} />

                <select
                  id="pre-login-bakery"
                  value={preLoginBakeryId}
                  disabled={preLoginBakeries.length === 1}
                  onChange={(event) => {
                    setPreLoginBakeryId(event.target.value)
                    setErrorMessage('')
                  }}
                >
                  {preLoginBakeries.length > 1 && (
                    <option value="">Selecione a unidade</option>
                  )}
                  {preLoginBakeries.map((bakery) => (
                    <option key={bakery.id} value={bakery.id}>
                      {bakery.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Senha */}
          <div className="form-group">
            <label htmlFor="password">Senha</label>

            <div className="input-wrapper">
              <Lock className="input-icon" size={18} />

              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setErrorMessage('')
                }}
                placeholder="Digite sua senha"
                autoComplete="current-password"
                required
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff size={18} />
                ) : (
                  <Eye size={18} />
                )}
              </button>
            </div>
          </div>

          {/* Unidade (operador) */}
          {pendingUnitSelection && (
            <div className="form-group">
              <label htmlFor="bakery">Unidade</label>

              <div className="input-wrapper">
                <Store className="input-icon" size={18} />

                <select
                  id="bakery"
                  value={selectedBakeryId}
                  disabled={pendingUnitSelection.bakeries.length === 1}
                  onChange={(event) => {
                    setSelectedBakeryId(event.target.value)
                    setErrorMessage('')
                  }}
                >
                  {pendingUnitSelection.bakeries.length > 1 && (
                    <option value="">Selecione a unidade</option>
                  )}
                  {pendingUnitSelection.bakeries.map((bakery) => (
                    <option key={bakery.id} value={bakery.id}>
                      {bakery.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Botão */}
          <button
            type="submit"
            className={`login-button ${isFormReady ? 'is-ready' : ''}`}
            disabled={!isFormReady || isSubmitting}
          >
            <LogIn size={17} />
            {isSubmitting ? 'Entrando...' : pendingUnitSelection ? 'Entrar na unidade' : 'Entrar'}
          </button>

          {(authMessage || errorMessage) && (
            <p className="login-message" role="alert">
              {authMessage ?? errorMessage}
            </p>
          )}

        </form>

      </div>

    </main>
  )
}

export default Login