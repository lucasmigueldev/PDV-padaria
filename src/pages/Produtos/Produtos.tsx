import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
    AlertTriangle,
    BarChart3,
    Edit3,
    History,
    LayoutDashboard,
    Package,
    Plus,
    Receipt,
    Search,
    Settings,
    ShoppingCart,
    Trash2,
    X,
} from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'

import { addProduct, deleteProduct, getProductsFromSupabase, normalizeBarcode, updateProduct } from '../../data/products'
import type { Product, ProductWithStock } from '../../types/Product'
import { useBakeries } from '../../hooks/useBakeries'
import { useAuth } from '../../contexts/AuthContext'
import { logoutAndRedirect } from '../../utils/auth'
import AppTopbar from '../../components/AppTopbar/AppTopbar'
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
    const { authenticatedUser } = useAuth()
    const isOwner = authenticatedUser?.role === 'owner'
    const { bakeries } = useBakeries()
    const bakeryId = authenticatedUser?.role === 'cashier' ? authenticatedUser.bakeryId : null
    const bakeryName = bakeryId
        ? bakeries.find((bakery) => bakery.id === bakeryId)?.name ?? 'Unidade indisponível'
        : null
    const userRoleLabel = isOwner ? 'Proprietário' : 'Operador'

    const [productList, setProductList] = useState<ProductWithStock[]>([])
    const [isLoadingProducts, setIsLoadingProducts] = useState(true)
    const [productsLoadError, setProductsLoadError] = useState('')
    const [search, setSearch] = useState('')
    const [form, setForm] = useState<ProductForm>(emptyForm)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isFormOpen, setIsFormOpen] = useState(false)
    const [formError, setFormError] = useState('')
    const [successMessage, setSuccessMessage] = useState('')
    const [isSavingProduct, setIsSavingProduct] = useState(false)
    const [productPendingDeletion, setProductPendingDeletion] = useState<Product | null>(null)
    const [isDeletingProduct, setIsDeletingProduct] = useState(false)
    const [deleteError, setDeleteError] = useState('')
    const confirmDeletionButtonRef = useRef<HTMLButtonElement>(null)
    const isSavingProductRef = useRef(false)
    const isDeletingProductRef = useRef(false)

    useEffect(() => {
        let isActive = true
        void (async () => {
            await Promise.resolve()
            if (!isActive) return

            setIsLoadingProducts(true)
            setProductsLoadError('')
            try {
                const products = await getProductsFromSupabase(bakeryId)
                if (isActive) setProductList(products)
            } catch (error: unknown) {
                if (isActive) {
                    console.error('Erro ao carregar o catálogo de produtos.', error)
                    setProductsLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os produtos.')
                }
            } finally {
                if (isActive) setIsLoadingProducts(false)
            }
        })()

        return () => {
            isActive = false
        }
    }, [bakeryId])

    useEffect(() => {
        if (!productPendingDeletion) return

        confirmDeletionButtonRef.current?.focus()

        function handleEscape(event: KeyboardEvent) {
            if (event.key === 'Escape' && !isDeletingProductRef.current) {
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
        void logoutAndRedirect(navigate)
    }

    function openNewProduct() {
        if (isOwner) return
        setEditingId(null)
        setIsFormOpen(true)
        setForm(emptyForm)
        setFormError('')
        setSuccessMessage('')
    }

    function openEditProduct(product: ProductWithStock) {
        if (isOwner) return
        setEditingId(product.id)
        setIsFormOpen(true)
        setSuccessMessage('')
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

    async function saveProduct(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (isSavingProductRef.current) return

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

        if (isOwner) {
            setFormError('O proprietário pode consultar os produtos, mas não cadastrá-los nem editá-los.')
            return
        }
        if (!bakeryId) {
            setFormError('Não foi possível identificar a unidade do operador.')
            return
        }

        const productData = { name, barcode, price, stock }
        isSavingProductRef.current = true
        setIsSavingProduct(true)
        setFormError('')
        setSuccessMessage('')
        try {
            if (editingId) {
                const updatedProduct = await updateProduct(editingId, productData)
                setProductList((products) => products.map((product) => (
                    product.id === editingId ? updatedProduct : product
                )))
                setSuccessMessage('Produto atualizado com sucesso.')
            } else {
                const newProduct = await addProduct(productData)
                setProductList((products) => [...products, newProduct])
                setSuccessMessage('Produto cadastrado com sucesso.')
            }
            closeForm()
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('O produto foi salvo, mas')) {
                setSuccessMessage(error.message)
                closeForm()
            } else if (error instanceof TypeError) {
                console.error('Não foi possível confirmar o salvamento do produto.', error)
                setFormError('Não foi possível confirmar se o produto foi salvo. Atualize a lista antes de tentar novamente, para evitar duplicidades.')
            } else {
                console.error('Erro inesperado ao cadastrar produto.', error)
                setFormError(error instanceof Error
                    ? error.message
                    : 'Não foi possível salvar o produto. Confira os dados e tente novamente.')
            }
        } finally {
            isSavingProductRef.current = false
            setIsSavingProduct(false)
        }
    }

    function requestProductDeletion(product: Product) {
        if (isOwner || isDeletingProductRef.current) return
        setProductPendingDeletion(product)
        setDeleteError('')
    }

    async function confirmProductDeletion() {
        if (!productPendingDeletion || isOwner || isDeletingProductRef.current) return
        isDeletingProductRef.current = true
        setIsDeletingProduct(true)
        setDeleteError('')
        setSuccessMessage('')
        try {
            await deleteProduct(productPendingDeletion.id)
            setProductList((products) => products.filter((product) => product.id !== productPendingDeletion.id))
            if (editingId === productPendingDeletion.id) closeForm()
            setProductPendingDeletion(null)
            setSuccessMessage('Produto excluído com sucesso.')
        } catch (error: unknown) {
            if (error instanceof TypeError) {
                console.error('Não foi possível confirmar a exclusão do produto.', error)
                setDeleteError('Não foi possível confirmar se o produto foi excluído. Atualize a lista antes de tentar novamente.')
            } else {
                console.error('Erro inesperado ao excluir produto.', error)
                setDeleteError(error instanceof Error
                    ? error.message
                    : 'Não foi possível excluir o produto. Atualize a lista e tente novamente.')
            }
        } finally {
            isDeletingProductRef.current = false
            setIsDeletingProduct(false)
        }
    }

    return (
        <div
            className="products-layout"
            onKeyDown={(event) => {
                if (!isFormOpen || event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return

                event.preventDefault()
                closeForm()
            }}
        >
            <AppTopbar
                userName={authenticatedUser?.name}
                bakeryName={bakeryName}
                userRole={userRoleLabel}
                onLogout={handleLogout}
            />

            <div className="products-body">
            <aside className="products-sidebar">
                <div className="products-brand">
                    <div className="products-logo-icon">
                        <ShoppingCart size={22} />
                    </div>
                    <div>
                        <strong>Padaria PDV</strong>
                        <span>Sistema de vendas</span>
                    </div>
                </div>

                <nav className="products-navigation" aria-label={isOwner ? 'Navegação administrativa' : 'Atalhos operacionais'}>
                    {isOwner ? (
                        <>
                            <span className="products-sidebar-label">Administração</span>
                            <Link to="/dashboard" className="products-nav-link"><LayoutDashboard size={19} /><span>Painel</span></Link>
                            <Link to="/historico-fechamentos" className="products-nav-link"><History size={19} /><span>Histórico de Fechamentos</span></Link>
                            <Link to="/relatorios" className="products-nav-link"><BarChart3 size={19} /><span>Relatórios</span></Link>
                        </>
                    ) : (
                        <>
                            <span className="products-sidebar-label">Operação</span>
                            <Link to="/produtos" className="products-shortcut-link active" aria-current="page">
                                <Package size={20} /><span>Produtos</span><kbd>F2</kbd>
                            </Link>
                            <Link to="/fechamento" className="products-shortcut-link">
                                <Receipt size={20} /><span>Fechamento</span><kbd>F3</kbd>
                            </Link>
                            <Link to="/historico-vendas" className="products-shortcut-link">
                                <History size={20} /><span>Histórico de Vendas</span>
                            </Link>
                            <Link to="/pdv" className="products-shortcut-link">
                                <ShoppingCart size={20} /><span>Voltar ao PDV</span><kbd>F4</kbd>
                            </Link>
                        </>
                    )}
                </nav>

                <div className="products-sidebar-bottom">
                    {isOwner && <Link to="/configuracoes" className="products-nav-link"><Settings size={19} /><span>Configurações</span></Link>}
                </div>
            </aside>

            <main className="products-main">
                <header className="products-page-heading">
                    <div>
                        <span>CATÁLOGO OPERACIONAL</span>
                        <h1>Produtos</h1>
                        <p>Gerenciamento do catálogo de produtos</p>
                    </div>
                </header>

                <section className="products-content">
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
                        {!isOwner && (
                            <button type="button" className="products-primary-button" onClick={openNewProduct}>
                                <Plus size={20} />
                                Novo produto
                            </button>
                        )}
                    </div>

                    {successMessage && <p className="products-success-message" role="status">{successMessage}</p>}

                    {isFormOpen && (
                        <form className="product-form-panel" onSubmit={saveProduct}>
                            <div className="product-form-heading">
                                <div>
                                    <h2>{editingId ? 'Editar produto' : 'Novo produto'}</h2>
                                    <p>Preencha os dados do produto para atualizar o catálogo.</p>
                                </div>
                                <button type="button" className="products-icon-button" onClick={closeForm} aria-label="Fechar formulário" title="Fechar formulário" disabled={isSavingProduct}><X size={18} /></button>
                            </div>
                            <div className="product-form-grid">
                                <label>Nome do produto<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                                <label>Código de barras<input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} inputMode="numeric" /></label>
                                <label>Preço<input value={form.price} onChange={(event) => setForm({ ...form, price: formatPriceInput(event.target.value) })} placeholder="0,00" inputMode="decimal" /></label>
                                <label>Estoque inicial<input value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value.replace(/\D/g, '') })} inputMode="numeric" /></label>
                            </div>
                            {formError && <p className="products-form-error" role="alert">{formError}</p>}
                            <div className="product-form-actions">
                                <button type="button" className="products-secondary-button" onClick={closeForm} aria-keyshortcuts="Escape" disabled={isSavingProduct}>
                                    <span>Cancelar</span><kbd className="products-button-shortcut">ESC</kbd>
                                </button>
                                <button type="submit" className="products-primary-button" aria-keyshortcuts="Enter" disabled={isSavingProduct}>
                                    <span>{isSavingProduct ? 'Salvando...' : 'Salvar produto'}</span>
                                    {!isSavingProduct && <kbd className="products-button-shortcut">ENTER</kbd>}
                                </button>
                            </div>
                        </form>
                    )}

                    <section className="products-table-panel">
                        <div className="products-section-heading">
                            <div><h2>Produtos cadastrados</h2><p>{filteredProducts.length} produto(s) encontrado(s)</p></div>
                            <Package size={21} aria-hidden="true" />
                        </div>
                        <div className="products-table-wrapper">
                            {productsLoadError && <div className="products-empty-state" role="alert">{productsLoadError}</div>}
                            <table>
                                <thead><tr><th>Produto</th><th>Código de barras</th><th>Preço</th><th>Estoque</th>{!isOwner && <th>Ações</th>}</tr></thead>
                                <tbody>
                                    {!productsLoadError && filteredProducts.map((product) => (
                                        <tr key={product.id}>
                                            <td className="products-name">{product.name}</td>
                                            <td>{product.barcode}</td>
                                            <td>{currency.format(product.price)}</td>
                                            <td>{product.stock}</td>
                                            {!isOwner && (
                                                <td><div className="products-actions">
                                                    <button type="button" className="products-action-button" onClick={() => openEditProduct(product)}><Edit3 size={16} />Editar</button>
                                                    <button type="button" className="products-action-button products-delete-button" onClick={() => requestProductDeletion(product)}><Trash2 size={16} />Excluir</button>
                                                </div></td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!productsLoadError && !isLoadingProducts && filteredProducts.length === 0 && <div className="products-empty-state">Nenhum produto encontrado.</div>}
                            {isLoadingProducts && <div className="products-empty-state" role="status">Carregando produtos...</div>}
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
                        {deleteError && <p className="products-form-error" role="alert">{deleteError}</p>}
                        <div className="product-delete-actions">
                            <button
                                type="button"
                                className="products-secondary-button"
                                onClick={() => {
                                    setProductPendingDeletion(null)
                                    setDeleteError('')
                                }}
                                disabled={isDeletingProduct}
                            >
                                Cancelar
                            </button>
                            <button
                                ref={confirmDeletionButtonRef}
                                type="button"
                                className="product-confirm-delete-button"
                                onClick={confirmProductDeletion}
                                disabled={isDeletingProduct}
                            >
                                <Trash2 size={16} />
                                {isDeletingProduct ? 'Excluindo...' : 'Excluir'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    )
}
