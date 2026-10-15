import { useRef, useState } from 'react'
import { Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../contexts/AuthContext'
import {
  getAuthenticatedUser,
  signInWithEmailPassword,
  signOutLocalSession,
  UnavailableBakeryError,
  UserProfileNotFoundError,
} from '../../services/auth'
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

const Login = () => {
  const navigate = useNavigate()
  const { authMessage, clearAuthMessage } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const isFormReady = email.trim().length > 0 && password.length > 0

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmittingRef.current) return

    isSubmittingRef.current = true
    setIsSubmitting(true)
    setErrorMessage('')
    clearAuthMessage()

    try {
      try {
        await signInWithEmailPassword(email.trim().toLowerCase(), password)
      } catch (error) {
        console.error('Falha na autenticação pelo Supabase.', error)
        setErrorMessage(getLoginErrorMessage(error))
        return
      }

      try {
        const authenticatedUser = await getAuthenticatedUser()
        if (!authenticatedUser) throw new UserProfileNotFoundError()

        navigate(authenticatedUser.role === 'owner' ? '/dashboard' : '/pdv', { replace: true })
      } catch (error) {
        console.error('Não foi possível carregar o perfil do usuário.', error)
        try {
          await signOutLocalSession()
        } catch (signOutError) {
          console.error('Não foi possível encerrar a sessão sem perfil.', signOutError)
        }
        setErrorMessage(error instanceof UnavailableBakeryError
          ? 'A unidade vinculada à sua conta está indisponível. Solicite ajuda ao proprietário.'
          : error instanceof UserProfileNotFoundError
            ? 'Esta conta ainda não está configurada para acessar o sistema. Solicite ajuda ao proprietário.'
            : 'Não foi possível carregar seus dados de acesso. Tente entrar novamente. Se o problema continuar, solicite ajuda ao proprietário.')
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
          <h1>Acesso ao Sistema</h1>

          <p>Entre com suas credenciais para continuar</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>

          {/* Usuário */}
          <div className="form-group">
            <label htmlFor="email">Email</label>

            <div className="input-wrapper">
              <Mail className="input-icon" size={18} />

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setErrorMessage('')
                }}
                placeholder="Digite seu email"
                autoComplete="email"
                required
              />
            </div>
          </div>

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

          {/* Botão */}
          <button
            type="submit"
            className={`login-button ${isFormReady ? 'is-ready' : ''}`}
            disabled={!isFormReady || isSubmitting}
          >
            <LogIn size={17} />
            {isSubmitting ? 'Entrando...' : 'Entrar'}
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