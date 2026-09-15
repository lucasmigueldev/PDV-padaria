import { useState } from 'react'
import { Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react'
import './Login.css'

const Login = () => {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <main className="login-page">

      <div className="login-card">

        {/* Cabeçalho */}
        <div className="login-header">
          <h1>Acesso ao Sistema</h1>

          <p>Entre com suas credenciais para continuar</p>
        </div>

        <form className="login-form">

          {/* E-mail */}
          <div className="form-group">
            <label>E-mail</label>

            <div className="input-wrapper">
              <Mail className="input-icon" size={18} />

              <input
                type="email"
                placeholder="Digite seu e-mail"
              />
            </div>
          </div>

          {/* Senha */}
          <div className="form-group">
            <label>Senha</label>

            <div className="input-wrapper">
              <Lock className="input-icon" size={18} />

              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Digite sua senha"
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
          <button type="submit" className="login-button">
            <LogIn size={17} />
            Entrar
          </button>

        </form>

      </div>

    </main>
  )
}

export default Login