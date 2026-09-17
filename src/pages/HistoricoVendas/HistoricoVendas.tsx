import {
    BarChart3,
    Calculator,
    Clock3,
    History,
    LayoutDashboard,
    LogOut,
    Package,
    Settings,
    ShoppingCart,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { getSales } from '../../data/sales'
import type { PaymentMethod } from '../../types/Sale'
import '../Dashboard/Dashborad.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

const dateTime = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
})

const paymentMethodLabels: Record<PaymentMethod, string> = {
    cash: 'Dinheiro',
    pix: 'PIX',
    card: 'Cartão',
}

export default function HistoricoVendas() {
    const navigate = useNavigate()
    const sales = getSales()

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
                    <a href="/dashboard" className="sidebar-link"><LayoutDashboard size={19} /><span>Dashboard</span></a>
                    <a href="/pdv" className="sidebar-link"><ShoppingCart size={19} /><span>Caixa</span></a>
                    <a href="#" className="sidebar-link"><Calculator size={19} /><span>Fechamento</span></a>
                    <a href="/produtos" className="sidebar-link"><Package size={19} /><span>Produtos</span></a>
                    <a href="/historico-vendas" className="sidebar-link active"><History size={19} /><span>Histórico de Vendas</span></a>
                    <a href="#" className="sidebar-link"><BarChart3 size={19} /><span>Relatórios</span></a>
                </nav>

                <div className="sidebar-bottom mt-auto flex flex-col gap-2">
                    <a href="#" className="sidebar-link"><Settings size={19} /><span>Configurações</span></a>
                    <button type="button" onClick={handleLogout} className="sidebar-link logout-button"><LogOut size={19} /><span>Sair</span></button>
                </div>
            </aside>

            <main className="dashboard-main ml-64 min-h-screen flex-1">
                <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
                    <div>
                        <span className="header-overline">OPERAÇÃO DE VENDAS</span>
                        <h1>Histórico de Vendas</h1>
                        <p>Consulte as vendas já registradas no sistema.</p>
                    </div>
                    <div className="header-user flex items-center gap-3">
                        <div className="user-avatar">A</div>
                        <div><strong>Administrador</strong><span>Usuário do sistema</span></div>
                    </div>
                </header>

                <section className="dashboard-content p-10">
                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 p-6">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Vendas registradas</h2>
                                <p className="mt-1 text-sm text-slate-500">{sales.length} venda(s) encontrada(s)</p>
                            </div>
                            <Clock3 className="text-slate-400" size={21} aria-hidden="true" />
                        </div>

                        {sales.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[640px] text-left text-sm">
                                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                        <tr>
                                            <th className="px-6 py-4 font-semibold">Data e hora</th>
                                            <th className="px-6 py-4 font-semibold">ID da venda</th>
                                            <th className="px-6 py-4 font-semibold">Forma de pagamento</th>
                                            <th className="px-6 py-4 text-right font-semibold">Valor total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {sales.map((sale) => (
                                            <tr key={sale.id} className="text-slate-700">
                                                <td className="whitespace-nowrap px-6 py-4">{dateTime.format(new Date(sale.date))}</td>
                                                <td className="px-6 py-4 font-medium text-slate-900">{sale.id}</td>
                                                <td className="px-6 py-4">{paymentMethodLabels[sale.paymentMethod]}</td>
                                                <td className="whitespace-nowrap px-6 py-4 text-right font-semibold text-slate-900">{currency.format(sale.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="p-12 text-center">
                                <History className="mx-auto mb-4 text-slate-300" size={32} aria-hidden="true" />
                                <p className="font-medium text-slate-700">Ainda não existem vendas registradas.</p>
                                <p className="mt-1 text-sm text-slate-500">As vendas concluídas no caixa aparecerão aqui.</p>
                            </div>
                        )}
                    </section>
                </section>
            </main>
        </div>
    )
}