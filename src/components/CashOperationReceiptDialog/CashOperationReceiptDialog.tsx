import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bluetooth, BluetoothOff, Printer, X } from 'lucide-react'
import { useBluetoothPrinter } from '../../hooks/useBluetoothPrinter'
import { useEstablishmentName } from '../../services/establishment'
import {
    buildCashOperationReceiptBuffer,
    type CashOperationReceiptData,
} from '../../services/thermalPrinter'
import '../ReceiptPrintDialog/ReceiptPrintDialog.css'

interface CashOperationReceiptDialogProps {
    data: CashOperationReceiptData
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

export function CashOperationReceiptDialog({
    data,
    contextMessage,
    onClose,
}: CashOperationReceiptDialogProps) {
    const [printMessage, setPrintMessage] = useState('')
    const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false)
    const isPrintDialogOpenRef = useRef(false)
    const bluetooth = useBluetoothPrinter()
    const establishmentName = useEstablishmentName()

    const isClosing = data.operation === 'closing'
    const shortRegisterId = data.registerId.slice(0, 8).toUpperCase()
    const title = isClosing ? 'Comprovante de fechamento' : 'Comprovante de abertura'

    const printReceipt = useCallback(() => {
        if (isPrintDialogOpenRef.current) return

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
    }, [])

    const handleBluetoothPrint = useCallback(async () => {
        if (bluetooth.status !== 'connected') {
            await bluetooth.connect()
            return
        }

        await bluetooth.printBuffer(buildCashOperationReceiptBuffer({
            ...data,
            establishmentName,
        }))
    }, [bluetooth, data, establishmentName])

    const isBusy = isPrintDialogOpen || bluetooth.status === 'connecting' || bluetooth.status === 'printing'
    const isBluetoothConnected = bluetooth.status === 'connected'

    function getBluetoothButtonLabel(): string {
        switch (bluetooth.status) {
            case 'connecting': return 'Conectando...'
            case 'printing': return 'Imprimindo...'
            case 'connected': return `Imprimir em ${bluetooth.deviceName ?? 'Bluetooth'}`
            default: return 'Conectar impressora Bluetooth'
        }
    }

    return createPortal((
        <div className="receipt-dialog-overlay" onClick={onClose}>
            <section
                className="receipt-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cash-operation-receipt-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className="receipt-dialog-header">
                    <div>
                        <span>{title}</span>
                        <h2 id="cash-operation-receipt-title">Visualização para impressão</h2>
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

                {contextMessage && <p className="receipt-dialog-message">{contextMessage}</p>}

                <div className="thermal-print-root">
                    <article className="thermal-receipt">
                        <h1>{establishmentName || data.bakeryName}</h1>
                        {establishmentName && data.bakeryName && data.bakeryName !== establishmentName && (
                            <p className="thermal-receipt-unit">Unidade: {data.bakeryName}</p>
                        )}
                        <p className="thermal-receipt-legal">
                            COMPROVANTE {isClosing ? 'DE FECHAMENTO' : 'DE ABERTURA'} — SEM VALOR FISCAL
                        </p>
                        <div className="thermal-receipt-separator" />
                        <p><strong>Caixa:</strong> #{shortRegisterId}</p>
                        <p><strong>Tipo:</strong> {isClosing ? 'Fechamento' : 'Abertura'}</p>
                        <p><strong>Data:</strong> {dateTime.format(new Date(data.date))}</p>
                        {data.operatorName?.trim() && <p><strong>Operador:</strong> {data.operatorName.trim()}</p>}
                        <div className="thermal-receipt-separator" />

                        <div className="thermal-receipt-items">
                            <div className="thermal-receipt-item">
                                <div className="thermal-receipt-item-details">
                                    <span>Valor inicial</span>
                                    <strong>{currency.format(data.initialAmount)}</strong>
                                </div>
                            </div>
                            {isClosing && data.cashSalesAmount !== undefined && (
                                <div className="thermal-receipt-item">
                                    <div className="thermal-receipt-item-details">
                                        <span>Vendas em dinheiro</span>
                                        <strong>{currency.format(data.cashSalesAmount)}</strong>
                                    </div>
                                </div>
                            )}
                            {isClosing && data.expectedAmount !== undefined && (
                                <div className="thermal-receipt-item">
                                    <div className="thermal-receipt-item-details">
                                        <span>Valor esperado</span>
                                        <strong>{currency.format(data.expectedAmount)}</strong>
                                    </div>
                                </div>
                            )}
                            {isClosing && data.countedAmount !== undefined && (
                                <div className="thermal-receipt-item">
                                    <div className="thermal-receipt-item-details">
                                        <span>Valor contado</span>
                                        <strong>{currency.format(data.countedAmount)}</strong>
                                    </div>
                                </div>
                            )}
                            {isClosing && data.differenceAmount !== undefined && (
                                <div className="thermal-receipt-item">
                                    <div className="thermal-receipt-item-details">
                                        <span>{data.differenceAmount >= 0 ? 'Sobra' : 'Falta'}</span>
                                        <strong>{currency.format(data.differenceAmount)}</strong>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="thermal-receipt-separator" />
                        <p className="thermal-receipt-thanks">
                            {isClosing ? 'Caixa encerrado com sucesso' : 'Caixa aberto com sucesso'}
                        </p>
                    </article>
                </div>


                {printMessage && <p className="receipt-dialog-message" role="status">{printMessage}</p>}

                {bluetooth.errorMessage && (
                    <p className="receipt-dialog-message receipt-dialog-bluetooth-error" role="alert">
                        {bluetooth.errorMessage}
                    </p>
                )}
                {isBluetoothConnected && !bluetooth.errorMessage && (
                    <p className="receipt-dialog-message receipt-dialog-bluetooth-ok" role="status">
                        Impressora conectada: {bluetooth.deviceName}
                    </p>
                )}

                <footer className="receipt-dialog-actions">
                    <button type="button" className="receipt-dialog-close" onClick={onClose} disabled={isBusy}>
                        Fechar
                    </button>

                    {bluetooth.isBluetoothAvailable && (
                        <button
                            type="button"
                            className={`receipt-dialog-bluetooth${isBluetoothConnected ? ' is-connected' : ''}`}
                            onClick={handleBluetoothPrint}
                            disabled={isBusy}
                            title={isBluetoothConnected ? `Desconectar de ${bluetooth.deviceName ?? 'Bluetooth'}` : undefined}
                        >
                            {isBluetoothConnected
                                ? <Bluetooth size={17} aria-hidden="true" />
                                : <BluetoothOff size={17} aria-hidden="true" />}
                            {getBluetoothButtonLabel()}
                        </button>
                    )}

                    <button
                        type="button"
                        className="receipt-dialog-print"
                        onClick={printReceipt}
                        disabled={isBusy}
                    >
                        <Printer size={17} aria-hidden="true" />
                        Imprimir / salvar PDF
                    </button>
                </footer>

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

