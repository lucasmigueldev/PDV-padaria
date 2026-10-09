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

function throwProductSaveError(error: { code?: string; message: string }): never {
    console.error('Erro ao cadastrar produto no Supabase.', error)

    if (error.code === '23505') throw new Error('DUPLICATE_BARCODE')
    if (error.code === '42501') throw new Error('PRODUCT_PERMISSION_DENIED')

    throw new Error('PRODUCT_SAVE_FAILED')
}

export async function addProduct(
    product: Omit<ProductWithStock, 'id'>,
    bakeryId: string,
    stockBakeryId: string,
): Promise<{ product: Product; initialStockSaved: boolean }> {
    const normalizedBarcode = normalizeBarcode(product.barcode)
    const { data, error } = await getSupabaseClient()
        .from('products')
        .insert({
            name: product.name.trim(),
            barcode: normalizedBarcode,
            price: product.price,
            bakery_id: bakeryId,
        })
        .select('id, barcode, name, price')
        .single()

    if (error) throwProductSaveError(error)

    const newProduct = data as ProductRecord
    let initialStockSaved = true
    try {
        updateProductStock(newProduct.id, stockBakeryId, product.stock)
    } catch (stockError: unknown) {
        console.error('Produto cadastrado, mas não foi possível salvar o estoque inicial localmente.', stockError)
        initialStockSaved = false
    }

    return {
        product: {
            id: newProduct.id,
            barcode: normalizeBarcode(newProduct.barcode),
            name: newProduct.name,
            price: newProduct.price,
        },
        initialStockSaved,
    }
}

export async function updateProduct(
    id: string,
    product: Omit<ProductWithStock, 'id'>,
    bakeryId: string,
    stockBakeryId: string,
): Promise<{ product: Product; stockSaved: boolean }> {
    const normalizedBarcode = normalizeBarcode(product.barcode)
    const { data, error } = await getSupabaseClient()
        .from('products')
        .update({
            name: product.name.trim(),
            barcode: normalizedBarcode,
            price: product.price,
        })
        .eq('id', id)
        .eq('bakery_id', bakeryId)
        .select('id, barcode, name, price')
        .maybeSingle()

    if (error) throwProductMutationError(error, 'PRODUCT_UPDATE_FAILED')
    if (!data) throw new Error('PRODUCT_NOT_FOUND_OR_PERMISSION_DENIED')

    let stockSaved = true
    try {
        updateProductStock(id, stockBakeryId, product.stock)
    } catch (stockError: unknown) {
        console.error('Produto atualizado no Supabase, mas não foi possível atualizar o estoque local.', stockError)
        stockSaved = false
    }

    const updatedProduct = data as ProductRecord
    return {
        product: {
            id: updatedProduct.id,
            barcode: normalizeBarcode(updatedProduct.barcode),
            name: updatedProduct.name,
            price: updatedProduct.price,
        },
        stockSaved,
    }
}

function updateProductStock(productId: string, bakeryId: string, quantity: number): void {
    const stocks = readStocks()
    const stockIndex = stocks.findIndex((stock) => stock.productId === productId && stock.bakeryId === bakeryId)
    const nextStock = { productId, bakeryId, quantity }
    if (stockIndex === -1) stocks.push(nextStock)
    else stocks[stockIndex] = nextStock
    persistStocks(stocks)
}

function throwProductMutationError(
    error: { code?: string; message: string },
    fallbackCode: 'PRODUCT_UPDATE_FAILED' | 'PRODUCT_DELETE_FAILED',
): never {
    console.error('Erro ao alterar produto no Supabase.', error)

    if (error.code === '23505') throw new Error('DUPLICATE_BARCODE')
    if (error.code === '42501') throw new Error('PRODUCT_PERMISSION_DENIED')

    throw new Error(fallbackCode)
}

function removeLocalProductReferences(id: string): boolean {
    let referencesRemoved = true

    try {
        const storedProducts = localStorage.getItem(STORAGE_KEY)
        if (storedProducts) {
            const parsedProducts: unknown = JSON.parse(storedProducts)
            if (!Array.isArray(parsedProducts)) throw new Error('Formato inválido no catálogo local.')

            const remainingProducts = parsedProducts.filter((product: unknown) => (
                !product
                || typeof product !== 'object'
                || !('id' in product)
                || product.id !== id
            ))
            persistProducts(remainingProducts as Product[])
        }
    } catch (error: unknown) {
        console.error('Não foi possível remover o produto do catálogo local.', error)
        referencesRemoved = false
    }

    try {
        const storedStocks = localStorage.getItem(STOCK_STORAGE_KEY)
        if (storedStocks) {
            const parsedStocks: unknown = JSON.parse(storedStocks)
            if (!Array.isArray(parsedStocks)) throw new Error('Formato inválido no estoque local.')

            const remainingStocks = parsedStocks.filter((stock: unknown) => (
                !stock
                || typeof stock !== 'object'
                || !('productId' in stock)
                || stock.productId !== id
            ))
            persistStocks(remainingStocks as ProductStock[])
        }
    } catch (error: unknown) {
        console.error('Não foi possível remover o estoque local do produto.', error)
        referencesRemoved = false
    }

    return referencesRemoved
}

export async function deleteProduct(
    id: string,
    bakeryId: string,
): Promise<{ localReferencesRemoved: boolean }> {
    const { data, error } = await getSupabaseClient()
        .from('products')
        .delete()
        .eq('id', id)
        .eq('bakery_id', bakeryId)
        .select('id')
        .maybeSingle()

    if (error) throwProductMutationError(error, 'PRODUCT_DELETE_FAILED')
    if (!data) throw new Error('PRODUCT_NOT_FOUND_OR_PERMISSION_DENIED')

    return { localReferencesRemoved: removeLocalProductReferences(id) }
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
