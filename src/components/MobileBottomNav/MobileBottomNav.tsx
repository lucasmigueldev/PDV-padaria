import { Link, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Calculator,
  ClipboardList,
  Clock,
  LayoutDashboard,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useOverdueCashRegisterAlertContext } from '../../contexts/OverdueCashRegisterAlertContext'
import './MobileBottomNav.css'

export function MobileBottomNav() {
  const { authenticatedUser } = useAuth()
  const location = useLocation()
  const { alertCount } = useOverdueCashRegisterAlertContext()
  const isOwner = authenticatedUser?.role === 'owner'

  // Só exibir para administradores logados em rotas administrativas
  if (!authenticatedUser || !isOwner) return null

  // Ocultar se estiver em tela de login
  if (location.pathname === '/login' || location.pathname === '/') return null

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

        </div>
      </nav>
    </>
  )
}
