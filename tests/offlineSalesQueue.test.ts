import assert from 'node:assert/strict'
import test from 'node:test'

const STORAGE_KEY = 'pdv_offline_sales_v1'
let importId = 0

function createStorage(initialValue: string | null = null) {
    const values = new Map<string, string>()
    const listeners = new Map<string, (event: { key: string | null; newValue: string | null }) => void>()
    if (initialValue !== null) {
        values.set(STORAGE_KEY, initialValue)
    }

    let failWrites = false
    const storage = {
        getItem(key: string) {
            return values.get(key) ?? null
        },
        setItem(key: string, value: string) {
            if (failWrites) {
                throw new Error('Storage quota exceeded')
            }
            values.set(key, value)
        },
        setFailWrites(value: boolean) {
            failWrites = value
        },
        dispatchStorage(newValue: string | null) {
            listeners.get('storage')?.({ key: STORAGE_KEY, newValue })
        },
    }

    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: storage,
            addEventListener(type: string, listener: (event: { key: string | null; newValue: string | null }) => void) {
                listeners.set(type, listener)
            },
        },
    })

    return storage
}

async function importQueue() {
    return import(`../src/services/offlineSalesQueue.ts?instance=${++importId}`)
}

function createSale(id = 'sale-1', status: 'pending' | 'failed' | 'quarantined' = 'pending') {
    return {
        id,
        idempotencyKey: `key-${id}`,
        localRef: `local-${id}`,
        cashRegisterId: 'register-1',
        bakeryId: 'bakery-1',
        occurredAt: '2026-10-30T12:00:00.000Z',
        paymentMethod: 'pix' as const,
        receivedAmount: null,
        changeAmount: null,
        total: 10,
        items: [{
            productId: 'product-1',
            name: 'Pão',
            barcode: '123',
            price: 10,
            quantity: 1,
        }],
        status,
        ...(status === 'failed' ? { errorMessage: 'Falha ao sincronizar' } : {}),
        createdAt: '2026-10-30T12:00:00.000Z',
    }
}

test('starts with an empty queue when storage has no saved sales', async () => {
    createStorage()
    const queue = await importQueue()

    assert.deepEqual(queue.getQueueSnapshot(), [])
    assert.deepEqual(queue.getPendingSales(), [])
    assert.deepEqual(queue.getFailedSales(), [])
})

test('persists an enqueued sale before publishing the updated snapshot', async () => {
    const storage = createStorage()
    const queue = await importQueue()
    const sale = createSale()
    let notifications = 0
    queue.subscribeQueue(() => {
        notifications++
    })

    assert.equal(queue.enqueueSale(sale), true)
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'), [sale])
    assert.deepEqual(queue.getQueueSnapshot(), [sale])
    assert.deepEqual(queue.getPendingSales(), [sale])
    assert.equal(notifications, 1)
})

test('restores persisted sales after a fresh module initialization', async () => {
    const storage = createStorage()
    const firstQueue = await importQueue()
    const pending = createSale()
    const failed = createSale('sale-2', 'failed')
    firstQueue.enqueueSale(pending)
    firstQueue.enqueueSale(failed)

    const restoredQueue = await importQueue()

    assert.deepEqual(restoredQueue.getQueueSnapshot(), [pending, failed])
    assert.deepEqual(restoredQueue.getPendingSales(), [pending])
    assert.deepEqual(restoredQueue.getFailedSales(), [failed])
    assert.equal(restoredQueue.getQueueSnapshot()[0].idempotencyKey, pending.idempotencyKey)
    assert.equal(restoredQueue.getQueueSnapshot()[1].idempotencyKey, failed.idempotencyKey)
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'), [pending, failed])
})

test('does not duplicate records when recovering or enqueuing the same idempotency key', async () => {
    const sale = createSale()
    const storage = createStorage(JSON.stringify([sale]))
    const queue = await importQueue()

    assert.equal(queue.getQueueSnapshot().length, 1)
    assert.equal(queue.getQueueSnapshot().length, 1)
    assert.equal(queue.enqueueSale(sale), true)
    assert.equal(queue.getQueueSnapshot().length, 1)
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'), [sale])
})

test('rejects reuse of an idempotency key for a different sale payload', async () => {
    createStorage()
    const queue = await importQueue()
    const sale = createSale()
    queue.enqueueSale(sale)

    assert.throws(
        () => queue.enqueueSale({ ...sale, total: sale.total + 5 }),
        /identificador já pertence a outro registro/,
    )
    assert.equal(queue.getQueueSnapshot().length, 1)
})

test('notifies queue subscribers when another tab updates persisted sales', async () => {
    const storage = createStorage()
    const queue = await importQueue()
    let notifications = 0
    queue.subscribeQueue(() => {
        notifications++
    })
    const sale = createSale()

    storage.dispatchStorage(JSON.stringify([sale]))

    assert.deepEqual(queue.getQueueSnapshot(), [sale])
    assert.equal(notifications, 1)
})

test('does not report enqueue success or mutate memory when storage writes fail', async () => {
    const storage = createStorage()
    const queue = await importQueue()
    const sale = createSale()
    let notifications = 0
    queue.subscribeQueue(() => {
        notifications++
    })
    storage.setFailWrites(true)

    assert.throws(
        () => queue.enqueueSale(sale),
        /Não foi possível salvar a venda neste dispositivo/,
    )
    assert.deepEqual(queue.getQueueSnapshot(), [])
    assert.deepEqual(queue.getPendingSales(), [])
    assert.equal(storage.getItem(STORAGE_KEY), null)
    assert.equal(notifications, 0)
})

test('persists quarantine separately and does not retry or remove it as a financial sale', async () => {
    const storage = createStorage()
    const queue = await importQueue()
    const sale = createSale()
    queue.enqueueSale(sale)

    queue.markSaleQuarantined(sale.id, 'quarantine-event-1')

    const quarantined = { ...sale, status: 'quarantined', quarantineEventId: 'quarantine-event-1' }
    assert.deepEqual(queue.getQueueSnapshot(), [quarantined])
    assert.deepEqual(queue.getPendingSales(), [])
    assert.deepEqual(queue.getFailedSales(), [])
    assert.deepEqual(queue.getQuarantinedSales(), [quarantined])
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'), [quarantined])

    queue.retryFailedSale(sale.id)
    queue.markSaleSynced(sale.id)
    assert.deepEqual(queue.getQueueSnapshot(), [quarantined])
})

test('retains the original pending sale when persisting a confirmed quarantine fails', async () => {
    const storage = createStorage()
    const queue = await importQueue()
    const sale = createSale()
    queue.enqueueSale(sale)
    storage.setFailWrites(true)

    assert.throws(() => queue.markSaleQuarantined(sale.id, 'quarantine-event-1'))
    assert.deepEqual(queue.getQueueSnapshot(), [sale])
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'), [sale])
})

test('preserves invalid stored data and reports a controlled recovery error', async () => {
    const invalidData = '{"not":"a queue"}'
    const storage = createStorage(invalidData)
    const queue = await importQueue()

    assert.throws(
        () => queue.getQueueSnapshot(),
        /Não foi possível recuperar a fila de vendas offline/,
    )
    assert.equal(storage.getItem(STORAGE_KEY), invalidData)
})
