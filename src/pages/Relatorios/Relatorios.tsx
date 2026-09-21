import {
  BarChart3,
  Banknote,
  Calculator,
  CalendarDays,
  CreditCard,
  DollarSign,
  History,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  ShoppingCart,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getProducts } from '../../data/products'
import { getSales } from '../../data/sales'
import type { Product } from '../../types/Product'
import type { PaymentMethod, Sale } from '../../types/Sale'
import { isOwnerAuthenticated } from '../../utils/auth'
import '../Dashboard/Dashborad.css'
import './Relatorios.css'

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const paymentMethodLabels: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'PIX',
  card: 'Cartão',
}

function validateDateInput(value: string, today: Date): string | null {
  if (!value) return null

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return 'Informe uma data válida com ano de 4 dígitos.'

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const currentYear = today.getFullYear()

  if (year !== currentYear) {
    return `O ano deve ser o ano atual (${currentYear}).`
  }

  const date = new Date(year, month - 1, day)
  const isValidCalendarDate = date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day

  if (!isValidCalendarDate) return 'Informe uma data de calendário válida.'

  const todayStart = new Date(currentYear, today.getMonth(), today.getDate())
  if (date > todayStart) return 'A data não pode ser futura.'

  return null
}

function getPaymentSummary(sales: Sale[], paymentMethod: PaymentMethod) {
  const paymentSales = sales.filter((sale) => sale.paymentMethod === paymentMethod)

  return {
    count: paymentSales.length,
    total: paymentSales.reduce((sum, sale) => sum + sale.total, 0),
  }
}

type SoldProductSummary = {
  productId: string
  name: string
  barcode: string
  quantity: number
  revenue: number
}

function getSoldProducts(sales: Sale[]): SoldProductSummary[] {
  const productsById = new Map<string, SoldProductSummary>()

  sales.forEach((sale) => {
    sale.items.forEach((item) => {
      const currentProduct = productsById.get(item.productId)

      if (currentProduct) {
        currentProduct.quantity += item.quantity
        currentProduct.revenue += item.subtotal
        return
      }

      productsById.set(item.productId, {
        productId: item.productId,
        name: item.name,
        barcode: item.barcode,
        quantity: item.quantity,
        revenue: item.subtotal,
      })
    })
  })

  return [...productsById.values()].sort((firstProduct, secondProduct) =>
    secondProduct.quantity - firstProduct.quantity
    || secondProduct.revenue - firstProduct.revenue,
  )
}

type StockProduct = {
  product: Product
  originalIndex: number
}

export default function Relatorios() {
  const navigate = useNavigate()
  const isOwner = isOwnerAuthenticated()
  const sales = getSales()
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [appliedStartDate, setAppliedStartDate] = useState('')
  const [appliedEndDate, setAppliedEndDate] = useState('')
  const today = new Date()
  const currentYear = today.getFullYear()
  const todayInputValue = [
    currentYear,
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
  const minimumDate = `${currentYear}-01-01`
  const startDateError = validateDateInput(startDate, today)
  const endDateError = validateDateInput(endDate, today)
  const startTimestamp = startDate
    ? new Date(`${startDate}T00:00:00`).getTime()
    : null
  const endTimestamp = endDate
    ? new Date(`${endDate}T23:59:59.999`).getTime()
    : null
  const hasInvalidDateRange = !startDateError && !endDateError
    && startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp
  const dateError = startDateError || endDateError || (hasInvalidDateRange
    ? 'A data inicial não pode ser posterior à data final.'
    : null)
  const appliedStartTimestamp = appliedStartDate
    ? new Date(`${appliedStartDate}T00:00:00`).getTime()
    : null
  const appliedEndTimestamp = appliedEndDate
    ? new Date(`${appliedEndDate}T23:59:59.999`).getTime()
    : null
  const filteredSales = sales.filter((sale) => {
    const saleTimestamp = new Date(sale.date).getTime()
    const matchesStartDate = !appliedStartDate || saleTimestamp >= (appliedStartTimestamp ?? 0)
    const matchesEndDate = !appliedEndDate || saleTimestamp <= (appliedEndTimestamp ?? 0)

    return matchesStartDate && matchesEndDate
  })
  const totalSales = filteredSales.length
  const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0)
  const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0
  const paymentSummary = {
    cash: getPaymentSummary(filteredSales, 'cash'),
    pix: getPaymentSummary(filteredSales, 'pix'),
    card: getPaymentSummary(filteredSales, 'card'),
  }
  const soldProducts = getSoldProducts(filteredSales)
  const products = getProducts()
  const stockSummary = products.reduce((summary, product) => {
    summary.totalProducts += 1
    summary.totalUnits += product.stock
    summary.estimatedValue += product.price * product.stock

    if (product.stock > 0) {
      summary.availableProducts += 1
    } else {
      summary.outOfStockProducts += 1
    }

    return summary
  }, {
    totalProducts: 0,
    availableProducts: 0,
    outOfStockProducts: 0,
    totalUnits: 0,
    estimatedValue: 0,
  })
  const stockProducts = products
    .map<StockProduct>((product, originalIndex) => ({ product, originalIndex }))
    .sort((firstProduct, secondProduct) =>
      firstProduct.product.stock - secondProduct.product.stock
      || firstProduct.originalIndex - secondProduct.originalIndex,
    )

  function applyPeriod() {
    if (dateError) return

    setAppliedStartDate(startDate)
    setAppliedEndDate(endDate)
  }

  function clearPeriod() {
    setStartDate('')
    setEndDate('')
    setAppliedStartDate('')
    setAppliedEndDate('')
  }

  function handleLogout() {
    sessionStorage.removeItem('isAuthenticated')
    sessionStorage.removeItem('authenticatedUser')
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
          {isOwner && <a href="/dashboard" className="sidebar-link">
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
          {isOwner && <a href="/relatorios" className="sidebar-link active">
            <BarChart3 size={19} />
            <span>Relatórios</span>
          </a>}
        </nav>

        <div className="sidebar-bottom mt-auto flex flex-col gap-2">
          {isOwner && <a href="/configuracoes" className="sidebar-link">
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
          <section className="reports-section reports-filters" aria-labelledby="sales-report-title">
            <div className="reports-section-heading">
              <div>
                <span className="reports-section-overline">RELATÓRIO OPERACIONAL</span>
                <h2 id="sales-report-title">Relatório de Vendas</h2>
                <p>Consolide as vendas registradas em um período.</p>
              </div>
              <CalendarDays className="reports-section-icon" size={22} aria-hidden="true" />
            </div>

            <div className="reports-date-fields">
              <div className="reports-date-field">
                <label htmlFor="reports-start-date">Data inicial</label>
                <input
                  id="reports-start-date"
                  type="date"
                  value={startDate}
                  min={minimumDate}
                  max={todayInputValue}
                  aria-invalid={Boolean(startDateError)}
                  aria-describedby={dateError ? 'reports-date-error' : undefined}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="reports-date-field">
                <label htmlFor="reports-end-date">Data final</label>
                <input
                  id="reports-end-date"
                  type="date"
                  value={endDate}
                  min={minimumDate}
                  max={todayInputValue}
                  aria-invalid={Boolean(endDateError)}
                  aria-describedby={dateError ? 'reports-date-error' : undefined}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>
              <div className="reports-filter-actions">
                <button type="button" className="reports-primary-button" onClick={applyPeriod} disabled={Boolean(dateError)}>
                  Aplicar período
                </button>
                <button type="button" className="reports-secondary-button" onClick={clearPeriod} disabled={!startDate && !endDate && !appliedStartDate && !appliedEndDate}>
                  Limpar período
                </button>
              </div>
            </div>
            {dateError && <p id="reports-date-error" className="reports-date-error" role="alert">{dateError}</p>}
          </section>

          <section className="reports-section" aria-labelledby="sales-indicators-title">
            <div className="reports-section-heading reports-section-heading-compact">
              <div>
                <h2 id="sales-indicators-title">Indicadores de vendas</h2>
                <p>Resultados correspondentes às vendas filtradas.</p>
              </div>
            </div>
            <div className="reports-indicators-grid">
              <article className="reports-indicator-card reports-indicator-card-highlight">
                <div className="reports-indicator-icon"><BarChart3 size={19} aria-hidden="true" /></div>
                <span>Total de vendas</span>
                <strong>{totalSales}</strong>
              </article>
              <article className="reports-indicator-card">
                <div className="reports-indicator-icon"><DollarSign size={19} aria-hidden="true" /></div>
                <span>Faturamento total</span>
                <strong>{currency.format(totalRevenue)}</strong>
              </article>
              <article className="reports-indicator-card">
                <div className="reports-indicator-icon"><ShoppingCart size={19} aria-hidden="true" /></div>
                <span>Ticket médio</span>
                <strong>{currency.format(averageTicket)}</strong>
              </article>
              <article className="reports-indicator-card">
                <div className="reports-indicator-icon"><Banknote size={19} aria-hidden="true" /></div>
                <span>Total em dinheiro</span>
                <strong>{currency.format(paymentSummary.cash.total)}</strong>
              </article>
              <article className="reports-indicator-card">
                <div className="reports-indicator-icon"><BarChart3 size={19} aria-hidden="true" /></div>
                <span>Total em PIX</span>
                <strong>{currency.format(paymentSummary.pix.total)}</strong>
              </article>
              <article className="reports-indicator-card">
                <div className="reports-indicator-icon"><CreditCard size={19} aria-hidden="true" /></div>
                <span>Total em cartão</span>
                <strong>{currency.format(paymentSummary.card.total)}</strong>
              </article>
            </div>
          </section>

          <section className="reports-section" aria-labelledby="payment-summary-title">
            <div className="reports-section-heading reports-section-heading-compact">
              <div>
                <h2 id="payment-summary-title">Resumo por forma de pagamento</h2>
                <p>Quantidade e valor das vendas no período selecionado.</p>
              </div>
            </div>
            <div className="reports-payment-grid">
              {(Object.entries(paymentSummary) as [PaymentMethod, { count: number; total: number }][]).map(([paymentMethod, summary]) => (
                <article className="reports-payment-card" key={paymentMethod}>
                  <div className="reports-payment-card-heading">
                    {paymentMethod === 'cash' && <Banknote size={19} aria-hidden="true" />}
                    {paymentMethod === 'pix' && <BarChart3 size={19} aria-hidden="true" />}
                    {paymentMethod === 'card' && <CreditCard size={19} aria-hidden="true" />}
                    <h3>{paymentMethodLabels[paymentMethod]}</h3>
                  </div>
                  <div className="reports-payment-values">
                    <div><span>Quantidade de vendas</span><strong>{summary.count}</strong></div>
                    <div><span>Valor total</span><strong>{currency.format(summary.total)}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="reports-section" aria-labelledby="best-selling-products-title">
            <div className="reports-section-heading reports-section-heading-compact">
              <div>
                <h2 id="best-selling-products-title">Produtos mais vendidos</h2>
                <p>Produtos ordenados pela quantidade vendida no período selecionado.</p>
              </div>
              <Package className="reports-section-icon" size={22} aria-hidden="true" />
            </div>

            {soldProducts.length > 0 ? (
              <div className="reports-products-table-wrapper">
                <table className="reports-products-table">
                  <thead>
                    <tr>
                      <th>Posição</th>
                      <th>Produto</th>
                      <th>Código de barras</th>
                      <th className="reports-products-number">Quantidade vendida</th>
                      <th className="reports-products-number">Faturamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {soldProducts.map((product, index) => (
                      <tr key={product.productId}>
                        <td>{index + 1}</td>
                        <td className="reports-products-name">{product.name}</td>
                        <td>{product.barcode}</td>
                        <td className="reports-products-number">{product.quantity}</td>
                        <td className="reports-products-number">{currency.format(product.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="reports-empty-state" aria-live="polite">
                <Package size={28} aria-hidden="true" />
                <h2>Nenhum produto vendido</h2>
                <p>Não existem produtos vendidos no período selecionado.</p>
              </div>
            )}
          </section>

          <section className="reports-section" aria-labelledby="stock-report-title">
            <div className="reports-section-heading reports-section-heading-compact">
              <div>
                <span className="reports-section-overline">VISÃO DO CATÁLOGO</span>
                <h2 id="stock-report-title">Estoque</h2>
                <p>Resumo do estoque atual dos produtos cadastrados.</p>
              </div>
              <Package className="reports-section-icon" size={22} aria-hidden="true" />
            </div>

            <div className="reports-indicators-grid reports-stock-indicators-grid">
              <article className="reports-indicator-card reports-indicator-card-highlight">
                <div className="reports-indicator-icon"><Package size={19} aria-hidden="true" /></div>
                <span>Total de produtos cadastrados</span>
                <strong>{stockSummary.totalProducts}</strong>
              </article>
              <article className="reports-indicator-card">
                <div className="reports-indicator-icon"><Package size={19} aria-hidden="true" /></div>
                <span>Produtos com estoque disponível</span>
                <strong>{stockSummary.availableProducts}</strong>
              </article>
              <article className="reports-indicator-card">
                <div className="reports-indicator-icon"><Package size={19} aria-hidden="true" /></div>
                <span>Produtos sem estoque</span>
                <strong>{stockSummary.outOfStockProducts}</strong>
              </article>
              <article className="reports-indicator-card">
                <div className="reports-indicator-icon"><Package size={19} aria-hidden="true" /></div>
                <span>Unidades em estoque</span>
                <strong>{stockSummary.totalUnits}</strong>
              </article>
              <article className="reports-indicator-card">
                <div className="reports-indicator-icon"><DollarSign size={19} aria-hidden="true" /></div>
                <span>Valor estimado do estoque</span>
                <strong>{currency.format(stockSummary.estimatedValue)}</strong>
              </article>
            </div>

            {stockProducts.length > 0 ? (
              <div className="reports-products-table-wrapper reports-stock-table-wrapper">
                <table className="reports-products-table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Código de barras</th>
                      <th className="reports-products-number">Preço unitário</th>
                      <th className="reports-products-number">Estoque atual</th>
                      <th className="reports-products-number">Valor em estoque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockProducts.map(({ product }) => (
                      <tr key={product.id}>
                        <td className="reports-products-name">{product.name}</td>
                        <td>{product.barcode}</td>
                        <td className="reports-products-number">{currency.format(product.price)}</td>
                        <td className="reports-products-number">{product.stock}</td>
                        <td className="reports-products-number">{currency.format(product.price * product.stock)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="reports-empty-state" aria-live="polite">
                <Package size={28} aria-hidden="true" />
                <h2>Nenhum produto cadastrado</h2>
                <p>Não existem produtos cadastrados no catálogo.</p>
              </div>
            )}
          </section>
        </section>
      </main>
    </div>
  )
}
