import {
    BarChart3,
    Banknote,
    Calculator,
    History,
    LayoutDashboard,
    LogOut,
    Package,
    Settings,
    ShoppingCart,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { getSales } from '../../data/sales'
import '../Dashboard/Dashborad.css'
import './Fechamento.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

function getDateKey(date: Date): string {
    return [date.getFullYear(), date.getMonth(), date.getDate()].join('-')
}

export default function Fechamento() {
    const navigate = useNavigate()
    const todayKey = getDateKey(new Date())
    const expectedCash = getSales()
        .filter((sale) => getDateKey(new Date(sale.date)) === todayKey)
        .filter((sale) => sale.paymentMethod === 'cash')
        .reduce((total, sale) => total + sale.total, 0)

    function handleLogout() {
        sessionStorage.removeItem('isAuthenticated')
        navigate('/login', { replace: true })
    }

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
                    <a href="/dashboard" className="sidebar-link">
                        <LayoutDashboard size={19} />
                        <span>Dashboard</span>
                    </a>
                    <a href="/pdv" className="sidebar-link">
                        <ShoppingCart size={19} />
                        <span>Caixa</span>
                    </a>
                    <a href="/fechamento" className="sidebar-link active">
                        <Calculator size={19} />
                        <span>Fechamento</span>
                    </a>
                    <a href="/produtos" className="sidebar-link">
                        <Package size={19} />
                        <span>Produtos</span>
                    </a>
                    <a href="/historico-vendas" className="sidebar-link">
                        <History size={19} />
                        <span>Histórico de Vendas</span>
                    </a>
                    <a href="#" className="sidebar-link">
                        <BarChart3 size={19} />
                        <span>Relatórios</span>
                    </a>
                </nav>

                <div className="sidebar-bottom mt-auto flex flex-col gap-2">
                    <a href="#" className="sidebar-link">
                        <Settings size={19} />
                        <span>Configurações</span>
                    </a>
                    <button type="button" onClick={handleLogout} className="sidebar-link logout-button">
                        <LogOut size={19} />
                        <span>Sair</span>
                    </button>
                </div>
            </aside>

            <main className="dashboard-main ml-64 min-h-screen flex-1">
                <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
                    <div>
                        <span className="header-overline">FECHAMENTO</span>
                        <h1>Resumo do movimento</h1>
                        <p>Confira as vendas realizadas hoje por forma de pagamento.</p>
                    </div>
                    <div className="header-user flex items-center gap-3">
                        <div className="user-avatar">A</div>
                        <div>
                            <strong>Administrador</strong>
                            <span>Usuário do sistema</span>
                        </div>
                    </div>
                </header>

                <section className="dashboard-content fechamento-content p-10">
                    <section className="fechamento-cash-card">
                        <div className="fechamento-cash-card-header">
                            <div className="fechamento-cash-icon">
                                <Banknote size={24} />
                            </div>
                            <span>Conferência de caixa</span>
                        </div>
                        <div className="fechamento-cash-card-body">
                            <div>
                                <h2>Valor esperado em dinheiro</h2>
                                <p>Valor calculado com base nas vendas em dinheiro registradas hoje.</p>
                            </div>
                            <strong>{currency.format(expectedCash)}</strong>
                        </div>
                    </section>
                </section>
            </main>
        </div>
    )
}