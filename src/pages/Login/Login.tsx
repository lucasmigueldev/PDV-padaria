import { useState } from 'react'
import { Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react'
import './Login.css'

const Login = () => {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const isFormReady = username.trim().length > 0 && password.length === 5

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (username === 'ADM' && password === '12345') {
      setErrorMessage('Login realizado com sucesso.')
      console.log('Usuário logado:', username)
      return
    }

    setErrorMessage('Usuário ou senha inválidos.')
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
            <label htmlFor="username">Usuário</label>

            <div className="input-wrapper">
              <Mail className="input-icon" size={18} />

              <input
                id="username"
                type="text"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value)
                  setErrorMessage('')
                }}
                placeholder="Digite seu usuário"
                autoComplete="username"
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
            disabled={!isFormReady}
          >
            <LogIn size={17} />
            Entrar
          </button>

          {errorMessage && (
            <p className="login-message" role="alert">
              {errorMessage}
            </p>
          )}

        </form>

      </div>

    </main>
  )
}

export default Login