import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, X } from 'lucide-react'
import type { Sale } from '../../types/Sale'
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
                        disabled={isPrintDialogOpen}
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
                                <h1>{bakeryName}</h1>
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
                <footer className="receipt-dialog-actions">
                    <button type="button" className="receipt-dialog-close" onClick={onClose} disabled={isPrintDialogOpen}>
                        Fechar
                    </button>
                    <button
                        type="button"
                        className="receipt-dialog-print"
                        onClick={printReceipt}
                        disabled={Boolean(receiptProblem) || isPrintDialogOpen}
                    >
                        <Printer size={17} aria-hidden="true" />
                        Imprimir / salvar PDF
                    </button>
                </footer>
            </section>
        </div>
    ), document.body)
}
