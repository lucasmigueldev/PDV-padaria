import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
    Banknote,
    CircleAlert,
    CircleCheck,
    CreditCard,
    History,
    Minus,
    Package,
    Plus,
    Printer,
    QrCode,
    Receipt,
    ShoppingCart,
    Trash2,
    X,
} from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'

import { getProductsFromSupabase } from '../../data/products'
import { createSaleWithItems, getOpenCashRegister } from '../../services/operations'
import { useBakeries } from '../../hooks/useBakeries'
import { useAuth } from '../../contexts/AuthContext'
import { useBluetoothPrinter } from '../../hooks/useBluetoothPrinter'
import type { ProductWithStock, SaleItem } from '../../types/Product'
import type { PaymentMethod, Sale } from '../../types/Sale'
import type { ReceiptData } from '../../services/thermalPrinter'
import { logoutAndRedirect } from '../../utils/auth'
import AppTopbar from '../../components/AppTopbar/AppTopbar'
import './PDV.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

const moneyInputPattern = /^\d*(?:[,.]\d{0,2})?$/

function getOperationalErrorMessage(error: unknown, fallback: string, connectionMessage: string): string {
    if (error instanceof TypeError) return connectionMessage

    if (error instanceof Error) {
        const containsTechnicalDetails = /(supabase|rpc|postgres|pgrst|jwt|\.env)/i.test(error.message)
            || /\b[0-9A-Z]{5}\b/.test(error.message)
        if (!containsTechnicalDetails) return error.message
    }

    return fallback
}

function parseMoneyToCents(value: string): number | null {
    if (!value || !moneyInputPattern.test(value)) return null

    const normalizedValue = value.replace(',', '.')
    const [wholePart, decimalPart = ''] = normalizedValue.split('.')

    if (!wholePart && !decimalPart) return null

    const cents = Number(wholePart || '0') * 100 + Number(decimalPart.padEnd(2, '0'))

    return Number.isSafeInteger(cents) ? cents : null
}

function saleToReceiptData(sale: Sale, bakeryName: string): ReceiptData {
    return {
        bakeryName,
        saleId: sale.id,
        date: sale.date,
        items: sale.items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
        })),
        total: sale.total,
        paymentMethod: sale.paymentMethod,
        receivedAmount: sale.receivedAmount,
        change: sale.change,
    }
}

export default function PDV() {
    const navigate = useNavigate()
    const { authenticatedUser } = useAuth()
    const { bakeries } = useBakeries()
    const bluetooth = useBluetoothPrinter()
    const bakeryId = authenticatedUser?.role === 'cashier' ? authenticatedUser.bakeryId : null
    const receiptBakeryName = bakeryId
        ? bakeries.find((bakery) => bakery.id === bakeryId)?.name ?? null
        : null
    const bakeryName = receiptBakeryName ?? 'Unidade indisponível'
    const barcodeInputRef = useRef<HTMLInputElement>(null)
    const finishButtonRef = useRef<HTMLButtonElement>(null)
    const [barcode, setBarcode] = useState('')
    const [productQuantity, setProductQuantity] = useState('1')
    const [items, setItems] = useState<SaleItem[]>([])
    const [errorMessage, setErrorMessage] = useState('')
    const [saleFeedback, setSaleFeedback] = useState('')
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
    const [checkoutStep, setCheckoutStep] = useState<'payment' | 'completed'>('payment')
    const [completedSale, setCompletedSale] = useState<Sale | null>(null)
    const [modalPrintFeedback, setModalPrintFeedback] = useState<{ isError: boolean; message: string } | null>(null)
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
    const [receivedValue, setReceivedValue] = useState('')
    const [checkoutMessage, setCheckoutMessage] = useState('')
    const [isRegisteringSale, setIsRegisteringSale] = useState(false)
    const [products, setProducts] = useState<ProductWithStock[]>([])
    const [cashRegister, setCashRegister] = useState<Awaited<ReturnType<typeof getOpenCashRegister>>>(null)
    const [isLoadingOperationalData, setIsLoadingOperationalData] = useState(true)
    const closeCheckoutButtonRef = useRef<HTMLButtonElement>(null)
    const receivedValueInputRef = useRef<HTMLInputElement>(null)
    const isRegisteringSaleRef = useRef(false)
    const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null)

    useEffect(() => {
        let active = true
        void (async () => {
            await Promise.resolve()
            if (!active) return
            if (!bakeryId) {
                setProducts([])
                setCashRegister(null)
                setIsLoadingOperationalData(false)
                return
            }
            setIsLoadingOperationalData(true)
            try {
                const [catalog, register] = await Promise.all([
                    getProductsFromSupabase(bakeryId),
                    getOpenCashRegister(bakeryId),
                ])
                if (!active) return
                setProducts(catalog)
                setCashRegister(register)
            } catch (error: unknown) {
                if (!active) return
                console.error('Erro ao carregar os dados operacionais do PDV.', error)
                setErrorMessage(getOperationalErrorMessage(
                    error,
                    'Não foi possível carregar os dados do PDV. Atualize a tela e tente novamente.',
                    'Não foi possível carregar os dados do PDV. Verifique a conexão e tente novamente.',
                ))
            } finally {
                if (active) setIsLoadingOperationalData(false)
            }
        })()

        return () => {
            active = false
        }
    }, [bakeryId])

    useEffect(() => {
        barcodeInputRef.current?.focus()
    }, [])

    useEffect(() => {
        if (!isCheckoutOpen) return

        closeCheckoutButtonRef.current?.focus()

        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') closeCheckout()
        }

        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [isCheckoutOpen])

    useEffect(() => {
        function handleFinishShortcut(event: KeyboardEvent) {
            if (event.key !== 'F5') return

            event.preventDefault()
            if (!isCheckoutOpen) finishButtonRef.current?.click()
        }

        document.addEventListener('keydown', handleFinishShortcut)
        return () => document.removeEventListener('keydown', handleFinishShortcut)
    }, [isCheckoutOpen])

    useEffect(() => {
        if (isCheckoutOpen && paymentMethod === 'cash') {
            receivedValueInputRef.current?.focus()
        }
    }, [isCheckoutOpen, paymentMethod])

    function handleLogout() {
        void logoutAndRedirect(navigate)
    }

    function addProduct(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setErrorMessage('')
        setSaleFeedback('')
        const normalizedBarcode = barcode.trim()
        const requestedQuantity = Number(productQuantity)
        const product = products.find((item) => item.barcode.trim() === normalizedBarcode)

        if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1) {
            setErrorMessage('Informe uma quantidade válida.')
            barcodeInputRef.current?.focus()
            return
        }

        if (!product) {
            setErrorMessage('Produto não encontrado.')
            barcodeInputRef.current?.focus()
            return
        }

        if (product.stock <= 0) {
            setErrorMessage('Produto sem estoque.')
            barcodeInputRef.current?.focus()
            return
        }

        const existingItem = items.find((item) => item.barcode === product.barcode)

        if (existingItem && existingItem.quantity + requestedQuantity > product.stock) {
            setErrorMessage('Limite de estoque atingido.')
            barcodeInputRef.current?.focus()
            return
        }

        if (!existingItem && requestedQuantity > product.stock) {
            setErrorMessage('Limite de estoque atingido.')
            barcodeInputRef.current?.focus()
            return
        }

        setItems((currentItems) => {
            const currentItem = currentItems.find((item) => item.barcode === product.barcode)

            if (currentItem) {
                return currentItems.map((item) =>
                    item.barcode === product.barcode
                        ? { ...item, quantity: Math.min(item.quantity + requestedQuantity, product.stock) }
                        : item,
                )
            }

            return [...currentItems, { ...product, quantity: requestedQuantity }]
        })
        setBarcode('')
        setProductQuantity('1')
        barcodeInputRef.current?.focus()
    }

    function updateQuantity(id: string, amount: number) {
        const currentItem = items.find((item) => item.id === id)
        const catalogProduct = products.find((product) => product.id === id)
        const stock = catalogProduct?.stock ?? currentItem?.stock ?? 0

        if (amount > 0 && currentItem && currentItem.quantity >= stock) {
            setErrorMessage('Limite de estoque atingido.')
            barcodeInputRef.current?.focus()
            return
        }

        setItems((currentItems) => currentItems.map((item) => {
            if (item.id !== id) return item

            const nextQuantity = amount > 0
                ? Math.min(item.quantity + amount, stock)
                : Math.max(1, item.quantity + amount)

            return { ...item, quantity: nextQuantity }
        }))
        barcodeInputRef.current?.focus()
    }

    function removeProduct(id: string) {
        setItems((currentItems) => currentItems.filter((item) => item.id !== id))
    }

    function openCheckout() {
        if (items.length === 0) return
        if (!cashRegister) return

        setPaymentMethod(null)
        setReceivedValue('')
        setCheckoutMessage('')
        setCheckoutStep('payment')
        setCompletedSale(null)
        setModalPrintFeedback(null)
        setIsCheckoutOpen(true)
    }

    function closeCheckout() {
        setIsCheckoutOpen(false)
        setPaymentMethod(null)
        setReceivedValue('')
        setCheckoutMessage('')
        setCheckoutStep('payment')
        setCompletedSale(null)
        setModalPrintFeedback(null)
        barcodeInputRef.current?.focus()
    }

    function selectPaymentMethod(method: PaymentMethod) {
        setPaymentMethod(method)
        setReceivedValue('')
        setCheckoutMessage('')
    }

    const totalItems = items.reduce((total, item) => total + item.quantity, 0)
    const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0)
    const isCashRegisterOpen = cashRegister !== null
    const totalInCents = Math.round(total * 100)
    const receivedInCents = parseMoneyToCents(receivedValue)
    const isCashPaymentValid = paymentMethod === 'cash'
        && receivedInCents !== null
        && receivedInCents >= totalInCents
    const cashValidationMessage = paymentMethod !== 'cash' || !receivedValue
        ? ''
        : receivedInCents === null
            ? 'Informe um valor válido.'
            : receivedInCents < totalInCents
                ? `Valor insuficiente. Falta ${currency.format((totalInCents - receivedInCents) / 100)}.`
                : `Troco: ${currency.format((receivedInCents - totalInCents) / 100)}`

    async function continueCheckout() {
        if (isRegisteringSaleRef.current) return

        if (items.length === 0) {
            setCheckoutMessage('Adicione pelo menos um produto para concluir a venda.')
            return
        }

        if (!paymentMethod) {
            setCheckoutMessage('Selecione uma forma de pagamento para continuar.')
            return
        }

        if (paymentMethod === 'cash' && !isCashPaymentValid) return

        if (!bakeryId) {
            closeCheckout()
            setCheckoutMessage('Abra o caixa para finalizar a venda.')
            return
        }

        if (!authenticatedUser || authenticatedUser.role !== 'cashier' || !authenticatedUser.bakeryId?.trim()) {
            setCheckoutMessage('Não foi possível identificar a unidade do operador.')
            return
        }

        let currentRegister
        try {
            currentRegister = await getOpenCashRegister(authenticatedUser.bakeryId)
        } catch (error) {
            setCheckoutMessage(getOperationalErrorMessage(
                error,
                'Não foi possível verificar se há um caixa aberto. Atualize a tela e tente novamente.',
                'Não foi possível verificar o caixa aberto. Verifique a conexão e tente novamente.',
            ))
            return
        }
        if (!currentRegister) {
            setCashRegister(null)
            setCheckoutMessage('Abra o caixa para finalizar a venda.')
            return
        }

        const receivedAmount = paymentMethod === 'cash' && receivedInCents !== null
            ? receivedInCents / 100
            : null
        const changeAmount = paymentMethod === 'cash' && receivedInCents !== null
            ? (receivedInCents - totalInCents) / 100
            : null
        const fingerprint = JSON.stringify({
            cashRegisterId: currentRegister.id,
            paymentMethod,
            receivedAmount,
            changeAmount,
            items: items.map(({ id, quantity }) => ({ product_id: id, quantity })),
        })
        if (idempotencyRef.current?.fingerprint !== fingerprint) {
            idempotencyRef.current = { fingerprint, key: crypto.randomUUID() }
        }

        isRegisteringSaleRef.current = true
        setIsRegisteringSale(true)

        try {
            const registeredAt = new Date().toISOString()
            const saleId = await createSaleWithItems({
                cashRegisterId: currentRegister.id,
                paymentMethod,
                receivedAmount,
                changeAmount,
                items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
                idempotencyKey: idempotencyRef.current.key,
            })
            idempotencyRef.current = null
            const confirmedSale: Sale = {
                id: saleId,
                date: registeredAt,
                items: items.map((item) => ({
                    productId: item.id,
                    name: item.name,
                    barcode: item.barcode,
                    price: item.price,
                    quantity: item.quantity,
                    subtotal: item.quantity * item.price,
                })),
                total,
                paymentMethod,
                bakeryId: authenticatedUser.bakeryId,
                ...(receivedAmount !== null ? { receivedAmount } : {}),
                ...(changeAmount !== null ? { change: changeAmount } : {}),
            }
            setItems([])
            setCompletedSale(confirmedSale)
            setCheckoutStep('completed')
            setModalPrintFeedback(null)
            setSaleFeedback('Venda concluída com sucesso.')

            try {
                setProducts(await getProductsFromSupabase(authenticatedUser.bakeryId))
            } catch (error) {
                console.error('Venda registrada, mas a atualização do estoque exibido falhou.', error)
                setErrorMessage('Venda concluída. O estoque mostrado na tela pode estar desatualizado. Atualize o PDV antes da próxima venda.')
            }
        } catch (error) {
            setCheckoutMessage(getOperationalErrorMessage(
                error,
                'Não foi possível confirmar se a venda foi registrada. Consulte o histórico de vendas antes de tentar novamente, para evitar duplicidade.',
                'Não foi possível confirmar se a venda foi registrada. Verifique a conexão e consulte o histórico antes de tentar novamente, para evitar duplicidade.',
            ))
        } finally {
            isRegisteringSaleRef.current = false
            setIsRegisteringSale(false)
        }
    }

    async function handlePrintFromModal() {
        if (!completedSale) return
        const bakery = receiptBakeryName ?? bakeryName

        try {
            setModalPrintFeedback({ isError: false, message: 'Enviando cupom para a impressora...' })
            if (bluetooth.status !== 'connected') {
                await bluetooth.connect()
            }
            await bluetooth.print(saleToReceiptData(completedSale, bakery))
            setModalPrintFeedback({ isError: false, message: '✓ Cupom impresso com sucesso!' })
        } catch (error) {
            console.error('Erro ao imprimir via Bluetooth:', error)
            setModalPrintFeedback({
                isError: true,
                message: 'Não foi possível concluir a impressão. Verifique a conexão com a impressora e tente novamente.',
            })
        }
    }


    return (
        <div className="pdv-layout">
            <AppTopbar
                userName={authenticatedUser?.name}
                bakeryName={bakeryName}
                userRole="Operador"
                onLogout={handleLogout}
                showPrinter
            />

            <aside className="pdv-sidebar">
                <div className="pdv-brand">
                    <div className="pdv-logo-icon">
                        <ShoppingCart size={22} />
                    </div>
                    <div>
                        <strong>Padaria PDV</strong>
                        <span>Sistema de vendas</span>
                    </div>
                </div>

                <form className="pdv-add-product" onSubmit={addProduct}>
                    <label htmlFor="barcode">Código do produto</label>
                    <input
                        ref={barcodeInputRef}
                        id="barcode"
                        value={barcode}
                        onChange={(event) => setBarcode(event.target.value)}
                        placeholder="Digite ou bip o código"
                        autoComplete="off"
                    />
                    <button type="submit" className="pdv-primary-button" disabled={isLoadingOperationalData}>
                        <Plus size={18} />
                        Adicionar produto
                    </button>
                    {errorMessage && <p className="pdv-error-message" role="alert">{errorMessage}</p>}
                </form>

                <nav className="pdv-shortcuts" aria-label="Atalhos operacionais">
                    <span className="pdv-sidebar-label">Operação</span>
                    <Link to="/produtos" className="pdv-shortcut">
                        <Package size={19} />
                        <span>Produtos</span>
                        <kbd>F2</kbd>
                    </Link>
                    <Link to="/fechamento" className="pdv-shortcut">
                        <Receipt size={19} />
                        <span>Fechamento</span>
                        <kbd>F3</kbd>
                    </Link>
                    <Link to="/historico-vendas" className="pdv-shortcut">
                        <History size={19} />
                        <span>Histórico de Vendas</span>
                        <kbd>F6</kbd>
                    </Link>
                    <Link to="/pdv" className="pdv-shortcut active" aria-current="page">
                        <ShoppingCart size={19} />
                        <span>Voltar ao PDV</span>
                        <kbd>F4</kbd>
                    </Link>
                </nav>

            </aside>

            <main className="pdv-main">
                <section className="pdv-content">
                    {saleFeedback && (
                        <p className="pdv-success-message" role="status">{saleFeedback}</p>
                    )}


                    <div className="pdv-sale-grid">
                        <section className="pdv-sale-panel">
                            <div className="pdv-section-heading">
                                <div>
                                    <h1>Venda atual</h1>
                                    <p>{totalItems === 1 ? '1 item adicionado' : `${totalItems} itens adicionados`}</p>
                                </div>
                            </div>

                            {items.length === 0 ? (
                                <div className="pdv-empty-state">
                                    <ShoppingCart size={28} />
                                    <strong>Nenhum produto adicionado</strong>
                                    <span>Informe um código de barras acima para começar a venda.</span>
                                </div>
                            ) : (
                                <div className="pdv-table-wrapper">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Código</th>
                                                <th>Nome</th>
                                                <th>Quantidade</th>
                                                <th>Valor (un.)</th>
                                                <th>Valor</th>
                                                <th><span className="sr-only">Ação</span></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((item) => (
                                                <tr key={item.id}>
                                                    <td>{item.barcode}</td>
                                                    <td className="pdv-product-name">{item.name}</td>
                                                    <td>
                                                        <div className="pdv-quantity-controls">
                                                            <button
                                                                type="button"
                                                                className="pdv-quantity-button"
                                                                onClick={() => updateQuantity(item.id, -1)}
                                                                aria-label={`Diminuir quantidade de ${item.name}`}
                                                                title="Diminuir quantidade"
                                                            >
                                                                <Minus size={14} />
                                                            </button>
                                                            <span>{item.quantity}</span>
                                                            <button
                                                                type="button"
                                                                className="pdv-quantity-button"
                                                                onClick={() => updateQuantity(item.id, 1)}
                                                                disabled={item.quantity >= item.stock}
                                                                aria-label={`Aumentar quantidade de ${item.name}`}
                                                                title="Aumentar quantidade"
                                                            >
                                                                <Plus size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td>{currency.format(item.price)}</td>
                                                    <td>{currency.format(item.quantity * item.price)}</td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="pdv-remove-button"
                                                            onClick={() => removeProduct(item.id)}
                                                            aria-label={`Remover ${item.name}`}
                                                            title="Remover item"
                                                        >
                                                            <Trash2 size={17} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        <aside className="pdv-summary">
                            <div className={`pdv-cash-status${isCashRegisterOpen ? ' is-open' : ' is-closed'}`} role="status">
                                {isCashRegisterOpen
                                    ? <CircleCheck size={20} aria-hidden="true" />
                                    : <CircleAlert size={20} aria-hidden="true" />}
                                <div>
                                    <strong>Caixa {isCashRegisterOpen ? 'aberto' : 'fechado'}</strong>
                                    {!isCashRegisterOpen && <span className="pdv-cash-register-message">Abra o caixa para finalizar a venda.</span>}
                                </div>
                            </div>
                            <div className="pdv-section-heading pdv-summary-heading">
                                <div>
                                    <h2>Resumo da venda</h2>
                                    <p>Confira os valores antes de finalizar.</p>
                                </div>
                            </div>
                            <div className="pdv-summary-lines">
                                <div><span>Quantidade total de itens</span><strong>{totalItems}</strong></div>
                                <div><span>Subtotal</span><strong>{currency.format(total)}</strong></div>
                            </div>
                            <div className="pdv-total"><span>Total da venda</span><strong>{currency.format(total)}</strong></div>
                            <button
                                ref={finishButtonRef}
                                type="button"
                                className="pdv-finish-button"
                                disabled={isLoadingOperationalData || isRegisteringSale || items.length === 0 || !isCashRegisterOpen}
                                onClick={openCheckout}
                            >
                                <span>FINALIZAR VENDA</span>
                                <kbd>F5</kbd>
                            </button>
                        </aside>
                    </div>
                </section>
            </main>

            {isCheckoutOpen && (
                <div className="pdv-checkout-overlay" onClick={closeCheckout}>
                    <div
                        className="pdv-checkout-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="pdv-checkout-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="pdv-checkout-header">
                            <div>
                                <span className="pdv-checkout-overline">
                                    {checkoutStep === 'payment' ? 'RESUMO DA VENDA' : 'PAGAMENTO CONFIRMADO'}
                                </span>
                                <h2 id="pdv-checkout-title">
                                    {checkoutStep === 'payment' ? 'Finalizar venda' : 'Venda concluída!'}
                                </h2>
                            </div>
                            <button
                                ref={closeCheckoutButtonRef}
                                type="button"
                                className="pdv-checkout-close"
                                onClick={closeCheckout}
                                aria-label="Fechar finalização da venda"
                                title="Fechar"
                            >
                                <X size={19} />
                            </button>
                        </div>

                        {checkoutStep === 'payment' ? (
                            <>
                                <div className="pdv-checkout-total">
                                    <span>Total da venda</span>
                                    <strong>{currency.format(total)}</strong>
                                </div>

                                <div className="pdv-payment-section">
                                    <div>
                                        <h3>Forma de pagamento</h3>
                                        <p>Selecione como o cliente deseja pagar.</p>
                                    </div>
                                    <div className="pdv-payment-options" role="radiogroup" aria-label="Forma de pagamento">
                                        <button
                                            type="button"
                                            className={`pdv-payment-option ${paymentMethod === 'cash' ? 'selected' : ''}`}
                                            onClick={() => selectPaymentMethod('cash')}
                                            role="radio"
                                            aria-checked={paymentMethod === 'cash'}
                                        >
                                            <Banknote size={20} />
                                            <span>Dinheiro</span>
                                        </button>
                                        <button
                                            type="button"
                                            className={`pdv-payment-option ${paymentMethod === 'pix' ? 'selected' : ''}`}
                                            onClick={() => selectPaymentMethod('pix')}
                                            role="radio"
                                            aria-checked={paymentMethod === 'pix'}
                                        >
                                            <QrCode size={20} />
                                            <span>PIX</span>
                                        </button>
                                        <button
                                            type="button"
                                            className={`pdv-payment-option ${paymentMethod === 'card' ? 'selected' : ''}`}
                                            onClick={() => selectPaymentMethod('card')}
                                            role="radio"
                                            aria-checked={paymentMethod === 'card'}
                                        >
                                            <CreditCard size={20} />
                                            <span>Cartão</span>
                                        </button>
                                    </div>
                                </div>

                                {paymentMethod === 'cash' && (
                                    <div className="pdv-cash-section">
                                        <label htmlFor="received-value">Valor recebido</label>
                                        <div className="pdv-cash-input-wrapper">
                                            <span>R$</span>
                                            <input
                                                ref={receivedValueInputRef}
                                                id="received-value"
                                                type="text"
                                                inputMode="decimal"
                                                value={receivedValue}
                                                onChange={(event) => {
                                                    const nextValue = event.target.value

                                                    if (moneyInputPattern.test(nextValue)) {
                                                        setReceivedValue(nextValue)
                                                        setCheckoutMessage('')
                                                    }
                                                }}
                                                placeholder="0,00"
                                                autoComplete="off"
                                                aria-describedby={cashValidationMessage ? 'cash-validation-message' : undefined}
                                            />
                                        </div>
                                        {cashValidationMessage && (
                                            <p
                                                id="cash-validation-message"
                                                className={receivedInCents !== null && receivedInCents >= totalInCents
                                                    ? 'pdv-cash-change'
                                                    : 'pdv-cash-error'}
                                                role="status"
                                            >
                                                {cashValidationMessage}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {paymentMethod === 'pix' && (
                                    <div className="pdv-pix-section" aria-label="Pagamento via PIX">
                                        <div className="pdv-pix-icon" aria-hidden="true">
                                            <QrCode size={26} />
                                        </div>
                                        <div className="pdv-pix-content">
                                            <h3>Pagamento via PIX</h3>
                                            <p>Realize o pagamento via PIX no valor total da venda.</p>
                                            <strong>{currency.format(total)}</strong>
                                        </div>
                                    </div>
                                )}

                                {paymentMethod === 'card' && (
                                    <div className="pdv-card-section" aria-label="Pagamento com Cartão">
                                        <div className="pdv-card-icon" aria-hidden="true">
                                            <CreditCard size={26} />
                                        </div>
                                        <div className="pdv-card-content">
                                            <h3>Pagamento com Cartão</h3>
                                            <p>Pagamento será realizado por cartão.</p>
                                            <strong>{currency.format(total)}</strong>
                                        </div>
                                    </div>
                                )}

                                {checkoutMessage && <p className="pdv-checkout-message" role="alert">{checkoutMessage}</p>}

                                <div className="pdv-checkout-actions">
                                    <button type="button" className="pdv-checkout-cancel" onClick={closeCheckout}>
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        className="pdv-checkout-continue"
                                        onClick={continueCheckout}
                                        disabled={isRegisteringSale || (paymentMethod === 'cash' && !isCashPaymentValid)}
                                    >
                                        {isRegisteringSale ? 'Registrando...' : 'Continuar'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            completedSale && (
                                <div className="pdv-checkout-completed-body">
                                    <div className="pdv-checkout-completed-banner">
                                        <CircleCheck size={36} className="pdv-checkout-completed-icon" aria-hidden="true" />
                                        <div>
                                            <h3>Pagamento registrado com sucesso!</h3>
                                            <p>Deseja imprimir o cupom na impressora térmica?</p>
                                        </div>
                                    </div>

                                    <div className="pdv-checkout-completed-summary">
                                        <div className="pdv-checkout-completed-row">
                                            <span>Total pago</span>
                                            <strong>{currency.format(completedSale.total)}</strong>
                                        </div>
                                        <div className="pdv-checkout-completed-row">
                                            <span>Forma de pagamento</span>
                                            <span>
                                                {completedSale.paymentMethod === 'cash'
                                                    ? 'Dinheiro'
                                                    : completedSale.paymentMethod === 'pix'
                                                        ? 'PIX'
                                                        : 'Cartão'}
                                            </span>
                                        </div>
                                        {completedSale.paymentMethod === 'cash'
                                            && completedSale.receivedAmount !== undefined
                                            && completedSale.change !== undefined && (
                                                <>
                                                    <div className="pdv-checkout-completed-row">
                                                        <span>Valor recebido</span>
                                                        <span>{currency.format(completedSale.receivedAmount)}</span>
                                                    </div>
                                                    <div className="pdv-checkout-completed-row pdv-checkout-completed-change">
                                                        <span>Troco</span>
                                                        <strong>{currency.format(completedSale.change)}</strong>
                                                    </div>
                                                </>
                                            )}
                                    </div>

                                    {modalPrintFeedback && (
                                        <p
                                            className={`pdv-checkout-print-feedback ${modalPrintFeedback.isError ? 'is-error' : 'is-success'}`}
                                            role="status"
                                        >
                                            {modalPrintFeedback.message}
                                        </p>
                                    )}

                                    <div className="pdv-checkout-completed-actions">
                                        <button
                                            type="button"
                                            className="pdv-checkout-btn-print"
                                            onClick={handlePrintFromModal}
                                            disabled={bluetooth.status === 'printing'}
                                        >
                                            <Printer size={18} aria-hidden="true" />
                                            <span>
                                                {bluetooth.status === 'printing'
                                                    ? 'Imprimindo cupom...'
                                                    : 'Imprimir Cupom'}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="pdv-checkout-btn-done"
                                            onClick={closeCheckout}
                                        >
                                            Concluir (Nova Venda)
                                        </button>
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}