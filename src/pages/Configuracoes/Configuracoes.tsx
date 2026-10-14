import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import {
  BarChart3,
  Building2,
  Calculator,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Pencil,
  Settings,
  ShoppingCart,
  Users,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { UserProfileMenu } from '../../components/UserProfileMenu/UserProfileMenu'
import { getOpenCashRegister } from '../../services/operations'
import { createAdminUser, getAdminUsers } from '../../services/adminUsers'
import { addBakery, updateBakery } from '../../services/bakeries'
import { useBakeries } from '../../hooks/useBakeries'
import { useAuth } from '../../contexts/AuthContext'
import type { Bakery } from '../../types/Bakery'
import type { User } from '../../types/User'
import { logoutAndRedirect } from '../../utils/auth'
import '../Dashboard/Dashborad.css'
import './Configuracoes.css'

function getRoleLabel(role: User['role']): string {
  return role === 'owner' ? 'Proprietário' : 'Operador de caixa'
}

function getBakeryLabel(bakeryId: User['bakeryId'], bakeries: Bakery[]): string {
  if (bakeryId === null) return 'Todas as unidades'

  const bakery = bakeries.find((currentBakery) => currentBakery.id === bakeryId)
  return bakery?.active ? bakery.name : 'Unidade indisponível'
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

type BakeryForm = {
  name: string
  active: boolean
}

const initialBakeryForm: BakeryForm = {
  name: '',
  active: true,
}

export default function Configuracoes() {
  const navigate = useNavigate()
  const { authenticatedUser } = useAuth()
  const isOwner = authenticatedUser?.role === 'owner'
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(true)
  const [usersLoadError, setUsersLoadError] = useState('')
  const [userBakeryFilter, setUserBakeryFilter] = useState('all')
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [newUserForm, setNewUserForm] = useState(initialNewUserForm)
  const { bakeries, setBakeries, isLoadingBakeries, bakeriesLoadError } = useBakeries()
  const [activeBakeries, setActiveBakeries] = useState<Bakery[]>([])
  const [isBakeryModalOpen, setIsBakeryModalOpen] = useState(false)
  const [editingBakery, setEditingBakery] = useState<Bakery | null>(null)
  const [bakeryForm, setBakeryForm] = useState(initialBakeryForm)
  const [bakeryFormError, setBakeryFormError] = useState('')
  const [isSavingBakery, setIsSavingBakery] = useState(false)
  const [userFormError, setUserFormError] = useState('')
  const [userSuccessMessage, setUserSuccessMessage] = useState('')
  const [isSavingUser, setIsSavingUser] = useState(false)
  const activeBakeryOptions = bakeries.filter((bakery) => bakery.active)
  const filteredUsers = users.filter((user) => (
    userBakeryFilter === 'all'
      || (user.role === 'cashier' && user.bakeryId === userBakeryFilter)
  ))

  useEffect(() => {
    let isActive = true

    void getAdminUsers().then((loadedUsers) => {
      if (!isActive) return
      setUsers(loadedUsers)
      setUsersLoadError('')
    }).catch((error: unknown) => {
      if (!isActive) return
      setUsersLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os usuários.')
    }).finally(() => {
      if (isActive) setIsLoadingUsers(false)
    })

    return () => {
      isActive = false
    }
  }, [authenticatedUser?.id])

  useEffect(() => {
    if (!isUserModalOpen && !isBakeryModalOpen) return

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return

      if (isUserModalOpen) {
        setIsUserModalOpen(false)
        setNewUserForm(initialNewUserForm)
        setUserFormError('')
      }
      if (isBakeryModalOpen && !isSavingBakery) {
        setIsBakeryModalOpen(false)
        setEditingBakery(null)
        setBakeryForm(initialBakeryForm)
        setBakeryFormError('')
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isBakeryModalOpen, isSavingBakery, isUserModalOpen])

  function handleLogout() {
    void logoutAndRedirect(navigate)
  }

  function closeMobileMenu() {
    setIsMobileMenuOpen(false)
  }

  function openUserModal() {
    setActiveBakeries(bakeries.filter((bakery) => bakery.active))
    setNewUserForm(initialNewUserForm)
    setUserFormError('')
    setUserSuccessMessage('')
    setIsUserModalOpen(true)
  }

  function closeUserModal() {
    if (isSavingUser) return

    setIsUserModalOpen(false)
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

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
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

    if (!password.trim()) {
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
      user.email.trim().toLocaleLowerCase() === normalizedEmail
    ))

    if (hasDuplicateEmail) {
      setUserFormError('Este e-mail já está cadastrado.')
      return
    }

    setIsSavingUser(true)

    try {
      const createdUser = await createAdminUser({
        name,
        email,
        password,
        role: newUserForm.role,
        bakeryId: newUserForm.role === 'owner' ? null : newUserForm.bakeryId,
      })
      const savedUser = { ...createdUser, password: '' }

      setUsers((currentUsers) => [...currentUsers, savedUser])
      setNewUserForm(initialNewUserForm)
      setUserFormError('')
      setIsUserModalOpen(false)
      setUserSuccessMessage('Usuário criado com sucesso.')
    } catch (error) {
      setUserFormError(error instanceof Error ? error.message : 'Não foi possível salvar o usuário.')
    } finally {
      setIsSavingUser(false)
    }
  }

  function openBakeryModal() {
    setEditingBakery(null)
    setBakeryForm(initialBakeryForm)
    setBakeryFormError('')
    setIsBakeryModalOpen(true)
  }

  function openEditBakeryModal(bakery: Bakery) {
    setEditingBakery(bakery)
    setBakeryForm({ name: bakery.name, active: bakery.active })
    setBakeryFormError('')
    setIsBakeryModalOpen(true)
  }

  function closeBakeryModal() {
    if (isSavingBakery) return

    setIsBakeryModalOpen(false)
    setEditingBakery(null)
    setBakeryForm(initialBakeryForm)
    setBakeryFormError('')
  }

  function handleBakeryOverlayMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) closeBakeryModal()
  }

  async function handleBakerySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSavingBakery) return

    const name = bakeryForm.name.trim()
    if (!name) {
      setBakeryFormError('Informe o nome da unidade.')
      return
    }

    const normalizedName = name.toLocaleLowerCase().replace(/\s+/g, ' ')
    const hasDuplicateName = bakeries.some((bakery) => (
      bakery.id !== editingBakery?.id
      && bakery.name.trim().toLocaleLowerCase().replace(/\s+/g, ' ') === normalizedName
    ))

    if (hasDuplicateName) {
      setBakeryFormError('Esta unidade já está cadastrada.')
      return
    }

    if (editingBakery?.active && !bakeryForm.active) {
      try {
        if (await getOpenCashRegister(editingBakery.id)) {
          setBakeryFormError('Não é possível desativar esta unidade enquanto houver um caixa aberto. Feche o caixa primeiro.')
          return
        }
      } catch (error) {
        setBakeryFormError(error instanceof Error ? error.message : 'Não foi possível verificar o caixa aberto.')
        return
      }
    }

    setIsSavingBakery(true)

    try {
      const savedBakery = editingBakery
        ? await updateBakery(editingBakery.id, { name, active: bakeryForm.active })
        : await addBakery({ name, active: bakeryForm.active })

      setBakeries((currentBakeries) => editingBakery
        ? currentBakeries.map((bakery) => bakery.id === savedBakery.id ? savedBakery : bakery)
        : [...currentBakeries, savedBakery])
      if (!savedBakery.active && userBakeryFilter === savedBakery.id) setUserBakeryFilter('all')
      setIsBakeryModalOpen(false)
      setEditingBakery(null)
      setBakeryForm(initialBakeryForm)
      setBakeryFormError('')
    } catch (error) {
      setBakeryFormError(error instanceof Error ? error.message : 'Não foi possível salvar a unidade.')
    } finally {
      setIsSavingBakery(false)
    }
  }

  return (
    <div className="dashboard-layout settings-layout flex min-h-screen">
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
          {isOwner && <a href="/dashboard" className="sidebar-link"><LayoutDashboard size={19} /><span>Dashboard</span></a>}
          {!isOwner && <a href="/pdv" className="sidebar-link"><ShoppingCart size={19} /><span>Caixa</span></a>}
          {!isOwner && <a href="/fechamento" className="sidebar-link"><Calculator size={19} /><span>Fechamento</span></a>}
          {!isOwner && <a href="/produtos" className="sidebar-link"><Package size={19} /><span>Produtos</span></a>}
          {isOwner && <a href="/historico-vendas" className="sidebar-link"><History size={19} /><span>Histórico de Vendas</span></a>}
          {isOwner && <a href="/historico-fechamentos" className="sidebar-link"><History size={19} /><span>Histórico de Fechamentos</span></a>}
          {isOwner && <a href="/relatorios" className="sidebar-link"><BarChart3 size={19} /><span>Relatórios</span></a>}
        </nav>

        <div className="sidebar-bottom mt-auto flex flex-col gap-2">
          {isOwner && <a href="/configuracoes" className="sidebar-link active"><Settings size={19} /><span>Configurações</span></a>}
          <button type="button" onClick={handleLogout} className="sidebar-link logout-button"><LogOut size={19} /><span>Sair</span></button>
        </div>
      </aside>

      <div className={`mobile-menu-overlay${isMobileMenuOpen ? ' is-open' : ''}`} onClick={closeMobileMenu} />

      <aside className={`mobile-drawer${isMobileMenuOpen ? ' is-open' : ''}`} aria-hidden={!isMobileMenuOpen}>
        <div className="mobile-drawer-header">
          <div className="sidebar-logo">
            <div className="logo-icon">
              <ShoppingCart size={22} />
            </div>
            <div>
              <strong>Padaria PDV</strong>
              <span>Sistema de vendas</span>
            </div>
          </div>
          <button type="button" className="mobile-close-button" onClick={closeMobileMenu} aria-label="Fechar menu">
            <X size={22} />
          </button>
        </div>

        <nav className="mobile-drawer-menu">
          {isOwner && <a href="/dashboard" className="sidebar-link" onClick={closeMobileMenu}>
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
          </a>}
          {!isOwner && <a href="/pdv" className="sidebar-link" onClick={closeMobileMenu}>
            <ShoppingCart size={19} />
            <span>Caixa</span>
          </a>}
          {!isOwner && <a href="/fechamento" className="sidebar-link" onClick={closeMobileMenu}>
            <Calculator size={19} />
            <span>Fechamento</span>
          </a>}
          {!isOwner && <a href="/produtos" className="sidebar-link" onClick={closeMobileMenu}>
            <Package size={19} />
            <span>Produtos</span>
          </a>}
          {isOwner && <a href="/historico-vendas" className="sidebar-link" onClick={closeMobileMenu}>
            <History size={19} />
            <span>Histórico de Vendas</span>
          </a>}
          {isOwner && <a href="/historico-fechamentos" className="sidebar-link" onClick={closeMobileMenu}>
            <History size={19} />
            <span>Histórico de Fechamentos</span>
          </a>}
          {isOwner && <a href="/relatorios" className="sidebar-link" onClick={closeMobileMenu}>
            <BarChart3 size={19} />
            <span>Relatórios</span>
          </a>}
        </nav>

        <div className="mobile-drawer-bottom">
          {isOwner && <a href="/configuracoes" className="sidebar-link active" onClick={closeMobileMenu}>
            <Settings size={19} />
            <span>Configurações</span>
          </a>}
          <button type="button" onClick={handleLogout} className="sidebar-link logout-button">
            <LogOut size={19} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <main className="dashboard-main ml-64 min-h-screen flex-1">
        <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
          <div className="mobile-topbar">
            <div className="mobile-header-brand" aria-label="Padaria PDV">
              <div className="logo-icon">
                <ShoppingCart size={17} />
              </div>
              <span>Padaria PDV</span>
            </div>
            <button
              type="button"
              className="mobile-menu-button"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={isMobileMenuOpen}
            >
              <Menu size={23} />
            </button>
          </div>
          <div className="mobile-page-heading">
            <span className="header-overline">CONTA DO USUÁRIO</span>
            <h1>Configurações</h1>
            <p>Gerencie usuários e unidades do sistema.</p>
          </div>
          <UserProfileMenu user={authenticatedUser} />
        </header>

        <section className="dashboard-content settings-content p-10">
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

            <div className="settings-field users-filter">
              <label htmlFor="users-bakery-filter">Unidade</label>
              <select
                id="users-bakery-filter"
                value={userBakeryFilter}
                onChange={(event) => setUserBakeryFilter(event.target.value)}
              >
                <option value="all">Todas as unidades</option>
                {activeBakeryOptions.map((bakery) => (
                  <option key={bakery.id} value={bakery.id}>{bakery.name}</option>
                ))}
              </select>
            </div>

            {usersLoadError ? (
              <p className="user-form-error" role="alert">{usersLoadError}</p>
            ) : isLoadingUsers ? (
              <div className="users-empty-state">Carregando usuários...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="users-empty-state">
                {userBakeryFilter === 'all' ? 'Nenhum usuário cadastrado.' : 'Nenhum usuário cadastrado nesta unidade.'}
              </div>
            ) : (
              <div className="users-table-wrapper">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th scope="col">Nome</th>
                      <th scope="col">E-mail</th>
                      <th scope="col">Perfil</th>
                      <th scope="col">Unidade</th>
                      <th scope="col">Gerenciamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id}>
                        <td data-label="Nome">{user.name}</td>
                        <td data-label="E-mail">{user.email}</td>
                        <td data-label="Perfil">
                          <span className={`user-role-badge ${user.role}`}>{getRoleLabel(user.role)}</span>
                        </td>
                        <td data-label="Unidade">{getBakeryLabel(user.bakeryId, bakeries)}</td>
                        <td data-label="Gerenciamento">
                          <span title="O serviço administrativo atual permite consultar e criar usuários.">
                            Edição e exclusão indisponíveis
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="settings-card users-card" aria-labelledby="bakeries-section-title">
            <div className="settings-card-heading">
              <div>
                <span className="settings-card-overline">ESTRUTURA DA OPERAÇÃO</span>
                <h2 id="bakeries-section-title">Unidades</h2>
                <p>Gerencie as unidades disponíveis no sistema.</p>
              </div>
              <div className="users-heading-actions">
                <Building2 size={22} aria-hidden="true" />
                <button type="button" className="settings-button users-new-button" onClick={openBakeryModal}>
                  <Building2 size={17} />
                  Nova unidade
                </button>
              </div>
            </div>

            {bakeriesLoadError ? (
              <p className="user-form-error" role="alert">{bakeriesLoadError}</p>
            ) : isLoadingBakeries ? (
              <div className="users-empty-state">Carregando unidades...</div>
            ) : bakeries.length === 0 ? (
              <div className="users-empty-state">Nenhuma unidade cadastrada.</div>
            ) : (
              <div className="users-table-wrapper">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th scope="col">Nome</th>
                      <th scope="col">Status</th>
                      <th scope="col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bakeries.map((bakery) => (
                      <tr key={bakery.id}>
                        <td data-label="Nome">{bakery.name}</td>
                        <td data-label="Status">
                          <span className={`bakery-status-badge ${bakery.active ? 'active' : 'inactive'}`}>
                            {bakery.active ? 'Ativa' : 'Inativa'}
                          </span>
                        </td>
                        <td data-label="Ações">
                          <button
                            type="button"
                            className="user-actions-button"
                            onClick={() => openEditBakeryModal(bakery)}
                            aria-label={`Editar ${bakery.name}`}
                            title={`Editar ${bakery.name}`}
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

        {isBakeryModalOpen && (
          <div
            className="user-modal-overlay"
            role="presentation"
            onMouseDown={handleBakeryOverlayMouseDown}
          >
            <section
              className="user-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bakery-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="user-modal-header">
                <div>
                  <span className="settings-card-overline">ESTRUTURA DA OPERAÇÃO</span>
                  <h2 id="bakery-modal-title">{editingBakery ? 'Editar unidade' : 'Nova unidade'}</h2>
                  <p>{editingBakery ? 'Atualize os dados da unidade cadastrada.' : 'Cadastre uma unidade para a operação.'}</p>
                </div>
                <button type="button" className="user-modal-close" onClick={closeBakeryModal} aria-label="Fechar cadastro de unidade">
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <form className="user-form" onSubmit={handleBakerySubmit}>
                <div className="user-form-fields bakery-form-fields">
                  <div className="settings-field">
                    <label htmlFor="bakery-name">Nome da unidade</label>
                    <input
                      id="bakery-name"
                      type="text"
                      value={bakeryForm.name}
                      onChange={(event) => {
                        setBakeryForm((currentForm) => ({ ...currentForm, name: event.target.value }))
                        setBakeryFormError('')
                      }}
                      autoComplete="organization"
                      aria-invalid={Boolean(bakeryFormError)}
                    />
                  </div>
                  <label className="bakery-status-toggle">
                    <input
                      type="checkbox"
                      checked={bakeryForm.active}
                      onChange={(event) => setBakeryForm((currentForm) => ({ ...currentForm, active: event.target.checked }))}
                    />
                    <span>Unidade ativa</span>
                  </label>
                </div>

                {bakeryFormError && <p className="user-form-error" role="alert">{bakeryFormError}</p>}

                <div className="user-modal-actions">
                  <button type="button" className="user-modal-cancel" onClick={closeBakeryModal} disabled={isSavingBakery}>
                    Cancelar
                  </button>
                  <button type="submit" className="settings-button" disabled={isSavingBakery}>
                    {isSavingBakery ? 'Salvando...' : editingBakery ? 'Atualizar' : 'Salvar'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

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
                  <h2 id="new-user-modal-title">Novo usuário</h2>
                  <p>Cadastre um usuário para acessar o sistema.</p>
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
                        <option key={bakery.id} value={bakery.id}>
                          {bakery.name}{bakery.active ? '' : ' (Inativa)'}
                        </option>
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
                    {isSavingUser ? 'Salvando...' : 'Salvar'}
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