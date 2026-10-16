import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, History, BarChart3, Settings, Calculator } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import './MobileBottomNav.css'

export function MobileBottomNav() {
  const { authenticatedUser } = useAuth()
  const location = useLocation()
  const isOwner = authenticatedUser?.role === 'owner'

  // Só exibir para administradores logados em rotas administrativas
  if (!authenticatedUser || !isOwner) return null

  // Ocultar se estiver em tela de login
  if (location.pathname === '/login' || location.pathname === '/') return null

  const navItems = [
    {
      label: 'Início',
      path: '/dashboard',
      icon: LayoutDashboard,
    },
    {
      label: 'Vendas',
      path: '/historico-vendas',
      icon: History,
    },
    {
      label: 'Fechamentos',
      path: '/historico-fechamentos',
      icon: Calculator,
    },
    {
      label: 'Relatórios',
      path: '/relatorios',
      icon: BarChart3,
    },
    {
      label: 'Ajustes',
      path: '/configuracoes',
      icon: Settings,
    },
  ]

  return (
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
            >
              <div className="mobile-bottom-nav-icon-wrap">
                <Icon size={20} />
              </div>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
