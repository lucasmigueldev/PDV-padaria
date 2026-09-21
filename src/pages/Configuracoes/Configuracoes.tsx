import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
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
  Pencil,
  Settings,
  ShoppingCart,
  Users,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { getBakeries } from '../../data/bakeries'
import { addUser, getUsers, updateUser } from '../../data/users'
import type { Bakery } from '../../types/Bakery'
import type { User } from '../../types/User'
import '../Dashboard/Dashborad.css'
import './Configuracoes.css'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type PasswordField = 'current' | 'new' | 'confirmation'

const initialPasswordVisibility: Record<PasswordField, boolean> = {
  current: false,
  new: false,
  confirmation: false,
}

function getRoleLabel(role: User['role']): string {
  return role === 'owner' ? 'Proprietário' : 'Operador de caixa'
}

function getBakeryLabel(bakeryId: User['bakeryId']): string {
  return bakeryId === null ? 'Todas as unidades' : bakeryId
}

type NewUserForm = {
  name: string
  email: string
  password: string
  role: '' | User['role']
  bakeryId: string
}

const initialNewUserForm: NewUserForm = {
  name: '',
  email: '',
  password: '',
  role: '',
  bakeryId: '',
}

export default function Configuracoes() {
  const navigate = useNavigate()
  const [users, setUsers] = useState(() => getUsers())
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [newUserForm, setNewUserForm] = useState(initialNewUserForm)
  const [activeBakeries, setActiveBakeries] = useState<Bakery[]>([])
  const [userFormError, setUserFormError] = useState('')
  const [userSuccessMessage, setUserSuccessMessage] = useState('')
  const [isSavingUser, setIsSavingUser] = useState(false)
  const [email, setEmail] = useState('')
  const [passwords, setPasswords] = useState({ current: '', new: '', confirmation: '' })
  const [visiblePasswords, setVisiblePasswords] = useState(initialPasswordVisibility)
  const [emailMessage, setEmailMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')

  useEffect(() => {
    if (!isUserModalOpen) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return

      setIsUserModalOpen(false)
      setEditingUser(null)
      setNewUserForm(initialNewUserForm)
      setUserFormError('')
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isUserModalOpen])

  const isEmailValid = emailPattern.test(email.trim())
  const arePasswordsValid = passwords.current.length > 0
    && passwords.new.length > 0
    && passwords.confirmation.length > 0
    && passwords.new === passwords.confirmation

  function handleLogout() {
    sessionStorage.removeItem('isAuthenticated')
    navigate('/login', { replace: true })
  }

  function openUserModal() {
    setActiveBakeries(getBakeries().filter((bakery) => bakery.active))
    setEditingUser(null)
    setNewUserForm(initialNewUserForm)
    setUserFormError('')
    setUserSuccessMessage('')
    setIsUserModalOpen(true)
  }

  function openEditUserModal(user: User) {
    setActiveBakeries(getBakeries().filter((bakery) => bakery.active))
    setEditingUser(user)
    setNewUserForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      bakeryId: user.bakeryId ?? '',
    })
    setUserFormError('')
    setUserSuccessMessage('')
    setIsUserModalOpen(true)
  }

  function closeUserModal() {
    if (isSavingUser) return

    setIsUserModalOpen(false)
    setEditingUser(null)
    setNewUserForm(initialNewUserForm)
    setUserFormError('')
  }

  function handleUserOverlayMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) closeUserModal()
  }

  function updateNewUserField(field: keyof NewUserForm, value: string) {
    setNewUserForm((currentForm) => ({
      ...currentForm,
      [field]: value,
      ...(field === 'role' && value === 'owner' ? { bakeryId: '' } : {}),
    }))
    setUserFormError('')
  }

  function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSavingUser) return

    const name = newUserForm.name.trim()
    const email = newUserForm.email.trim()
    const password = newUserForm.password

    if (!name) {
      setUserFormError('Informe o nome.')
      return
    }

    if (!email) {
      setUserFormError('Informe o e-mail.')
      return
    }

    if (!editingUser && !password.trim()) {
      setUserFormError('Informe a senha.')
      return
    }

    if (!newUserForm.role) {
      setUserFormError('Selecione um perfil.')
      return
    }

    if (newUserForm.role === 'cashier' && !newUserForm.bakeryId) {
      setUserFormError('Selecione uma unidade.')
      return
    }

    const normalizedEmail = email.toLocaleLowerCase()
    const hasDuplicateEmail = users.some((user) => (
      user.id !== editingUser?.id
      && user.email.trim().toLocaleLowerCase() === normalizedEmail
    ))

    if (hasDuplicateEmail) {
      setUserFormError('Este e-mail já está cadastrado.')
      return
    }

    setIsSavingUser(true)

    try {
      const userData = {
        name,
        email,
        password: editingUser && !password.trim() ? editingUser.password : password,
        role: newUserForm.role,
        bakeryId: newUserForm.role === 'owner' ? null : newUserForm.bakeryId,
      }
      const savedUser = editingUser
        ? updateUser(editingUser.id, userData)
        : addUser(userData)

      if (!savedUser) {
        setUserFormError('Não foi possível atualizar o usuário.')
        return
      }

      setUsers((currentUsers) => editingUser
        ? currentUsers.map((user) => user.id === savedUser.id ? savedUser : user)
        : [...currentUsers, savedUser])
      const successMessage = editingUser
        ? 'Usuário atualizado com sucesso.'
        : 'Usuário criado com sucesso.'
      setNewUserForm(initialNewUserForm)
      setEditingUser(null)
      setUserFormError('')
      setIsUserModalOpen(false)
      setUserSuccessMessage(successMessage)
    } catch {
      setUserFormError('Não foi possível criar o usuário.')
    } finally {
      setIsSavingUser(false)
    }
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

          <section className="settings-card users-card" aria-labelledby="users-section-title">
            <div className="settings-card-heading">
              <div>
                <span className="settings-card-overline">ACESSO AO SISTEMA</span>
                <h2 id="users-section-title">Usuários</h2>
                <p>Consulte os usuários cadastrados para acessar o sistema.</p>
              </div>
              <div className="users-heading-actions">
                <Users size={22} aria-hidden="true" />
                <button type="button" className="settings-button users-new-button" onClick={openUserModal}>
                  <Users size={17} />
                  Novo usuário
                </button>
              </div>
            </div>

            {userSuccessMessage && <p className="settings-message" role="status">{userSuccessMessage}</p>}

            {users.length === 0 ? (
              <div className="users-empty-state">Nenhum usuário cadastrado.</div>
            ) : (
              <div className="users-table-wrapper">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th scope="col">Nome</th>
                      <th scope="col">E-mail</th>
                      <th scope="col">Perfil</th>
                      <th scope="col">Unidade</th>
                      <th scope="col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td data-label="Nome">{user.name}</td>
                        <td data-label="E-mail">{user.email}</td>
                        <td data-label="Perfil">
                          <span className={`user-role-badge ${user.role}`}>{getRoleLabel(user.role)}</span>
                        </td>
                        <td data-label="Unidade">{getBakeryLabel(user.bakeryId)}</td>
                        <td data-label="Ações">
                          <button
                            type="button"
                            className="user-actions-button"
                            onClick={() => openEditUserModal(user)}
                            aria-label={`Editar ${user.name}`}
                            title={`Editar ${user.name}`}
                          >
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>

        {isUserModalOpen && (
          <div
            className="user-modal-overlay"
            role="presentation"
            onMouseDown={handleUserOverlayMouseDown}
          >
            <section
              className="user-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-user-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="user-modal-header">
                <div>
                  <span className="settings-card-overline">ACESSO AO SISTEMA</span>
                  <h2 id="new-user-modal-title">{editingUser ? 'Editar usuário' : 'Novo usuário'}</h2>
                  <p>{editingUser ? 'Atualize os dados do usuário cadastrado.' : 'Cadastre um usuário para acessar o sistema.'}</p>
                </div>
                <button type="button" className="user-modal-close" onClick={closeUserModal} aria-label="Fechar cadastro de usuário">
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <form className="user-form" onSubmit={handleUserSubmit}>
                <div className="user-form-fields">
                  <div className="settings-field">
                    <label htmlFor="new-user-name">Nome</label>
                    <input
                      id="new-user-name"
                      type="text"
                      value={newUserForm.name}
                      onChange={(event) => updateNewUserField('name', event.target.value)}
                      autoComplete="name"
                    />
                  </div>

                  <div className="settings-field">
                    <label htmlFor="new-user-email">E-mail</label>
                    <input
                      id="new-user-email"
                      type="email"
                      value={newUserForm.email}
                      onChange={(event) => updateNewUserField('email', event.target.value)}
                      autoComplete="email"
                    />
                  </div>

                  <div className="settings-field">
                    <label htmlFor="new-user-password">Senha</label>
                    <input
                      id="new-user-password"
                      type="password"
                      value={newUserForm.password}
                      onChange={(event) => updateNewUserField('password', event.target.value)}
                      autoComplete="new-password"
                      placeholder={editingUser ? 'Deixe vazio para manter a senha atual' : undefined}
                    />
                  </div>

                  <div className="settings-field">
                    <label htmlFor="new-user-role">Perfil</label>
                    <select
                      id="new-user-role"
                      value={newUserForm.role}
                      onChange={(event) => updateNewUserField('role', event.target.value)}
                    >
                      <option value="">Selecione um perfil</option>
                      <option value="owner">Proprietário</option>
                      <option value="cashier">Operador de caixa</option>
                    </select>
                  </div>

                  <div className="settings-field">
                    <label htmlFor="new-user-bakery">Unidade</label>
                    <select
                      id="new-user-bakery"
                      value={newUserForm.bakeryId}
                      onChange={(event) => updateNewUserField('bakeryId', event.target.value)}
                      disabled={newUserForm.role !== 'cashier'}
                    >
                      <option value="">Selecione uma unidade</option>
                      {activeBakeries.map((bakery) => (
                        <option key={bakery.id} value={bakery.id}>{bakery.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {userFormError && <p className="user-form-error" role="alert">{userFormError}</p>}

                <div className="user-modal-actions">
                  <button type="button" className="user-modal-cancel" onClick={closeUserModal} disabled={isSavingUser}>
                    Cancelar
                  </button>
                  <button type="submit" className="settings-button" disabled={isSavingUser}>
                    {isSavingUser ? 'Salvando...' : editingUser ? 'Atualizar' : 'Salvar'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}