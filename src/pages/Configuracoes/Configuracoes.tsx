import { useState, type FormEvent } from 'react'
import {
  BarChart3,
  Calculator,
  Eye,
  EyeOff,
  History,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  Package,
  Settings,
  ShoppingCart,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import '../Dashboard/Dashborad.css'
import './Configuracoes.css'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type PasswordField = 'current' | 'new' | 'confirmation'

const initialPasswordVisibility: Record<PasswordField, boolean> = {
  current: false,
  new: false,
  confirmation: false,
}

export default function Configuracoes() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [passwords, setPasswords] = useState({ current: '', new: '', confirmation: '' })
  const [visiblePasswords, setVisiblePasswords] = useState(initialPasswordVisibility)
  const [emailMessage, setEmailMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')

  const isEmailValid = emailPattern.test(email.trim())
  const arePasswordsValid = passwords.current.length > 0
    && passwords.new.length > 0
    && passwords.confirmation.length > 0
    && passwords.new === passwords.confirmation

  function handleLogout() {
    sessionStorage.removeItem('isAuthenticated')
    navigate('/login', { replace: true })
  }

  function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isEmailValid) return

    setEmailMessage('A alteração de e-mail estará disponível quando o sistema estiver conectado ao banco de dados.')
  }

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!arePasswordsValid) return

    setPasswordMessage('A alteração de senha estará disponível quando o sistema estiver conectado ao banco de dados.')
  }

  function togglePasswordVisibility(field: PasswordField) {
    setVisiblePasswords((currentVisibility) => ({
      ...currentVisibility,
      [field]: !currentVisibility[field],
    }))
  }

  function updatePassword(field: PasswordField, value: string) {
    setPasswords((currentPasswords) => ({ ...currentPasswords, [field]: value }))
    setPasswordMessage('')
  }

  const passwordFields: Array<{ field: PasswordField; label: string; id: string; autoComplete: string }> = [
    { field: 'current', label: 'Senha atual', id: 'current-password', autoComplete: 'current-password' },
    { field: 'new', label: 'Nova senha', id: 'new-password', autoComplete: 'new-password' },
    { field: 'confirmation', label: 'Confirmar nova senha', id: 'confirm-password', autoComplete: 'new-password' },
  ]

  return (
    <div className="dashboard-layout flex min-h-screen">
      <aside className="sidebar fixed left-0 top-0 flex h-screen w-64 flex-col bg-white px-4 py-6">
        <div className="sidebar-logo mb-10 flex items-center gap-3 px-2">
          <div className="logo-icon flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white">
            <ShoppingCart size={22} />
          </div>
          <div>
            <strong>Padaria PDV</strong>
            <span>Sistema de vendas</span>
          </div>
        </div>

        <nav className="sidebar-menu flex flex-col gap-2">
          <a href="/dashboard" className="sidebar-link"><LayoutDashboard size={19} /><span>Dashboard</span></a>
          <a href="/pdv" className="sidebar-link"><ShoppingCart size={19} /><span>Caixa</span></a>
          <a href="/fechamento" className="sidebar-link"><Calculator size={19} /><span>Fechamento</span></a>
          <a href="/produtos" className="sidebar-link"><Package size={19} /><span>Produtos</span></a>
          <a href="/historico-vendas" className="sidebar-link"><History size={19} /><span>Histórico de Vendas</span></a>
          <a href="/historico-fechamentos" className="sidebar-link"><History size={19} /><span>Histórico de Fechamentos</span></a>
          <a href="/relatorios" className="sidebar-link"><BarChart3 size={19} /><span>Relatórios</span></a>
        </nav>

        <div className="sidebar-bottom mt-auto flex flex-col gap-2">
          <a href="/configuracoes" className="sidebar-link active"><Settings size={19} /><span>Configurações</span></a>
          <button type="button" onClick={handleLogout} className="sidebar-link logout-button"><LogOut size={19} /><span>Sair</span></button>
        </div>
      </aside>

      <main className="dashboard-main ml-64 min-h-screen flex-1">
        <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
          <div>
            <span className="header-overline">CONTA DO USUÁRIO</span>
            <h1>Configurações</h1>
            <p>Gerencie as informações de acesso à sua conta.</p>
          </div>
          <div className="header-user flex items-center gap-3">
            <div className="user-avatar">A</div>
            <div><strong>Administrador</strong><span>Usuário do sistema</span></div>
          </div>
        </header>

        <section className="dashboard-content settings-content p-10">
          <form className="settings-card" onSubmit={handleEmailSubmit}>
            <div className="settings-card-heading">
              <div>
                <span className="settings-card-overline">DADOS DE ACESSO</span>
                <h2>Alterar e-mail</h2>
                <p>Atualize o e-mail usado para acessar sua conta.</p>
              </div>
              <Mail size={22} aria-hidden="true" />
            </div>
            <div className="settings-field">
              <label htmlFor="account-email">Novo e-mail</label>
              <input
                id="account-email"
                type="email"
                value={email}
                onChange={(event) => { setEmail(event.target.value); setEmailMessage('') }}
                placeholder="Digite o novo e-mail"
                autoComplete="email"
                required
                aria-invalid={email.length > 0 && !isEmailValid}
              />
              {email.length > 0 && !isEmailValid && <span className="settings-validation">Informe um e-mail válido.</span>}
            </div>
            <button type="submit" className="settings-button" disabled={!isEmailValid}>
              <Mail size={17} />
              Alterar e-mail
            </button>
            {emailMessage && <p className="settings-message" role="status">{emailMessage}</p>}
          </form>

          <form className="settings-card" onSubmit={handlePasswordSubmit}>
            <div className="settings-card-heading">
              <div>
                <span className="settings-card-overline">DADOS DE ACESSO</span>
                <h2>Alterar senha</h2>
                <p>Defina uma nova senha para proteger sua conta.</p>
              </div>
              <LockKeyhole size={22} aria-hidden="true" />
            </div>
            <div className="settings-password-fields">
              {passwordFields.map(({ field, label, id, autoComplete }) => {
                const hasMismatch = field === 'confirmation'
                  && passwords.confirmation.length > 0
                  && passwords.new !== passwords.confirmation
                const hasError = passwords[field].length === 0 || hasMismatch

                return (
                  <div className="settings-field" key={field}>
                    <label htmlFor={id}>{label}</label>
                    <div className="settings-password-input">
                      <LockKeyhole size={18} aria-hidden="true" />
                      <input
                        id={id}
                        type={visiblePasswords[field] ? 'text' : 'password'}
                        value={passwords[field]}
                        onChange={(event) => updatePassword(field, event.target.value)}
                        autoComplete={autoComplete}
                        required
                        aria-invalid={hasError}
                      />
                      <button
                        type="button"
                        className="settings-password-toggle"
                        onClick={() => togglePasswordVisibility(field)}
                        aria-label={visiblePasswords[field] ? `Ocultar ${label.toLocaleLowerCase()}` : `Mostrar ${label.toLocaleLowerCase()}`}
                      >
                        {visiblePasswords[field] ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {hasMismatch && <span className="settings-validation">As senhas não coincidem.</span>}
                  </div>
                )
              })}
            </div>
            <button type="submit" className="settings-button" disabled={!arePasswordsValid}>
              <LockKeyhole size={17} />
              Alterar senha
            </button>
            {passwordMessage && <p className="settings-message" role="status">{passwordMessage}</p>}
          </form>
        </section>
      </main>
    </div>
  )
}