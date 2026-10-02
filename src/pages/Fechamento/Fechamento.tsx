import {
    BarChart3,
    Banknote,
    History,
    LayoutDashboard,
    LogOut,
    Package,
    Receipt,
    Settings,
    ShoppingCart,
    Store,
    UserRound,
    X,
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { getBakeries } from '../../data/bakeries'
import { clearOpenCashRegister, getOpenCashRegister, openCashRegister, type CashRegister } from '../../data/cashRegister'
import { saveCashClosure } from '../../data/cashClosures'
import { getSales } from '../../data/sales'
import { getAuthenticatedUser, isOwnerAuthenticated, logoutAndRedirect } from '../../utils/auth'
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

function toCents(value: number): number {
    return Math.round(value * 100)
}

function calculateCashMovement(cashRegister: CashRegister) {
    const openedAtTimestamp = new Date(cashRegister.openedAt).getTime()
    const cashSalesAmountInCents = getSales()
        .filter((sale) => sale.paymentMethod === 'cash')
        .filter((sale) => sale.bakeryId === cashRegister.bakeryId)
        .filter((sale) => new Date(sale.date).getTime() >= openedAtTimestamp)
        .reduce((total, sale) => total + toCents(sale.total), 0)
    const initialAmountInCents = toCents(cashRegister.initialAmount)

    return {
        cashSalesAmountInCents,
        initialAmountInCents,
        expectedAmountInCents: initialAmountInCents + cashSalesAmountInCents,
    }
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
    const isOwner = isOwnerAuthenticated()
    const authenticatedUser = getAuthenticatedUser()
    const bakeryId = authenticatedUser?.role === 'cashier' ? authenticatedUser.bakeryId : null
    const bakeryName = bakeryId
        ? getBakeries().find((bakery) => bakery.id === bakeryId)?.name ?? 'Unidade indisponível'
        : 'Unidade indisponível'
    const [cashRegister, setCashRegister] = useState<CashRegister | null>(() => (
        bakeryId ? getOpenCashRegister(bakeryId) : null
    ))
    const [isOpeningModalOpen, setIsOpeningModalOpen] = useState(false)
    const [initialAmountInput, setInitialAmountInput] = useState('')
    const [countedCashInput, setCountedCashInput] = useState('')
    const [isCloseModalOpen, setIsCloseModalOpen] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const [closeError, setCloseError] = useState('')
    const isClosingRef = useRef(false)
    const confirmCloseButtonRef = useRef<HTMLButtonElement>(null)
    const cashMovement = cashRegister ? calculateCashMovement(cashRegister) : null
    const countedCash = parseMoneyInput(countedCashInput)
    const countedCashInCents = countedCash === null ? null : toCents(countedCash)
    const differenceInCents = countedCashInCents === null
        ? null
        : countedCashInCents - (cashMovement?.expectedAmountInCents ?? 0)

    function handleLogout() {
        void logoutAndRedirect(navigate)
    }

    function requestOpenCash() {
        setIsOpeningModalOpen(true)
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

    function handleCountedCashChange(value: string) {
        if (!/^[\d.,]*$/.test(value) || (value.match(/,/g) ?? []).length > 1) return

        const decimalPart = value.split(',')[1]
        if (decimalPart && decimalPart.length > 2) return

        setCountedCashInput(value)
    }

    function handleOpenCash() {
        const initialAmount = parseMoneyInput(initialAmountInput)
        if (initialAmount === null || cashRegister || !bakeryId) return

        setCashRegister(openCashRegister(initialAmount, bakeryId))
        closeOpeningModal()
    }

    function handleRequestClose() {
        if (countedCash === null) {
            setCloseError('Informe um valor contado válido antes de fechar o caixa.')
            return
        }

        setCloseError('')
        setIsCloseModalOpen(true)
    }

    function closeClosingModal() {
        if (isClosing) return

        setIsCloseModalOpen(false)
        setCloseError('')
    }

    function handleConfirmClose() {
        if (isClosingRef.current || !cashRegister) return

        const countedAmount = parseMoneyInput(countedCashInput)
        if (countedAmount === null) {
            setCloseError('Informe um valor contado válido antes de fechar o caixa.')
            return
        }

        const currentCashRegister = bakeryId ? getOpenCashRegister(bakeryId) : null
        if (!currentCashRegister || currentCashRegister.id !== cashRegister.id) {
            setCloseError('O caixa aberto não está mais disponível para fechamento.')
            return
        }

        isClosingRef.current = true
        setIsClosing(true)
        setCloseError('')

        try {
            const currentCashMovement = calculateCashMovement(currentCashRegister)
            const countedAmountInCents = toCents(countedAmount)
            const closedAt = new Date().toISOString()

            saveCashClosure({
                id: currentCashRegister.id,
                bakeryId: currentCashRegister.bakeryId,
                openedAt: currentCashRegister.openedAt,
                initialAmount: currentCashRegister.initialAmount,
                closedAt,
                countedAmount: countedAmountInCents / 100,
                expectedAmount: currentCashMovement.expectedAmountInCents / 100,
                differenceAmount: (countedAmountInCents - currentCashMovement.expectedAmountInCents) / 100,
                cashSalesAmount: currentCashMovement.cashSalesAmountInCents / 100,
            })
            clearOpenCashRegister(currentCashRegister.id)
            setCashRegister(null)
            setCountedCashInput('')
            setIsCloseModalOpen(false)
        } catch (error) {
            setCloseError(error instanceof Error ? error.message : 'Não foi possível fechar o caixa.')
        } finally {
            isClosingRef.current = false
            setIsClosing(false)
        }
    }

    function handlePageEnter(event: ReactKeyboardEvent<HTMLDivElement>) {
        if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (isOpeningModalOpen || isCloseModalOpen || event.repeat) return
        if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return

        event.preventDefault()
        if (cashRegister) handleRequestClose()
        else requestOpenCash()
    }

    useEffect(() => {
        if (!isOpeningModalOpen && !isCloseModalOpen) return

        function handleEscape(event: KeyboardEvent) {
            if (event.key !== 'Escape') return
            if (isOpeningModalOpen) {
                setIsOpeningModalOpen(false)
                setInitialAmountInput('')
            }
            if (isCloseModalOpen && !isClosing) {
                setIsCloseModalOpen(false)
                setCloseError('')
            }
        }

        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [isOpeningModalOpen, isCloseModalOpen, isClosing])

    useEffect(() => {
        if (isCloseModalOpen) confirmCloseButtonRef.current?.focus()
    }, [isCloseModalOpen])

    const initialAmount = parseMoneyInput(initialAmountInput)

    return (
        <div className="fechamento-layout" onKeyDown={handlePageEnter}>
            <header className="fechamento-topbar">
                <strong className="fechamento-topbar-title">Padaria PDV</strong>
                <div className="fechamento-topbar-session">
                    <div className="fechamento-session-field">
                        <UserRound size={16} aria-hidden="true" />
                        <span>Operador</span>
                        <strong>{authenticatedUser?.name}</strong>
                    </div>
                    <div className="fechamento-session-divider" aria-hidden="true" />
                    <div className="fechamento-session-field">
                        <Store size={16} aria-hidden="true" />
                        <span>Unidade</span>
                        <strong>{bakeryName}</strong>
                    </div>
                    <button type="button" onClick={handleLogout} className="fechamento-topbar-logout">
                        <LogOut size={17} />
                        <span>Sair</span>
                    </button>
                </div>
            </header>

            <aside className="fechamento-sidebar">
                <div className="fechamento-brand">
                    <div className="fechamento-logo-icon"><ShoppingCart size={22} /></div>
                    <div><strong>Padaria PDV</strong><span>Sistema de vendas</span></div>
                </div>

                {!isOwner && <nav className="fechamento-shortcuts" aria-label="Atalhos operacionais">
                    <span className="fechamento-sidebar-label">Operação</span>
                    <a href="/produtos" className="fechamento-shortcut">
                        <Package size={19} /><span>Produtos</span><kbd>F2</kbd>
                    </a>
                    <a href="/fechamento" className="fechamento-shortcut active" aria-current="page">
                        <Receipt size={19} /><span>Fechamento</span><kbd>F3</kbd>
                    </a>
                    <a href="/pdv" className="fechamento-shortcut">
                        <ShoppingCart size={19} /><span>Voltar ao PDV</span><kbd>F4</kbd>
                    </a>
                </nav>}

                {isOwner && <nav className="fechamento-shortcuts" aria-label="Navegação administrativa">
                    <span className="fechamento-sidebar-label">Administração</span>
                    <a href="/dashboard" className="fechamento-shortcut"><LayoutDashboard size={19} /><span>Dashboard</span></a>
                    <a href="/historico-vendas" className="fechamento-shortcut"><History size={19} /><span>Histórico de Vendas</span></a>
                    <a href="/historico-fechamentos" className="fechamento-shortcut"><History size={19} /><span>Histórico de Fechamentos</span></a>
                    <a href="/relatorios" className="fechamento-shortcut"><BarChart3 size={19} /><span>Relatórios</span></a>
                </nav>}

                {isOwner && <div className="fechamento-sidebar-bottom">
                    <a href="/configuracoes" className="fechamento-shortcut"><Settings size={19} /><span>Configurações</span></a>
                </div>}
            </aside>

            <main className="fechamento-main">
                <section className="fechamento-content">
                    <header className="fechamento-page-heading">
                        <div>
                            <span>OPERAÇÃO DE CAIXA</span>
                            <h1>Fechamento</h1>
                            <p>Abertura e conferência do caixa</p>
                        </div>
                    </header>
                    {!cashRegister ? (
                        <section className="fechamento-status-card fechado">
                            <div className="fechamento-status-overview">
                                <div className="fechamento-status-icon"><Banknote size={28} /></div>
                                <div className="fechamento-status-copy">
                                    <span className="fechamento-status-label">Status do caixa</span>
                                    <h2>Caixa fechado</h2>
                                    <p>Informe o valor inicial para iniciar uma nova sessão de caixa.</p>
                                </div>
                                <button type="button" className="fechamento-primary-button" onClick={requestOpenCash}>
                                    <span>Abrir caixa</span><kbd className="fechamento-keycap">ENTER</kbd>
                                </button>
                            </div>
                        </section>
                    ) : (
                        <section className="fechamento-status-card aberto">
                            <div className="fechamento-open-status-bar">
                                <div className="fechamento-status-icon"><Banknote size={28} /></div>
                                <div className="fechamento-opened-heading">
                                    <span className="fechamento-status-label">Status do caixa</span>
                                    <h2>Caixa aberto</h2>
                                </div>
                                <button type="button" className="fechamento-danger-button" onClick={handleRequestClose}>
                                    <span>Fechar caixa</span><kbd className="fechamento-keycap fechamento-keycap-light">ENTER</kbd>
                                </button>
                                <div className="fechamento-opened-details">
                                    <div><span>Data de abertura</span><strong>{formatOpeningDate(cashRegister.openedAt).date}</strong></div>
                                    <div><span>Hora de abertura</span><strong>{formatOpeningDate(cashRegister.openedAt).time}</strong></div>
                                    <div><span>Valor inicial</span><strong>{currency.format((cashMovement?.initialAmountInCents ?? 0) / 100)}</strong></div>
                                </div>
                            </div>
                            <div className="fechamento-open-workspace">
                                <section className="fechamento-cash-movement">
                                    <h3>Movimentação em dinheiro</h3>
                                    <div className="fechamento-cash-movement-row"><span>Valor inicial</span><strong>{currency.format((cashMovement?.initialAmountInCents ?? 0) / 100)}</strong></div>
                                    <div className="fechamento-cash-movement-row"><span>Vendas em dinheiro</span><strong>{currency.format((cashMovement?.cashSalesAmountInCents ?? 0) / 100)}</strong></div>
                                    <div className="fechamento-cash-movement-row total"><span>Valor esperado</span><strong>{currency.format((cashMovement?.expectedAmountInCents ?? 0) / 100)}</strong></div>
                                </section>
                                <div className="fechamento-counted-panel">
                                    <div className="fechamento-counted-cash">
                                        <label htmlFor="counted-cash">Valor contado</label>
                                        <div className="fechamento-counted-cash-input">
                                            <span>R$</span>
                                            <input
                                                id="counted-cash"
                                                type="text"
                                                inputMode="decimal"
                                                value={countedCashInput}
                                                onChange={(event) => handleCountedCashChange(event.target.value)}
                                                onBlur={() => setCountedCashInput(formatMoneyInput(countedCashInput))}
                                                aria-describedby="counted-cash-description"
                                            />
                                        </div>
                                        <p id="counted-cash-description">Informe o valor em dinheiro contado fisicamente no caixa.</p>
                                    </div>
                                    <div className={`fechamento-difference ${differenceInCents === null ? 'pending' : differenceInCents === 0 ? 'balanced' : differenceInCents > 0 ? 'surplus' : 'shortage'}`}>
                                        <span className="fechamento-difference-label">Diferença</span>
                                        {differenceInCents === null ? (
                                            <p>Informe o valor contado para conferir o caixa.</p>
                                        ) : (
                                            <>
                                                <strong>
                                                    {differenceInCents === 0 && 'Caixa conferido'}
                                                    {differenceInCents > 0 && 'Caixa com sobra'}
                                                    {differenceInCents < 0 && 'Caixa com falta'}
                                                </strong>
                                                <b>
                                                    {differenceInCents > 0 && '+ '}
                                                    {differenceInCents < 0 && '- '}
                                                    {currency.format(Math.abs(differenceInCents) / 100)}
                                                </b>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                            {closeError && !isCloseModalOpen && (
                                <p className="fechamento-close-error">{closeError}</p>
                            )}
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
                                    onKeyDown={(event) => {
                                        if (event.key !== 'Enter' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return

                                        event.preventDefault()
                                        handleOpenCash()
                                    }}
                                    autoFocus
                                />
                            </div>
                            <p>O valor e a data de abertura serão registrados nesta sessão.</p>
                        </div>
                        <div className="fechamento-modal-footer">
                            <button type="button" className="fechamento-secondary-button" onClick={closeOpeningModal}>
                                <span>Cancelar</span><kbd className="fechamento-cancel-keycap">ESC</kbd>
                            </button>
                            <button type="button" className="fechamento-primary-button" onClick={handleOpenCash} disabled={initialAmount === null}>
                                <span>Abrir caixa</span><kbd className="fechamento-keycap">ENTER</kbd>
                            </button>
                        </div>
                    </section>
                </div>
            )}

            {isCloseModalOpen && cashRegister && cashMovement && countedCashInCents !== null && (
                <div className="fechamento-modal-overlay" role="presentation" onMouseDown={(event) => {
                    if (event.target === event.currentTarget) closeClosingModal()
                }}>
                    <section className="fechamento-modal" role="dialog" aria-modal="true" aria-labelledby="close-modal-title">
                        <div className="fechamento-modal-header">
                            <div>
                                <span className="fechamento-modal-overline">CONFIRMAÇÃO</span>
                                <h2 id="close-modal-title">Fechar caixa?</h2>
                            </div>
                            <button type="button" className="fechamento-modal-close" onClick={closeClosingModal} disabled={isClosing} aria-label="Fechar janela">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="fechamento-modal-body">
                            <div className="fechamento-close-summary">
                                <div><span>Valor inicial</span><strong>{currency.format(cashMovement.initialAmountInCents / 100)}</strong></div>
                                <div><span>Vendas em dinheiro</span><strong>{currency.format(cashMovement.cashSalesAmountInCents / 100)}</strong></div>
                                <div><span>Valor esperado</span><strong>{currency.format(cashMovement.expectedAmountInCents / 100)}</strong></div>
                                <div><span>Valor contado</span><strong>{currency.format(countedCashInCents / 100)}</strong></div>
                                <div><span>Diferença</span><strong>{differenceInCents !== null && differenceInCents > 0 ? '+ ' : differenceInCents !== null && differenceInCents < 0 ? '- ' : ''}{currency.format(Math.abs(differenceInCents ?? 0) / 100)}</strong></div>
                            </div>
                            {closeError && <p className="fechamento-close-error">{closeError}</p>}
                        </div>
                        <div className="fechamento-modal-footer">
                            <button type="button" className="fechamento-secondary-button" onClick={closeClosingModal} disabled={isClosing}>
                                <span>Cancelar</span><kbd className="fechamento-cancel-keycap">ESC</kbd>
                            </button>
                            <button ref={confirmCloseButtonRef} type="button" className="fechamento-danger-button" onClick={handleConfirmClose} disabled={isClosing}>
                                <span>{isClosing ? 'Fechando...' : 'Confirmar fechamento'}</span><kbd className="fechamento-keycap fechamento-keycap-light">ENTER</kbd>
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    )
}
