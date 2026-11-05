import assert from 'node:assert/strict'
import test from 'node:test'

let importId = 0

function createStorage() {
    const localValues = new Map<string, string>()
    const sessionValues = new Map<string, string>()
    let failLocalWrites = false
    const localStorage = {
        getItem(key: string) {
            return localValues.get(key) ?? null
        },
        setItem(key: string, value: string) {
            if (failLocalWrites) {
                throw new Error('Storage quota exceeded')
            }
            localValues.set(key, value)
        },
        raw(key: string) {
            return localValues.get(key) ?? null
        },
        setFailWrites(value: boolean) {
            failLocalWrites = value
        },
    }
    const sessionStorage = {
        getItem(key: string) {
            return sessionValues.get(key) ?? null
        },
        setItem(key: string, value: string) {
            sessionValues.set(key, value)
        },
        removeItem(key: string) {
            sessionValues.delete(key)
        },
        key(index: number) {
            return [...sessionValues.keys()][index] ?? null
        },
        get length() {
            return sessionValues.size
        },
        raw(key: string) {
            return sessionValues.get(key) ?? null
        },
    }

    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage, sessionStorage, addEventListener() {} },
    })
    return { localStorage, sessionStorage }
}

async function importCache() {
    return import(`../src/services/offlinePdvCache.ts?instance=${++importId}`)
}

function createProduct(id = 'product-1', bakeryId = 'bakery-1') {
    return {
        id,
        bakeryId,
        name: 'Pão francês',
        barcode: '123',
        price: 1.5,
        stock: 20,
    }
}

function createRegister(bakeryId = 'bakery-1') {
    return {
        id: 'register-1',
        bakeryId,
        openedAt: new Date().toISOString(),
        initialAmount: 100,
        operatorName: 'Operador',
    }
}

function createQueuedSale(id: string, registerId = 'register-1', bakeryId = 'bakery-1') {
    return {
        id,
        idempotencyKey: `key-${id}`,
        localRef: `local-${id}`,
        cashRegisterId: registerId,
        bakeryId,
        operatorUserId: 'user-1',
        occurredAt: new Date().toISOString(),
        paymentMethod: 'pix' as const,
        receivedAmount: null,
        changeAmount: null,
        total: 1.5,
        items: [{
            productId: 'product-1',
            name: 'Pão francês',
            barcode: '123',
            price: 1.5,
            quantity: 1,
        }],
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
    }
}

test('stores and restores a bakery-scoped product catalog', async () => {
    createStorage()
    const writer = await importCache()
    const products = [createProduct()]

    assert.equal(writer.cacheProducts('bakery-1', products), true)
    const reader = await importCache()

    assert.deepEqual(reader.getCachedProducts('bakery-1'), products)
    assert.equal(reader.getCachedProducts('bakery-2'), null)
})

test('does not cache products whose bakery differs from the requested bakery', async () => {
    createStorage()
    const cache = await importCache()

    assert.equal(cache.cacheProducts('bakery-1', [createProduct('product-2', 'bakery-2')]), false)
    assert.equal(cache.getCachedProducts('bakery-1'), null)
})

test('preserves invalid catalog data and does not authorize its use', async () => {
    const { localStorage } = createStorage()
    const key = 'pdv_offline_products_v1_bakery-1'
    const corruptValue = '{"version":1,"bakeryId":"bakery-1","products":[{"id":"wrong"}]}'
    localStorage.setItem(key, corruptValue)
    const cache = await importCache()

    assert.equal(cache.getCachedProducts('bakery-1'), null)
    assert.equal(localStorage.raw(key), corruptValue)
})

test('restores a server-confirmed register only for the same user, bakery, and tab session', async () => {
    createStorage()
    const writer = await importCache()
    const register = createRegister()

    assert.equal(writer.rememberConfirmedOpenCashRegister('bakery-1', 'user-1', register), true)
    const reader = await importCache()

    assert.deepEqual(reader.getRememberedOpenCashRegister('bakery-1', 'user-1'), register)
    assert.equal(reader.getRememberedOpenCashRegister('bakery-2', 'user-1'), null)
    assert.equal(reader.getRememberedOpenCashRegister('bakery-1', 'user-2'), null)
})

test('does not accept an old register record without a current session confirmation', async () => {
    const { sessionStorage } = createStorage()
    const reader = await importCache()
    sessionStorage.setItem('pdv_offline_confirmed_cash_register_v1_bakery-1_user-1', JSON.stringify({
        version: 1,
        bakeryId: 'bakery-1',
        userId: 'user-1',
        sessionId: 'old-session',
        confirmedAt: Date.now(),
        register: createRegister(),
    }))

    assert.equal(reader.getRememberedOpenCashRegister('bakery-1', 'user-1'), null)
})

test('invalidates remembered state when the server confirms the register is closed', async () => {
    createStorage()
    const cache = await importCache()
    cache.rememberConfirmedOpenCashRegister('bakery-1', 'user-1', createRegister())

    cache.invalidateRememberedCashRegister('bakery-1', 'user-1')

    assert.equal(cache.getRememberedOpenCashRegister('bakery-1', 'user-1'), null)
})

test('expires a remembered register confirmation after its safety window', async () => {
    const { sessionStorage } = createStorage()
    const writer = await importCache()
    writer.rememberConfirmedOpenCashRegister('bakery-1', 'user-1', createRegister())
    const key = 'pdv_offline_confirmed_cash_register_v1_bakery-1_user-1'
    const record = JSON.parse(sessionStorage.raw(key) ?? 'null')
    record.confirmedAt -= 13 * 60 * 60 * 1000
    sessionStorage.setItem(key, JSON.stringify(record))
    const reader = await importCache()

    assert.equal(reader.getRememberedOpenCashRegister('bakery-1', 'user-1'), null)
})

test('clears remembered cash state when the authenticated session changes', async () => {
    const { sessionStorage } = createStorage()
    const cache = await importCache()
    cache.rememberConfirmedOpenCashRegister('bakery-1', 'user-1', createRegister())

    cache.resetOfflineCashRegisterSession()

    assert.equal(sessionStorage.raw('pdv_offline_auth_session_v1'), null)
    assert.equal(sessionStorage.raw('pdv_offline_confirmed_cash_register_v1_bakery-1_user-1'), null)
    assert.equal(cache.getRememberedOpenCashRegister('bakery-1', 'user-1'), null)
})

test('queues an offline sale only with the same-session confirmed register and local products', async () => {
    const { localStorage } = createStorage()
    const cache = await importCache()
    cache.rememberConfirmedOpenCashRegister('bakery-1', 'user-1', createRegister())
    const sale = createQueuedSale('offline-sale-1')

    assert.deepEqual(
        cache.queueSaleForOfflineSession(sale, 'user-1', [createProduct()], ['product-1']),
        { saved: true },
    )
    assert.equal(
        JSON.parse(localStorage.raw('pdv_offline_sales_v1') ?? '[]')
            .filter((queuedSale: { id: string }) => queuedSale.id === sale.id).length,
        1,
    )
})

test('subtracts consecutive and failed offline sales from the available local stock', async () => {
    const { localStorage } = createStorage()
    const cache = await importCache()
    const bakeryId = 'bakery-stock-test'
    const product = createProduct('product-stock-test', bakeryId)
    const products = [{ ...product, stock: 5 }]
    cache.cacheProducts(bakeryId, products)
    cache.rememberConfirmedOpenCashRegister(bakeryId, 'user-1', createRegister(bakeryId))

    const firstSale = createQueuedSale('offline-stock-first', 'register-1', bakeryId)
    firstSale.items[0].quantity = 3
    firstSale.items[0].productId = product.id
    assert.deepEqual(
        cache.queueSaleForOfflineSession(firstSale, 'user-1', products, [product.id]),
        { saved: true },
    )

    const queue = await import('../src/services/offlineSalesQueue.ts')
    const estimateAfterFirst = cache.getOfflineAvailableProducts(
        bakeryId,
        products,
        queue.getQueueSnapshot(),
    )
    assert.equal(estimateAfterFirst[0].stock, 2)

    const secondSale = createQueuedSale('offline-stock-second', 'register-1', bakeryId)
    secondSale.items[0].quantity = 3
    secondSale.items[0].productId = product.id
    assert.deepEqual(
        cache.queueSaleForOfflineSession(secondSale, 'user-1', products, [product.id]),
        { saved: false, reason: 'stock' },
    )

    queue.markSaleFailed(firstSale.id, 'Estoque insuficiente no servidor')
    const estimateWithFailed = cache.getOfflineAvailableProducts(
        bakeryId,
        products,
        queue.getQueueSnapshot(),
    )
    assert.equal(estimateWithFailed[0].stock, 2)
    assert.equal(queue.getQueueSnapshot().find((sale) => sale.id === firstSale.id)?.status, 'failed')
    assert.equal(
        JSON.parse(localStorage.raw('pdv_offline_sales_v1') ?? '[]')
            .filter((queuedSale: { id: string }) => queuedSale.id === firstSale.id).length,
        1,
    )
})

test('restores the stock estimate after reload without deducting a confirmed sale twice', async () => {
    const { localStorage } = createStorage()
    const cache = await importCache()
    const bakeryId = 'bakery-stock-reload-test'
    const product = createProduct('product-stock-reload-test', bakeryId)
    const products = [{ ...product, stock: 5 }]
    cache.cacheProducts(bakeryId, products)
    cache.rememberConfirmedOpenCashRegister(bakeryId, 'user-1', createRegister(bakeryId))
    const sale = createQueuedSale('offline-stock-reconciled', 'register-1', bakeryId)
    sale.items[0].quantity = 3
    sale.items[0].productId = product.id
    cache.queueSaleForOfflineSession(sale, 'user-1', products, [product.id])
    const queue = await import('../src/services/offlineSalesQueue.ts')

    assert.equal(cache.applyConfirmedSaleToCachedStock(sale), true)
    assert.equal(cache.applyConfirmedSaleToCachedStock(sale), true)
    assert.equal(cache.getCachedProducts(bakeryId)?.[0].stock, 2)

    const restoredCache = await importCache()
    const restoredProducts = restoredCache.getCachedProducts(bakeryId) ?? []
    assert.equal(
        restoredCache.getOfflineAvailableProducts(bakeryId, restoredProducts, queue.getQueueSnapshot())[0].stock,
        2,
    )

    queue.markSaleSynced(sale.id)
    assert.equal(
        restoredCache.getOfflineAvailableProducts(bakeryId, restoredProducts, queue.getQueueSnapshot())[0].stock,
        2,
    )
    assert.equal(
        JSON.parse(localStorage.raw('pdv_offline_sales_v1') ?? '[]')
            .some((queuedSale: { id: string }) => queuedSale.id === sale.id),
        false,
    )
})

test('blocks offline queueing without a confirmed register or matching local catalog', async () => {
    createStorage()
    const cache = await importCache()
    const sale = createQueuedSale('offline-sale-2')

    assert.deepEqual(
        cache.queueSaleForOfflineSession(sale, 'user-1', [createProduct()], ['product-1']),
        { saved: false, reason: 'cash-register' },
    )
    cache.rememberConfirmedOpenCashRegister('bakery-1', 'user-1', createRegister())
    assert.deepEqual(
        cache.queueSaleForOfflineSession(sale, 'user-1', [], ['product-1']),
        { saved: false, reason: 'catalog' },
    )
    assert.deepEqual(JSON.parse(window.localStorage.getItem('pdv_offline_sales_v1') ?? '[]'), [])
})

test('rejects a register or product from a different bakery when queueing offline', async () => {
    createStorage()
    const cache = await importCache()
    cache.rememberConfirmedOpenCashRegister('bakery-2', 'user-1', createRegister('bakery-2'))

    assert.deepEqual(
        cache.queueSaleForOfflineSession(
            createQueuedSale('offline-sale-3', 'register-1', 'bakery-1'),
            'user-1',
            [createProduct('product-1', 'bakery-2')],
            ['product-1'],
        ),
        { saved: false, reason: 'cash-register' },
    )
    assert.deepEqual(JSON.parse(window.localStorage.getItem('pdv_offline_sales_v1') ?? '[]'), [])
})

test('does not queue a sale under a different operator than its recorded owner', async () => {
    createStorage()
    const cache = await importCache()
    cache.rememberConfirmedOpenCashRegister('bakery-1', 'user-1', createRegister())

    assert.deepEqual(
        cache.queueSaleForOfflineSession(
            createQueuedSale('offline-sale-other-operator'),
            'user-2',
            [createProduct()],
            ['product-1'],
        ),
        { saved: false, reason: 'operator' },
    )
})

test('does not queue a sale or report success when offline persistence fails', async () => {
    const { localStorage } = createStorage()
    const cache = await importCache()
    cache.rememberConfirmedOpenCashRegister('bakery-1', 'user-1', createRegister())
    localStorage.setFailWrites(true)

    assert.throws(
        () => cache.queueSaleForOfflineSession(
            createQueuedSale('offline-sale-4'),
            'user-1',
            [createProduct()],
            ['product-1'],
        ),
        /Não foi possível salvar a venda neste dispositivo/,
    )
    assert.equal(localStorage.raw('pdv_offline_sales_v1'), null)
})
