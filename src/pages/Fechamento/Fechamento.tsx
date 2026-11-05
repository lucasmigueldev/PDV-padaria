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
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'

import type { CashRegister } from '../../types/CashRegister'
import { closeCashRegister, getOpenCashRegister, openCashRegister } from '../../services/operations'
import { getCashSalesTotalForRegister } from '../../data/sales'
import type { CashOperationReceiptData } from '../../services/thermalPrinter'
import { CashOperationReceiptDialog } from '../../components/CashOperationReceiptDialog/CashOperationReceiptDialog'
import { useBakeries } from '../../hooks/useBakeries'
import { useAuth } from '../../contexts/AuthContext'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'
import { useOfflineQueue, useOfflineQueueError } from '../../hooks/useOfflineQueue'
import { isNetworkError } from '../../services/connection'
import {
    CashRegisterOperationOutcomeUnknownError,
    getCashRegisterCloseBlockMessage,
} from '../../services/cashRegisterSafety'
import { getQueueLoadError, getQueueSnapshot } from '../../services/offlineSalesQueue'
import { logoutAndRedirect } from '../../utils/auth'
import AppTopbar from '../../components/AppTopbar/AppTopbar'
import './Fechamento.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

type UncertainCashOperation =
    | { operation: 'opening'; bakeryId: string; userId: string }
    | { operation: 'closing'; registerId: string; bakeryId: string; userId: string }

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
    const queueLoadError = useOfflineQueueError()
    const operatorUserId = authenticatedUser?.id ?? null
    const bakeryId = authenticatedUser?.role === 'cashier' ? authenticatedUser.activeBakeryId : null
    const bakeryName = bakeryId
        ? bakeries.find((bakery) => bakery.id === bakeryId)?.name ?? 'Unidade indisponível'
        : 'Unidade indisponível'
    const [cashRegister, setCashRegister] = useState<CashRegister | null>(null)
    const [isLoadingCashRegister, setIsLoadingCashRegister] = useState(true)
    const [cashLoadError, setCashLoadError] = useState('')
    const [isOpeningModalOpen, setIsOpeningModalOpen] = useState(false)
    const [isOpening, setIsOpening] = useState(false)
    const [initialAmountInput, setInitialAmountInput] = useState('')
    const [countedCashInput, setCountedCashInput] = useState('')
    const [isCloseModalOpen, setIsCloseModalOpen] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const [closeError, setCloseError] = useState('')
    const [pendingReceipt, setPendingReceipt] = useState<CashOperationReceiptData | null>(null)
    const [receiptData, setReceiptData] = useState<CashOperationReceiptData | null>(null)
    const [receiptContextMessage, setReceiptContextMessage] = useState('')
    const [uncertainCashOperation, setUncertainCashOperation] = useState<UncertainCashOperation | null>(null)
    const [isReconcilingCashRegister, setIsReconcilingCashRegister] = useState(false)
    const isOpeningRef = useRef(false)
    const isClosingRef = useRef(false)
    const isReconcilingCashRegisterRef = useRef(false)
    const confirmCloseButtonRef = useRef<HTMLButtonElement>(null)
    const countedCash = parseMoneyInput(countedCashInput)
    const closeBlockMessage = cashRegister
        ? getCashRegisterCloseBlockMessage(queue, cashRegister.id, queueLoadError)
        : null

    function getFreshCloseBlockMessage(registerId: string): string | null {
        try {
            return getCashRegisterCloseBlockMessage(
                getQueueSnapshot(),
                registerId,
                getQueueLoadError(),
            )
        } catch (error) {
            return getCashRegisterCloseBlockMessage(
                [],
                registerId,
                getQueueLoadError() ?? (error instanceof Error ? error : new Error('Falha ao carregar a fila local.')),
            )
        }
    }

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
                setCashRegister(await getOpenCashRegister(bakeryId, authenticatedUser?.id))
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
    }, [authenticatedUser?.id, bakeryId])

    const reconcileUncertainCashOperation = useCallback(async () => {
        if (!uncertainCashOperation
            || connection.status !== 'online'
            || isReconcilingCashRegisterRef.current
            || !bakeryId
            || !operatorUserId) {
            return
        }
        if (uncertainCashOperation.bakeryId !== bakeryId
            || uncertainCashOperation.userId !== operatorUserId) {
            setUncertainCashOperation(null)
            setCashRegister(null)
            setIsLoadingCashRegister(true)
            return
        }

        isReconcilingCashRegisterRef.current = true
        setIsReconcilingCashRegister(true)
        try {
            const serverRegister = await getOpenCashRegister(bakeryId, operatorUserId)
            setCashLoadError('')
            if (uncertainCashOperation.operation === 'opening') {
                setCashRegister(serverRegister)
                if (serverRegister) {
                    setIsOpeningModalOpen(false)
                    setInitialAmountInput('')
                    setCloseError('O estado do caixa foi atualizado pelo servidor. Nenhuma nova abertura foi enviada.')
                } else {
                    setCloseError('O servidor não encontrou um caixa aberto. O estado foi atualizado; você pode tentar abrir novamente.')
                }
            } else if (serverRegister?.id === uncertainCashOperation.registerId) {
                setCashRegister(serverRegister)
                setCloseError('O servidor ainda informa este caixa como aberto. O estado foi atualizado; revise antes de tentar fechar novamente.')
            } else {
                setCashRegister(serverRegister)
                setIsCloseModalOpen(false)
                setCountedCashInput('')
                setCloseError(serverRegister
                    ? 'O caixa consultado não está mais aberto. O estado atual do servidor foi carregado.'
                    : 'O servidor não informa um caixa aberto. O estado foi atualizado; confira o histórico de fechamentos.')
            }
            setUncertainCashOperation(null)
        } catch (error) {
            console.error('Não foi possível reconciliar o estado do caixa após resultado incerto.', error)
            setCloseError('O resultado da operação ainda é desconhecido. Consulte novamente o estado do caixa no servidor antes de tentar outra operação.')
        } finally {
            isReconcilingCashRegisterRef.current = false
            setIsReconcilingCashRegister(false)
        }
    }, [operatorUserId, bakeryId, connection.status, uncertainCashOperation])

    useEffect(() => {
        if (!uncertainCashOperation || connection.status !== 'online') {
            return
        }
        const timer = window.setTimeout(() => {
            void reconcileUncertainCashOperation()
        }, 0)
        return () => window.clearTimeout(timer)
    }, [connection.status, reconcileUncertainCashOperation, uncertainCashOperation])

    function handleLogout() {
        void logoutAndRedirect(navigate)
    }

    function requestOpenCash() {
        if (isLoadingCashRegister) {
            setCloseError('Aguarde a confirmação do estado atual do caixa no servidor.')
            return
        }
        if (uncertainCashOperation || isOpeningRef.current) {
            setCloseError('Consulte o estado atual do caixa no servidor antes de iniciar outra operação.')
            return
        }
        if (connection.status === 'offline') {
            setCloseError('Sem conexão. Abrir o caixa exige conexão com o sistema.')
            return
        }
        setCloseError('')
        setIsOpeningModalOpen(true)
    }

    function closeOpeningModal() {
        if (isOpeningRef.current) return
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
        if (isLoadingCashRegister) {
            setCloseError('Aguarde a confirmação do estado atual do caixa no servidor.')
            return
        }
        if (isOpeningRef.current || uncertainCashOperation) {
            setCloseError('Consulte o estado atual do caixa no servidor antes de iniciar outra operação.')
            return
        }
        if (connection.status === 'offline') {
            setCloseError('Sem conexão. Abrir o caixa exige conexão com o sistema.')
            return
        }
        const initialAmount = parseMoneyInput(initialAmountInput)
        if (initialAmount === null || cashRegister || !bakeryId) return

        setCloseError('')
        isOpeningRef.current = true
        setIsOpening(true)
        try {
            const currentRegister = await getOpenCashRegister(bakeryId, authenticatedUser?.id)
            setCashLoadError('')
            if (currentRegister) {
                setCashRegister(currentRegister)
                closeOpeningModal()
                setCloseError('Já existe um caixa aberto nesta unidade. O estado foi atualizado pelo servidor.')
                return
            }
            const register = await openCashRegister(initialAmount, authenticatedUser?.id)
            setCashRegister(register)
            closeOpeningModal()
            setReceiptContextMessage('O caixa foi aberto com sucesso. O comprovante de abertura é opcional.')
            setPendingReceipt({
                operation: 'opening',
                bakeryName,
                operatorName: authenticatedUser?.name,
                date: register.openedAt,
                registerId: register.id,
                initialAmount: register.initialAmount,
            })
        } catch (error) {
            console.error('Erro ao abrir o caixa.', error)
            if (error instanceof CashRegisterOperationOutcomeUnknownError
                && bakeryId
                && authenticatedUser?.id) {
                setUncertainCashOperation({
                    operation: 'opening',
                    bakeryId,
                    userId: authenticatedUser.id,
                })
            }
            setCloseError(getCashOperationErrorMessage(
                error,
                'Não foi possível confirmar se o caixa foi aberto. Atualize o status do caixa antes de tentar novamente.',
                'A conexão foi interrompida durante a abertura do caixa. Atualize o status antes de tentar novamente.',
            ))
        } finally {
            isOpeningRef.current = false
            setIsOpening(false)
        }
    }

    function handleRequestClose() {
        if (uncertainCashOperation) {
            setCloseError('Consulte o estado atual do caixa no servidor antes de iniciar outra operação.')
            return
        }
        if (connection.status === 'offline') {
            setCloseError('Sem conexão. Fechar o caixa exige conexão com o sistema.')
            return
        }
        const blockedBySales = cashRegister ? getFreshCloseBlockMessage(cashRegister.id) : null
        if (blockedBySales) {
            setCloseError(blockedBySales)
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
        if (uncertainCashOperation) {
            setCloseError('Consulte o estado atual do caixa no servidor antes de iniciar outra operação.')
            return
        }
        if (connection.status === 'offline') {
            setCloseError('Sem conexão. Fechar o caixa exige conexão com o sistema.')
            return
        }
        if (isClosingRef.current || !cashRegister) return
        const initialSalesBlock = getFreshCloseBlockMessage(cashRegister.id)
        if (initialSalesBlock) {
            setCloseError(initialSalesBlock)
            return
        }

        const countedAmountRaw = parseMoneyInput(countedCashInput)
        if (countedAmountRaw === null) {
            setCloseError('Informe um valor contado válido antes de fechar o caixa.')
            return
        }
        const countedAmount: number = countedAmountRaw

        if (!bakeryId) {
            setCloseError('O caixa aberto não está mais disponível para fechamento.')
            return
        }

        isClosingRef.current = true
        setIsClosing(true)
        setCloseError('')

        const registerId = cashRegister.id
        const initialAmount = cashRegister.initialAmount

        try {
            const currentCashRegister = await getOpenCashRegister(bakeryId, authenticatedUser?.id)
            if (!currentCashRegister || currentCashRegister.id !== cashRegister.id) {
                setCloseError('O caixa aberto não está mais disponível para fechamento.')
                return
            }
            const latestSalesBlock = getFreshCloseBlockMessage(currentCashRegister.id)
            if (latestSalesBlock) {
                setCloseError(latestSalesBlock)
                return
            }
            const closureId = await closeCashRegister(
                currentCashRegister.id,
                countedAmount,
                bakeryId,
                authenticatedUser?.id,
            )
            setCashRegister(null)
            setCountedCashInput('')
            setIsCloseModalOpen(false)

            let cashSalesAmount: number
            try {
                cashSalesAmount = await getCashSalesTotalForRegister(registerId)
            } catch (receiptError) {
                console.error('O caixa foi fechado, mas não foi possível carregar os valores para o comprovante.', receiptError)
                setCloseError('O fechamento foi confirmado pelo servidor, mas não foi possível carregar os valores do comprovante.')
                return
            }
            const expectedAmount = initialAmount + cashSalesAmount
            setReceiptContextMessage('O caixa foi fechado com sucesso. O comprovante de fechamento é opcional.')
            setPendingReceipt({
                operation: 'closing',
                bakeryName,
                operatorName: authenticatedUser?.name,
                date: new Date().toISOString(),
                registerId,
                initialAmount,
                cashSalesAmount,
                expectedAmount,
                countedAmount,
                differenceAmount: countedAmount - expectedAmount,
                ...(closureId ? { closureId } : {}),
            })
        } catch (error) {
            console.error('Erro ao fechar o caixa.', error)
            if (error instanceof CashRegisterOperationOutcomeUnknownError
                && bakeryId
                && authenticatedUser?.id) {
                setUncertainCashOperation({
                    operation: 'closing',
                    registerId: cashRegister.id,
                    bakeryId,
                    userId: authenticatedUser.id,
                })
            }
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
            if (isOpeningModalOpen && !isOpening) {
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
    }, [isOpening, isOpeningModalOpen, isCloseModalOpen, isClosing])

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
                    <Link to="/pdv" className="fechamento-shortcut">
                        <ShoppingCart size={19} /><span>Voltar ao PDV</span><kbd>F4</kbd>
                    </Link>
                    <span className="fechamento-sidebar-label">Operação</span>
                    <Link to="/produtos" className="fechamento-shortcut">
                        <Package size={19} /><span>Produtos</span><kbd>F2</kbd>
                    </Link>
                    <Link to="/fechamento" className="fechamento-shortcut active" aria-current="page">
                        <Receipt size={19} /><span>Fechamento</span><kbd>F3</kbd>
                    </Link>
                    <Link to="/historico-vendas" className="fechamento-shortcut">
                        <History size={19} /><span>Histórico de Vendas</span>
                        <kbd>F6</kbd>
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
                    {uncertainCashOperation && (
                        <div className="fechamento-close-error" role="alert">
                            <p>O resultado da operação do caixa precisa ser consultado no servidor antes de qualquer nova tentativa.</p>
                            <button
                                type="button"
                                className="fechamento-secondary-button"
                                onClick={() => void reconcileUncertainCashOperation()}
                                disabled={connection.status === 'offline' || isReconcilingCashRegister}
                            >
                                <span>{isReconcilingCashRegister ? 'Consultando...' : 'Consultar estado do caixa'}</span>
                            </button>
                        </div>
                    )}
                    {pendingReceipt && (
                        <section className="fechamento-receipt-offer" role="group" aria-label="Comprovante da operação de caixa">
                            <div>
                                <strong style={{ marginBottom: '8px' }}>{receiptContextMessage}</strong>
                                {pendingReceipt.contactValue && (
                                    <p>Valor contato: {currency.format(pendingReceipt.contactValue)}</p>
                                )}
                                {/* Message removed: <p>Deseja imprimir o comprovante de {pendingReceipt.operation === 'closing' ? 'fechamento' : 'abertura'}?</p> */}
                            </div>
                            <div className="fechamento-receipt-offer-actions">
                                <button
                                    type="button"
                                    className="fechamento-secondary-button"
                                    onClick={() => setPendingReceipt(null)}
                                >
                                    <span>Não imprimir</span>
                                </button>
                                <button
                                    type="button"
                                    className="fechamento-primary-button"
                                    onClick={() => {
                                        setReceiptData(pendingReceipt)
                                        setPendingReceipt(null)
                                    }}
                                >
                                    <span>Imprimir comprovante</span>
                                </button>
                            </div>
                        </section>
                    )}
                    {receiptData && (
                        <CashOperationReceiptDialog
                            data={receiptData}
                            onClose={() => setReceiptData(null)}
                        />
                    )}
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
                                    <div className="fechamento-cash-movement-row total"><span>Conferência</span><strong>Calculada automaticamente pelo sistema</strong></div>
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
                            {closeBlockMessage && (
                                <p className="fechamento-close-error" role="alert">{closeBlockMessage}</p>
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
                            <button type="button" className="fechamento-modal-close" onClick={closeOpeningModal} disabled={isOpening} aria-label="Fechar janela">
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
                                        if (isOpening || uncertainCashOperation) return

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
                            <button type="button" className="fechamento-secondary-button" onClick={closeOpeningModal} disabled={isOpening}>
                                <span>Cancelar</span><kbd className="fechamento-cancel-keycap">ESC</kbd>
                            </button>
                            <button
                                type="button"
                                className="fechamento-primary-button"
                                onClick={handleOpenCash}
                                disabled={initialAmount === null || isOpening || Boolean(uncertainCashOperation)}
                            >
                                <span>{isOpening ? 'Abrindo...' : 'Abrir caixa'}</span><kbd className="fechamento-keycap">ENTER</kbd>
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
                                <div><span>Conferência</span><strong>Calculada automaticamente pelo sistema</strong></div>
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
