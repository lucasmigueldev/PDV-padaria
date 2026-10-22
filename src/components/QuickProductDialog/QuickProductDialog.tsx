import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PackagePlus, X } from 'lucide-react'

import './QuickProductDialog.css'

type QuickProductForm = {
    name: string
    barcode: string
    price: string
    stock: string
}

export type QuickProductData = {
    name: string
    barcode: string
    price: number
    stock: number
}

interface QuickProductDialogProps {
    isOpen: boolean
    barcode: string
    isSaving: boolean
    error: string
    onConfirm: (data: QuickProductData) => void
    onCancel: () => void
}

const moneyInputPattern = /^\d*(?:[,.]?\d{0,2})?$/

function parsePrice(value: string): number {
    const normalizedValue = value.includes(',')
        ? value.replace(/\./g, '').replace(',', '.')
        : value

    return Number(normalizedValue)
}

export function QuickProductDialog({
    isOpen,
    barcode,
    isSaving,
    error,
    onConfirm,
    onCancel,
}: QuickProductDialogProps) {
    const [form, setForm] = useState<QuickProductForm>({ name: '', barcode: '', price: '', stock: '' })
    const [validationError, setValidationError] = useState('')
    const nameInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!isOpen || !barcode) return
        let cancelled = false
        queueMicrotask(() => {
            if (cancelled) return
            setForm((current) => ({ ...current, barcode }))
        })

        fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`)
            .then((res) => res.json())
            .then((data) => {
                if (cancelled) return
                const name = data?.product?.product_name || data?.product?.generic_name
                if (name) {
                    setForm((current) => ({ ...current, name: current.name || name }))
                }
            })
            .catch(() => {})

        return () => {
            cancelled = true
        }
    }, [isOpen, barcode])

    useEffect(() => {
        if (!isOpen) return

        function handleKeydown(event: KeyboardEvent) {
            if (event.key === 'Escape') onCancel()
        }

        document.addEventListener('keydown', handleKeydown)
        return () => document.removeEventListener('keydown', handleKeydown)
    }, [isOpen, onCancel])

    if (!isOpen) return null

    const message = validationError || error

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (isSaving) return

        const name = form.name.trim()
        const normalizedBarcode = form.barcode.trim()
        const price = parsePrice(form.price)
        const stock = Number(form.stock.trim())

        if (!name) {
            setValidationError('Informe o nome do produto.')
            nameInputRef.current?.focus()
            return
        }
        if (!normalizedBarcode) {
            setValidationError('Informe o código de barras.')
            return
        }
        if (!Number.isFinite(price) || price <= 0) {
            setValidationError('Informe um preço válido maior que zero.')
            return
        }
        if (!Number.isInteger(stock) || stock < 0) {
            setValidationError('Informe um estoque válido com número inteiro.')
            return
        }

        setValidationError('')
        onConfirm({ name, barcode: normalizedBarcode, price, stock })
    }

    return (
        <>
            <div className="quick-product-overlay" onClick={onCancel} />
            <div
                className="quick-product-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="quick-product-title"
            >
                <div className="quick-product-header">
                    <div className="quick-product-heading">
                        <span className="quick-product-icon" aria-hidden="true">
                            <PackagePlus size={20} />
                        </span>
                        <div>
                            <h2 id="quick-product-title">Produto não cadastrado</h2>
                            <p>O código lido não existe no catálogo desta unidade.</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="quick-product-close"
                        onClick={onCancel}
                        aria-label="Fechar"
                        title="Fechar"
                    >
                        <X size={19} />
                    </button>
                </div>

                <form className="quick-product-body" onSubmit={handleSubmit}>
                    <p className="quick-product-question">
                        Deseja cadastrar o produto com o código <strong>{barcode}</strong> agora?
                    </p>

                    <label htmlFor="quick-product-name">Nome do produto</label>
                    <input
                        ref={nameInputRef}
                        id="quick-product-name"
                        value={form.name}
                        onChange={(event) => {
                            setForm((current) => ({ ...current, name: event.target.value }))
                            setValidationError('')
                        }}
                        placeholder="Ex.: Pão francês"
                        autoComplete="off"
                        maxLength={120}
                    />

                    <label htmlFor="quick-product-barcode">Código de barras</label>
                    <input
                        id="quick-product-barcode"
                        value={form.barcode}
                        onChange={(event) => {
                            setForm((current) => ({ ...current, barcode: event.target.value }))
                            setValidationError('')
                        }}
                        autoComplete="off"
                    />

                    <div className="quick-product-row">
                        <div>
                            <label htmlFor="quick-product-price">Preço de venda</label>
                            <input
                                id="quick-product-price"
                                inputMode="decimal"
                                value={form.price}
                                onChange={(event) => {
                                    const nextValue = event.target.value
                                    if (!moneyInputPattern.test(nextValue)) return

                                    setForm((current) => ({ ...current, price: nextValue }))
                                    setValidationError('')
                                }}
                                placeholder="0,00"
                                autoComplete="off"
                            />
                        </div>
                        <div>
                            <label htmlFor="quick-product-stock">Estoque inicial</label>
                            <input
                                id="quick-product-stock"
                                inputMode="numeric"
                                value={form.stock}
                                onChange={(event) => {
                                    const nextValue = event.target.value.replace(/[^\d]/g, '')
                                    setForm((current) => ({ ...current, stock: nextValue }))
                                    setValidationError('')
                                }}
                                placeholder="0"
                                autoComplete="off"
                            />
                        </div>
                    </div>

                    {message && <p className="quick-product-error" role="alert">{message}</p>}

                    <div className="quick-product-actions">
                        <button type="button" className="quick-product-cancel" onClick={onCancel}>
                            Cancelar
                        </button>
                        <button type="submit" className="quick-product-confirm" disabled={isSaving}>
                            {isSaving ? 'Cadastrando...' : 'Cadastrar e adicionar'}
                        </button>
                    </div>
                </form>
            </div>
        </>
    )
}
