import { BarChart3, Calculator, History, LayoutDashboard, Package, ShoppingCart } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import type { AuthenticatedUser } from '../../services/auth'
import { PendingRegistersNavigationLink } from '../PendingRegistersNavigationLink/PendingRegistersNavigationLink'
import './AdminSidebar.css'

interface AdminSidebarProps {
    user: AuthenticatedUser | null
    onLogout: () => void
}

export function AdminSidebar({ user }: AdminSidebarProps) {
    const location = useLocation()
    const isOwner = user?.role === 'owner'

    function linkClass(path: string) {
        return `sidebar-link${location.pathname === path ? ' active' : ''}`
    }

    return (
        <aside className="admin-sidebar">
            <div className="admin-sidebar-logo">
                <div className="logo-icon">
                    <ShoppingCart size={22} />
                </div>
                <div>
                    <strong>PDV360</strong>
                    <span>Sistema de vendas</span>
                </div>
            </div>

            <nav className="admin-sidebar-menu">
                {isOwner ? (
                    <>
                        <Link to="/dashboard" className={linkClass('/dashboard')}>
                            <LayoutDashboard size={19} />
                            <span>Painel</span>
                        </Link>
                        <Link to="/historico-fechamentos" className={linkClass('/historico-fechamentos')}>
                            <History size={19} />
                            <span>Histórico de Fechamentos</span>
                        </Link>
                        <PendingRegistersNavigationLink className="sidebar-link" />
                        <Link to="/relatorios" className={linkClass('/relatorios')}>
                            <BarChart3 size={19} />
                            <span>Relatórios</span>
                        </Link>
                    </>
                ) : (
                    <>
                        <Link to="/pdv" className={linkClass('/pdv')}>
                            <ShoppingCart size={19} />
                            <span>Caixa</span>
                        </Link>
                        <Link to="/fechamento" className={linkClass('/fechamento')}>
                            <Calculator size={19} />
                            <span>Fechamento</span>
                        </Link>
                        <Link to="/produtos" className={linkClass('/produtos')}>
                            <Package size={19} />
                            <span>Produtos</span>
                        </Link>
                    </>
                )}
            </nav>

        </aside>
    )
}
