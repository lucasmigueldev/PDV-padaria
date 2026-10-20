import {
  BarChart3,
  Banknote,
  Calculator,
  CalendarDays,
  CreditCard,
  DollarSign,
  Clock3,
  History,
  LayoutDashboard,
  LogOut,
  Package,
  QrCode,
  Settings,
  ShoppingCart,
  UserRound,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

import { getSalesFromSupabase } from '../../data/sales'
import { getOpenCashRegister } from '../../services/operations'
import { UserProfileMenu } from '../../components/UserProfileMenu/UserProfileMenu'
import { useBakeries } from '../../hooks/useBakeries'
import { useEstablishmentName } from '../../services/establishment'
import { useAuth } from '../../contexts/AuthContext'
import { usePdvHeartbeats, PDV_OFFLINE_THRESHOLD_MS } from '../../hooks/usePdvHeartbeats'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { WifiOff } from 'lucide-react'
import { OfflineNotification } from '../../components/OfflineNotification/OfflineNotification'
import type { PaymentMethod, Sale } from '../../types/Sale'
import { logoutAndRedirect } from '../../utils/auth'
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

const clockTime = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' })

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

function getVariation(currentValue: number, previousValue: number): string | null {
  if (previousValue === 0) return null

  const variation = (currentValue - previousValue) / previousValue
  const sign = variation > 0 ? '+' : ''
  return `${sign}${percentage.format(variation)} em relação a ontem`
}

function getPaymentTotal(sales: Sale[], paymentMethod: PaymentMethod): number {
  return sumSales(sales.filter((sale) => sale.paymentMethod === paymentMethod))
}

function getLocalDateString(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Converte "YYYY-MM-DD" para meia-noite no fuso local. `new Date("YYYY-MM-DD")`
 * interpreta a string como UTC, o que no Brasil resulta nas 21h do dia
 * ANTERIOR — e fazia os cards de "Hoje"/"Ontem" filtrarem o dia errado.
 */
function parseLocalDate(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { authenticatedUser } = useAuth()
  const isOwner = authenticatedUser?.role === 'owner'
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [bakeryFilter, setBakeryFilter] = useState('all')
  const [selectedDate, setSelectedDate] = useState(getLocalDateString())
  const [sales, setSales] = useState<Sale[]>([])
  const [cashRegister, setCashRegister] = useState<Awaited<ReturnType<typeof getOpenCashRegister>>>(null)
  const [loadError, setLoadError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const datePickerRef = useRef<HTMLInputElement>(null)
  const establishmentName = useEstablishmentName()
  const { bakeries } = useBakeries()
  const activeBakeries = bakeries.filter((bakery) => bakery.active)
  const { heartbeats } = usePdvHeartbeats(isOwner)
  const offlineUnits = activeBakeries.filter((bakery) => {
    const heartbeat = heartbeats.find((item) => item.bakeryId === bakery.id)
    if (!heartbeat) return false
    // Date.now() is needed here to check PDV offline status. The value only needs to be refreshed when heartbeats change (every 30s via polling).
    // eslint-disable-next-line react-hooks/purity
    return Date.now() - new Date(heartbeat.lastSeenAt).getTime() > PDV_OFFLINE_THRESHOLD_MS
  })
  const pendingUnits = activeBakeries.filter((bakery) => {
    const heartbeat = heartbeats.find((item) => item.bakeryId === bakery.id)
    return (heartbeat?.pendingSales ?? 0) > 0
  })
  const selectedBakeryId = bakeryFilter === 'all' ? null : bakeryFilter
  const selectedDateObj = parseLocalDate(selectedDate)
  const previousDateObj = new Date(selectedDateObj)
  previousDateObj.setDate(previousDateObj.getDate() - 1)
  const filteredSales = sales.filter((sale) => !selectedBakeryId || sale.bakeryId === selectedBakeryId)
  const salesToday = filteredSales.filter((sale) => isSameDay(sale.date, selectedDateObj))
  const salesYesterday = filteredSales.filter((sale) => isSameDay(sale.date, previousDateObj))
  const totalSalesToday = sumSales(salesToday)
  const totalSalesYesterday = sumSales(salesYesterday)
  const salesCountToday = salesToday.length
  const salesCountYesterday = salesYesterday.length
  const salesValueVariation = getVariation(totalSalesToday, totalSalesYesterday)
  const salesCountVariation = getVariation(salesCountToday, salesCountYesterday)
  const cashSalesToday = getPaymentTotal(salesToday, 'cash')
  const cardSalesToday = getPaymentTotal(salesToday, 'card')
  const pixSalesToday = getPaymentTotal(salesToday, 'pix')
  const totalReceived = totalSalesToday
  const cashPercentage = totalReceived > 0 ? cashSalesToday / totalReceived : 0
  const cardPercentage = totalReceived > 0 ? cardSalesToday / totalReceived : 0
  const pixAmountPercentage = totalReceived > 0 ? pixSalesToday / totalReceived : 0

  const isSelectedDateToday = selectedDate === getLocalDateString()
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const isSelectedDateYesterday = selectedDate === getLocalDateString(yesterdayDate)
  const selectedDateLabel = isSelectedDateToday
    ? 'Hoje'
    : isSelectedDateYesterday
      ? 'Ontem'
      : parseLocalDate(selectedDate).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
  const isCashRegisterOpen = cashRegister !== null
  const openingTime = cashRegister
    ? new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(cashRegister.openedAt))
    : '-'

  const fetchDashboardData = useCallback(async () => {
    const [loadedSales, register] = await Promise.all([
      getSalesFromSupabase(),
      selectedBakeryId ? getOpenCashRegister(selectedBakeryId) : Promise.resolve(null),
    ])
    return { loadedSales, register }
  }, [selectedBakeryId])

  useEffect(() => {
    let active = true
    void (async () => {
      await Promise.resolve()
      if (!active) return
      setIsLoading(true)
      setLoadError('')
      try {
        const { loadedSales, register } = await fetchDashboardData()
        if (!active) return
        setSales(loadedSales)
        setCashRegister(register)
        setLastUpdatedAt(clockTime.format(new Date()))
      } catch (error: unknown) {
        if (!active) return
        console.error('Erro ao carregar os dados do dashboard.', error)
        const fallback = error instanceof TypeError
          ? 'Não foi possível conectar ao sistema. Verifique sua conexão e tente novamente.'
          : 'Não foi possível carregar os indicadores. Atualize a tela e tente novamente.'
        const message = error instanceof Error ? error.message : ''
        setLoadError(/supabase|rpc|postgres|pgrst|jwt|\.env/i.test(message) ? fallback : message || fallback)
      } finally {
        if (active) setIsLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [fetchDashboardData])

  // Background refresh: keeps totals in sync with sales made on other
  // devices while the dashboard stays open. Failures never touch the
  // loading/error states already on screen; the next tick retries.
  const refreshDashboardData = useCallback(async () => {
    try {
      const { loadedSales, register } = await fetchDashboardData()
      setSales(loadedSales)
      setCashRegister(register)
      setLoadError('')
      setLastUpdatedAt(clockTime.format(new Date()))
    } catch (error: unknown) {
      console.error('Falha ao atualizar os indicadores do dashboard.', error)
    }
  }, [fetchDashboardData])

  useAutoRefresh(() => {
    void refreshDashboardData()
  })

  function handleLogout() {
    void logoutAndRedirect(navigate)
  }

  function handleDateButtonClick() {
    const input = datePickerRef.current
    if (!input) return

    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker()
        return
      } catch {
        // Navegadores podem lançar se o elemento não estiver pronto; usa o fallback abaixo.
      }
    }

    input.focus()
    input.click()
  }

  function handleMetricClick(metric: 'sales' | 'sales-count' | 'cash' | 'card' | 'pix') {
    switch (metric) {
      case 'sales':
      case 'sales-count':
        navigate('/relatorios')
        break
      case 'cash':
      case 'card':
      case 'pix':
        navigate('/fechamento')
        break
    }
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
            <strong>PDV360</strong>
            <span>Sistema de vendas</span>
          </div>
        </div>

        <nav className="sidebar-menu flex flex-col gap-2">
          {isOwner && <Link to="/dashboard" className="sidebar-link active">
            <LayoutDashboard size={19} />
            <span>Painel</span>
          </Link>}

          {!isOwner && <Link to="/pdv" className="sidebar-link">
            <ShoppingCart size={19} />
            <span>Caixa</span>
          </Link>}

          {!isOwner && <Link to="/fechamento" className="sidebar-link">
            <Calculator size={19} />
            <span>Fechamento</span>
          </Link>}

          {!isOwner && <Link to="/produtos" className="sidebar-link">
            <Package size={19} />
            <span>Produtos</span>
          </Link>}

          {isOwner && <Link to="/historico-fechamentos" className="sidebar-link">
            <History size={19} />
            <span>Histórico de Fechamentos</span>
          </Link>}

          {isOwner && <Link to="/relatorios" className="sidebar-link">
            <BarChart3 size={19} />
            <span>Relatórios</span>
          </Link>}
        </nav>

        <div className="sidebar-bottom mt-auto flex flex-col gap-2">
          {isOwner && <Link to="/configuracoes" className="sidebar-link">
            <Settings size={19} />
            <span>Configurações</span>
          </Link>}

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
              <strong>PDV360</strong>
              <span>Sistema de vendas</span>
            </div>
          </div>

          <button type="button" className="mobile-close-button" onClick={closeMobileMenu} aria-label="Fechar menu">
            <X size={22} />
          </button>
        </div>

        <nav className="mobile-drawer-menu">
          {isOwner && <Link to="/dashboard" className="sidebar-link active" onClick={closeMobileMenu}>
            <LayoutDashboard size={19} />
            <span>Painel</span>
          </Link>}

          {!isOwner && <Link to="/pdv" className="sidebar-link" onClick={closeMobileMenu}>
            <ShoppingCart size={19} />
            <span>Caixa</span>
          </Link>}

          {!isOwner && <Link to="/fechamento" className="sidebar-link" onClick={closeMobileMenu}>
            <Calculator size={19} />
            <span>Fechamento</span>
          </Link>}

          {!isOwner && <Link to="/produtos" className="sidebar-link" onClick={closeMobileMenu}>
            <Package size={19} />
            <span>Produtos</span>
          </Link>}

          {isOwner && <Link to="/historico-fechamentos" className="sidebar-link" onClick={closeMobileMenu}>
            <History size={19} />
            <span>Histórico de Fechamentos</span>
          </Link>}

          {isOwner && <Link to="/relatorios" className="sidebar-link" onClick={closeMobileMenu}>
            <BarChart3 size={19} />
            <span>Relatórios</span>
          </Link>}
        </nav>

        <div className="mobile-drawer-bottom">
          {isOwner && <Link to="/configuracoes" className="sidebar-link" onClick={closeMobileMenu}>
            <Settings size={19} />
            <span>Configurações</span>
          </Link>}

          <button type="button" onClick={handleLogout} className="sidebar-link logout-button">
            <LogOut size={19} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <OfflineNotification />

      <main className="dashboard-main ml-64 min-h-screen flex-1">
        <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
          <div className="mobile-topbar">
            <div className="mobile-header-brand" aria-label={establishmentName}>
              <div className="logo-icon">
                <ShoppingCart size={17} />
              </div>
              <span>{establishmentName}</span>
            </div>

            <UserProfileMenu user={authenticatedUser} />
          </div>

          <div className="dashboard-header-row">
            <div className="mobile-page-heading">
              <span className="header-overline">VISÃO GERAL</span>
              <h1>Painel</h1>
              <p>Acompanhe os principais dados da sua padaria.</p>
            </div>

            <div className="desktop-user-profile">
              <UserProfileMenu user={authenticatedUser} />
            </div>
          </div>
        </header>

        <section className="dashboard-content p-10">
          {loadError && <p role="alert" className="mb-4 text-red-700">{loadError}</p>}
          {isLoading && <p role="status" className="mb-4">Carregando dados operacionais...</p>}
          {isOwner && offlineUnits.length > 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
              <WifiOff size={20} aria-hidden="true" />
              <div>
                <strong>PDV sem conexão</strong>
                <p className="text-sm">
                  {offlineUnits.map((bakery) => bakery.name).join(', ')} não respondeu na última verificação.
                  Os valores exibidos abaixo podem estar desatualizados.
                </p>
              </div>
            </div>
          )}
          {isOwner && pendingUnits.length > 0 && offlineUnits.length === 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800" role="status">
              <Clock3 size={20} aria-hidden="true" />
              <div>
                <strong>Vendas aguardando sincronização</strong>
                <p className="text-sm">
                  {pendingUnits.map((bakery) => {
                    const heartbeat = heartbeats.find((item) => item.bakeryId === bakery.id)
                    return `${bakery.name} (${heartbeat?.pendingSales})`
                  }).join(', ')}. As vendas serão registradas automaticamente quando a conexão for restabelecida.
                </p>
              </div>
            </div>
          )}
          <div className="dashboard-filters">
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

            <div className="dashboard-date-filter">
              <label>Data</label>
              <div className="dashboard-date-picker">
                <button
                  type="button"
                  className="dashboard-date-button"
                  onClick={handleDateButtonClick}
                  aria-label={`Data: ${selectedDateLabel}. Escolher nova data`}
                >
                  <CalendarDays size={15} aria-hidden="true" />
                  {selectedDateLabel}
                </button>
                <input
                  ref={datePickerRef}
                  id="dashboard-date-filter"
                  type="date"
                  className="dashboard-date-input"
                  value={selectedDate}
                  tabIndex={-1}
                  aria-hidden="true"
                  max={getLocalDateString()}
                  onChange={(event) => {
                    const nextDate = event.target.value
                    if (nextDate && nextDate <= getLocalDateString()) {
                      setSelectedDate(nextDate)
                    }
                  }}
                />
              </div>
              <span className="text-xs text-slate-400" title="Última atualização dos indicadores">
                Atualizado às {lastUpdatedAt ?? '-'}
              </span>
            </div>
          </div>

          <div className="dashboard-metrics-grid mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-blue-200 cursor-pointer" onClick={() => handleMetricClick('sales')}>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Vendas em {selectedDateLabel}
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <DollarSign size={18} />
                </div>
              </div>
              <strong className="block text-xl font-bold tracking-tight text-slate-900">{currency.format(totalSalesToday)}</strong>
              {salesValueVariation && (
                <span className="mt-1.5 block text-[11px] font-medium text-emerald-600">
                  {salesValueVariation}
                </span>
              )}
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-violet-200 cursor-pointer" onClick={() => handleMetricClick('sales-count')}>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Qtd. vendas</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <ShoppingCart size={18} />
                </div>
              </div>
              <strong className="block text-xl font-bold tracking-tight text-slate-900">{salesCountToday}</strong>
              {salesCountVariation && (
                <span className="mt-1.5 block text-[11px] font-medium text-emerald-600">
                  {salesCountVariation}
                </span>
              )}
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-emerald-200 cursor-pointer" onClick={() => handleMetricClick('cash')}>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Dinheiro</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Banknote size={18} />
                </div>
              </div>
              <strong className="block text-xl font-bold tracking-tight text-slate-900">{currency.format(cashSalesToday)}</strong>
              <span className="mt-1.5 block text-[11px] text-slate-400">{percentage.format(cashPercentage)} do total</span>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-amber-200 cursor-pointer" onClick={() => handleMetricClick('card')}>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Cartão</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <CreditCard size={18} />
                </div>
              </div>
              <strong className="block text-xl font-bold tracking-tight text-slate-900">{currency.format(cardSalesToday)}</strong>
              <span className="mt-1.5 block text-[11px] text-slate-400">{percentage.format(cardPercentage)} do total</span>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-violet-200">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">PIX</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                  <QrCode size={18} />
                </div>
              </div>
              <strong className="block text-xl font-bold tracking-tight text-slate-900">{currency.format(pixSalesToday)}</strong>
              <span className="mt-1.5 block text-[11px] text-slate-400">{percentage.format(pixAmountPercentage)} do total</span>
            </article>
          </div>

          <div className="dashboard-panels-grid grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 pt-8 shadow-sm">
              <div className="mb-5 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Formas de pagamento</h2>
                  <p className="mt-1 text-xs text-slate-500">Distribuição das vendas de hoje</p>
                </div>
                <Wallet className="text-slate-400" size={20} />
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs sm:text-sm">
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
                  <div className="mb-2 flex items-center justify-between text-xs sm:text-sm">
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
                  <div className="mb-2 flex items-center justify-between text-xs sm:text-sm">
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
              <div className="mb-5 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Informações do caixa</h2>
                  <p className="mt-1 text-xs text-slate-500">Resumo do caixa em operação</p>
                </div>
                <Calculator className="text-slate-400" size={20} />
              </div>

              <div className="divide-y divide-slate-100">
                <div className="flex items-center justify-between py-2.5 first:pt-0">
                  <span className="flex items-center gap-3 text-xs sm:text-sm text-slate-500">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${isCashRegisterOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                      <span className={`h-2 w-2 rounded-full ${isCashRegisterOpen ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    </span>
                    Status do caixa
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isCashRegisterOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {isCashRegisterOpen ? 'Caixa aberto' : 'Caixa fechado'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-2.5">
                  <span className="flex items-center gap-3 text-xs sm:text-sm text-slate-500">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <UserRound size={15} />
                    </span>
                    Operador responsável
                  </span>
                  <strong className="text-xs sm:text-sm text-slate-900">{authenticatedUser?.name ?? 'Conta indisponível'}</strong>
                </div>

                <div className="flex items-center justify-between py-2.5">
                  <span className="flex items-center gap-3 text-xs sm:text-sm text-slate-500">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                      <Clock3 size={15} />
                    </span>
                    Horário de abertura
                  </span>
                  <strong className="text-xs sm:text-sm text-slate-900">{openingTime}</strong>
                </div>

                <div className="flex items-center justify-between py-2.5 pb-0">
                  <span className="flex items-center gap-3 text-xs sm:text-sm text-slate-500">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                      <Banknote size={15} />
                    </span>
                    Saldo inicial
                  </span>
                  <strong className="text-xs sm:text-sm text-slate-900">{cashRegister ? currency.format(cashRegister.initialAmount) : '-'}</strong>
                </div>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}