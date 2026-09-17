import {
    BarChart3,
    Banknote,
    Calculator,
    History,
    LayoutDashboard,
    LogOut,
    Package,
    Settings,
    ShoppingCart,
    X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { getOpenCashRegister, openCashRegister, type CashRegister } from '../../data/cashRegister'
import '../Dashboard/Dashborad.css'
import './Fechamento.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

function formatMoneyInput(value: string): string {
    if (!value) return ''

    const [integerPart, decimalPart] = value.replace(/\./g, '').split(',')
    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '') || '0'
    const formattedInteger = Number(normalizedInteger).toLocaleString('pt-BR')

    return decimalPart === undefined
        ? formattedInteger
        : `${formattedInteger},${decimalPart.slice(0, 2)}`
}

function parseMoneyInput(value: string): number | null {
    if (!value) return null

    const isValidFormat = /^\d+(,\d{1,2})?$/.test(value)
        || /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(value)
    if (!isValidFormat) return null

    const normalizedValue = value.replace(/\./g, '')
    const [integerPart, decimalPart] = normalizedValue.split(',')

    if (!/^\d+$/.test(integerPart) || (decimalPart !== undefined && !/^\d{1,2}$/.test(decimalPart))) {
        return null
    }

    const cents = Number(integerPart) * 100 + Number((decimalPart ?? '').padEnd(2, '0'))
    return Number.isSafeInteger(cents) ? cents / 100 : null
}

function formatOpeningDate(openedAt: string): { date: string; time: string } {
    const openedDate = new Date(openedAt)

    const date = new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
    }).format(openedDate)
    const time = new Intl.DateTimeFormat('pt-BR', {
        timeStyle: 'short',
    }).format(openedDate)

    return { date, time }
}

export default function Fechamento() {
    const navigate = useNavigate()
    const [cashRegister, setCashRegister] = useState<CashRegister | null>(() => getOpenCashRegister())
    const [isOpeningModalOpen, setIsOpeningModalOpen] = useState(false)
    const [initialAmountInput, setInitialAmountInput] = useState('')

    function handleLogout() {
        sessionStorage.removeItem('isAuthenticated')
        navigate('/login', { replace: true })
    }

    function closeOpeningModal() {
        setIsOpeningModalOpen(false)
        setInitialAmountInput('')
    }

    function handleInitialAmountChange(value: string) {
        if (!/^[\d.,]*$/.test(value) || (value.match(/,/g) ?? []).length > 1) return

        const decimalPart = value.split(',')[1]
        if (decimalPart && decimalPart.length > 2) return

        setInitialAmountInput(value)
    }

    function handleOpenCash() {
        const initialAmount = parseMoneyInput(initialAmountInput)
        if (initialAmount === null || cashRegister) return

        setCashRegister(openCashRegister(initialAmount))
        closeOpeningModal()
    }

    useEffect(() => {
        if (!isOpeningModalOpen) return

        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') closeOpeningModal()
        }

        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [isOpeningModalOpen])

    const initialAmount = parseMoneyInput(initialAmountInput)

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
                    <a href="/fechamento" className="sidebar-link active">
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
                        <span className="header-overline">FECHAMENTO</span>
                        <h1>Abertura de caixa</h1>
                        <p>Inicie a sessão do caixa antes de realizar a conferência.</p>
                    </div>
                    <div className="header-user flex items-center gap-3">
                        <div className="user-avatar">A</div>
                        <div>
                            <strong>Administrador</strong>
                            <span>Usuário do sistema</span>
                        </div>
                    </div>
                </header>

                <section className="dashboard-content fechamento-content p-10">
                    {!cashRegister ? (
                        <section className="fechamento-status-card fechado">
                            <div className="fechamento-status-icon">
                                <Banknote size={26} />
                            </div>
                            <div>
                                <span className="fechamento-status-label">Status do caixa</span>
                                <h2>Caixa fechado</h2>
                                <p>Informe o valor inicial para iniciar uma nova sessão de caixa.</p>
                            </div>
                            <button type="button" className="fechamento-primary-button" onClick={() => setIsOpeningModalOpen(true)}>
                                Abrir caixa
                            </button>
                        </section>
                    ) : (
                        <section className="fechamento-status-card aberto">
                            <div className="fechamento-status-icon">
                                <Banknote size={26} />
                            </div>
                            <div className="fechamento-opened-heading">
                                <span className="fechamento-status-label">Status do caixa</span>
                                <h2>Caixa aberto</h2>
                            </div>
                            <div className="fechamento-opened-details">
                                <div>
                                    <span>Data de abertura</span>
                                    <strong>{formatOpeningDate(cashRegister.openedAt).date}</strong>
                                </div>
                                <div>
                                    <span>Hora de abertura</span>
                                    <strong>{formatOpeningDate(cashRegister.openedAt).time}</strong>
                                </div>
                                <div>
                                    <span>Valor inicial</span>
                                    <strong>{currency.format(cashRegister.initialAmount)}</strong>
                                </div>
                            </div>
                        </section>
                    )}
                </section>
            </main>

            {isOpeningModalOpen && !cashRegister && (
                <div className="fechamento-modal-overlay" role="presentation" onMouseDown={(event) => {
                    if (event.target === event.currentTarget) closeOpeningModal()
                }}>
                    <section className="fechamento-modal" role="dialog" aria-modal="true" aria-labelledby="opening-modal-title">
                        <div className="fechamento-modal-header">
                            <div>
                                <span className="fechamento-modal-overline">NOVA SESSÃO</span>
                                <h2 id="opening-modal-title">Abrir caixa</h2>
                            </div>
                            <button type="button" className="fechamento-modal-close" onClick={closeOpeningModal} aria-label="Fechar janela">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="fechamento-modal-body">
                            <label htmlFor="initial-amount">Valor inicial do caixa</label>
                            <div className="fechamento-counted-cash-input">
                                <span>R$</span>
                                <input
                                    id="initial-amount"
                                    type="text"
                                    inputMode="decimal"
                                    value={initialAmountInput}
                                    onChange={(event) => handleInitialAmountChange(event.target.value)}
                                    onBlur={() => setInitialAmountInput(formatMoneyInput(initialAmountInput))}
                                    autoFocus
                                />
                            </div>
                            <p>O valor e a data de abertura serão registrados nesta sessão.</p>
                        </div>
                        <div className="fechamento-modal-footer">
                            <button type="button" className="fechamento-secondary-button" onClick={closeOpeningModal}>
                                Cancelar
                            </button>
                            <button type="button" className="fechamento-primary-button" onClick={handleOpenCash} disabled={initialAmount === null}>
                                Abrir caixa
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    )
}
