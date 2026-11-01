import type { CashRegister } from '../types/CashRegister'
import type { ProductWithStock } from '../types/Product'
import {
    enqueueSale,
    getQueueSnapshot,
    type QueuedSale,
} from './offlineSalesQueue.ts'

const PRODUCT_CACHE_PREFIX = 'pdv_offline_products_v1_'
const CASH_REGISTER_CACHE_PREFIX = 'pdv_offline_confirmed_cash_register_v1_'
const SESSION_ID_KEY = 'pdv_offline_auth_session_v1'
const CASH_REGISTER_MAX_AGE_MS = 12 * 60 * 60 * 1000

type CachedCashRegister = {
    version: 1
    bakeryId: string
    userId: string
    sessionId: string
    confirmedAt: number
    register: CashRegister
}

type CachedProductCatalog = {
    version: 1
    bakeryId: string
    cachedAt: number
    products: ProductWithStock[]
    appliedSaleIds: string[]
}

const productsInMemory = new Map<string, CachedProductCatalog>()
const cashRegistersInMemory = new Map<string, CachedCashRegister>()
let volatileSessionId: string | null = null

function getCashRegisterKey(bakeryId: string, userId: string): string {
    return `${CASH_REGISTER_CACHE_PREFIX}${bakeryId}_${userId}`
}

function isProductWithStock(value: unknown, bakeryId: string): value is ProductWithStock {
    if (typeof value !== 'object' || value === null) {
        return false
    }

    const product = value as Record<string, unknown>
    return typeof product.id === 'string'
        && product.bakeryId === bakeryId
        && typeof product.name === 'string'
        && typeof product.barcode === 'string'
        && typeof product.price === 'number'
        && Number.isFinite(product.price)
        && product.price > 0
        && typeof product.stock === 'number'
        && Number.isSafeInteger(product.stock)
        && product.stock >= 0
}

function isCashRegister(value: unknown, bakeryId: string): value is CashRegister {
    if (typeof value !== 'object' || value === null) {
        return false
    }

    const register = value as Record<string, unknown>
    return typeof register.id === 'string'
        && register.bakeryId === bakeryId
        && typeof register.openedAt === 'string'
        && Number.isFinite(Date.parse(register.openedAt))
        && typeof register.initialAmount === 'number'
        && Number.isFinite(register.initialAmount)
        && register.initialAmount >= 0
        && (typeof register.operatorName === 'string' || register.operatorName === null)
}

function getSessionId(create: boolean): string | null {
    try {
        const existing = window.sessionStorage.getItem(SESSION_ID_KEY)
        if (existing) {
            return existing
        }
        if (!create) {
            return volatileSessionId
        }

        const sessionId = crypto.randomUUID()
        window.sessionStorage.setItem(SESSION_ID_KEY, sessionId)
        volatileSessionId = sessionId
        return sessionId
    } catch (error) {
        console.warn('Não foi possível acessar a sessão local do PDV.', error)
        if (!create && volatileSessionId) {
            return volatileSessionId
        }
        if (!volatileSessionId && create) {
            volatileSessionId = crypto.randomUUID()
        }
        return volatileSessionId
    }
}

function readProductCatalog(bakeryId: string): CachedProductCatalog | null {
    const inMemory = productsInMemory.get(bakeryId)
    if (inMemory) {
        return inMemory
    }

    try {
        const raw = window.localStorage.getItem(`${PRODUCT_CACHE_PREFIX}${bakeryId}`)
        if (raw === null) {
            return null
        }

        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null) {
            return null
        }
        const envelope = parsed as Record<string, unknown>
        if (envelope.version !== 1
            || envelope.bakeryId !== bakeryId
            || typeof envelope.cachedAt !== 'number'
            || !Number.isFinite(envelope.cachedAt)
            || !Array.isArray(envelope.products)
            || !envelope.products.every((product: unknown) => isProductWithStock(product, bakeryId))
            || (envelope.appliedSaleIds !== undefined
                && (!Array.isArray(envelope.appliedSaleIds)
                    || !envelope.appliedSaleIds.every((id: unknown) => typeof id === 'string')))) {
            return null
        }

        const catalog: CachedProductCatalog = {
            version: 1,
            bakeryId,
            cachedAt: envelope.cachedAt,
            products: envelope.products as ProductWithStock[],
            appliedSaleIds: (envelope.appliedSaleIds as string[] | undefined) ?? [],
        }
        productsInMemory.set(bakeryId, catalog)
        return catalog
    } catch (error) {
        console.warn('Não foi possível recuperar o catálogo offline desta unidade.', error)
        return null
    }
}

export function getCachedProducts(bakeryId: string): ProductWithStock[] | null {
    return readProductCatalog(bakeryId)?.products.slice() ?? null
}

export function cacheProducts(bakeryId: string, products: ProductWithStock[]): boolean {
    if (!products.every((product) => isProductWithStock(product, bakeryId))) {
        console.error('O catálogo não foi armazenado porque contém produtos de outra unidade ou dados inválidos.')
        return false
    }

    let appliedSaleIds: string[]
    try {
        const queuedSaleIds = new Set(getQueueSnapshot().map((sale) => sale.id))
        appliedSaleIds = (readProductCatalog(bakeryId)?.appliedSaleIds ?? [])
            .filter((saleId) => queuedSaleIds.has(saleId))
    } catch (error) {
        console.error('Não foi possível reconciliar as vendas locais ao atualizar o catálogo.', error)
        return false
    }

    const catalog: CachedProductCatalog = {
        version: 1,
        bakeryId,
        cachedAt: Date.now(),
        products: products.slice(),
        appliedSaleIds,
    }
    try {
        window.localStorage.setItem(`${PRODUCT_CACHE_PREFIX}${bakeryId}`, JSON.stringify(catalog))
    } catch (error) {
        console.warn('Não foi possível persistir o catálogo offline desta unidade.', error)
        return false
    }

    productsInMemory.set(bakeryId, catalog)
    return true
}

export function getOfflineAvailableProducts(
    bakeryId: string,
    products: ProductWithStock[],
    queuedSales: readonly QueuedSale[],
): ProductWithStock[] {
    const appliedSaleIds = new Set(readProductCatalog(bakeryId)?.appliedSaleIds ?? [])
    const deductedSaleKeys = new Set<string>()
    const remainingByProduct = new Map(products.map((product) => [product.id, product.stock]))

    for (const sale of queuedSales) {
        const saleKey = sale.idempotencyKey || sale.id
        if (sale.bakeryId !== bakeryId
            || (sale.status !== 'pending' && sale.status !== 'failed')
            || appliedSaleIds.has(sale.id)
            || deductedSaleKeys.has(saleKey)) {
            continue
        }
        deductedSaleKeys.add(saleKey)

        for (const item of sale.items) {
            const available = remainingByProduct.get(item.productId)
            if (available !== undefined) {
                remainingByProduct.set(item.productId, Math.max(0, available - item.quantity))
            }
        }
    }

    return products.map((product) => ({
        ...product,
        stock: remainingByProduct.get(product.id) ?? product.stock,
    }))
}

export function applyConfirmedSaleToCachedStock(sale: QueuedSale): boolean {
    const catalog = readProductCatalog(sale.bakeryId)
    if (!catalog) {
        console.error('Não foi possível reconciliar o estoque local porque o catálogo desta padaria não está disponível.')
        return false
    }
    if (catalog.appliedSaleIds.includes(sale.id)) {
        return true
    }

    const quantitiesByProduct = new Map<string, number>()
    for (const item of sale.items) {
        quantitiesByProduct.set(
            item.productId,
            (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity,
        )
    }
    const updatedCatalog: CachedProductCatalog = {
        ...catalog,
        cachedAt: Date.now(),
        products: catalog.products.map((product) => {
            const soldQuantity = quantitiesByProduct.get(product.id) ?? 0
            return soldQuantity === 0
                ? product
                : { ...product, stock: Math.max(0, product.stock - soldQuantity) }
        }),
        appliedSaleIds: [...catalog.appliedSaleIds, sale.id],
    }

    try {
        window.localStorage.setItem(`${PRODUCT_CACHE_PREFIX}${sale.bakeryId}`, JSON.stringify(updatedCatalog))
    } catch (error) {
        console.error('Não foi possível persistir a reconciliação do estoque local.', error)
        return false
    }

    productsInMemory.set(sale.bakeryId, updatedCatalog)
    return true
}

export function rememberConfirmedOpenCashRegister(
    bakeryId: string,
    userId: string,
    register: CashRegister,
): boolean {
    if (!bakeryId || !userId || !isCashRegister(register, bakeryId)) {
        return false
    }

    const sessionId = getSessionId(true)
    if (!sessionId) {
        return false
    }

    const cached: CachedCashRegister = {
        version: 1,
        bakeryId,
        userId,
        sessionId,
        confirmedAt: Date.now(),
        register,
    }
    cashRegistersInMemory.set(getCashRegisterKey(bakeryId, userId), cached)

    try {
        window.sessionStorage.setItem(getCashRegisterKey(bakeryId, userId), JSON.stringify(cached))
        return true
    } catch (error) {
        console.warn('Não foi possível persistir a confirmação local do caixa.', error)
        return false
    }
}

export function getRememberedOpenCashRegister(bakeryId: string, userId: string): CashRegister | null {
    const sessionId = getSessionId(false)
    if (!sessionId) {
        return null
    }

    const key = getCashRegisterKey(bakeryId, userId)
    let cached = cashRegistersInMemory.get(key)
    if (!cached) {
        try {
            const raw = window.sessionStorage.getItem(key)
            if (raw === null) {
                return null
            }
            const parsed: unknown = JSON.parse(raw)
            if (typeof parsed !== 'object' || parsed === null) {
                return null
            }
            if ((parsed as Record<string, unknown>).closed === true) {
                return null
            }
            cached = parsed as CachedCashRegister
        } catch (error) {
            console.warn('Não foi possível recuperar a confirmação local do caixa.', error)
            return null
        }
    }

    const age = Date.now() - cached.confirmedAt
    if (cached.version !== 1
        || cached.bakeryId !== bakeryId
        || cached.userId !== userId
        || cached.sessionId !== sessionId
        || !Number.isFinite(cached.confirmedAt)
        || age < 0
        || age > CASH_REGISTER_MAX_AGE_MS
        || !isCashRegister(cached.register, bakeryId)) {
        return null
    }

    return cached.register
}

export type OfflineSaleQueueResult =
    | { saved: true }
    | { saved: false; reason: 'operator' | 'cash-register' | 'catalog' | 'stock' }

export function queueSaleForOfflineSession(
    sale: QueuedSale,
    userId: string,
    products: ProductWithStock[],
    productIds: string[],
): OfflineSaleQueueResult {
    if (!userId || sale.operatorUserId !== userId) {
        return { saved: false, reason: 'operator' }
    }

    const register = getRememberedOpenCashRegister(sale.bakeryId, userId)
    if (!register || sale.cashRegisterId !== register.id) {
        return { saved: false, reason: 'cash-register' }
    }

    const availableProductIds = new Set(
        products
            .filter((product) => isProductWithStock(product, sale.bakeryId))
            .map((product) => product.id),
    )
    if (productIds.length === 0 || !productIds.every((productId) => availableProductIds.has(productId))) {
        return { saved: false, reason: 'catalog' }
    }

    const queuedSales = getQueueSnapshot()
    const existing = queuedSales.find((queued) =>
        queued.id === sale.id || queued.idempotencyKey === sale.idempotencyKey,
    )
    if (existing) {
        enqueueSale(sale)
        return { saved: true }
    }

    const availableByProductId = new Map(
        getOfflineAvailableProducts(sale.bakeryId, products, queuedSales)
            .map((product) => [product.id, product.stock]),
    )
    const requestedByProductId = new Map<string, number>()
    for (const item of sale.items) {
        requestedByProductId.set(
            item.productId,
            (requestedByProductId.get(item.productId) ?? 0) + item.quantity,
        )
    }
    if ([...requestedByProductId].some(([productId, quantity]) =>
        quantity > (availableByProductId.get(productId) ?? 0),
    )) {
        return { saved: false, reason: 'stock' }
    }

    enqueueSale(sale)
    return { saved: true }
}

export function invalidateRememberedCashRegister(bakeryId: string, userId: string): void {
    const key = getCashRegisterKey(bakeryId, userId)
    cashRegistersInMemory.delete(key)
    try {
        const sessionId = getSessionId(false)
        if (sessionId) {
            window.sessionStorage.setItem(key, JSON.stringify({
                version: 1,
                bakeryId,
                userId,
                sessionId,
                confirmedAt: Date.now(),
                closed: true,
            }))
        } else {
            window.sessionStorage.removeItem(key)
        }
    } catch (error) {
        console.warn('Não foi possível invalidar a confirmação local do caixa.', error)
        try {
            window.sessionStorage.removeItem(key)
        } catch (removeError) {
            console.warn('Não foi possível remover a confirmação local do caixa.', removeError)
        }
    }
}

export function resetOfflineCashRegisterSession(): void {
    cashRegistersInMemory.clear()
    volatileSessionId = null
    try {
        const keysToRemove: string[] = []
        for (let index = 0; index < window.sessionStorage.length; index++) {
            const key = window.sessionStorage.key(index)
            if (key === SESSION_ID_KEY || key?.startsWith(CASH_REGISTER_CACHE_PREFIX)) {
                keysToRemove.push(key)
            }
        }
        keysToRemove.forEach((key) => window.sessionStorage.removeItem(key))
    } catch (error) {
        console.warn('Não foi possível limpar as confirmações locais de caixa da sessão.', error)
    }
}
