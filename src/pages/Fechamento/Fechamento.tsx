import {
    BarChart3,
    Banknote,
    History,
    LayoutDashboard,
    Package,
    Receipt,
    Settings,
    ShoppingCart,
    X,
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'

import type { CashRegister } from '../../types/CashRegister'
import { closeCashRegister, getOpenCashRegister, openCashRegister } from '../../services/operations'
import { useBakeries } from '../../hooks/useBakeries'
import { useAuth } from '../../contexts/AuthContext'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'
import { useOfflineQueue } from '../../hooks/useOfflineQueue'
import { isNetworkError } from '../../services/connection'
import { logoutAndRedirect } from '../../utils/auth'
import AppTopbar from '../../components/AppTopbar/AppTopbar'
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

function getCashOperationErrorMessage(error: unknown, fallback: string, connectionMessage: string): string {
    if (error instanceof TypeError) return connectionMessage
    if (isNetworkError(error)) return connectionMessage
    if (!(error instanceof Error)) return fallback

    const containsTechnicalDetails = /(supabase|rpc|postgres|pgrst|jwt|\.env)/i.test(error.message)
        || /\b[0-9A-Z]{5}\b/.test(error.message)
    return containsTechnicalDetails ? fallback : error.message
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
    const { authenticatedUser } = useAuth()
    const isOwner = authenticatedUser?.role === 'owner'
    const { bakeries } = useBakeries()
    const connection = useConnectionStatus()
    const queue = useOfflineQueue()
    const pendingCount = queue.filter((sale) => sale.status === 'pending').length
    const bakeryId = authenticatedUser?.role === 'cashier' ? authenticatedUser.activeBakeryId : null
    const bakeryName = bakeryId
        ? bakeries.find((bakery) => bakery.id === bakeryId)?.name ?? 'Unidade indisponível'
        : 'Unidade indisponível'
    const [cashRegister, setCashRegister] = useState<CashRegister | null>(null)
    const [isLoadingCashRegister, setIsLoadingCashRegister] = useState(true)
    const [cashLoadError, setCashLoadError] = useState('')
    const [isOpeningModalOpen, setIsOpeningModalOpen] = useState(false)
    const [initialAmountInput, setInitialAmountInput] = useState('')
    const [countedCashInput, setCountedCashInput] = useState('')
    const [isCloseModalOpen, setIsCloseModalOpen] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const [closeError, setCloseError] = useState('')
    const isClosingRef = useRef(false)
    const confirmCloseButtonRef = useRef<HTMLButtonElement>(null)
    const countedCash = parseMoneyInput(countedCashInput)

    useEffect(() => {
        let isActive = true
        void (async () => {
            await Promise.resolve()
            if (!isActive) return
            setIsLoadingCashRegister(true)
            setCashLoadError('')
            if (!bakeryId) {
                setCashRegister(null)
                setIsLoadingCashRegister(false)
                return
            }
            try {
                setCashRegister(await getOpenCashRegister(bakeryId))
            } catch (error: unknown) {
                if (!isActive) return
                console.error('Erro ao carregar o caixa aberto.', error)
                setCashLoadError(error instanceof Error ? error.message : 'Não foi possível carregar o caixa.')
            } finally {
                if (isActive) setIsLoadingCashRegister(false)
            }
        })()

        return () => {
            isActive = false
        }
    }, [bakeryId])

    function handleLogout() {
        void logoutAndRedirect(navigate)
    }

    function requestOpenCash() {
        if (connection.status === 'offline') {
            setCloseError('Sem conexão. Abrir o caixa exige conexão com o sistema.')
            return
        }
        setCloseError('')
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

    async function handleOpenCash() {
        if (connection.status === 'offline') {
            setCloseError('Sem conexão. Abrir o caixa exige conexão com o sistema.')
            return
        }
        const initialAmount = parseMoneyInput(initialAmountInput)
        if (initialAmount === null || cashRegister || !bakeryId) return

        setCloseError('')
        try {
            const register = await openCashRegister(initialAmount)
            setCashRegister(register)
            closeOpeningModal()
        } catch (error) {
            console.error('Erro ao abrir o caixa.', error)
            setCloseError(getCashOperationErrorMessage(
                error,
                'Não foi possível confirmar se o caixa foi aberto. Atualize o status do caixa antes de tentar novamente.',
                'A conexão foi interrompida durante a abertura do caixa. Atualize o status antes de tentar novamente.',
            ))
        }
    }

    function handleRequestClose() {
        if (connection.status === 'offline') {
            setCloseError('Sem conexão. Fechar o caixa exige conexão com o sistema.')
            return
        }
        if (pendingCount > 0) {
            setCloseError(`Há ${pendingCount} venda(s) aguardando sincronização. Sincronize antes de fechar o caixa.`)
            return
        }

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

    async function handleConfirmClose() {
        if (connection.status === 'offline') {
            setCloseError('Sem conexão. Fechar o caixa exige conexão com o sistema.')
            return
        }
        if (pendingCount > 0) {
            setCloseError(`Há ${pendingCount} venda(s) aguardando sincronização. Sincronize antes de fechar o caixa.`)
            return
        }
        if (isClosingRef.current || !cashRegister) return

        const countedAmount = parseMoneyInput(countedCashInput)
        if (countedAmount === null) {
            setCloseError('Informe um valor contado válido antes de fechar o caixa.')
            return
        }

        if (!bakeryId) {
            setCloseError('O caixa aberto não está mais disponível para fechamento.')
            return
        }

        isClosingRef.current = true
        setIsClosing(true)
        setCloseError('')

        try {
            const currentCashRegister = await getOpenCashRegister(bakeryId)
            if (!currentCashRegister || currentCashRegister.id !== cashRegister.id) {
                setCloseError('O caixa aberto não está mais disponível para fechamento.')
                return
            }
            await closeCashRegister(currentCashRegister.id, countedAmount)
            setCashRegister(null)
            setCountedCashInput('')
            setIsCloseModalOpen(false)
        } catch (error) {
            console.error('Erro ao fechar o caixa.', error)
            setCloseError(getCashOperationErrorMessage(
                error,
                'Não foi possível confirmar se o caixa foi fechado. Atualize o histórico antes de tentar novamente.',
                'A conexão foi interrompida durante o fechamento. Consulte o histórico antes de tentar novamente.',
            ))
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
            <AppTopbar
                userName={authenticatedUser?.name}
                bakeryName={bakeryName}
                userRole="Operador"
                onLogout={handleLogout}
            />

            <aside className="fechamento-sidebar">
                <div className="fechamento-brand">
                    <div className="fechamento-logo-icon"><ShoppingCart size={22} /></div>
                    <div><strong>PDV360</strong><span>Sistema de vendas</span></div>
                </div>

                {!isOwner && <nav className="fechamento-shortcuts" aria-label="Atalhos operacionais">
                    <span className="fechamento-sidebar-label">Operação</span>
                    <Link to="/produtos" className="fechamento-shortcut">
                        <Package size={19} /><span>Produtos</span><kbd>F2</kbd>
                    </Link>
                    <Link to="/fechamento" className="fechamento-shortcut active" aria-current="page">
                        <Receipt size={19} /><span>Fechamento</span><kbd>F3</kbd>
                    </Link>
                    <Link to="/historico-vendas" className="fechamento-shortcut">
                        <History size={19} /><span>Histórico de Vendas</span>
                    </Link>
                    <Link to="/pdv" className="fechamento-shortcut">
                        <ShoppingCart size={19} /><span>Voltar ao PDV</span><kbd>F4</kbd>
                    </Link>
                </nav>}

                {isOwner && <nav className="fechamento-shortcuts" aria-label="Navegação administrativa">
                    <span className="fechamento-sidebar-label">Administração</span>
                    <Link to="/dashboard" className="fechamento-shortcut"><LayoutDashboard size={19} /><span>Painel</span></Link>
                    <Link to="/historico-fechamentos" className="fechamento-shortcut"><History size={19} /><span>Histórico de Fechamentos</span></Link>
                    <Link to="/relatorios" className="fechamento-shortcut"><BarChart3 size={19} /><span>Relatórios</span></Link>
                </nav>}

                {isOwner && <div className="fechamento-sidebar-bottom">
                    <Link to="/configuracoes" className="fechamento-shortcut"><Settings size={19} /><span>Configurações</span></Link>
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
                    {cashLoadError && <p className="fechamento-close-error" role="alert">{cashLoadError}</p>}
                    {closeError && !isOpeningModalOpen && !isCloseModalOpen && <p className="fechamento-close-error" role="alert">{closeError}</p>}
                    {isLoadingCashRegister ? (
                        <p role="status">Carregando o caixa...</p>
                    ) : !cashRegister ? (
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
                                    <div><span>Valor inicial</span><strong>{currency.format(cashRegister.initialAmount)}</strong></div>
                                </div>
                            </div>
                            <div className="fechamento-open-workspace">
                                <section className="fechamento-cash-movement">
                                    <h3>Movimentação em dinheiro</h3>
                                    <div className="fechamento-cash-movement-row"><span>Valor inicial</span><strong>{currency.format(cashRegister.initialAmount)}</strong></div>
                                    <div className="fechamento-cash-movement-row total"><span>Conferência</span><strong>Calculada pelo servidor no fechamento</strong></div>
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
                                    <div className="fechamento-difference pending">
                                        <span className="fechamento-difference-label">Conferência</span>
                                        <p>O valor esperado e a diferença serão calculados pelo servidor ao fechar.</p>
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
                            {closeError && <p className="fechamento-close-error" role="alert">{closeError}</p>}
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

            {isCloseModalOpen && cashRegister && countedCash !== null && (
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
                                <div><span>Valor inicial</span><strong>{currency.format(cashRegister.initialAmount)}</strong></div>
                                <div><span>Valor contado</span><strong>{currency.format(countedCash)}</strong></div>
                                <div><span>Conferência</span><strong>Calculada pelo servidor no fechamento</strong></div>
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
