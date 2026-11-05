import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Calculator,
  ClipboardList,
  Clock,
  LayoutDashboard,
  LogOut,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useOverdueCashRegisterAlertContext } from '../../contexts/OverdueCashRegisterAlertContext'
import { logoutAndRedirect } from '../../utils/auth'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import './MobileBottomNav.css'

export function MobileBottomNav() {
  const { authenticatedUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { alertCount } = useOverdueCashRegisterAlertContext()
  const isOwner = authenticatedUser?.role === 'owner'
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Só exibir para administradores logados em rotas administrativas
  if (!authenticatedUser || !isOwner) return null

  // Ocultar se estiver em tela de login
  if (location.pathname === '/login' || location.pathname === '/') return null

  function handleLogoutClick() {
    setConfirmOpen(true)
  }

  function handleConfirmLogout() {
    setConfirmOpen(false)
    void logoutAndRedirect(navigate)
  }

  const navItems: {
    label: string
    accessibleLabel: string
    path: string
    icon: LucideIcon
    count?: number
  }[] = [
    {
      label: 'Início',
      accessibleLabel: 'Início',
      path: '/dashboard',
      icon: LayoutDashboard,
    },
    {
      label: 'Fechamentos',
      accessibleLabel: 'Fechamentos',
      path: '/historico-fechamentos',
      icon: Calculator,
    },
    {
      label: 'Caixas Pendentes',
      accessibleLabel: 'Caixas Pendentes',
      path: '/caixas-pendentes',
      icon: ClipboardList,
      count: alertCount,
    },
    {
      label: 'Relatórios',
      accessibleLabel: 'Relatórios',
      path: '/relatorios',
      icon: BarChart3,
    },
    {
      label: 'Fora do ar',
      accessibleLabel: 'Relatório de interrupções',
      path: '/relatorios-offline',
      icon: Clock,
    },
    {
      label: 'Ajustes',
      accessibleLabel: 'Ajustes',
      path: '/configuracoes',
      icon: Settings,
    },
  ]

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Navegação rápida">
        <div className="mobile-bottom-nav-inner">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`mobile-bottom-nav-item${isActive ? ' is-active' : ''}`}
                aria-label={item.count && item.count > 0
                  ? `${item.accessibleLabel}, ${item.count} caixas atrasados`
                  : item.accessibleLabel}
                aria-current={isActive ? 'page' : undefined}
              >
                <div className="mobile-bottom-nav-icon-wrap">
                  <Icon size={20} />
                  {item.count !== undefined && item.count > 0 && (
                    <span className="mobile-bottom-nav-count" aria-hidden="true">
                      {item.count > 99 ? '99+' : item.count}
                    </span>
                  )}
                </div>
                <span>{item.label}</span>
              </Link>
            )
          })}

          <button
            type="button"
            onClick={handleLogoutClick}
            className="mobile-bottom-nav-item mobile-bottom-nav-logout"
          >
            <div className="mobile-bottom-nav-icon-wrap">
              <LogOut size={20} />
            </div>
            <span>Sair</span>
          </button>
        </div>
      </nav>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Sair do sistema"
        message="Tem certeza que deseja encerrar a sua sessão?"
        onConfirm={handleConfirmLogout}
        onCancel={() => setConfirmOpen(false)}
        confirmText="Sair"
        cancelText="Cancelar"
      />
    </>
  )
}
