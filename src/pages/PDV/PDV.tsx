import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
    CircleAlert,
    CircleCheck,
    CreditCard,
    History,
    Minus,
    MonitorSmartphone,
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
import { addProduct as createProduct, getProductsFromSupabase } from '../../data/products'
import { createSaleWithItems, getOpenCashRegister } from '../../services/operations'
import { useBakeries } from '../../hooks/useBakeries'
import { useAuth } from '../../contexts/AuthContext'
import { usePixKey } from '../../services/pixConfig'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { useBluetoothPrinter } from '../../hooks/useBluetoothPrinter'
import { useConnectionStatus } from '../../hooks/useConnectionStatus'
import { enqueueSale, getPendingSyncCount } from '../../services/offlineSalesQueue'
import { startSalesSync } from '../../services/syncOfflineSales'
import { isNetworkError, startConnectionMonitor } from '../../services/connection'
import { startOfflinePeriodTracking } from '../../services/offlinePeriods'
import PixQrCode from '../../components/PixQrCode/PixQrCode'
import type { ProductWithStock, SaleItem } from '../../types/Product'
import type { PaymentMethod, Sale } from '../../types/Sale'
import type { ReceiptData } from '../../services/thermalPrinter'
import { logoutAndRedirect } from '../../utils/auth'
import AppTopbar from '../../components/AppTopbar/AppTopbar'
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog'
import { QuickProductDialog, type QuickProductData } from '../../components/QuickProductDialog/QuickProductDialog'
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
import { useEstablishmentName } from '../../services/establishment'
function saleToReceiptData(sale: Sale, bakeryName: string, establishmentName?: string): ReceiptData {
    return {
        establishmentName,
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
    const establishmentName = useEstablishmentName()
    const bakeryId = authenticatedUser?.role === 'cashier' ? authenticatedUser.activeBakeryId : null
    const pixKey = usePixKey(bakeryId)
    const bluetooth = useBluetoothPrinter()
    const connection = useConnectionStatus()
    const pendingCount = getPendingSyncCount()
    const receiptBakeryName = bakeryId
        ? bakeries.find((bakery) => bakery.id === bakeryId)?.name ?? null
        : null
    const bakeryName = receiptBakeryName ?? 'Unidade indisponível'
    const barcodeInputRef = useRef<HTMLInputElement>(null)
    const finishButtonRef = useRef<HTMLButtonElement>(null)
    const [showScreenNotice, setShowScreenNotice] = useState(true)
    const [barcode, setBarcode] = useState('')
    const [productQuantity, setProductQuantity] = useState('1')
    const [items, setItems] = useState<SaleItem[]>([])
    const [itemBeingRemoved, setItemBeingRemoved] = useState<{ id: string; name: string } | null>(null)
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
    const [pixOverlayOpen, setPixOverlayOpen] = useState(false)
    const [pixKeyDisplayOpen, setPixKeyDisplayOpen] = useState(false)
    const [products, setProducts] = useState<ProductWithStock[]>([])
    const [cashRegister, setCashRegister] = useState<Awaited<ReturnType<typeof getOpenCashRegister>>>(null)
    const [isLoadingOperationalData, setIsLoadingOperationalData] = useState(true)
    const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null)
    const [isSavingQuickProduct, setIsSavingQuickProduct] = useState(false)
    const [quickProductError, setQuickProductError] = useState('')

    const isRefreshingOperationalDataRef = useRef(false)
    const closeCheckoutButtonRef = useRef<HTMLButtonElement>(null)
    const receivedValueInputRef = useRef<HTMLInputElement>(null)
    const isRegisteringSaleRef = useRef(false)
    const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null)
    const isSavingQuickProductRef = useRef(false)
    const scanBufferRef = useRef('')
    const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const scanLastKeyRef = useRef(0)
    const addProductByBarcodeRef = useRef(addProductByBarcode)
    useEffect(() => {
        addProductByBarcodeRef.current = addProductByBarcode
    })
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
    // Recarrega o catálogo e o caixa sob demanda (botão "Atualizar dados") sem
    // desfazer a venda em andamento: os itens da venda mantêm seus próprios valores.
    const reloadOperationalData = useCallback(async (showFeedback = false) => {
        if (!bakeryId || isRefreshingOperationalDataRef.current) return
        isRefreshingOperationalDataRef.current = true
        try {
            const [catalog, register] = await Promise.all([
                getProductsFromSupabase(bakeryId),
                getOpenCashRegister(bakeryId),
            ])
            setProducts(catalog)
            setCashRegister(register)
            // Reflete o novo estoque nos itens já presentes na venda, sem alterar
            // as quantidades escolhidas pelo operador (apenas limita ao estoque).
            const stockByBarcode = new Map(catalog.map((product) => [product.barcode.trim(), product.stock]))
            setItems((currentItems) => currentItems.map((item) => {
                const stock = stockByBarcode.get(item.barcode.trim())
                if (stock === undefined) return item
                return { ...item, stock, quantity: Math.min(item.quantity, stock) }
            }).filter((item) => item.quantity > 0))
            if (showFeedback) setSaleFeedback('Dados atualizados.')
        } catch (error: unknown) {
            console.error('Erro ao atualizar os dados do PDV.', error)
            setErrorMessage(getOperationalErrorMessage(
                error,
                'Não foi possível atualizar os dados do PDV. Tente novamente.',
                'Não foi possível atualizar os dados do PDV. Verifique a conexão e tente novamente.',
            ))
        } finally {
            isRefreshingOperationalDataRef.current = false
        }
    }, [bakeryId])
    // Mantém o PDV sincronizado com as movimentações de outros dispositivos:
    // ao voltar para a aba e a cada intervalo, o catálogo e o caixa são recarregados.
    useAutoRefresh(() => {
        if (isCheckoutOpen || pixOverlayOpen || pixKeyDisplayOpen || unknownBarcode) return
        if (document.visibilityState !== 'visible') return
        void reloadOperationalData()
    })
    
    useEffect(() => {
        barcodeInputRef.current?.focus()
    }, [])
    useEffect(() => {
        if (!isCheckoutOpen) return
        closeCheckoutButtonRef.current?.focus()
    }, [isCheckoutOpen])
    useEffect(() => {
        if (!isCheckoutOpen && !pixOverlayOpen && !pixKeyDisplayOpen) return
        function handleEscape(event: KeyboardEvent) {
            if (event.key !== 'Escape') return
            if (pixOverlayOpen) {
                closePixOverlay()
            } else if (pixKeyDisplayOpen) {
                closePixKeyDisplay()
            } else if (isCheckoutOpen) {
                closeCheckout()
            }
        }
        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [isCheckoutOpen, pixOverlayOpen, pixKeyDisplayOpen])
    // Leitores de código de barras funcionam como teclado (keyboard wedge) e enviam
    // os caracteres rapidamente, terminando com Enter. Quando o foco da página não está
    // no campo de código (por exemplo, após clicar em um botão da venda), a leitura é
    // perdida. Este listener global captura essas teclas, monta o código e adiciona o
    // produto assim que o Enter chega, sem exigir clique no campo.
    useEffect(() => {
        function isEditableTarget(target: EventTarget | null): boolean {
            if (!(target instanceof HTMLElement)) return false
            if (target.isContentEditable) return true
            const tagName = target.tagName
            return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
        }
        function handleScanKey(event: KeyboardEvent) {
            if (isCheckoutOpen || pixOverlayOpen || pixKeyDisplayOpen || unknownBarcode) return
            if (event.ctrlKey || event.altKey || event.metaKey) return
            // Campos de digitação já recebem a leitura diretamente (o Enter dispara o form).
            if (isEditableTarget(event.target)) return
            if (event.key === 'Enter') {
                const scannedBarcode = scanBufferRef.current.trim()
                scanBufferRef.current = ''
                if (scanTimerRef.current) {
                    clearTimeout(scanTimerRef.current)
                    scanTimerRef.current = null
                }
                if (!scannedBarcode) return
                event.preventDefault()
                addProductByBarcodeRef.current(scannedBarcode)
                barcodeInputRef.current?.focus()
                return
            }
            if (event.key.length !== 1) return
            const now = Date.now()
            // Separa múltiplos scans enviados em ritmo rápido: se o último caractere
            // chegou há mais de 120ms, o scan anterior já foi encerrado e o buffer
            // pode ser recomeçado sem ficar concatenando códigos anteriores.
            if (now - scanLastKeyRef.current > 120 && scanBufferRef.current) {
                scanBufferRef.current = ''
            }
            scanBufferRef.current += event.key
            scanLastKeyRef.current = now
            // Digitação humana é descartada: o buffer só vale se os caracteres chegarem
            // no ritmo típico de um leitor.
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
            scanTimerRef.current = setTimeout(() => {
                scanBufferRef.current = ''
                scanTimerRef.current = null
            }, 150)
        }
        document.addEventListener('keydown', handleScanKey)
        return () => {
            document.removeEventListener('keydown', handleScanKey)
            if (scanTimerRef.current) {
                clearTimeout(scanTimerRef.current)
                scanTimerRef.current = null
            }
        }
    }, [isCheckoutOpen, pixOverlayOpen, pixKeyDisplayOpen, unknownBarcode])
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
    // Inicia o monitor de conectividade, a sincronização de vendas pendentes
    // e o rastreamento de períodos fora do ar quando o PDV está ativo para uma unidade.
    useEffect(() => {
        if (!bakeryId) return
        const stopConnection = startConnectionMonitor()
        const stopSync = startSalesSync()
        const stopOfflineTracking = startOfflinePeriodTracking()
        return () => {
            stopConnection()
            stopSync()
            stopOfflineTracking()
        }
    }, [bakeryId])
    function handleLogout() {
        void logoutAndRedirect(navigate)
    }
    function addProductByBarcode(rawBarcode: string) {
        setErrorMessage('')
        setSaleFeedback('')
        const normalizedBarcode = rawBarcode.trim()
        if (!normalizedBarcode) {
            setErrorMessage('Informe o código de barras do produto.')
            barcodeInputRef.current?.focus()
            return
        }
        if (unknownBarcode === normalizedBarcode) {
            barcodeInputRef.current?.focus()
            return
        }
        const requestedQuantity = Number(productQuantity)
        const product = products.find((item) => item.barcode.trim() === normalizedBarcode)
        if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1) {
            setErrorMessage('Informe uma quantidade válida.')
            barcodeInputRef.current?.focus()
            return
        }
        if (!product) {
            setBarcode(normalizedBarcode)
            setUnknownBarcode(normalizedBarcode)
            setQuickProductError('')
            setErrorMessage('')
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
    function addProduct(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        addProductByBarcode(barcode)
    }
    function cancelQuickProduct() {
        setUnknownBarcode(null)
        setQuickProductError('')
        setIsSavingQuickProduct(false)
        setBarcode('')
        setProductQuantity('1')
        barcodeInputRef.current?.focus()
    }
    async function confirmQuickProduct(data: QuickProductData) {
        if (!unknownBarcode || isSavingQuickProduct) return
        isSavingQuickProductRef.current = true
        setIsSavingQuickProduct(true)
        setQuickProductError('')
        try {
            const createdProduct = await createProduct(data)
            setProducts((currentProducts) => [...currentProducts, createdProduct])
            setUnknownBarcode(null)
            setBarcode('')
            setProductQuantity('1')
            setErrorMessage('')
            if (createdProduct.stock <= 0) {
                setSaleFeedback('Produto cadastrado, mas sem estoque disponível para a venda.')
                barcodeInputRef.current?.focus()
                return
            }
            const requestedQuantity = Number(productQuantity)
            const quantity = Number.isSafeInteger(requestedQuantity) && requestedQuantity > 0
                ? Math.min(requestedQuantity, createdProduct.stock)
                : 1
            setItems((currentItems) => {
                const currentItem = currentItems.find((item) => item.barcode === createdProduct.barcode)
                if (currentItem) {
                    return currentItems.map((item) =>
                        item.barcode === createdProduct.barcode
                            ? { ...item, quantity: Math.min(item.quantity + quantity, createdProduct.stock) }
                            : item,
                    )
                }
                return [...currentItems, { ...createdProduct, quantity }]
            })
            setSaleFeedback(`Produto "${createdProduct.name}" cadastrado e adicionado à venda.`)
            barcodeInputRef.current?.focus()
        } catch (error: unknown) {
            console.error('Erro inesperado ao cadastrar produto lido.', error)
            setQuickProductError(error instanceof Error
                ? error.message
                : 'Não foi possível cadastrar o produto. Tente novamente.')
        } finally {
            isSavingQuickProductRef.current = false
            setIsSavingQuickProduct(false)
        }
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
    function confirmItemRemoval() {
        if (!itemBeingRemoved) return
        removeProduct(itemBeingRemoved.id)
        setItemBeingRemoved(null)
        barcodeInputRef.current?.focus()
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
        setPixOverlayOpen(false)
        setReceivedValue('')
        setCheckoutMessage('')
        setCheckoutStep('payment')
        setCompletedSale(null)
        setModalPrintFeedback(null)
        barcodeInputRef.current?.focus()
    }
    function closePixOverlay() {
        setPixOverlayOpen(false)
    }
    function openPixKeyDisplay() {
        setPixKeyDisplayOpen(true)
    }
    function closePixKeyDisplay() {
        setPixKeyDisplayOpen(false)
    }
    function selectPaymentMethod(method: PaymentMethod) {
        setPaymentMethod(method)
        setReceivedValue('')
        setCheckoutMessage('')
        if (method === 'pix') setPixOverlayOpen(true)
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
        if (!authenticatedUser || authenticatedUser.role !== 'cashier' || !authenticatedUser.activeBakeryId?.trim()) {
            setCheckoutMessage('Não foi possível identificar a unidade do operador.')
            return
        }
        let currentRegister
        try {
            currentRegister = await getOpenCashRegister(authenticatedUser.activeBakeryId)
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
                bakeryId: authenticatedUser.activeBakeryId,
                ...(receivedAmount !== null ? { receivedAmount } : {}),
                ...(changeAmount !== null ? { change: changeAmount } : {}),
            }
            setItems([])
            setCompletedSale(confirmedSale)
            setPixOverlayOpen(false)
            setCheckoutStep('completed')
            setModalPrintFeedback(null)
            setSaleFeedback('Venda concluída com sucesso.')
            try {
                setProducts(await getProductsFromSupabase(authenticatedUser.activeBakeryId))
            } catch (error) {
                console.error('Venda registrada, mas a atualização do estoque exibido falhou.', error)
                setErrorMessage('Venda concluída. O estoque mostrado na tela pode estar desatualizado. Atualize o PDV antes da próxima venda.')
            }
        } catch (error) {
            const isOffline = !navigator.onLine || isNetworkError(error)
            if (isOffline) {
                // Sem conexão: enfileira a venda para sincronizar depois
                const saleId = idempotencyRef.current?.key ?? crypto.randomUUID()
                try {
                    enqueueSale({
                        id: saleId,
                        idempotencyKey: saleId,
                        localRef: saleId,
                        cashRegisterId: currentRegister.id,
                        bakeryId: authenticatedUser.activeBakeryId,
                        occurredAt: new Date().toISOString(),
                        paymentMethod,
                        receivedAmount,
                        changeAmount,
                        total,
                        items: items.map((item) => ({
                            productId: item.id,
                            name: item.name,
                            barcode: item.barcode,
                            price: item.price,
                            quantity: item.quantity,
                        })),
                        status: 'pending',
                        createdAt: new Date().toISOString(),
                    })
                    idempotencyRef.current = null
                    const confirmedSale: Sale = {
                        id: saleId,
                        date: new Date().toISOString(),
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
                        bakeryId: authenticatedUser.activeBakeryId,
                        ...(receivedAmount !== null ? { receivedAmount } : {}),
                        ...(changeAmount !== null ? { change: changeAmount } : {}),
                    }
                    setItems([])
                    setCompletedSale(confirmedSale)
                    setPixOverlayOpen(false)
                    setCheckoutStep('completed')
                    setModalPrintFeedback(null)
                    setSaleFeedback('Venda registrada offline. Será sincronizada quando a conexão voltar.')
                } catch {
                    setCheckoutMessage('Não foi possível registrar a venda. Verifique a conexão e tente novamente.')
                }
            } else {
                setCheckoutMessage(getOperationalErrorMessage(
                    error,
                    'Não foi possível confirmar se a venda foi registrada. Consulte o histórico de vendas antes de tentar novamente, para evitar duplicidade.',
                    'Não foi possível confirmar se a venda foi registrada. Verifique a conexão e consulte o histórico antes de tentar novamente, para evitar duplicidade.',
                ))
            }
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
            await bluetooth.print(saleToReceiptData(completedSale, bakery, establishmentName))
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
        <>
            {showScreenNotice && (
                <div
                    className="pdv-screen-notice"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="pdv-screen-notice-title"
                >
                    <div className="pdv-screen-notice-card">
                        <MonitorSmartphone size={44} aria-hidden="true" />
                        <h2 id="pdv-screen-notice-title">Modo PDV para telas maiores</h2>
                        <p>
                            O modo operador do PDV foi desenvolvido para telas maiores.
                            Para uma melhor experiência, acesse pelo computador ou por um
                            tablet em uma tela maior. Se preferir, você pode continuar
                            no celular mesmo.
                        </p>
                        <button
                            type="button"
                            className="pdv-screen-notice-button"
                            onClick={() => setShowScreenNotice(false)}
                        >
                            Continuar mesmo assim
                        </button>
                    </div>
                </div>
            )}
            <div className="pdv-layout">
            <AppTopbar
                userName={authenticatedUser?.name}
                bakeryName={bakeryName}
                userRole="Operador"
                onLogout={handleLogout}
                showPrinter
            />
            {pendingCount > 0 && connection.status === 'offline' && (
                <div className="pdv-offline-banner">
                    <span>● Sem conexão</span>
                    <span>{pendingCount} venda(ões) aguardando sincronização</span>
                </div>
            )}
            {pendingCount > 0 && connection.status === 'online' && (
                <div className="pdv-offline-banner pdv-offline-banner--syncing">
                    <span>● Sincronizando vendas pendentes...</span>
                    <span>{pendingCount} venda(ões) na fila</span>
                </div>
            )}
            <aside className="pdv-sidebar">
                <div className="pdv-brand">
                    <div className="pdv-logo-icon">
                        <ShoppingCart size={22} />
                    </div>
                    <div>
                        <strong>PDV360</strong>
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
                <nav className="pdv-shortcuts" aria-label="Pagamento">
                    <span className="pdv-sidebar-label">Pagamento</span>
                    <button
                        type="button"
                        className="pdv-shortcut"
                        onClick={openPixKeyDisplay}
                        aria-label="Exibir chave PIX"
                    >
                        <QrCode size={19} />
                        <span>Exibir Chave Pix</span>
                    </button>
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
                                                            onClick={() => setItemBeingRemoved({ id: item.id, name: item.name })}
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
                                    type="button"
                                    className="pdv-clear-cart-button"
                                    disabled={items.length === 0}
                                    onClick={() => {
                                        if (window.confirm('Limpar todos os produtos da tela?')) {
                                            setItems([])
                                            setBarcode('')
                                            setProductQuantity('1')
                                            barcodeInputRef.current?.focus()
                                        }
                                    }}
                                >
                                    Limpar tela
                                </button>
                                <button
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
                <>
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
                                            {pixKey ? (
                                                <PixQrCode pixKey={pixKey} size={120} />
                                            ) : (
                                                <QrCode size={26} />
                                            )}
                                        </div>
                                        <div className="pdv-pix-content">
                                            <h3>Pagamento via PIX</h3>
                                            <p>Realize o pagamento via PIX no valor total da venda.</p>
                                            <strong>{currency.format(total)}</strong>
                                            {!pixKey && (
                                                <p className="pdv-pix-warning">
                                                    Chave PIX não configurada para esta unidade. O pagamento
                                                    será registrado manualmente como PIX.
                                                </p>
                                            )}
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
                </>
            )}
                {pixOverlayOpen && (
                    <div className="pdv-pix-overlay" onClick={closePixOverlay}>
                        <div className="pdv-pix-overlay-content" onClick={(event) => event.stopPropagation()}>
                            <button
                                type="button"
                                className="pdv-pix-overlay-close"
                                onClick={closePixOverlay}
                                aria-label="Fechar código QR"
                            >
                                <X size={24} />
                            </button>
                            <div className="pdv-pix-overlay-body">
                                {pixKey ? (
                                    <>
                                        <div className="pdv-pix-overlay-qr">
                                            <PixQrCode pixKey={pixKey} size={340} />
                                        </div>
                                        <p className="pdv-pix-overlay-total">{currency.format(total)}</p>
                                        <p className="pdv-pix-overlay-hint">
                                            Apresente este código para o cliente escanear
                                        </p>
                                    </>
                                ) : (
                                    <p className="pdv-pix-overlay-warning">
                                        Chave PIX não configurada. Solicite ao administrador.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                {pixKeyDisplayOpen && (
                    <div className="pdv-pix-overlay" onClick={closePixKeyDisplay}>
                        <div className="pdv-pix-overlay-content" onClick={(event) => event.stopPropagation()}>
                            <button
                                type="button"
                                className="pdv-pix-overlay-close"
                                onClick={closePixKeyDisplay}
                                aria-label="Fechar código QR"
                            >
                                <X size={24} />
                            </button>
                            <div className="pdv-pix-overlay-body">
                                {pixKey ? (
                                    <>
                                        <div className="pdv-pix-overlay-qr">
                                            <PixQrCode pixKey={pixKey} size={340} />
                                        </div>
                                        <p className="pdv-pix-overlay-hint" style={{ fontWeight: 600, color: '#111827', marginTop: 8 }}>
                                            Chave PIX da padaria
                                        </p>
                                        <p className="pdv-pix-overlay-hint">
                                            Código para pagamento via PIX (valor livre)
                                        </p>
                                        <p className="pdv-pix-overlay-key" style={{ wordBreak: 'break-all', marginTop: 12, fontFamily: 'monospace', fontSize: 14, color: '#374151', background: '#f3f4f6', padding: 10, borderRadius: 8 }}>
                                            {pixKey}
                                        </p>
                                        <p className="pdv-pix-overlay-hint">
                                            Apresente este código para o cliente escanear ou informe a chave acima
                                        </p>
                                    </>
                                ) : (
                                    <p className="pdv-pix-overlay-warning">
                                        Chave PIX não configurada. Solicite ao administrador.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            {unknownBarcode !== null && (
                <QuickProductDialog
                    isOpen
                    barcode={unknownBarcode}
                    isSaving={isSavingQuickProduct}
                    error={quickProductError}
                    onConfirm={confirmQuickProduct}
                    onCancel={cancelQuickProduct}
                />
            )}
            <ConfirmDialog
                isOpen={itemBeingRemoved !== null}
                title="Remover produto"
                message={itemBeingRemoved ? `Remover "${itemBeingRemoved.name}" da venda atual?` : ''}
                onConfirm={confirmItemRemoval}
                onCancel={() => setItemBeingRemoved(null)}
                confirmText="Remover"
                cancelText="Cancelar"
            />
            </div>
        </>
    )
}