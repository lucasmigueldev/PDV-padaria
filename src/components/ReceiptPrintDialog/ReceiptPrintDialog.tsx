import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bluetooth, BluetoothOff, Printer, X } from 'lucide-react'
import type { Sale } from '../../types/Sale'
import { useBluetoothPrinter } from '../../hooks/useBluetoothPrinter'
import { useEstablishmentName } from '../../services/establishment'
import type { ReceiptData } from '../../services/thermalPrinter'
import './ReceiptPrintDialog.css'

interface ReceiptPrintDialogProps {
    sale: Sale
    bakeryName: string | null
    autoPrint?: boolean
    contextMessage?: string
    onClose: () => void
}

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

const dateTime = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
})

const paymentMethodLabels: Record<Sale['paymentMethod'], string> = {
    cash: 'Dinheiro',
    pix: 'PIX',
    card: 'Cartão',
}

function getReceiptProblem(sale: Sale, bakeryName: string | null): string | null {
    if (!bakeryName?.trim()) {
        return 'O nome da padaria não está disponível. O comprovante não pode ser impresso.'
    }

    if (!sale.id || !Number.isFinite(new Date(sale.date).getTime())) {
        return 'A identificação ou a data da venda não está disponível. O comprovante não pode ser impresso.'
    }

    if (
        sale.items.length === 0
        || sale.items.some((item) => (
            !item.name.trim()
            || !Number.isFinite(item.quantity)
            || item.quantity <= 0
            || !Number.isFinite(item.price)
            || !Number.isFinite(item.subtotal)
        ))
        || !Number.isFinite(sale.total)
    ) {
        return 'Os itens ou valores da venda estão incompletos. O comprovante não pode ser impresso.'
    }

    if (
        sale.paymentMethod === 'cash'
        && (
            sale.receivedAmount === null
            || sale.receivedAmount === undefined
            || sale.change === null
            || sale.change === undefined
            || !Number.isFinite(sale.receivedAmount)
            || !Number.isFinite(sale.change)
        )
    ) {
        return 'Os valores recebidos e de troco não estão disponíveis. O comprovante não pode ser impresso.'
    }

    return null
}

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

export function ReceiptPrintDialog({
    sale,
    bakeryName,
    autoPrint = false,
    contextMessage,
    onClose,
}: ReceiptPrintDialogProps) {
    const [printMessage, setPrintMessage] = useState('')
    const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false)
    const isPrintDialogOpenRef = useRef(false)
    const autoPrintStartedRef = useRef(false)
    const isMountedRef = useRef(false)
    const receiptProblem = getReceiptProblem(sale, bakeryName)
    const shortSaleId = sale.id.slice(0, 8).toUpperCase()

    const bluetooth = useBluetoothPrinter()
    const establishmentName = useEstablishmentName()

    const printReceipt = useCallback(() => {
        if (receiptProblem || isPrintDialogOpenRef.current) {
            return
        }

        isPrintDialogOpenRef.current = true
        setIsPrintDialogOpen(true)
        setPrintMessage('A janela de impressão foi aberta. O navegador não confirma se houve impressão física.')
        const handleAfterPrint = () => {
            isPrintDialogOpenRef.current = false
            setIsPrintDialogOpen(false)
            window.removeEventListener('afterprint', handleAfterPrint)
            setPrintMessage('A janela de impressão foi fechada. Confirme no destino escolhido se o comprovante foi impresso ou salvo.')
        }

        window.addEventListener('afterprint', handleAfterPrint, { once: true })
        try {
            window.print()
        } catch (error) {
            window.removeEventListener('afterprint', handleAfterPrint)
            isPrintDialogOpenRef.current = false
            setIsPrintDialogOpen(false)
            console.error('Não foi possível iniciar a impressão do comprovante.', error)
            setPrintMessage('Não foi possível abrir a janela de impressão.')
        }
    }, [receiptProblem])

    const handleBluetoothPrint = useCallback(async () => {
        if (receiptProblem || !bakeryName) return

        if (bluetooth.status !== 'connected') {
            await bluetooth.connect()
            return
        }

        await bluetooth.print(saleToReceiptData(sale, bakeryName, establishmentName))
    }, [receiptProblem, bakeryName, bluetooth, sale, establishmentName])

    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    useEffect(() => {
        if (!autoPrint || autoPrintStartedRef.current || receiptProblem) {
            return
        }

        autoPrintStartedRef.current = true
        window.requestAnimationFrame(() => {
            if (isMountedRef.current) printReceipt()
        })
    }, [autoPrint, printReceipt, receiptProblem])

    const isBusy = isPrintDialogOpen || bluetooth.status === 'connecting' || bluetooth.status === 'printing'

    function getBluetoothButtonLabel(): string {
        switch (bluetooth.status) {
            case 'connecting': return 'Conectando...'
            case 'printing': return 'Imprimindo...'
            case 'connected': return `Imprimir em ${bluetooth.deviceName ?? 'Bluetooth'}`
            default: return 'Conectar impressora Bluetooth'
        }
    }

    const isBluetoothConnected = bluetooth.status === 'connected'

    return createPortal((
        <div className="receipt-dialog-overlay" onClick={onClose}>
            <section
                className="receipt-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="receipt-dialog-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className="receipt-dialog-header">
                    <div>
                        <span>Comprovante de venda</span>
                        <h2 id="receipt-dialog-title">Visualização para impressão</h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fechar visualização do comprovante"
                        disabled={isBusy}
                    >
                        <X size={19} aria-hidden="true" />
                    </button>
                </header>

                {receiptProblem ? (
                    <p className="receipt-dialog-message" role="alert">{receiptProblem}</p>
                ) : (
                    <>
                        {contextMessage && <p className="receipt-dialog-message">{contextMessage}</p>}
                        <div className="thermal-print-root">
                            <article className="thermal-receipt">
                                <h1>{establishmentName || bakeryName}</h1>
                                {establishmentName && bakeryName && bakeryName !== establishmentName && (
                                    <p className="thermal-receipt-unit">Unidade: {bakeryName}</p>
                                )}
                                <p className="thermal-receipt-legal">COMPROVANTE NÃO FISCAL — SEM VALOR FISCAL</p>
                                <div className="thermal-receipt-separator" />
                                <p><strong>Venda:</strong> #{shortSaleId}</p>
                                <p><strong>Data:</strong> {dateTime.format(new Date(sale.date))}</p>
                                <div className="thermal-receipt-separator" />

                                <div className="thermal-receipt-items">
                                    {sale.items.map((item, index) => (
                                        <div className="thermal-receipt-item" key={`${item.productId}-${index}`}>
                                            <strong className="thermal-receipt-item-name">{item.name}</strong>
                                            <div className="thermal-receipt-item-details">
                                                <span>{item.quantity} x {currency.format(item.price)}</span>
                                                <strong>{currency.format(item.subtotal)}</strong>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="thermal-receipt-separator" />
                                <div className="thermal-receipt-total">
                                    <strong>TOTAL</strong>
                                    <strong>{currency.format(sale.total)}</strong>
                                </div>
                                <p className="thermal-receipt-payment">
                                    <strong>Pagamento:</strong> {paymentMethodLabels[sale.paymentMethod]}
                                </p>
                                {sale.paymentMethod === 'cash'
                                    && sale.receivedAmount !== undefined
                                    && sale.change !== undefined && (
                                        <>
                                            <p><strong>Valor recebido:</strong> {currency.format(sale.receivedAmount)}</p>
                                            <p><strong>Troco:</strong> {currency.format(sale.change)}</p>
                                        </>
                                    )}
                                <div className="thermal-receipt-separator" />
                                <p className="thermal-receipt-thanks">Obrigado pela preferência!</p>
                            </article>
                        </div>
                    </>
                )}

                {printMessage && <p className="receipt-dialog-message" role="status">{printMessage}</p>}

                {/* Feedback do Bluetooth */}
                {bluetooth.errorMessage && (
                    <p className="receipt-dialog-message receipt-dialog-bluetooth-error" role="alert">
                        {bluetooth.errorMessage}
                    </p>
                )}
                {isBluetoothConnected && bluetooth.status === 'connected' && !bluetooth.errorMessage && (
                    <p className="receipt-dialog-message receipt-dialog-bluetooth-ok" role="status">
                        Impressora conectada: {bluetooth.deviceName}
                    </p>
                )}

                <footer className="receipt-dialog-actions">
                    <button type="button" className="receipt-dialog-close" onClick={onClose} disabled={isBusy}>
                        Fechar
                    </button>

                    {/* Botão Bluetooth — só aparece se a API estiver disponível */}
                    {bluetooth.isBluetoothAvailable && (
                        <button
                            type="button"
                            className={`receipt-dialog-bluetooth${isBluetoothConnected ? ' is-connected' : ''}`}
                            onClick={handleBluetoothPrint}
                            disabled={Boolean(receiptProblem) || isBusy}
                            title={isBluetoothConnected ? `Desconectar de ${bluetooth.deviceName ?? 'Bluetooth'}` : undefined}
                        >
                            {isBluetoothConnected
                                ? <Bluetooth size={17} aria-hidden="true" />
                                : <BluetoothOff size={17} aria-hidden="true" />}
                            {getBluetoothButtonLabel()}
                        </button>
                    )}

                    {/* Botão imprimir/PDF padrão */}
                    <button
                        type="button"
                        className="receipt-dialog-print"
                        onClick={printReceipt}
                        disabled={Boolean(receiptProblem) || isBusy}
                    >
                        <Printer size={17} aria-hidden="true" />
                        Imprimir / salvar PDF
                    </button>
                </footer>

                {/* Opção de desconectar quando conectado */}
                {isBluetoothConnected && (
                    <div className="receipt-dialog-bluetooth-disconnect">
                        <button
                            type="button"
                            onClick={bluetooth.disconnect}
                            disabled={isBusy}
                        >
                            Desconectar impressora Bluetooth
                        </button>
                    </div>
                )}
            </section>
        </div>
    ), document.body)
}
