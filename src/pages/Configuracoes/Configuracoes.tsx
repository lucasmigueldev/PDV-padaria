import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import {
  BarChart3,
  Building2,
  Calculator,
  History,
  LayoutDashboard,
  LogOut,
  Package,
  Pencil,
  QrCode,
  Settings,
  ShoppingCart,
  Store,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'

import { UserProfileMenu } from '../../components/UserProfileMenu/UserProfileMenu'
import PixQrCode from '../../components/PixQrCode/PixQrCode'
import { getOpenCashRegister } from '../../services/operations'
import {
  createAdminUser,
  deactivateAdminUser,
  getAdminUsers,
  updateAdminUser,
} from '../../services/adminUsers'
import { addBakery, updateBakery } from '../../services/bakeries'
import { useEstablishmentName, saveEstablishmentName } from '../../services/establishment'
import { usePixKey, savePixKey } from '../../services/pixConfig'
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
  const [editingOperator, setEditingOperator] = useState<User | null>(null)
  const [newUserForm, setNewUserForm] = useState(initialNewUserForm)
  const [operatorEditForm, setOperatorEditForm] = useState({
    name: '',
    email: '',
    password: '',
    bakeryId: '',
  })
  const { bakeries, setBakeries, isLoadingBakeries, bakeriesLoadError } = useBakeries()
  const [activeBakeries, setActiveBakeries] = useState<Bakery[]>([])
  const [isBakeryModalOpen, setIsBakeryModalOpen] = useState(false)
  const [editingBakery, setEditingBakery] = useState<Bakery | null>(null)
  const [bakeryForm, setBakeryForm] = useState(initialBakeryForm)
  const [bakeryFormError, setBakeryFormError] = useState('')
  const [isSavingBakery, setIsSavingBakery] = useState(false)
  const [activeTab, setActiveTab] = useState<'users' | 'bakeries' | 'general' | 'pix'>('users')
  const currentEstablishmentName = useEstablishmentName()
  const pixKeyFromService = usePixKey()
  const [pixKeyInput, setPixKeyInput] = useState(pixKeyFromService)
  const [isSavingPixKey, setIsSavingPixKey] = useState(false)
  const [pixKeyFeedback, setPixKeyFeedback] = useState<{ isError: boolean; message: string } | null>(null)
  const [isEditingPixKey, setIsEditingPixKey] = useState(false)
  const [establishmentInput, setEstablishmentInput] = useState(currentEstablishmentName)
  const [isSavingEstablishment, setIsSavingEstablishment] = useState(false)
  const [establishmentFeedback, setEstablishmentFeedback] = useState<{ isError: boolean; message: string } | null>(null)

  async function handleSaveEstablishment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = establishmentInput.trim()
    if (!name) {
      setEstablishmentFeedback({ isError: true, message: 'Informe o nome do estabelecimento.' })
      return
    }

    setIsSavingEstablishment(true)
    setEstablishmentFeedback(null)
    try {
      await saveEstablishmentName(name)
      setEstablishmentFeedback({ isError: false, message: 'Nome do estabelecimento salvo com sucesso!' })
    } catch {
      setEstablishmentFeedback({ isError: true, message: 'Não foi possível salvar o nome do estabelecimento.' })
    } finally {
      setIsSavingEstablishment(false)
    }
  }

  async function handleSavePixKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const key = pixKeyInput.trim()
    if (!key) {
      setPixKeyFeedback({ isError: true, message: 'Informe a chave PIX.' })
      return
    }

    setIsSavingPixKey(true)
    setPixKeyFeedback(null)
    try {
      await savePixKey(key)
      setPixKeyInput('')
      setIsEditingPixKey(false)
      setPixKeyFeedback({ isError: false, message: 'Chave PIX salva com sucesso!' })
    } catch {
      setPixKeyFeedback({ isError: true, message: 'Não foi possível salvar a chave PIX.' })
    } finally {
      setIsSavingPixKey(false)
    }
  }

  async function handleDeletePixKey() {
    if (!window.confirm('Tem certeza que deseja excluir a chave PIX?')) return
    setIsSavingPixKey(true)
    setPixKeyFeedback(null)
    try {
      await savePixKey('')
      setPixKeyInput('')
      setIsEditingPixKey(false)
      setPixKeyFeedback({ isError: false, message: 'Chave PIX excluída com sucesso!' })
    } catch {
      setPixKeyFeedback({ isError: true, message: 'Não foi possível excluir a chave PIX.' })
    } finally {
      setIsSavingPixKey(false)
    }
  }

  const [userFormError, setUserFormError] = useState('')
  const [userSuccessMessage, setUserSuccessMessage] = useState('')
  const [userManagementError, setUserManagementError] = useState('')
  const [isSavingUser, setIsSavingUser] = useState(false)
  const [isManagingOperator, setIsManagingOperator] = useState(false)
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
        if (!isSavingUser) {
          setIsUserModalOpen(false)
          setEditingOperator(null)
          setNewUserForm(initialNewUserForm)
          setOperatorEditForm({ name: '', email: '', password: '', bakeryId: '' })
          setUserFormError('')
        }
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
  }, [isBakeryModalOpen, isSavingBakery, isSavingUser, isUserModalOpen])

  function handleLogout() {
    void logoutAndRedirect(navigate)
  }

  function closeMobileMenu() {
    setIsMobileMenuOpen(false)
  }

  function openUserModal() {
    setEditingOperator(null)
    setActiveBakeries(bakeries.filter((bakery) => bakery.active))
    setNewUserForm(initialNewUserForm)
    setOperatorEditForm({ name: '', email: '', password: '', bakeryId: '' })
    setUserFormError('')
    setUserSuccessMessage('')
    setUserManagementError('')
    setIsUserModalOpen(true)
  }

  function openEditOperatorModal(operator: User) {
    if (operator.role !== 'cashier') return

    const currentBakery = bakeries.find((bakery) => bakery.id === operator.bakeryId)
    setEditingOperator(operator)
    setActiveBakeries([
      ...bakeries.filter((bakery) => bakery.active),
      ...(currentBakery && !currentBakery.active ? [currentBakery] : []),
    ])
    setOperatorEditForm({
      name: operator.name,
      email: operator.email,
      password: '',
      bakeryId: operator.bakeryId ?? '',
    })
    setUserFormError('')
    setUserManagementError('')
    setUserSuccessMessage('')
    setIsUserModalOpen(true)
  }

  function closeUserModal() {
    if (isSavingUser) return

    setIsUserModalOpen(false)
    setEditingOperator(null)
    setNewUserForm(initialNewUserForm)
    setOperatorEditForm({ name: '', email: '', password: '', bakeryId: '' })
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

    if (editingOperator) {
      const name = operatorEditForm.name.trim()
      const email = operatorEditForm.email.trim().toLowerCase()
      const password = operatorEditForm.password.trim()
        ? operatorEditForm.password
        : undefined

      if (!name) {
        setUserFormError('Informe o nome do operador.')
        return
      }
      if (!operatorEditForm.bakeryId) {
        setUserFormError('Selecione uma unidade.')
        return
      }
      if (password !== undefined && password.length < 7) {
        setUserFormError('A nova senha deve ter no mínimo 7 caracteres.')
        return
      }

      setIsSavingUser(true)
      try {
        await updateAdminUser({
          id: editingOperator.id,
          name,
          bakeryId: operatorEditForm.bakeryId,
          ...(email !== editingOperator.email.trim().toLowerCase() ? { email } : {}),
          ...(password !== undefined ? { password } : {}),
        })
        setUsers((currentUsers) => currentUsers.map((user) => (
          user.id === editingOperator.id
            ? { ...user, name, email, bakeryId: operatorEditForm.bakeryId }
            : user
        )))
        setIsUserModalOpen(false)
        setEditingOperator(null)
        setOperatorEditForm({ name: '', email: '', password: '', bakeryId: '' })
        setUserFormError('')
        setUserSuccessMessage('Operador atualizado com sucesso.')
        setUserManagementError('')
      } catch (error) {
        setUserFormError(error instanceof Error ? error.message : 'Não foi possível atualizar o operador.')
      } finally {
        setIsSavingUser(false)
      }
      return
    }

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

  async function handleOperatorDeactivation(operator: User) {
    if (operator.role !== 'cashier' || isManagingOperator) return

    const confirmed = window.confirm(
      `Desativar o operador ${operator.name}? O histórico de vendas e caixas será preservado.`,
    )
    if (!confirmed) return

    setIsManagingOperator(true)
    setUserManagementError('')
    setUserSuccessMessage('')
    try {
      await deactivateAdminUser(operator.id)
      setUsers((currentUsers) => currentUsers.filter((user) => user.id !== operator.id))
      setUserSuccessMessage('Operador desativado. O histórico foi preservado.')
    } catch (error) {
      setUserManagementError(error instanceof Error ? error.message : 'Não foi possível desativar o operador.')
    } finally {
      setIsManagingOperator(false)
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
        console.error('Não foi possível verificar o caixa aberto da unidade.', error)
        setBakeryFormError(error instanceof TypeError
          ? 'Não foi possível conectar ao sistema para verificar o caixa aberto. Verifique sua conexão e tente novamente.'
          : 'Não foi possível verificar se há um caixa aberto. Atualize a tela e tente novamente.')
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

  async function handleDeleteBakery(bakery: Bakery) {
    const confirmed = window.confirm(
      `Excluir a unidade "${bakery.name}"? O histórico de vendas e caixas será preservado, mas a unidade ficará inativa.`,
    )
    if (!confirmed) return

    try {
      if (await getOpenCashRegister(bakery.id)) {
        window.alert('Não é possível excluir esta unidade enquanto houver um caixa aberto. Feche o caixa primeiro.')
        return
      }
    } catch (error) {
      console.error('Não foi possível verificar o caixa aberto da unidade.', error)
      window.alert('Não foi possível verificar se há um caixa aberto. Verifique sua conexão e tente novamente.')
      return
    }

    try {
      await updateBakery(bakery.id, { name: bakery.name, active: false })
      setBakeries((currentBakeries) =>
        currentBakeries.map((b) => (b.id === bakery.id ? { ...b, active: false } : b)),
      )
      if (userBakeryFilter === bakery.id) setUserBakeryFilter('all')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Não foi possível excluir a unidade.')
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
            <strong>PDV360</strong>
            <span>Sistema de vendas</span>
          </div>
        </div>

        <nav className="sidebar-menu flex flex-col gap-2">
          {isOwner && <Link to="/dashboard" className="sidebar-link"><LayoutDashboard size={19} /><span>Painel</span></Link>}
          {!isOwner && <Link to="/pdv" className="sidebar-link"><ShoppingCart size={19} /><span>Caixa</span></Link>}
          {!isOwner && <Link to="/fechamento" className="sidebar-link"><Calculator size={19} /><span>Fechamento</span></Link>}
          {!isOwner && <Link to="/produtos" className="sidebar-link"><Package size={19} /><span>Produtos</span></Link>}
          {isOwner && <Link to="/historico-fechamentos" className="sidebar-link"><History size={19} /><span>Histórico de Fechamentos</span></Link>}
          {isOwner && <Link to="/relatorios" className="sidebar-link"><BarChart3 size={19} /><span>Relatórios</span></Link>}
        </nav>

        <div className="sidebar-bottom mt-auto flex flex-col gap-2">
          {isOwner && <Link to="/configuracoes" className="sidebar-link active"><Settings size={19} /><span>Configurações</span></Link>}
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
              <strong>PDV360</strong>
              <span>Sistema de vendas</span>
            </div>
          </div>
          <button type="button" className="mobile-close-button" onClick={closeMobileMenu} aria-label="Fechar menu">
            <X size={22} />
          </button>
        </div>

        <nav className="mobile-drawer-menu">
          {isOwner && <Link to="/dashboard" className="sidebar-link" onClick={closeMobileMenu}>
            <LayoutDashboard size={19} />
            <span>Painel</span>
          </Link>}
          {!isOwner && <Link to="/pdv" className="sidebar-link" onClick={closeMobileMenu}>
            <ShoppingCart size={19} />
            <span>Caixa</span>
          </Link>}
          {!isOwner && <Link to="/fechamento" className="sidebar-link" onClick={closeMobileMenu}>
            <Calculator size={19} />
            <span>Fechamento</span>
          </Link>}
          {!isOwner && <Link to="/produtos" className="sidebar-link" onClick={closeMobileMenu}>
            <Package size={19} />
            <span>Produtos</span>
          </Link>}
          {isOwner && <Link to="/historico-fechamentos" className="sidebar-link" onClick={closeMobileMenu}>
            <History size={19} />
            <span>Histórico de Fechamentos</span>
          </Link>}
          {isOwner && <Link to="/relatorios" className="sidebar-link" onClick={closeMobileMenu}>
            <BarChart3 size={19} />
            <span>Relatórios</span>
          </Link>}
        </nav>

        <div className="mobile-drawer-bottom">
          {isOwner && <Link to="/configuracoes" className="sidebar-link active" onClick={closeMobileMenu}>
            <Settings size={19} />
            <span>Configurações</span>
          </Link>}
          <button type="button" onClick={handleLogout} className="sidebar-link logout-button">
            <LogOut size={19} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <main className="dashboard-main ml-64 min-h-screen flex-1">
        <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
          <div className="mobile-topbar">
            <div className="mobile-header-brand" aria-label="PDV360">
              <div className="logo-icon">
                <ShoppingCart size={17} />
              </div>
              <span>PDV360</span>
            </div>
            <UserProfileMenu user={authenticatedUser} />
          </div>
          <div className="dashboard-header-row">
            <div className="mobile-page-heading">
              <span className="header-overline">CONTA DO USUÁRIO</span>
              <h1>Configurações</h1>
              <p>Gerencie usuários e unidades do sistema.</p>
            </div>
            <div className="desktop-user-profile">
              <UserProfileMenu user={authenticatedUser} />
            </div>
          </div>
        </header>

        <section className="dashboard-content settings-content p-10">
          <nav className="settings-tabs" aria-label="Seções de configurações">
            <button
              type="button"
              className={`settings-tab-button${activeTab === 'general' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              <Store size={16} aria-hidden="true" />
              Geral
            </button>
            <button
              type="button"
              className={`settings-tab-button${activeTab === 'users' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('users')}
            >
              <Users size={16} aria-hidden="true" />
              Usuários
            </button>
            <button
              type="button"
              className={`settings-tab-button${activeTab === 'bakeries' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('bakeries')}
            >
              <Building2 size={16} aria-hidden="true" />
              Unidades
            </button>
            {isOwner && (
              <button
                type="button"
                className={`settings-tab-button${activeTab === 'pix' ? ' is-active' : ''}`}
                onClick={() => setActiveTab('pix')}
              >
                <QrCode size={16} aria-hidden="true" />
                PIX QR Code
              </button>
            )}
          </nav>

          {activeTab === 'general' && (
            <section className="settings-card establishment-card" aria-labelledby="establishment-section-title">
              <div className="settings-card-heading">
                <div>
                  <span className="settings-card-overline">IDENTIFICAÇÃO DO NEGÓCIO</span>
                  <h2 id="establishment-section-title">Nome do Estabelecimento</h2>
                  <p>Nome exibido no topo do sistema e impresso no cabeçalho do cupom não fiscal.</p>
                </div>
                <Store size={22} aria-hidden="true" />
              </div>

              {establishmentFeedback && (
                <p className={establishmentFeedback.isError ? 'user-form-error' : 'settings-message'} role={establishmentFeedback.isError ? 'alert' : 'status'}>
                  {establishmentFeedback.message}
                </p>
              )}

              <form onSubmit={handleSaveEstablishment} className="establishment-form">
                <div className="settings-field">
                  <label htmlFor="establishment-name-input">Nome da Empresa / Padaria</label>
                  <div className="flex gap-3">
                    <input
                      id="establishment-name-input"
                      type="text"
                      value={establishmentInput}
                      onChange={(event) => setEstablishmentInput(event.target.value)}
                      placeholder="Ex: Padaria Pão Quente"
                      maxLength={60}
                      required
                    />
                    <button type="submit" className="settings-button" disabled={isSavingEstablishment}>
                      {isSavingEstablishment ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </div>
              </form>
            </section>
          )}

          {activeTab === 'users' && (
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
              {userManagementError && <p className="user-form-error" role="alert">{userManagementError}</p>}

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
                            {user.role === 'cashier' ? (
                              <div className="operator-management-actions">
                                <button
                                  type="button"
                                  className="user-actions-button"
                                  onClick={() => openEditOperatorModal(user)}
                                  disabled={isManagingOperator}
                                  aria-label={`Editar ${user.name}`}
                                  title={`Editar ${user.name}`}
                                >
                                  <Pencil size={15} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="user-actions-button user-delete-button"
                                  onClick={() => void handleOperatorDeactivation(user)}
                                  disabled={isManagingOperator}
                                  aria-label={`Excluir ${user.name}`}
                                  title={`Excluir ${user.name}`}
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                </button>
                              </div>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === 'bakeries' && (
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
                            <div className="operator-management-actions">
                              <button
                                type="button"
                                className="user-actions-button"
                                onClick={() => openEditBakeryModal(bakery)}
                                aria-label={`Editar ${bakery.name}`}
                                title={`Editar ${bakery.name}`}
                              >
                                <Pencil size={16} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="user-actions-button user-delete-button"
                                onClick={() => void handleDeleteBakery(bakery)}
                                aria-label={`Excluir ${bakery.name}`}
                                title={`Excluir ${bakery.name}`}
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === 'pix' && (
            <section className="settings-card pix-card" aria-labelledby="pix-section-title">
              <div className="settings-card-heading">
                <div>
                  <span className="settings-card-overline">PIX QR CODE</span>
                  <h2 id="pix-section-title">Chave PIX e QR Code</h2>
                  <p>
                    Informe a chave PIX da padaria. O QR Code gerado será exibido no PDV quando o cliente
                    selecionar PIX como forma de pagamento.
                  </p>
                </div>
              </div>

              {pixKeyFeedback && (
                <p
                  className={pixKeyFeedback.isError ? 'user-form-error' : 'settings-message'}
                  role={pixKeyFeedback.isError ? 'alert' : 'status'}
                >
                  {pixKeyFeedback.message}
                </p>
              )}

              {pixKeyFromService && !isEditingPixKey ? (
                <>
                  <div className="pix-qr-preview">
                    <h3 className="pix-qr-preview-title">Pré-visualização do QR Code</h3>
                    <PixQrCode pixKey={pixKeyFromService} size={200} />
                    <p className="pix-qr-preview-hint">O QR Code será exibido no PDV quando o cliente selecionar PIX.</p>
                  </div>

                  <div className="pix-actions">
                    <button type="button" className="settings-button pix-action-button" onClick={() => {
                      setPixKeyInput(pixKeyFromService)
                      setIsEditingPixKey(true)
                      setPixKeyFeedback(null)
                    }}>
                      <Pencil size={16} aria-hidden="true" />
                      Editar chave
                    </button>
                    <button type="button" className="settings-button pix-action-button pix-delete-button" onClick={handleDeletePixKey}>
                      <Trash2 size={16} aria-hidden="true" />
                      Excluir
                    </button>
                  </div>
                </>
              ) : (
                <form onSubmit={handleSavePixKey} className="pix-form">
                  <div className="settings-field">
                    <label htmlFor="pix-key-input">Chave PIX</label>
                    <input
                      id="pix-key-input"
                      type="text"
                      value={pixKeyInput}
                      onChange={(event) => setPixKeyInput(event.target.value)}
                      placeholder="E-mail, CPF, CNPJ, telefone ou chave aleatória"
                      maxLength={255}
                      required
                      autoFocus
                    />
                  </div>

                  <div className="pix-actions">
                    <button type="submit" className="settings-button pix-action-button" disabled={isSavingPixKey}>
                      {isSavingPixKey ? 'Salvando...' : 'Salvar chave PIX'}
                    </button>
                    {!isEditingPixKey && (
                      <button type="button" className="settings-button pix-action-button pix-cancel-button" onClick={() => {
                        setPixKeyInput('')
                        setPixKeyFeedback(null)
                      }}>
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
              )}
            </section>
          )}
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
              aria-labelledby="user-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="user-modal-header">
                <div>
                  <span className="settings-card-overline">ACESSO AO SISTEMA</span>
                  <h2 id="user-modal-title">{editingOperator ? 'Editar operador' : 'Novo usuário'}</h2>
                  <p>
                    {editingOperator
                      ? 'Edite nome e unidade. Alterações de e-mail e senha ainda não estão disponíveis.'
                      : 'Cadastre um usuário para acessar o sistema.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="user-modal-close"
                  onClick={closeUserModal}
                  aria-label={editingOperator ? 'Fechar edição de operador' : 'Fechar cadastro de usuário'}
                  disabled={isSavingUser}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <form className="user-form" onSubmit={handleUserSubmit}>
                <div className="user-form-fields">
                  <div className="settings-field">
                    <label htmlFor={editingOperator ? 'edit-operator-name' : 'new-user-name'}>Nome</label>
                    <input
                      id={editingOperator ? 'edit-operator-name' : 'new-user-name'}
                      type="text"
                      value={editingOperator ? operatorEditForm.name : newUserForm.name}
                      onChange={(event) => editingOperator
                        ? setOperatorEditForm((current) => ({ ...current, name: event.target.value }))
                        : updateNewUserField('name', event.target.value)}
                      autoComplete="name"
                    />
                  </div>

                  {editingOperator ? (
                    <>
                      <div className="settings-field">
                        <label htmlFor="edit-operator-email">E-mail</label>
                        <input
                          id="edit-operator-email"
                          type="email"
                          value={operatorEditForm.email}
                          onChange={(event) => setOperatorEditForm((current) => ({
                            ...current,
                            email: event.target.value,
                          }))}
                          autoComplete="email"
                        />
                      </div>

                      <div className="settings-field">
                        <label htmlFor="edit-operator-password">Nova senha</label>
                        <input
                          id="edit-operator-password"
                          type="password"
                          value={operatorEditForm.password}
                          onChange={(event) => setOperatorEditForm((current) => ({
                            ...current,
                            password: event.target.value,
                          }))}
                          autoComplete="new-password"
                        />
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}

                  <div className="settings-field">
                    <label htmlFor={editingOperator ? 'edit-operator-bakery' : 'new-user-bakery'}>Unidade</label>
                    <select
                      id={editingOperator ? 'edit-operator-bakery' : 'new-user-bakery'}
                      value={editingOperator ? operatorEditForm.bakeryId : newUserForm.bakeryId}
                      onChange={(event) => editingOperator
                        ? setOperatorEditForm((current) => ({ ...current, bakeryId: event.target.value }))
                        : updateNewUserField('bakeryId', event.target.value)}
                      disabled={!editingOperator && newUserForm.role !== 'cashier'}
                    >
                      <option value="">Selecione uma unidade</option>
                      {activeBakeries.map((bakery) => (
                        <option key={bakery.id} value={bakery.id}>
                          {bakery.name}{bakery.active ? '' : ' (Inativa — unidade atual)'}
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
                    {isSavingUser ? 'Salvando...' : editingOperator ? 'Atualizar' : 'Salvar'}
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