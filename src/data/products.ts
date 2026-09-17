import type { Product } from '../types/Product'
import type { SaleItemSnapshot } from '../types/Sale'

const STORAGE_KEY = 'padaria-pdv-products'

const defaultProducts: Product[] = [
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

function sanitizeProducts(productList: Product[]): Product[] {
    const seenBarcodes = new Set<string>()

    return productList.reduce<Product[]>((sanitizedProducts, product) => {
        const barcode = normalizeBarcode(product.barcode)

        if (!barcode || seenBarcodes.has(barcode)) return sanitizedProducts

        seenBarcodes.add(barcode)
        sanitizedProducts.push({ ...product, barcode })
        return sanitizedProducts
    }, [])
}

function readStoredProducts(): Product[] {
    const storedProducts = localStorage.getItem(STORAGE_KEY)

    if (!storedProducts) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultProducts))
        return [...defaultProducts]
    }

    try {
        const parsedProducts = JSON.parse(storedProducts) as Product[]
        return Array.isArray(parsedProducts) ? sanitizeProducts(parsedProducts) : [...defaultProducts]
    } catch {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultProducts))
        return [...defaultProducts]
    }
}

export const products: Product[] = readStoredProducts()
localStorage.setItem(STORAGE_KEY, JSON.stringify(products))

function persistProducts(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products))
}

export function getProducts(): Product[] {
    const storedProducts = localStorage.getItem(STORAGE_KEY)

    if (storedProducts) {
        try {
            const parsedProducts = JSON.parse(storedProducts) as Product[]

            if (Array.isArray(parsedProducts)) {
                products.splice(0, products.length, ...sanitizeProducts(parsedProducts))
            }
        } catch {
            // Keep the in-memory catalog when persisted data is invalid.
        }
    }

    return [...products]
}

export function addProduct(product: Omit<Product, 'id'>): Product {
    const normalizedBarcode = normalizeBarcode(product.barcode)

    if (products.some((item) => normalizeBarcode(item.barcode) === normalizedBarcode)) {
        throw new Error('DUPLICATE_BARCODE')
    }

    const newProduct: Product = {
        ...product,
        barcode: normalizedBarcode,
        id: crypto.randomUUID(),
    }

    products.push(newProduct)
    persistProducts()
    return newProduct
}

export function updateProduct(id: string, product: Omit<Product, 'id'>): Product | undefined {
    const productIndex = products.findIndex((item) => item.id === id)

    if (productIndex === -1) return undefined

    const normalizedBarcode = normalizeBarcode(product.barcode)
    const hasDuplicateBarcode = products.some(
        (item) => item.id !== id && normalizeBarcode(item.barcode) === normalizedBarcode,
    )

    if (hasDuplicateBarcode) {
        throw new Error('DUPLICATE_BARCODE')
    }

    products[productIndex] = { id, ...product, barcode: normalizedBarcode }
    persistProducts()
    return products[productIndex]
}

export function deleteProduct(id: string): void {
    const productIndex = products.findIndex((item) => item.id === id)

    if (productIndex !== -1) {
        products.splice(productIndex, 1)
        persistProducts()
    }
}

export function decreaseStock(items: SaleItemSnapshot[]): void {
    const currentProducts = getProducts()
    const quantitiesByProduct = new Map<string, number>()

    items.forEach((item) => {
        quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity)
    })

    const updatedProducts = currentProducts.map((product) => {
        const quantity = quantitiesByProduct.get(product.id) ?? 0

        if (quantity > product.stock) {
            throw new Error('INSUFFICIENT_STOCK')
        }

        return quantity > 0 ? { ...product, stock: product.stock - quantity } : product
    })

    for (const productId of quantitiesByProduct.keys()) {
        if (!currentProducts.some((product) => product.id === productId)) {
            throw new Error('PRODUCT_NOT_FOUND')
        }
    }

    products.splice(0, products.length, ...updatedProducts)
    persistProducts()
}
