import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
    AlertTriangle,
    BarChart3,
    Calculator,
    Edit3,
    History,
    LayoutDashboard,
    LogOut,
    Package,
    Plus,
    Search,
    Settings,
    ShoppingCart,
    Trash2,
    X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { addProduct, deleteProduct, getProducts, normalizeBarcode, updateProduct } from '../../data/products'
import type { Product } from '../../types/Product'
import '../Dashboard/Dashborad.css'
import './Produtos.css'

const currency = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
})

type ProductForm = {
    name: string
    barcode: string
    price: string
    stock: string
}

const emptyForm: ProductForm = {
    name: '',
    barcode: '',
    price: '',
    stock: '',
}

function formatPriceInput(value: string): string {
    return value.replace(/[^\d,.-]/g, '').replace('.', ',')
}

function parsePrice(value: string): number {
    const normalizedValue = value.includes(',')
        ? value.replace(/\./g, '').replace(',', '.')
        : value

    return Number(normalizedValue)
}

export default function Produtos() {
    const navigate = useNavigate()
    const [productList, setProductList] = useState<Product[]>(getProducts)
    const [search, setSearch] = useState('')
    const [form, setForm] = useState<ProductForm>(emptyForm)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isFormOpen, setIsFormOpen] = useState(false)
    const [formError, setFormError] = useState('')
    const [productPendingDeletion, setProductPendingDeletion] = useState<Product | null>(null)
    const confirmDeletionButtonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        if (!productPendingDeletion) return

        confirmDeletionButtonRef.current?.focus()

        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                setProductPendingDeletion(null)
            }
        }

        window.addEventListener('keydown', handleEscape)
        return () => window.removeEventListener('keydown', handleEscape)
    }, [productPendingDeletion])

    const filteredProducts = useMemo(() => {
        const normalizedSearch = search.trim().toLocaleLowerCase()

        if (!normalizedSearch) return productList

        return productList.filter((product) =>
            product.name.toLocaleLowerCase().includes(normalizedSearch) ||
            product.barcode.includes(normalizedSearch),
        )
    }, [productList, search])

    function handleLogout() {
        sessionStorage.removeItem('isAuthenticated')
        navigate('/login', { replace: true })
    }

    function openNewProduct() {
        setEditingId(null)
        setIsFormOpen(true)
        setForm(emptyForm)
        setFormError('')
    }

    function openEditProduct(product: Product) {
        setEditingId(product.id)
        setIsFormOpen(true)
        setForm({
            name: product.name,
            barcode: product.barcode,
            price: product.price.toFixed(2).replace('.', ','),
            stock: String(product.stock),
        })
        setFormError('')
    }

    function closeForm() {
        setEditingId(null)
        setIsFormOpen(false)
        setForm(emptyForm)
        setFormError('')
    }

    function saveProduct(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const name = form.name.trim()
        const barcode = normalizeBarcode(form.barcode)
        const price = parsePrice(form.price)
        const stock = Number(form.stock)
        const duplicate = productList.some(
            (product) => normalizeBarcode(product.barcode) === barcode && product.id !== editingId,
        )

        if (!name) {
            setFormError('Informe o nome do produto.')
            return
        }
        if (!barcode) {
            setFormError('Informe o código de barras.')
            return
        }
        if (duplicate) {
            setFormError('Já existe um produto cadastrado com este código de barras.')
            return
        }
        if (!Number.isFinite(price) || price <= 0) {
            setFormError('Informe um preço válido maior que zero.')
            return
        }
        if (!form.stock.trim() || !Number.isInteger(stock) || stock < 0) {
            setFormError('Informe um estoque válido com número inteiro.')
            return
        }

        const productData = { name, barcode, price, stock }
        try {
            if (editingId) {
                updateProduct(editingId, productData)
            } else {
                addProduct(productData)
            }
        } catch (error) {
            if (error instanceof Error && error.message === 'DUPLICATE_BARCODE') {
                setFormError('Já existe um produto cadastrado com este código de barras.')
                return
            }

            setFormError('Não foi possível salvar o produto.')
            return
        }
        setProductList(getProducts())
        closeForm()
    }

    function requestProductDeletion(product: Product) {
        setProductPendingDeletion(product)
    }

    function confirmProductDeletion() {
        if (!productPendingDeletion) return

        deleteProduct(productPendingDeletion.id)
        setProductList(getProducts())
        if (editingId === productPendingDeletion.id) closeForm()
        setProductPendingDeletion(null)
    }

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
                    <a href="/dashboard" className="sidebar-link"><LayoutDashboard size={19} /><span>Dashboard</span></a>
                    <a href="/pdv" className="sidebar-link"><ShoppingCart size={19} /><span>Caixa</span></a>
                    <a href="/fechamento" className="sidebar-link"><Calculator size={19} /><span>Fechamento</span></a>
                    <a href="/produtos" className="sidebar-link active"><Package size={19} /><span>Produtos</span></a>
                    <a href="/historico-vendas" className="sidebar-link"><History size={19} /><span>Histórico de Vendas</span></a>
                    <a href="#" className="sidebar-link"><BarChart3 size={19} /><span>Relatórios</span></a>
                </nav>
                <div className="sidebar-bottom mt-auto flex flex-col gap-2">
                    <a href="#" className="sidebar-link"><Settings size={19} /><span>Configurações</span></a>
                    <button type="button" onClick={handleLogout} className="sidebar-link logout-button"><LogOut size={19} /><span>Sair</span></button>
                </div>
            </aside>

            <main className="dashboard-main ml-64 min-h-screen flex-1">
                <header className="dashboard-header flex items-center justify-between gap-6 bg-white px-10 py-7">
                    <div>
                        <span className="header-overline">CATÁLOGO</span>
                        <h1>Produtos</h1>
                        <p>Gerencie os produtos disponíveis para venda.</p>
                    </div>
                    <div className="header-user flex items-center gap-3">
                        <div className="user-avatar">A</div>
                        <div><strong>Administrador</strong><span>Usuário do sistema</span></div>
                    </div>
                </header>

                <section className="dashboard-content products-content p-10">
                    <div className="products-toolbar">
                        <div className="products-search">
                            <Search size={18} aria-hidden="true" />
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar por nome ou código de barras"
                                aria-label="Buscar produtos"
                            />
                        </div>
                        <button type="button" className="products-primary-button" onClick={openNewProduct}>
                            <Plus size={18} />
                            Novo produto
                        </button>
                    </div>

                    {isFormOpen && (
                        <form className="product-form-panel" onSubmit={saveProduct}>
                            <div className="product-form-heading">
                                <div>
                                    <h2>{editingId ? 'Editar produto' : 'Novo produto'}</h2>
                                    <p>Preencha os dados do produto para atualizar o catálogo.</p>
                                </div>
                                <button type="button" className="products-icon-button" onClick={closeForm} aria-label="Fechar formulário" title="Fechar formulário"><X size={18} /></button>
                            </div>
                            <div className="product-form-grid">
                                <label>Nome do produto<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                                <label>Código de barras<input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} inputMode="numeric" /></label>
                                <label>Preço<input value={form.price} onChange={(event) => setForm({ ...form, price: formatPriceInput(event.target.value) })} placeholder="0,00" inputMode="decimal" /></label>
                                <label>Estoque inicial<input value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value.replace(/\D/g, '') })} inputMode="numeric" /></label>
                            </div>
                            {formError && <p className="products-form-error" role="alert">{formError}</p>}
                            <div className="product-form-actions">
                                <button type="button" className="products-secondary-button" onClick={closeForm}>Cancelar</button>
                                <button type="submit" className="products-primary-button">Salvar produto</button>
                            </div>
                        </form>
                    )}

                    <section className="products-table-panel">
                        <div className="products-section-heading">
                            <div><h2>Produtos cadastrados</h2><p>{filteredProducts.length} produto(s) encontrado(s)</p></div>
                            <Package size={21} aria-hidden="true" />
                        </div>
                        <div className="products-table-wrapper">
                            <table>
                                <thead><tr><th>Produto</th><th>Código de barras</th><th>Preço</th><th>Estoque</th><th>Ações</th></tr></thead>
                                <tbody>
                                    {filteredProducts.map((product) => (
                                        <tr key={product.id}>
                                            <td className="products-name">{product.name}</td>
                                            <td>{product.barcode}</td>
                                            <td>{currency.format(product.price)}</td>
                                            <td>{product.stock}</td>
                                            <td><div className="products-actions">
                                                <button type="button" className="products-action-button" onClick={() => openEditProduct(product)}><Edit3 size={16} />Editar</button>
                                                <button type="button" className="products-action-button products-delete-button" onClick={() => requestProductDeletion(product)}><Trash2 size={16} />Excluir</button>
                                            </div></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filteredProducts.length === 0 && <div className="products-empty-state">Nenhum produto encontrado.</div>}
                        </div>
                    </section>
                </section>
            </main>

            {productPendingDeletion && (
                <div className="product-delete-overlay" role="presentation">
                    <div
                        className="product-delete-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-product-title"
                        aria-describedby="delete-product-description"
                    >
                        <div className="product-delete-icon" aria-hidden="true">
                            <AlertTriangle size={22} />
                        </div>
                        <h2 id="delete-product-title">Excluir produto?</h2>
                        <p id="delete-product-description">
                            Tem certeza que deseja excluir este produto? Esta ação não poderá ser desfeita.
                        </p>
                        <strong className="product-delete-name">{productPendingDeletion.name}</strong>
                        <div className="product-delete-actions">
                            <button
                                type="button"
                                className="products-secondary-button"
                                onClick={() => setProductPendingDeletion(null)}
                            >
                                Cancelar
                            </button>
                            <button
                                ref={confirmDeletionButtonRef}
                                type="button"
                                className="product-confirm-delete-button"
                                onClick={confirmProductDeletion}
                            >
                                <Trash2 size={16} />
                                Excluir
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
