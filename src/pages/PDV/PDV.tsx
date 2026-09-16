import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
    BarChart3,
    Banknote,
    Calculator,
    CreditCard,
    LogOut,
    Minus,
    Package,
    Plus,
    QrCode,
    Receipt,
    Settings,
    ShoppingCart,
    Trash2,
    X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { getProducts } from '../../data/products'
import type { SaleItem } from '../../types/Product'
import '../Dashboard/Dashborad.css'
import './PDV.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

type PaymentMethod = 'cash' | 'pix' | 'card'

export default function PDV() {
    const navigate = useNavigate()
    const barcodeInputRef = useRef<HTMLInputElement>(null)
    const [barcode, setBarcode] = useState('')
    const [items, setItems] = useState<SaleItem[]>([])
    const [errorMessage, setErrorMessage] = useState('')
    const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
    const [checkoutMessage, setCheckoutMessage] = useState('')
    const closeCheckoutButtonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        barcodeInputRef.current?.focus()
    }, [])

    useEffect(() => {
        if (!isCheckoutOpen) return

        closeCheckoutButtonRef.current?.focus()

        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') setIsCheckoutOpen(false)
        }

        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [isCheckoutOpen])

    function handleLogout() {
        sessionStorage.removeItem('isAuthenticated')
        navigate('/login', { replace: true })
    }

    function addProduct(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setErrorMessage('')
        const normalizedBarcode = barcode.trim()
        const product = getProducts().find((item) => item.barcode.trim() === normalizedBarcode)

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

        if (existingItem && existingItem.quantity >= product.stock) {
            setErrorMessage('Limite de estoque atingido.')
            barcodeInputRef.current?.focus()
            return
        }

        setItems((currentItems) => {
            const currentItem = currentItems.find((item) => item.barcode === product.barcode)

            if (currentItem) {
                return currentItems.map((item) =>
                    item.barcode === product.barcode
                        ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) }
                        : item,
                )
            }

            return [...currentItems, { ...product, quantity: 1 }]
        })
        setBarcode('')
        barcodeInputRef.current?.focus()
    }

    function updateQuantity(id: string, amount: number) {
        const currentItem = items.find((item) => item.id === id)
        const catalogProduct = getProducts().find((product) => product.id === id)
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

        setPaymentMethod(null)
        setCheckoutMessage('')
        setIsCheckoutOpen(true)
    }

    function closeCheckout() {
        setIsCheckoutOpen(false)
        setCheckoutMessage('')
    }

    function continueCheckout() {
        if (!paymentMethod) {
            setCheckoutMessage('Selecione uma forma de pagamento para continuar.')
            return
        }

        setCheckoutMessage('Forma de pagamento selecionada. A confirmação da venda será implementada em uma próxima etapa.')
    }

    const totalItems = items.reduce((total, item) => total + item.quantity, 0)
    const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0)

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
                        <BarChart3 size={19} />
                        <span>Dashboard</span>
                    </a>
                    <a href="/pdv" className="sidebar-link active">
                        <ShoppingCart size={19} />
                        <span>Caixa</span>
                    </a>
                    <a href="#" className="sidebar-link">
                        <Calculator size={19} />
                        <span>Fechamento</span>
                    </a>
                    <a href="/produtos" className="sidebar-link">
                        <Package size={19} />
                        <span>Produtos</span>
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
                        <span className="header-overline">OPERAÇÃO DE VENDAS</span>
                        <h1>PDV</h1>
                        <p>Registre os produtos e finalize a venda do cliente.</p>
                    </div>
                    <div className="header-user flex items-center gap-3">
                        <div className="user-avatar">A</div>
                        <div>
                            <strong>Administrador</strong>
                            <span>Usuário do sistema</span>
                        </div>
                    </div>
                </header>

                <section className="dashboard-content pdv-content p-10">
                    <form className="pdv-add-product" onSubmit={addProduct}>
                        <div className="pdv-section-heading">
                            <div>
                                <h2>Adicionar produto</h2>
                                <p>Use o código de barras para incluir um item na venda.</p>
                            </div>
                            <Receipt size={21} aria-hidden="true" />
                        </div>
                        <div className="pdv-product-form">
                            <label htmlFor="barcode">Código de barras</label>
                            <div className="pdv-product-fields">
                                <input
                                    ref={barcodeInputRef}
                                    id="barcode"
                                    value={barcode}
                                    onChange={(event) => setBarcode(event.target.value)}
                                    placeholder="Digite ou bip o código de barras"
                                    autoComplete="off"
                                />
                                <button type="submit" className="pdv-primary-button">
                                    <Plus size={18} />
                                    Adicionar produto
                                </button>
                            </div>
                            {errorMessage && <p className="pdv-error-message" role="alert">{errorMessage}</p>}
                        </div>
                    </form>

                    <div className="pdv-sale-grid">
                        <section className="pdv-sale-panel">
                            <div className="pdv-section-heading">
                                <div>
                                    <h2>Itens da venda</h2>
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
                                                <th>Produto</th>
                                                <th>Código</th>
                                                <th>Quantidade</th>
                                                <th>Preço unitário</th>
                                                <th>Subtotal</th>
                                                <th><span className="sr-only">Ação</span></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((item) => (
                                                <tr key={item.id}>
                                                    <td className="pdv-product-name">{item.name}</td>
                                                    <td>{item.barcode}</td>
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
                            <div className="pdv-section-heading">
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
                                className="pdv-finish-button"
                                disabled={items.length === 0}
                                onClick={openCheckout}
                            >
                                Finalizar venda
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
                                <span className="pdv-checkout-overline">RESUMO DA VENDA</span>
                                <h2 id="pdv-checkout-title">Finalizar venda</h2>
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
                                    onClick={() => { setPaymentMethod('cash'); setCheckoutMessage('') }}
                                    role="radio"
                                    aria-checked={paymentMethod === 'cash'}
                                >
                                    <Banknote size={20} />
                                    <span>Dinheiro</span>
                                </button>
                                <button
                                    type="button"
                                    className={`pdv-payment-option ${paymentMethod === 'pix' ? 'selected' : ''}`}
                                    onClick={() => { setPaymentMethod('pix'); setCheckoutMessage('') }}
                                    role="radio"
                                    aria-checked={paymentMethod === 'pix'}
                                >
                                    <QrCode size={20} />
                                    <span>PIX</span>
                                </button>
                                <button
                                    type="button"
                                    className={`pdv-payment-option ${paymentMethod === 'card' ? 'selected' : ''}`}
                                    onClick={() => { setPaymentMethod('card'); setCheckoutMessage('') }}
                                    role="radio"
                                    aria-checked={paymentMethod === 'card'}
                                >
                                    <CreditCard size={20} />
                                    <span>Cartão</span>
                                </button>
                            </div>
                        </div>

                        {checkoutMessage && <p className="pdv-checkout-message" role="alert">{checkoutMessage}</p>}

                        <div className="pdv-checkout-actions">
                            <button type="button" className="pdv-checkout-cancel" onClick={closeCheckout}>
                                Cancelar
                            </button>
                            <button type="button" className="pdv-checkout-continue" onClick={continueCheckout}>
                                Continuar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}