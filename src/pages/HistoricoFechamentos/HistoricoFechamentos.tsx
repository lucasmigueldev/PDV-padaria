import {
    BarChart3,
    Calculator,
    History,
    LayoutDashboard,
    LogOut,
    Package,
    Settings,
    ShoppingCart,
    X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getCashClosures } from '../../data/cashClosures'
import type { CashClosure } from '../../types/CashClosure'
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

export default function HistoricoFechamentos() {
    const navigate = useNavigate()
    const closures = [...getCashClosures()].sort(sortByMostRecent)
    const [selectedClosure, setSelectedClosure] = useState<CashClosure | null>(null)
    const closeDetailsButtonRef = useRef<HTMLButtonElement>(null)

    function handleLogout() {
        sessionStorage.removeItem('isAuthenticated')
        navigate('/login', { replace: true })
    }

    function closeDetails() {
        setSelectedClosure(null)
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
                    <a href="/historico-fechamentos" className="sidebar-link active">
                        <History size={19} />
                        <span>Histórico de Fechamentos</span>
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
                    <button type="button" onClick={handleLogout} className="sidebar-link logout-button">
                        <LogOut size={19} />
                        <span>Sair</span>
                    </button>
                </div>
            </aside>

            <main className="dashboard-main ml-64 min-h-screen flex-1">
                <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
                    <div>
                        <span className="header-overline">OPERAÇÃO DE CAIXA</span>
                        <h1>Histórico de Fechamentos</h1>
                        <p>Consulte as sessões de caixa já encerradas.</p>
                    </div>
                    <div className="header-user flex items-center gap-3">
                        <div className="user-avatar">A</div>
                        <div>
                            <strong>Administrador</strong>
                            <span>Usuário do sistema</span>
                        </div>
                    </div>
                </header>

                <section className="dashboard-content fechamento-history-content p-10">
                    {closures.length === 0 ? (
                        <section className="fechamento-history-empty">
                            <History size={28} />
                            <h2>Histórico de fechamentos</h2>
                            <p>Nenhum caixa foi fechado ainda.</p>
                        </section>
                    ) : (
                        <section className="fechamento-history-list" aria-label="Lista de caixas fechados">
                            {closures.map((closure) => (
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
