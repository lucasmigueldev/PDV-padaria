import {
  BarChart3,
  Calculator,
  History,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  ShoppingCart,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import '../Dashboard/Dashborad.css'
import './Relatorios.css'

export default function Relatorios() {
  const navigate = useNavigate()

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
          <a href="/fechamento" className="sidebar-link">
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
          <a href="/historico-fechamentos" className="sidebar-link">
            <History size={19} />
            <span>Histórico de Fechamentos</span>
          </a>
          <a href="/relatorios" className="sidebar-link active">
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
            <span className="header-overline">ANÁLISE OPERACIONAL</span>
            <h1>Relatórios</h1>
            <p>Consulte os relatórios da operação da sua padaria.</p>
          </div>
          <div className="header-user flex items-center gap-3">
            <div className="user-avatar">A</div>
            <div>
              <strong>Administrador</strong>
              <span>Usuário do sistema</span>
            </div>
          </div>
        </header>

        <section className="dashboard-content reports-content p-10">
          <section className="reports-placeholder" aria-labelledby="reports-placeholder-title">
            <div className="reports-placeholder-icon" aria-hidden="true">
              <BarChart3 size={28} />
            </div>
            <div>
              <h2 id="reports-placeholder-title">Relatórios em preparação</h2>
              <p>
                Esta área está preparada para receber os relatórios da operação.
              </p>
            </div>
          </section>
        </section>
      </main>
    </div>
  )
}
