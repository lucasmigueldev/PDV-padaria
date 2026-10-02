import {
  BarChart3,
  Banknote,
  Calculator,
  CreditCard,
  DollarSign,
  Clock3,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  QrCode,
  Settings,
  ShoppingCart,
  UserRound,
  Wallet,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getBakeries } from '../../data/bakeries'
import { getOpenCashRegister } from '../../data/cashRegister'
import { getSales } from '../../data/sales'
import type { PaymentMethod, Sale } from '../../types/Sale'
import { isOwnerAuthenticated, logoutAndRedirect } from '../../utils/auth'
import './Dashborad.css'

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const percentage = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function isSameDay(dateValue: string, referenceDate: Date): boolean {
  const date = new Date(dateValue)

  return !Number.isNaN(date.getTime())
    && date.getFullYear() === referenceDate.getFullYear()
    && date.getMonth() === referenceDate.getMonth()
    && date.getDate() === referenceDate.getDate()
}

function sumSales(sales: Sale[]): number {
  return sales.reduce((total, sale) => total + sale.total, 0)
}

function getVariation(currentValue: number, previousValue: number): string {
  if (previousValue === 0) return 'Sem dados de ontem'

  const variation = (currentValue - previousValue) / previousValue
  const sign = variation > 0 ? '+' : ''
  return `${sign}${percentage.format(variation)} em relação a ontem`
}

function getPaymentTotal(sales: Sale[], paymentMethod: PaymentMethod): number {
  return sumSales(sales.filter((sale) => sale.paymentMethod === paymentMethod))
}

export default function Dashboard() {
  const navigate = useNavigate()
  const isOwner = isOwnerAuthenticated()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [bakeryFilter, setBakeryFilter] = useState('all')
  const activeBakeries = getBakeries().filter((bakery) => bakery.active)
  const currentDate = new Date()
  const yesterday = new Date(currentDate)
  yesterday.setDate(yesterday.getDate() - 1)
  const sales = getSales().filter((sale) => bakeryFilter === 'all' || sale.bakeryId === bakeryFilter)
  const salesToday = sales.filter((sale) => isSameDay(sale.date, currentDate))
  const salesYesterday = sales.filter((sale) => isSameDay(sale.date, yesterday))
  const totalSalesToday = sumSales(salesToday)
  const totalSalesYesterday = sumSales(salesYesterday)
  const salesCountToday = salesToday.length
  const salesCountYesterday = salesYesterday.length
  const cashSalesToday = getPaymentTotal(salesToday, 'cash')
  const cardSalesToday = getPaymentTotal(salesToday, 'card')
  const pixSalesToday = getPaymentTotal(salesToday, 'pix')
  const cashRegister = getOpenCashRegister(bakeryFilter === 'all' ? undefined : bakeryFilter)
  const totalReceived = totalSalesToday
  const cashPercentage = totalReceived > 0 ? cashSalesToday / totalReceived : 0
  const cardPercentage = totalReceived > 0 ? cardSalesToday / totalReceived : 0
  const pixAmountPercentage = totalReceived > 0 ? pixSalesToday / totalReceived : 0
  const isCashRegisterOpen = cashRegister !== null
  const openingTime = cashRegister
    ? new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(cashRegister.openedAt))
    : '-'

  function handleLogout() {
    void logoutAndRedirect(navigate)
  }

  function closeMobileMenu() {
    setIsMobileMenuOpen(false)
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
          {isOwner && <a href="/dashboard" className="sidebar-link active">
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
          </a>}

          {!isOwner && <a href="/pdv" className="sidebar-link">
            <ShoppingCart size={19} />
            <span>Caixa</span>
          </a>}

          {!isOwner && <a href="/fechamento" className="sidebar-link">
            <Calculator size={19} />
            <span>Fechamento</span>
          </a>}

          {!isOwner && <a href="/produtos" className="sidebar-link">
            <Package size={19} />
            <span>Produtos</span>
          </a>}

          {isOwner && <a href="/historico-vendas" className="sidebar-link">
            <History size={19} />
            <span>Histórico de Vendas</span>
          </a>}

          {isOwner && <a href="/historico-fechamentos" className="sidebar-link">
            <History size={19} />
            <span>Histórico de Fechamentos</span>
          </a>}

          {isOwner && <a href="/relatorios" className="sidebar-link">
            <BarChart3 size={19} />
            <span>Relatórios</span>
          </a>}
        </nav>

        <div className="sidebar-bottom mt-auto flex flex-col gap-2">
          {isOwner && <a href="/configuracoes" className="sidebar-link">
            <Settings size={19} />
            <span>Configurações</span>
          </a>}

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

      <div className={`mobile-menu-overlay${isMobileMenuOpen ? ' is-open' : ''}`} onClick={closeMobileMenu} />

      <aside className={`mobile-drawer${isMobileMenuOpen ? ' is-open' : ''}`} aria-hidden={!isMobileMenuOpen}>
        <div className="mobile-drawer-header">
          <div className="sidebar-logo">
            <div className="logo-icon">
              <ShoppingCart size={22} />
            </div>

            <div>
              <strong>Padaria PDV</strong>
              <span>Sistema de vendas</span>
            </div>
          </div>

          <button type="button" className="mobile-close-button" onClick={closeMobileMenu} aria-label="Fechar menu">
            <X size={22} />
          </button>
        </div>

        <nav className="mobile-drawer-menu">
          {isOwner && <a href="/dashboard" className="sidebar-link active" onClick={closeMobileMenu}>
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
          </a>}

          {!isOwner && <a href="/pdv" className="sidebar-link" onClick={closeMobileMenu}>
            <ShoppingCart size={19} />
            <span>Caixa</span>
          </a>}

          {!isOwner && <a href="/fechamento" className="sidebar-link" onClick={closeMobileMenu}>
            <Calculator size={19} />
            <span>Fechamento</span>
          </a>}

          {!isOwner && <a href="/produtos" className="sidebar-link" onClick={closeMobileMenu}>
            <Package size={19} />
            <span>Produtos</span>
          </a>}

          {isOwner && <a href="/historico-vendas" className="sidebar-link" onClick={closeMobileMenu}>
            <History size={19} />
            <span>Histórico de Vendas</span>
          </a>}

          {isOwner && <a href="/historico-fechamentos" className="sidebar-link" onClick={closeMobileMenu}>
            <History size={19} />
            <span>Histórico de Fechamentos</span>
          </a>}

          {isOwner && <a href="/relatorios" className="sidebar-link" onClick={closeMobileMenu}>
            <BarChart3 size={19} />
            <span>Relatórios</span>
          </a>}
        </nav>

        <div className="mobile-drawer-bottom">
          {isOwner && <a href="/configuracoes" className="sidebar-link" onClick={closeMobileMenu}>
            <Settings size={19} />
            <span>Configurações</span>
          </a>}

          <button type="button" onClick={handleLogout} className="sidebar-link logout-button">
            <LogOut size={19} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <main className="dashboard-main ml-64 min-h-screen flex-1">
        <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
          <div className="mobile-topbar">
            <div className="mobile-header-brand" aria-label="Padaria PDV">
              <div className="logo-icon">
                <ShoppingCart size={17} />
              </div>
              <span>Padaria PDV</span>
            </div>

            <button
              type="button"
              className="mobile-menu-button"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={isMobileMenuOpen}
            >
              <Menu size={23} />
            </button>
          </div>

          <div className="mobile-page-heading">
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
          <div className="dashboard-unit-filter">
            <label htmlFor="dashboard-bakery-filter">Unidade</label>
            <select
              id="dashboard-bakery-filter"
              value={bakeryFilter}
              onChange={(event) => setBakeryFilter(event.target.value)}
            >
              <option value="all">Todas as unidades</option>
              {activeBakeries.map((bakery) => (
                <option key={bakery.id} value={bakery.id}>{bakery.name}</option>
              ))}
            </select>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">Vendas do dia</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <DollarSign size={20} />
                </div>
              </div>
              <strong className="block text-2xl font-bold text-slate-900">{currency.format(totalSalesToday)}</strong>
              <span className="mt-2 block text-xs font-medium text-emerald-600">{getVariation(totalSalesToday, totalSalesYesterday)}</span>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">Quantidade de vendas</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <ShoppingCart size={20} />
                </div>
              </div>
              <strong className="block text-2xl font-bold text-slate-900">{salesCountToday}</strong>
              <span className="mt-2 block text-xs font-medium text-emerald-600">{getVariation(salesCountToday, salesCountYesterday)}</span>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">Recebido em dinheiro</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Banknote size={20} />
                </div>
              </div>
              <strong className="block text-2xl font-bold text-slate-900">{currency.format(cashSalesToday)}</strong>
              <span className="mt-2 block text-xs text-slate-400">{percentage.format(cashPercentage)} do total recebido</span>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">Recebido no cartão</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <CreditCard size={20} />
                </div>
              </div>
              <strong className="block text-2xl font-bold text-slate-900">{currency.format(cardSalesToday)}</strong>
              <span className="mt-2 block text-xs text-slate-400">{percentage.format(cardPercentage)} do total recebido</span>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-500">Recebido em PIX</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <QrCode size={20} />
                </div>
              </div>
              <strong className="block text-2xl font-bold text-slate-900">{currency.format(pixSalesToday)}</strong>
              <span className="mt-2 block text-xs text-slate-400">{percentage.format(pixAmountPercentage)} do total recebido</span>
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
                    <span className="font-semibold text-slate-900">{currency.format(cashSalesToday)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${cashPercentage * 100}%` }} />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                      Cartão
                    </span>
                    <span className="font-semibold text-slate-900">{currency.format(cardSalesToday)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-blue-500" style={{ width: `${cardPercentage * 100}%` }} />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                      Pix
                    </span>
                    <span className="font-semibold text-slate-900">{currency.format(pixSalesToday)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-violet-500" style={{ width: `${pixAmountPercentage * 100}%` }} />
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
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${isCashRegisterOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                      <span className={`h-2 w-2 rounded-full ${isCashRegisterOpen ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    </span>
                    Status do caixa
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isCashRegisterOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {isCashRegisterOpen ? 'Caixa aberto' : 'Caixa fechado'}
                  </span>
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
                  <strong className="text-sm text-slate-900">{openingTime}</strong>
                </div>

                <div className="flex items-center justify-between py-3 pb-0">
                  <span className="flex items-center gap-3 text-sm text-slate-500">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                      <Banknote size={16} />
                    </span>
                    Saldo inicial
                  </span>
                  <strong className="text-sm text-slate-900">{cashRegister ? currency.format(cashRegister.initialAmount) : '-'}</strong>
                </div>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}