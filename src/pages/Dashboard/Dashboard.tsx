import {
  BarChart3,
  Banknote,
  Calculator,
  CreditCard,
  DollarSign,
  Clock3,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  ShoppingCart,
  UserRound,
  Wallet,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import './Dashborad.css'

export default function Dashboard() {
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
          <a href="/dashboard" className="sidebar-link active">
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
          </a>

          <a href="/pdv" className="sidebar-link">
            <ShoppingCart size={19} />
            <span>Caixa</span>
          </a>

          <a href="#" className="sidebar-link">
            <Calculator size={19} />
            <span>Fechamento</span>
          </a>

          <a href="/produtos" className="sidebar-link">
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
          <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">Vendas do dia</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <DollarSign size={20} />
                </div>
              </div>
              <strong className="block text-2xl font-bold text-slate-900">R$ 4.286,50</strong>
              <span className="mt-2 block text-xs font-medium text-emerald-600">+12,8% em relação a ontem</span>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">Quantidade de vendas</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <ShoppingCart size={20} />
                </div>
              </div>
              <strong className="block text-2xl font-bold text-slate-900">128</strong>
              <span className="mt-2 block text-xs font-medium text-emerald-600">+8,4% em relação a ontem</span>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">Recebido em dinheiro</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Banknote size={20} />
                </div>
              </div>
              <strong className="block text-2xl font-bold text-slate-900">R$ 1.740,00</strong>
              <span className="mt-2 block text-xs text-slate-400">40,6% do total recebido</span>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">Recebido no cartão</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <CreditCard size={20} />
                </div>
              </div>
              <strong className="block text-2xl font-bold text-slate-900">R$ 2.146,50</strong>
              <span className="mt-2 block text-xs text-slate-400">50,1% do total recebido</span>
            </article>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Formas de pagamento</h2>
                  <p className="mt-1 text-sm text-slate-500">Distribuição das vendas de hoje</p>
                </div>
                <Wallet className="text-slate-400" size={21} />
              </div>

              <div className="space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      Dinheiro
                    </span>
                    <span className="font-semibold text-slate-900">R$ 1.740,00</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 w-[41%] rounded-full bg-emerald-500" />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                      Cartão
                    </span>
                    <span className="font-semibold text-slate-900">R$ 2.146,50</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 w-1/2 rounded-full bg-blue-500" />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                      Pix
                    </span>
                    <span className="font-semibold text-slate-900">R$ 400,00</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 w-[9%] rounded-full bg-violet-500" />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Informações do caixa</h2>
                  <p className="mt-1 text-sm text-slate-500">Resumo do caixa em operação</p>
                </div>
                <Calculator className="text-slate-400" size={21} />
              </div>

              <div className="divide-y divide-slate-100">
                <div className="flex items-center justify-between py-3 first:pt-0">
                  <span className="flex items-center gap-3 text-sm text-slate-500">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    Status do caixa
                  </span>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Aberto</span>
                </div>

                <div className="flex items-center justify-between py-3">
                  <span className="flex items-center gap-3 text-sm text-slate-500">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <UserRound size={16} />
                    </span>
                    Operador responsável
                  </span>
                  <strong className="text-sm text-slate-900">Administrador</strong>
                </div>

                <div className="flex items-center justify-between py-3">
                  <span className="flex items-center gap-3 text-sm text-slate-500">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                      <Clock3 size={16} />
                    </span>
                    Horário de abertura
                  </span>
                  <strong className="text-sm text-slate-900">08:00</strong>
                </div>

                <div className="flex items-center justify-between py-3 pb-0">
                  <span className="flex items-center gap-3 text-sm text-slate-500">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                      <Banknote size={16} />
                    </span>
                    Saldo inicial
                  </span>
                  <strong className="text-sm text-slate-900">R$ 300,00</strong>
                </div>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}