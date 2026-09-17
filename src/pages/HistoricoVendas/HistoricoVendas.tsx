import {
    BarChart3,
    Calculator,
    Clock3,
    History,
    LayoutDashboard,
    LogOut,
    Package,
    Search,
    Settings,
    ShoppingCart,
    X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getSales } from '../../data/sales'
import type { PaymentMethod, Sale } from '../../types/Sale'
import '../Dashboard/Dashborad.css'
import './HistoricoVendas.css'

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

export default function HistoricoVendas() {
    const navigate = useNavigate()
    const sales = getSales()
    const [search, setSearch] = useState('')
    const [paymentFilter, setPaymentFilter] = useState<PaymentMethod | 'all'>('all')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
    const closeDetailsButtonRef = useRef<HTMLButtonElement>(null)
    const today = new Date()
    const currentYear = today.getFullYear()
    const todayInputValue = [
        currentYear,
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
    ].join('-')
    const minimumDate = `${currentYear}-01-01`
    const normalizedSearch = search.trim().toLocaleLowerCase()
    const startDateError = validateDateInput(startDate, today)
    const endDateError = validateDateInput(endDate, today)
    const startTimestamp = startDate
        ? new Date(`${startDate}T00:00:00`).getTime()
        : null
    const endTimestamp = endDate
        ? new Date(`${endDate}T23:59:59.999`).getTime()
        : null
    const hasInvalidDateRange = !startDateError && !endDateError &&
        startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp
    const dateError = startDateError || endDateError || (hasInvalidDateRange
        ? 'A data inicial não pode ser posterior à data final.'
        : null)
    const filteredSales = sales.filter((sale) => {
        const matchesPayment = paymentFilter === 'all' || sale.paymentMethod === paymentFilter
        const saleTimestamp = new Date(sale.date).getTime()
        const matchesStartDate = !startDate || !!startDateError || saleTimestamp >= (startTimestamp ?? 0)
        const matchesEndDate = !endDate || !!endDateError || saleTimestamp <= (endTimestamp ?? 0)
        const matchesDate = !hasInvalidDateRange && matchesStartDate && matchesEndDate
        const matchesSearch = !normalizedSearch ||
            sale.id.toLocaleLowerCase().includes(normalizedSearch) ||
            sale.items.some((item) =>
                item.name.toLocaleLowerCase().includes(normalizedSearch) ||
                item.barcode.toLocaleLowerCase().includes(normalizedSearch),
            )

        return matchesPayment && matchesDate && matchesSearch
    })

    useEffect(() => {
        if (!selectedSale) return

        closeDetailsButtonRef.current?.focus()

        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') setSelectedSale(null)
        }

        window.addEventListener('keydown', handleEscape)
        return () => window.removeEventListener('keydown', handleEscape)
    }, [selectedSale])

    function handleLogout() {
        sessionStorage.removeItem('isAuthenticated')
        navigate('/login', { replace: true })
    }

    function openSaleDetails(sale: Sale) {
        setSelectedSale(sale)
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
                    <div className="sales-history-toolbar">
                        <div className="sales-history-search">
                            <Search size={19} aria-hidden="true" />
                            <label htmlFor="sales-history-search-input">Buscar vendas</label>
                            <input
                                id="sales-history-search-input"
                                type="search"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar por ID, produto ou código de barras"
                            />
                        </div>

                        <div className="sales-history-filter">
                            <label htmlFor="sales-history-payment-filter">Forma de pagamento</label>
                            <select
                                id="sales-history-payment-filter"
                                value={paymentFilter}
                                onChange={(event) => setPaymentFilter(event.target.value as PaymentMethod | 'all')}
                            >
                                <option value="all">Todas</option>
                                <option value="cash">Dinheiro</option>
                                <option value="pix">PIX</option>
                                <option value="card">Cartão</option>
                            </select>
                        </div>

                        <div className="sales-history-date-filter">
                            <div className="sales-history-date-field">
                                <label htmlFor="sales-history-start-date">Data inicial</label>
                                <input
                                    id="sales-history-start-date"
                                    type="date"
                                    value={startDate}
                                    min={minimumDate}
                                    max={todayInputValue}
                                    aria-invalid={Boolean(startDateError)}
                                    aria-describedby={dateError ? 'sales-history-date-error' : undefined}
                                    onChange={(event) => setStartDate(event.target.value)}
                                />
                            </div>
                            <div className="sales-history-date-field">
                                <label htmlFor="sales-history-end-date">Data final</label>
                                <input
                                    id="sales-history-end-date"
                                    type="date"
                                    value={endDate}
                                    min={minimumDate}
                                    max={todayInputValue}
                                    aria-invalid={Boolean(endDateError)}
                                    aria-describedby={dateError ? 'sales-history-date-error' : undefined}
                                    onChange={(event) => setEndDate(event.target.value)}
                                />
                            </div>
                            <button
                                type="button"
                                className="sales-history-clear-dates"
                                onClick={() => {
                                    setStartDate('')
                                    setEndDate('')
                                }}
                                disabled={!startDate && !endDate}
                            >
                                Limpar datas
                            </button>
                            {dateError && (
                                <p id="sales-history-date-error" className="sales-history-date-error" role="alert">
                                    {dateError}
                                </p>
                            )}
                        </div>
                    </div>

                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 p-6">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Vendas registradas</h2>
                                <p className="mt-1 text-sm text-slate-500">{filteredSales.length} venda(s) encontrada(s)</p>
                            </div>
                            <Clock3 className="text-slate-400" size={21} aria-hidden="true" />
                        </div>

                        {sales.length > 0 && filteredSales.length > 0 ? (
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
                                        {filteredSales.map((sale) => (
                                            <tr
                                                key={sale.id}
                                                className="cursor-pointer text-slate-700 transition-colors hover:bg-slate-50 focus-within:bg-slate-50"
                                                onClick={() => openSaleDetails(sale)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault()
                                                        openSaleDetails(sale)
                                                    }
                                                }}
                                                role="button"
                                                tabIndex={0}
                                                aria-label={`Visualizar detalhes da venda ${sale.id}`}
                                            >
                                                <td className="whitespace-nowrap px-6 py-4">{dateTime.format(new Date(sale.date))}</td>
                                                <td className="px-6 py-4 font-medium text-slate-900">{sale.id}</td>
                                                <td className="px-6 py-4">{paymentMethodLabels[sale.paymentMethod]}</td>
                                                <td className="whitespace-nowrap px-6 py-4 text-right font-semibold text-slate-900">{currency.format(sale.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : sales.length === 0 ? (
                            <div className="p-12 text-center">
                                <History className="mx-auto mb-4 text-slate-300" size={32} aria-hidden="true" />
                                <p className="font-medium text-slate-700">Ainda não existem vendas registradas.</p>
                                <p className="mt-1 text-sm text-slate-500">As vendas concluídas no caixa aparecerão aqui.</p>
                            </div>
                        ) : (
                            <div className="sales-history-empty-search">
                                <Search size={30} aria-hidden="true" />
                                <p>Nenhuma venda encontrada.</p>
                                <span>Tente buscar por outro ID, produto ou código de barras.</span>
                            </div>
                        )}
                    </section>
                </section>
            </main>

            {selectedSale && (
                <div
                    className="sales-details-overlay"
                    onClick={() => setSelectedSale(null)}
                >
                    <div
                        className="sales-details-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="sale-details-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="sales-details-header">
                            <div>
                                <span className="sales-details-overline">Histórico de vendas</span>
                                <h2 id="sale-details-title">Detalhes da venda</h2>
                                <p className="sales-details-id">{selectedSale.id}</p>
                            </div>
                            <button
                                ref={closeDetailsButtonRef}
                                type="button"
                                className="sales-details-close"
                                onClick={() => setSelectedSale(null)}
                                aria-label="Fechar detalhes da venda"
                                title="Fechar"
                            >
                                <X size={19} />
                            </button>
                        </div>

                        <dl className="sales-details-summary">
                            <div className="sales-details-summary-card">
                                <dt>Data e hora</dt>
                                <dd>{dateTime.format(new Date(selectedSale.date))}</dd>
                            </div>
                            <div className="sales-details-summary-card">
                                <dt>Forma de pagamento</dt>
                                <dd>{paymentMethodLabels[selectedSale.paymentMethod]}</dd>
                            </div>
                            <div className="sales-details-summary-card">
                                <dt>ID da venda</dt>
                                <dd className="sales-details-summary-id">{selectedSale.id}</dd>
                            </div>
                        </dl>

                        <div className="sales-details-products">
                            <div className="sales-details-section-header">
                                <h3>Produtos vendidos</h3>
                                <p>Itens registrados nesta venda</p>
                            </div>
                            <div className="sales-details-products-scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Produto</th>
                                            <th>Código de barras</th>
                                            <th>Quantidade</th>
                                            <th>Preço unitário</th>
                                            <th>Subtotal</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedSale.items.map((item) => (
                                            <tr key={`${item.productId}-${item.barcode}`}>
                                                <td className="sales-details-product-name">{item.name}</td>
                                                <td className="sales-details-barcode">{item.barcode}</td>
                                                <td className="sales-details-quantity">{item.quantity}</td>
                                                <td className="sales-details-money">{currency.format(item.price)}</td>
                                                <td className="sales-details-money sales-details-subtotal">{currency.format(item.subtotal)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {selectedSale.paymentMethod === 'cash' && (
                            <dl className="sales-details-payment">
                                <div>
                                    <dt>Valor recebido</dt>
                                    <dd>{currency.format(selectedSale.receivedAmount ?? 0)}</dd>
                                </div>
                                <div>
                                    <dt>Troco</dt>
                                    <dd>{currency.format(selectedSale.change ?? 0)}</dd>
                                </div>
                            </dl>
                        )}

                        <div className="sales-details-total">
                            <span>Total da venda</span>
                            <strong>{currency.format(selectedSale.total)}</strong>
                        </div>

                        <div className="sales-details-footer">
                            <button
                                type="button"
                                className="sales-details-footer-button"
                                onClick={() => setSelectedSale(null)}
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}