import {
  BarChart3,
  Calculator,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  ShoppingCart,
} from 'lucide-react'

import './Dashborad.css'

export default function Dashboard() {
  function handleLogout() {
    sessionStorage.removeItem('isAuthenticated')
    window.location.href = '/login'
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
          <a href="/dashboard" className="sidebar-link active">
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
          </a>

          <a href="#" className="sidebar-link">
            <ShoppingCart size={19} />
            <span>Caixa</span>
          </a>

          <a href="#" className="sidebar-link">
            <Calculator size={19} />
            <span>Fechamento</span>
          </a>

          <a href="#" className="sidebar-link">
            <Package size={19} />
            <span>Produtos</span>
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

          <button
            type="button"
            onClick={handleLogout}
            className="sidebar-link logout-button"
          >
            <LogOut size={19} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <main className="dashboard-main ml-64 min-h-screen flex-1">
        <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
          <div>
            <span className="header-overline">VISÃO GERAL</span>

            <h1>Dashboard</h1>

            <p>Acompanhe os principais dados da sua padaria.</p>
          </div>

          <div className="header-user flex items-center gap-3">
            <div className="user-avatar">A</div>

            <div>
              <strong>Administrador</strong>
              <span>Usuário do sistema</span>
            </div>
          </div>
        </header>

        <section className="dashboard-content p-10">
          <div className="page-placeholder rounded-2xl bg-white p-8">
            <h2>Bem-vindo ao sistema!</h2>

            <p>
              Aqui serão exibidos os indicadores de vendas, pagamentos e
              movimentações do caixa.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}