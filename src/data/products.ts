import type { Product, ProductStock, ProductWithStock } from '../types/Product'
import type { SaleItemSnapshot } from '../types/Sale'
import { getSupabaseClient } from '../lib/supabaseClient'
import { defaultProductStockBakeryId } from '../utils/legacyBakeryIds'

const STORAGE_KEY = 'padaria-pdv-products'
const STOCK_STORAGE_KEY = 'padaria-pdv-product-stock'

const defaultProducts: Array<Product & { stock: number }> = [
    {
        id: '1',
        barcode: '7891000100015',
        name: 'Pão francês',
        price: 0.75,
        stock: 120,
    },
    {
        id: '2',
        barcode: '7891000100022',
        name: 'Café coado 200ml',
        price: 4.5,
        stock: 40,
    },
    {
        id: '3',
        barcode: '7891000100039',
        name: 'Bolo de milho',
        price: 8.9,
        stock: 15,
    },
    {
        id: '4',
        barcode: '7891000100046',
        name: 'Suco de laranja 300ml',
        price: 6.5,
        stock: 25,
    },
]

export const normalizeBarcode = (barcode: string | number): string => String(barcode).trim()

type ProductRecord = {
    id: string
    barcode: string
    name: string
    price: number
}

function persistProducts(productList: Product[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(productList))
}

function persistStocks(stockList: ProductStock[]): void {
    localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(stockList))
}

function readProducts(): Product[] {
    const storedProducts = localStorage.getItem(STORAGE_KEY)

    if (!storedProducts) {
        const catalog = defaultProducts.map(({ id, barcode, name, price }) => ({ id, barcode, name, price }))
        persistProducts(catalog)
        persistStocks(defaultProducts.map(({ id, stock }) => ({ productId: id, bakeryId: defaultProductStockBakeryId, quantity: stock })))
        return catalog
    }

    try {
        const parsedProducts = JSON.parse(storedProducts) as Array<Product & { stock?: number }>
        if (!Array.isArray(parsedProducts)) return []

        const seenBarcodes = new Set<string>()
        const catalog = parsedProducts.reduce<Product[]>((products, product) => {
            const barcode = normalizeBarcode(product.barcode)
            if (!barcode || seenBarcodes.has(barcode)) return products

            seenBarcodes.add(barcode)
            products.push({ id: product.id, barcode, name: product.name, price: product.price })
            return products
        }, [])
        const storedStocks = localStorage.getItem(STOCK_STORAGE_KEY)

        if (!storedStocks) {
            const legacyStocks = parsedProducts
                .filter((product) => typeof product.stock === 'number')
                .map((product) => ({ productId: product.id, bakeryId: defaultProductStockBakeryId, quantity: product.stock ?? 0 }))
            persistStocks(legacyStocks)
        }

        persistProducts(catalog)

        return catalog
    } catch {
        return []
    }
}

function readStocks(): ProductStock[] {
    const storedStocks = localStorage.getItem(STOCK_STORAGE_KEY)
    if (!storedStocks) return []

    try {
        const parsedStocks = JSON.parse(storedStocks) as ProductStock[]
        return Array.isArray(parsedStocks)
            ? parsedStocks.filter((stock) => typeof stock.productId === 'string' && typeof stock.bakeryId === 'string' && Number.isFinite(stock.quantity))
            : []
    } catch {
        return []
    }
}

export function getProducts(): Product[] {
    return [...readProducts()]
}

export async function getProductsFromSupabase(bakeryId: string | null): Promise<ProductWithStock[]> {
    const { data, error } = await getSupabaseClient()
        .from('products')
        .select('id, barcode, name, price')
        .order('name')

    if (error) {
        console.error('Erro ao carregar produtos no Supabase.', error)

        if (error.code === '42501') throw new Error('Você não tem permissão para consultar os produtos.')
        throw new Error('Não foi possível carregar os produtos.')
    }

    const stocks = readStocks()
    return (data as ProductRecord[]).map((record) => ({
        id: record.id,
        barcode: normalizeBarcode(record.barcode),
        name: record.name,
        price: record.price,
        stock: bakeryId
            ? stocks.find((stock) => stock.productId === record.id && stock.bakeryId === bakeryId)?.quantity ?? 0
            : stocks
                .filter((stock) => stock.productId === record.id)
                .reduce((total, stock) => total + stock.quantity, 0),
    }))
}

export function getProductsForBakery(bakeryId: string): ProductWithStock[] {
    const stocks = readStocks()
    return getProducts().map((product) => ({
        ...product,
        stock: stocks.find((stock) => stock.productId === product.id && stock.bakeryId === bakeryId)?.quantity ?? 0,
    }))
}

export function getTotalStockByProduct(productId: string): number {
    return readStocks()
        .filter((stock) => stock.productId === productId)
        .reduce((total, stock) => total + stock.quantity, 0)
}

export function getProductsWithTotalStock(): ProductWithStock[] {
    const stocks = readStocks()
    return getProducts().map((product) => ({
        ...product,
        stock: stocks
            .filter((stock) => stock.productId === product.id)
            .reduce((total, stock) => total + stock.quantity, 0),
    }))
}

export function addProduct(product: Omit<ProductWithStock, 'id'>, bakeryId: string): Product {
    const normalizedBarcode = normalizeBarcode(product.barcode)
    const products = getProducts()

    if (products.some((item) => item.barcode === normalizedBarcode)) throw new Error('DUPLICATE_BARCODE')

    const newProduct = { ...product, barcode: normalizedBarcode, id: crypto.randomUUID() }
    products.push(newProduct)
    persistProducts(products)
    persistStocks([...readStocks(), { productId: newProduct.id, bakeryId, quantity: product.stock }])
    return newProduct
}

export function updateProduct(id: string, product: Omit<ProductWithStock, 'id'>, bakeryId: string): Product | undefined {
    const products = getProducts()
    const productIndex = products.findIndex((item) => item.id === id)
    if (productIndex === -1) return undefined

    const normalizedBarcode = normalizeBarcode(product.barcode)
    if (products.some((item) => item.id !== id && item.barcode === normalizedBarcode)) throw new Error('DUPLICATE_BARCODE')

    const updatedProduct = {
        id,
        name: product.name,
        barcode: normalizedBarcode,
        price: product.price,
    }
    products[productIndex] = updatedProduct
    persistProducts(products)
    updateProductStock(id, bakeryId, product.stock)
    return updatedProduct
}

function updateProductStock(productId: string, bakeryId: string, quantity: number): void {
    const stocks = readStocks()
    const stockIndex = stocks.findIndex((stock) => stock.productId === productId && stock.bakeryId === bakeryId)
    const nextStock = { productId, bakeryId, quantity }
    if (stockIndex === -1) stocks.push(nextStock)
    else stocks[stockIndex] = nextStock
    persistStocks(stocks)
}

export function deleteProduct(id: string): void {
    persistProducts(getProducts().filter((product) => product.id !== id))
    persistStocks(readStocks().filter((stock) => stock.productId !== id))
}

export function decreaseStock(items: SaleItemSnapshot[], bakeryId: string): void {
    const stocks = readStocks()
    const quantitiesByProduct = new Map<string, number>()
    items.forEach((item) => quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity))

    for (const [productId, quantity] of quantitiesByProduct) {
        const stock = stocks.find((item) => item.productId === productId && item.bakeryId === bakeryId)
        if (!stock) throw new Error('INSUFFICIENT_STOCK')
        if (quantity > stock.quantity) throw new Error('INSUFFICIENT_STOCK')
    }

    persistStocks(stocks.map((stock) => {
        const quantity = bakeryId === stock.bakeryId ? quantitiesByProduct.get(stock.productId) ?? 0 : 0
        return quantity ? { ...stock, quantity: stock.quantity - quantity } : stock
    }))
}
