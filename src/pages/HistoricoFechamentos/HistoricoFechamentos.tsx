import {
    BarChart3,
    Calculator,
    History,
    LayoutDashboard,
    LogOut,
    Menu,
    Package,
    Settings,
    ShoppingCart,
    X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

import { getCashClosuresFromSupabase } from '../../data/cashClosures'
import { UserProfileMenu } from '../../components/UserProfileMenu/UserProfileMenu'
import { useBakeries } from '../../hooks/useBakeries'
import { useAuth } from '../../contexts/AuthContext'
import type { CashClosure } from '../../types/CashClosure'
import { logoutAndRedirect } from '../../utils/auth'
import '../Dashboard/Dashborad.css'
import './HistoricoFechamentos.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
})

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeStyle: 'short',
})

const CLOSURES_PER_PAGE = 10

function formatDate(date: string): string {
    return dateFormatter.format(new Date(date))
}

function formatTime(date: string): string {
    return timeFormatter.format(new Date(date))
}

function formatDateTime(date: string): string {
    return `${formatDate(date)} às ${formatTime(date)}`
}

function formatDifference(value: number): string {
    if (value > 0) return `+ ${currency.format(value)}`
    if (value < 0) return `- ${currency.format(Math.abs(value))}`
    return currency.format(0)
}

function sortByMostRecent(firstClosure: CashClosure, secondClosure: CashClosure): number {
    return new Date(secondClosure.closedAt).getTime() - new Date(firstClosure.closedAt).getTime()
}

function getClosureStatus(difference: number): string {
    if (difference === 0) return 'Caixa conferido'
    if (difference > 0) return 'Caixa com sobra'
    return 'Caixa com falta'
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

export default function HistoricoFechamentos() {
    const navigate = useNavigate()
    const { authenticatedUser } = useAuth()
    const isOwner = authenticatedUser?.role === 'owner'
    const [closures, setClosures] = useState<CashClosure[]>([])
    const [isLoadingClosures, setIsLoadingClosures] = useState(true)
    const [closuresLoadError, setClosuresLoadError] = useState('')
    const { bakeries } = useBakeries()
    const activeBakeries = bakeries.filter((bakery) => bakery.active)
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [bakeryFilter, setBakeryFilter] = useState('all')
    const [selectedClosure, setSelectedClosure] = useState<CashClosure | null>(null)
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
    const closeDetailsButtonRef = useRef<HTMLButtonElement>(null)
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
    const hasInvalidDateRange = !startDateError && !endDateError &&
        startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp
    const dateError = startDateError || endDateError || (hasInvalidDateRange
        ? 'A data inicial não pode ser posterior à data final.'
        : null)
    const filteredClosures = closures.filter((closure) => {
        const matchesBakery = bakeryFilter === 'all' || closure.bakeryId === bakeryFilter
        const closureTimestamp = new Date(closure.closedAt).getTime()
        const matchesStartDate = !startDate || !!startDateError || closureTimestamp >= (startTimestamp ?? 0)
        const matchesEndDate = !endDate || !!endDateError || closureTimestamp <= (endTimestamp ?? 0)
        return matchesBakery && !hasInvalidDateRange && matchesStartDate && matchesEndDate
    })
    const [currentPage, setCurrentPage] = useState(1)
    const totalPages = Math.ceil(filteredClosures.length / CLOSURES_PER_PAGE)
    const paginatedClosures = filteredClosures.slice(
        (currentPage - 1) * CLOSURES_PER_PAGE,
        currentPage * CLOSURES_PER_PAGE,
    )

    useEffect(() => {
        let active = true
        void (async () => {
            await Promise.resolve()
            if (!active) return
            setIsLoadingClosures(true)
            setClosuresLoadError('')
            try {
                const loadedClosures = await getCashClosuresFromSupabase()
                if (active) setClosures(loadedClosures.sort(sortByMostRecent))
            } catch (error: unknown) {
                if (!active) return
                console.error('Erro ao carregar o histórico de fechamentos.', error)
                const fallback = error instanceof TypeError
                    ? 'Não foi possível conectar ao sistema. Verifique sua conexão e tente novamente.'
                    : 'Não foi possível carregar os fechamentos. Atualize a tela e tente novamente.'
                const message = error instanceof Error ? error.message : ''
                setClosuresLoadError(/supabase|rpc|postgres|pgrst|jwt|\.env/i.test(message) ? fallback : message || fallback)
            } finally {
                if (active) setIsLoadingClosures(false)
            }
        })()

        return () => {
            active = false
        }
    }, [])

    function handleLogout() {
        void logoutAndRedirect(navigate)
    }

    function closeDetails() {
        setSelectedClosure(null)
    }

    function closeMobileMenu() {
        setIsMobileMenuOpen(false)
    }

    useEffect(() => {
        if (!selectedClosure) return

        closeDetailsButtonRef.current?.focus()

        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') closeDetails()
        }

        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [selectedClosure])

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
                    {isOwner && <Link to="/dashboard" className="sidebar-link">
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
                    {isOwner && <Link to="/historico-vendas" className="sidebar-link">
                        <History size={19} />
                        <span>Histórico de Vendas</span>
                    </Link>}
                    {isOwner && <Link to="/historico-fechamentos" className="sidebar-link active">
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
                    <button type="button" onClick={handleLogout} className="sidebar-link logout-button">
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
                    {isOwner && <Link to="/dashboard" className="sidebar-link" onClick={closeMobileMenu}>
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
                    {isOwner && <Link to="/historico-vendas" className="sidebar-link" onClick={closeMobileMenu}>
                        <History size={19} />
                        <span>Histórico de Vendas</span>
                    </Link>}
                    {isOwner && <Link to="/historico-fechamentos" className="sidebar-link active" onClick={closeMobileMenu}>
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
                        <span className="header-overline">OPERAÇÃO DE CAIXA</span>
                        <h1>Histórico de Fechamentos</h1>
                        <p>Consulte as sessões de caixa já encerradas.</p>
                    </div>
                    <UserProfileMenu user={authenticatedUser} />
                </header>

                <section className="dashboard-content fechamento-history-content p-10">
                    {closuresLoadError && <p role="alert" className="mb-4 text-red-700">{closuresLoadError}</p>}
                    {isLoadingClosures && <p role="status" className="mb-4">Carregando fechamentos...</p>}
                    <div className="fechamento-history-date-filter">
                        <div className="fechamento-history-filter">
                            <label htmlFor="fechamento-history-bakery-filter">Unidade</label>
                            <select
                                id="fechamento-history-bakery-filter"
                                value={bakeryFilter}
                                onChange={(event) => {
                                    setBakeryFilter(event.target.value)
                                    setCurrentPage(1)
                                }}
                            >
                                <option value="all">Todas as unidades</option>
                                {activeBakeries.map((bakery) => (
                                    <option key={bakery.id} value={bakery.id}>{bakery.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="fechamento-history-date-field">
                            <label htmlFor="fechamento-history-start-date">Data inicial</label>
                            <input
                                id="fechamento-history-start-date"
                                type="date"
                                value={startDate}
                                min={minimumDate}
                                max={todayInputValue}
                                aria-invalid={Boolean(startDateError)}
                                aria-describedby={dateError ? 'fechamento-history-date-error' : undefined}
                                onChange={(event) => {
                                    setStartDate(event.target.value)
                                    setCurrentPage(1)
                                }}
                            />
                        </div>
                        <div className="fechamento-history-date-field">
                            <label htmlFor="fechamento-history-end-date">Data final</label>
                            <input
                                id="fechamento-history-end-date"
                                type="date"
                                value={endDate}
                                min={minimumDate}
                                max={todayInputValue}
                                aria-invalid={Boolean(endDateError)}
                                aria-describedby={dateError ? 'fechamento-history-date-error' : undefined}
                                onChange={(event) => {
                                    setEndDate(event.target.value)
                                    setCurrentPage(1)
                                }}
                            />
                        </div>
                        <button
                            type="button"
                            className="fechamento-history-clear-dates"
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
                            <p id="fechamento-history-date-error" className="fechamento-history-date-error" role="alert">
                                {dateError}
                            </p>
                        )}
                    </div>
                    <div className="fechamento-history-results-heading">
                        <div>
                            <h2>Fechamentos registrados</h2>
                            <p>{filteredClosures.length} fechamento(s) encontrado(s)</p>
                        </div>
                    </div>
                    {closures.length === 0 ? (
                        <section className="fechamento-history-empty">
                            <History size={28} />
                            <h2>Histórico de fechamentos</h2>
                            <p>Nenhum caixa foi fechado ainda.</p>
                        </section>
                    ) : filteredClosures.length === 0 ? (
                        <section className="fechamento-history-empty">
                            <History size={28} />
                            <h2>Nenhum fechamento encontrado</h2>
                            <p>Nenhum fechamento corresponde ao período selecionado.</p>
                        </section>
                    ) : (
                        <section className="fechamento-history-list" aria-label="Lista de caixas fechados">
                            {paginatedClosures.map((closure) => (
                                <article
                                    className="fechamento-history-card"
                                    key={closure.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setSelectedClosure(closure)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault()
                                            setSelectedClosure(closure)
                                        }
                                    }}
                                >
                                    <div className="fechamento-history-card-header">
                                        <div>
                                            <span>Fechamento</span>
                                            <h2>{formatDate(closure.closedAt)}</h2>
                                        </div>
                                        <div className="fechamento-history-closed-time">
                                            <span>Horário de fechamento</span>
                                            <strong>{formatTime(closure.closedAt)}</strong>
                                        </div>
                                    </div>
                                    <div className="fechamento-history-grid">
                                        <div>
                                            <span>Horário de abertura</span>
                                            <strong>{formatTime(closure.openedAt)}</strong>
                                        </div>
                                        <div>
                                            <span>Valor inicial</span>
                                            <strong>{currency.format(closure.initialAmount)}</strong>
                                        </div>
                                        <div>
                                            <span>Vendas em dinheiro</span>
                                            <strong>{currency.format(closure.cashSalesAmount)}</strong>
                                        </div>
                                        <div>
                                            <span>Valor esperado</span>
                                            <strong>{currency.format(closure.expectedAmount)}</strong>
                                        </div>
                                        <div>
                                            <span>Valor contado</span>
                                            <strong>{currency.format(closure.countedAmount)}</strong>
                                        </div>
                                        <div className={`fechamento-history-difference ${closure.differenceAmount === 0 ? 'balanced' : closure.differenceAmount > 0 ? 'surplus' : 'shortage'}`}>
                                            <span>Diferença</span>
                                            <strong>{formatDifference(closure.differenceAmount)}</strong>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </section>
                    )}
                    {filteredClosures.length > 0 && (
                        <div className="fechamento-history-pagination">
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
                </section>
            </main>

            {selectedClosure && (
                <div
                    className="fechamento-details-overlay"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) closeDetails()
                    }}
                >
                    <section
                        className="fechamento-details-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="fechamento-details-title"
                    >
                        <div className="fechamento-details-header">
                            <div>
                                <span className="fechamento-details-overline">DETALHES DO FECHAMENTO</span>
                                <h2 id="fechamento-details-title">Caixa fechado</h2>
                            </div>
                            <button
                                ref={closeDetailsButtonRef}
                                type="button"
                                className="fechamento-details-close"
                                onClick={closeDetails}
                                aria-label="Fechar detalhes"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="fechamento-details-body">
                            <div className="fechamento-details-status">
                                <span>Situação do caixa</span>
                                <strong className={selectedClosure.differenceAmount === 0 ? 'balanced' : selectedClosure.differenceAmount > 0 ? 'surplus' : 'shortage'}>
                                    {getClosureStatus(selectedClosure.differenceAmount)}
                                </strong>
                            </div>
                            <dl className="fechamento-details-grid">
                                <div>
                                    <dt>Data e hora de abertura</dt>
                                    <dd>{formatDateTime(selectedClosure.openedAt)}</dd>
                                </div>
                                <div>
                                    <dt>Data e hora de fechamento</dt>
                                    <dd>{formatDateTime(selectedClosure.closedAt)}</dd>
                                </div>
                                <div>
                                    <dt>Valor inicial</dt>
                                    <dd>{currency.format(selectedClosure.initialAmount)}</dd>
                                </div>
                                <div>
                                    <dt>Vendas em dinheiro</dt>
                                    <dd>{currency.format(selectedClosure.cashSalesAmount)}</dd>
                                </div>
                                <div>
                                    <dt>Valor esperado</dt>
                                    <dd>{currency.format(selectedClosure.expectedAmount)}</dd>
                                </div>
                                <div>
                                    <dt>Valor contado</dt>
                                    <dd>{currency.format(selectedClosure.countedAmount)}</dd>
                                </div>
                                <div className="fechamento-details-difference">
                                    <dt>Diferença</dt>
                                    <dd className={selectedClosure.differenceAmount === 0 ? 'balanced' : selectedClosure.differenceAmount > 0 ? 'surplus' : 'shortage'}>
                                        {formatDifference(selectedClosure.differenceAmount)}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                        <div className="fechamento-details-footer">
                            <button type="button" className="fechamento-details-footer-button" onClick={closeDetails}>
                                Fechar
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    )
}
