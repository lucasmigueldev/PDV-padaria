import {
    BarChart3,
    Banknote,
    Calculator,
    Clock3,
    CreditCard,
    DollarSign,
    FileDown,
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
import { jsPDF } from 'jspdf'
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

const SALES_PER_PAGE = 10

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
    const [sortOrder, setSortOrder] = useState<'recent' | 'oldest' | 'highest' | 'lowest'>('recent')
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [currentPage, setCurrentPage] = useState(1)
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
    const filteredSalesSummary = filteredSales.reduce((summary, sale) => {
        summary.total += sale.total
        summary[sale.paymentMethod] += 1
        return summary
    }, { total: 0, cash: 0, pix: 0, card: 0 })
    const sortedSales = [...filteredSales].sort((firstSale, secondSale) => {
        if (sortOrder === 'highest') return secondSale.total - firstSale.total
        if (sortOrder === 'lowest') return firstSale.total - secondSale.total

        const dateDifference = new Date(secondSale.date).getTime() - new Date(firstSale.date).getTime()
        return sortOrder === 'recent' ? dateDifference : -dateDifference
    })
    const totalPages = Math.ceil(sortedSales.length / SALES_PER_PAGE)
    const paginatedSales = sortedSales.slice(
        (currentPage - 1) * SALES_PER_PAGE,
        currentPage * SALES_PER_PAGE,
    )

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

    function exportSales() {
        if (sortedSales.length === 0) return

        const documentPdf = new jsPDF({ unit: 'pt', format: 'a4' })
        const pageWidth = documentPdf.internal.pageSize.getWidth()
        const pageHeight = documentPdf.internal.pageSize.getHeight()
        const margin = 40
        const contentWidth = pageWidth - margin * 2
        let cursorY = margin

        const addPage = () => {
            documentPdf.addPage()
            cursorY = margin
        }

        const ensureSpace = (height: number) => {
            if (cursorY + height > pageHeight - margin) addPage()
        }

        const formatDateInput = (value: string) => value
            ? value.split('-').reverse().join('/')
            : 'Todos os períodos'

        const reportDate = dateTime.format(new Date())
        const generatedAt = new Date().toISOString().slice(0, 10)

        documentPdf.setFillColor('#2563eb')
        documentPdf.rect(0, 0, pageWidth, 9, 'F')
        documentPdf.setTextColor('#111827')
        documentPdf.setFontSize(22)
        documentPdf.setFont('helvetica', 'bold')
        documentPdf.text('Histórico de Vendas', margin, cursorY + 10)
        cursorY += 32
        documentPdf.setFont('helvetica', 'normal')
        documentPdf.setFontSize(10)
        documentPdf.setTextColor('#64748b')
        documentPdf.text(`Relatório gerado em ${reportDate}`, margin, cursorY)
        cursorY += 28

        documentPdf.setFillColor('#f8fafc')
        documentPdf.setDrawColor('#e2e8f0')
        documentPdf.roundedRect(margin, cursorY, contentWidth, 82, 8, 8, 'FD')
        cursorY += 20
        documentPdf.setFont('helvetica', 'bold')
        documentPdf.setFontSize(10)
        documentPdf.setTextColor('#1e293b')
        documentPdf.text('Filtros aplicados', margin + 16, cursorY)
        cursorY += 16
        documentPdf.setFont('helvetica', 'normal')
        documentPdf.setFontSize(9)
        documentPdf.setTextColor('#475569')
        documentPdf.text(`Período: ${formatDateInput(startDate)} a ${formatDateInput(endDate)}`, margin + 16, cursorY)
        cursorY += 13
        documentPdf.text(`Forma de pagamento: ${paymentFilter === 'all' ? 'Todas' : paymentMethodLabels[paymentFilter]}`, margin + 16, cursorY)
        cursorY += 13
        documentPdf.text(`Busca: ${search.trim() || 'Nenhuma'}`, margin + 16, cursorY)
        cursorY += 30

        documentPdf.setFont('helvetica', 'bold')
        documentPdf.setFontSize(10)
        documentPdf.setTextColor('#1e293b')
        documentPdf.text('Resumo', margin, cursorY)
        cursorY += 16
        documentPdf.setFont('helvetica', 'normal')
        documentPdf.setFontSize(9)
        documentPdf.setTextColor('#475569')
        documentPdf.text(`Vendas: ${filteredSales.length}   |   Total: ${currency.format(filteredSalesSummary.total)}`, margin, cursorY)
        cursorY += 13
        documentPdf.text(`Dinheiro: ${filteredSalesSummary.cash}   |   PIX: ${filteredSalesSummary.pix}   |   Cartão: ${filteredSalesSummary.card}`, margin, cursorY)
        cursorY += 28

        sortedSales.forEach((sale) => {
            ensureSpace(120)
            documentPdf.setFillColor('#eff6ff')
            documentPdf.setDrawColor('#bfdbfe')
            documentPdf.roundedRect(margin, cursorY, contentWidth, 42, 7, 7, 'FD')
            documentPdf.setFont('helvetica', 'bold')
            documentPdf.setFontSize(10)
            documentPdf.setTextColor('#1e3a8a')
            documentPdf.text(`Venda ${sale.id}`, margin + 14, cursorY + 17)
            documentPdf.setFont('helvetica', 'normal')
            documentPdf.setFontSize(9)
            documentPdf.setTextColor('#475569')
            documentPdf.text(dateTime.format(new Date(sale.date)), margin + 14, cursorY + 32)
            documentPdf.text(paymentMethodLabels[sale.paymentMethod], pageWidth - margin - 14, cursorY + 24, { align: 'right' })
            cursorY += 58

            documentPdf.setFont('helvetica', 'bold')
            documentPdf.setFontSize(8)
            documentPdf.setTextColor('#64748b')
            documentPdf.text('PRODUTO', margin, cursorY)
            documentPdf.text('QTD.', margin + 270, cursorY, { align: 'right' })
            documentPdf.text('UNITÁRIO', margin + 365, cursorY, { align: 'right' })
            documentPdf.text('SUBTOTAL', pageWidth - margin, cursorY, { align: 'right' })
            cursorY += 13

            sale.items.forEach((item) => {
                const productLines = documentPdf.splitTextToSize(`${item.name} | Cód. ${item.barcode}`, 235) as string[]
                const rowHeight = Math.max(24, productLines.length * 11 + 10)
                ensureSpace(rowHeight + 4)
                documentPdf.setDrawColor('#e2e8f0')
                documentPdf.line(margin, cursorY - 4, pageWidth - margin, cursorY - 4)
                documentPdf.setFont('helvetica', 'normal')
                documentPdf.setFontSize(9)
                documentPdf.setTextColor('#334155')
                documentPdf.text(productLines, margin, cursorY + 8)
                documentPdf.text(String(item.quantity), margin + 270, cursorY + 8, { align: 'right' })
                documentPdf.text(currency.format(item.price), margin + 365, cursorY + 8, { align: 'right' })
                documentPdf.text(currency.format(item.subtotal), pageWidth - margin, cursorY + 8, { align: 'right' })
                cursorY += rowHeight
            })

            ensureSpace(30)
            documentPdf.setFont('helvetica', 'bold')
            documentPdf.setFontSize(10)
            documentPdf.setTextColor('#1e293b')
            documentPdf.text('Total da venda', margin + 365, cursorY + 14, { align: 'right' })
            documentPdf.setTextColor('#1d4ed8')
            documentPdf.text(currency.format(sale.total), pageWidth - margin, cursorY + 14, { align: 'right' })
            cursorY += 36
        })

        ensureSpace(38)
        documentPdf.setDrawColor('#bfdbfe')
        documentPdf.line(margin, cursorY, pageWidth - margin, cursorY)
        cursorY += 22
        documentPdf.setFont('helvetica', 'bold')
        documentPdf.setFontSize(13)
        documentPdf.setTextColor('#1e293b')
        documentPdf.text('Total geral das vendas exportadas', margin, cursorY)
        documentPdf.setTextColor('#1d4ed8')
        documentPdf.text(currency.format(filteredSalesSummary.total), pageWidth - margin, cursorY, { align: 'right' })
        documentPdf.save(`historico-vendas-${generatedAt}.pdf`)
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
                    <a href="/fechamento" className="sidebar-link"><Calculator size={19} /><span>Fechamento</span></a>
                    <a href="/produtos" className="sidebar-link"><Package size={19} /><span>Produtos</span></a>
                    <a href="/historico-vendas" className="sidebar-link active"><History size={19} /><span>Histórico de Vendas</span></a>
                    <a href="/historico-fechamentos" className="sidebar-link"><History size={19} /><span>Histórico de Fechamentos</span></a>
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
                                onChange={(event) => {
                                    setSearch(event.target.value)
                                    setCurrentPage(1)
                                }}
                                placeholder="Buscar por ID, produto ou código de barras"
                            />
                        </div>

                        <div className="sales-history-filter">
                            <label htmlFor="sales-history-payment-filter">Forma de pagamento</label>
                            <select
                                id="sales-history-payment-filter"
                                value={paymentFilter}
                                onChange={(event) => {
                                    setPaymentFilter(event.target.value as PaymentMethod | 'all')
                                    setCurrentPage(1)
                                }}
                            >
                                <option value="all">Todas</option>
                                <option value="cash">Dinheiro</option>
                                <option value="pix">PIX</option>
                                <option value="card">Cartão</option>
                            </select>
                        </div>

                        <div className="sales-history-filter">
                            <label htmlFor="sales-history-sort-order">Ordenar por</label>
                            <select
                                id="sales-history-sort-order"
                                value={sortOrder}
                                onChange={(event) => {
                                    setSortOrder(event.target.value as typeof sortOrder)
                                    setCurrentPage(1)
                                }}
                            >
                                <option value="recent">Mais recentes primeiro</option>
                                <option value="oldest">Mais antigas primeiro</option>
                                <option value="highest">Maior valor</option>
                                <option value="lowest">Menor valor</option>
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
                                    onChange={(event) => {
                                        setStartDate(event.target.value)
                                        setCurrentPage(1)
                                    }}
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
                                    onChange={(event) => {
                                        setEndDate(event.target.value)
                                        setCurrentPage(1)
                                    }}
                                />
                            </div>
                            <button
                                type="button"
                                className="sales-history-clear-dates"
                                onClick={() => {
                                    setStartDate('')
                                    setEndDate('')
                                    setCurrentPage(1)
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

                    <section className="sales-history-summary" aria-label="Resumo das vendas filtradas">
                        <div className="sales-history-summary-heading">
                            <div>
                                <span>Resumo dos resultados</span>
                                <p>Valores correspondentes às vendas exibidas.</p>
                            </div>
                            <button
                                type="button"
                                className="sales-history-export-button"
                                onClick={exportSales}
                                disabled={sortedSales.length === 0}
                            >
                                <FileDown size={17} aria-hidden="true" />
                                Exportar PDF
                            </button>
                        </div>
                        <div className="sales-history-summary-grid">
                            <div className="sales-history-summary-card sales-history-summary-card-highlight">
                                <div className="sales-history-summary-icon"><Clock3 size={18} aria-hidden="true" /></div>
                                <span>Vendas encontradas</span>
                                <strong>{filteredSales.length}</strong>
                            </div>
                            <div className="sales-history-summary-card sales-history-summary-card-total">
                                <div className="sales-history-summary-icon"><DollarSign size={18} aria-hidden="true" /></div>
                                <span>Valor total</span>
                                <strong>{currency.format(filteredSalesSummary.total)}</strong>
                            </div>
                            <div className="sales-history-summary-card">
                                <div className="sales-history-summary-icon"><Banknote size={18} aria-hidden="true" /></div>
                                <span>Dinheiro</span>
                                <strong>{filteredSalesSummary.cash}</strong>
                            </div>
                            <div className="sales-history-summary-card">
                                <div className="sales-history-summary-icon"><DollarSign size={18} aria-hidden="true" /></div>
                                <span>PIX</span>
                                <strong>{filteredSalesSummary.pix}</strong>
                            </div>
                            <div className="sales-history-summary-card">
                                <div className="sales-history-summary-icon"><CreditCard size={18} aria-hidden="true" /></div>
                                <span>Cartão</span>
                                <strong>{filteredSalesSummary.card}</strong>
                            </div>
                        </div>
                    </section>

                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 p-6">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">Vendas registradas</h2>
                                <p className="mt-1 text-sm text-slate-500">{filteredSales.length} venda(s) encontrada(s)</p>
                            </div>
                            <Clock3 className="text-slate-400" size={21} aria-hidden="true" />
                        </div>

                        {sales.length > 0 && filteredSales.length > 0 ? (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-160 text-left text-sm">
                                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                        <tr>
                                            <th className="px-6 py-4 font-semibold">Data e hora</th>
                                            <th className="px-6 py-4 font-semibold">ID da venda</th>
                                            <th className="px-6 py-4 font-semibold">Forma de pagamento</th>
                                            <th className="px-6 py-4 text-right font-semibold">Valor total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {paginatedSales.map((sale) => (
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
                                {totalPages > 1 && (
                                    <div className="sales-history-pagination">
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                                            disabled={currentPage === 1}
                                        >
                                            Anterior
                                        </button>
                                        <span>Página {currentPage} de {totalPages}</span>
                                        <button
                                            type="button"
                                            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                                            disabled={currentPage === totalPages}
                                        >
                                            Próxima
                                        </button>
                                    </div>
                                )}
                            </>
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