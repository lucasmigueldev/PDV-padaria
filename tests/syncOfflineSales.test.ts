import assert from 'node:assert/strict'
import test from 'node:test'
import {
    enqueueSale,
    getQueueSnapshot,
    markSaleSynced,
    removeQueuedSale,
    type QueuedSale,
} from '../src/services/offlineSalesQueue.ts'
import { reportNetworkFailure, reportNetworkSuccess } from '../src/services/connection.ts'
import { OfflineSaleValueMismatchError } from '../src/services/offlineSaleReconciliation.ts'
import { startSalesSync, syncPendingSales } from '../src/services/syncOfflineSales.ts'

const STORAGE_KEY = 'pdv_offline_sales_v1'
const storedValues = new Map<string, string>()
const eventListeners = new Map<string, Set<(...args: unknown[]) => void>>()
const timers = new Map<number, () => void>()
let nextTimerId = 0
let failWrites = false

Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
        localStorage: {
            getItem(key: string) {
                return storedValues.get(key) ?? null
            },
            setItem(key: string, value: string) {
                if (failWrites) {
                    throw new Error('Storage quota exceeded')
                }
                storedValues.set(key, value)
            },
        },
        addEventListener(type: string, listener: (...args: unknown[]) => void) {
            const listeners = eventListeners.get(type) ?? new Set()
            listeners.add(listener)
            eventListeners.set(type, listeners)
        },
        removeEventListener(type: string, listener: (...args: unknown[]) => void) {
            eventListeners.get(type)?.delete(listener)
        },
        setTimeout(callback: () => void) {
            const id = ++nextTimerId
            timers.set(id, callback)
            return id
        },
        clearTimeout(id: number) {
            timers.delete(id)
        },
    },
})

function createSale(
    id: string,
    operatorUserId = 'operator-1',
    bakeryId = 'bakery-1',
): QueuedSale {
    return {
        id,
        idempotencyKey: `key-${id}`,
        localRef: `local-${id}`,
        cashRegisterId: `register-${bakeryId}`,
        bakeryId,
        operatorUserId,
        occurredAt: '2026-10-30T12:00:00.000Z',
        paymentMethod: 'pix',
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
        status: 'pending',
        createdAt: '2026-10-30T12:00:00.000Z',
    }
}

function scope(operatorUserId = 'operator-1', bakeryId = 'bakery-1') {
    return { operatorUserId, bakeryId }
}

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50 && !predicate(); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    assert.equal(predicate(), true, 'expected background synchronization to complete')
}

test('preserves pending sales and idempotency key when sync is interrupted by network loss', async () => {
    const sale = createSale('sync-network-interruption')
    enqueueSale(sale)
    reportNetworkSuccess()
    const attemptedKeys: string[] = []
    const attemptedTimes: string[] = []

    const interrupted = await syncPendingSales(scope(), async (input) => {
        attemptedKeys.push(input.idempotencyKey)
        attemptedTimes.push(input.occurredAt)
        throw new Error('Failed to fetch')
    })

    assert.deepEqual(interrupted, { synced: 0, failed: 0, remaining: 1 })
    assert.equal(getQueueSnapshot().find((queued) => queued.id === sale.id)?.status, 'pending')

    reportNetworkSuccess()
    const retried = await syncPendingSales(scope(), async (input) => {
        attemptedKeys.push(input.idempotencyKey)
        attemptedTimes.push(input.occurredAt)
        return 'remote-sale'
    })

    assert.deepEqual(retried, { synced: 1, failed: 0, remaining: 0 })
    assert.deepEqual(attemptedKeys, [sale.idempotencyKey, sale.idempotencyKey])
    assert.deepEqual(attemptedTimes, [sale.occurredAt, sale.occurredAt])
})

test('keeps server-rejected sales in the failed state with the rejection reason', async () => {
    const sale = createSale('sync-business-rejection')
    enqueueSale(sale)
    reportNetworkSuccess()

    const result = await syncPendingSales(scope(), async () => {
        throw new Error('Estoque insuficiente')
    })

    assert.deepEqual(result, { synced: 0, failed: 1, remaining: 0 })
    assert.deepEqual(
        getQueueSnapshot().find((queued) => queued.id === sale.id),
        { ...sale, status: 'failed', errorMessage: 'Estoque insuficiente' },
    )
})

test('preserves a sale and marks a price mismatch failed instead of synced', async () => {
    const sale = createSale('sync-price-mismatch')
    sale.items[0].price = 2
    sale.total = 2
    enqueueSale(sale)
    reportNetworkSuccess()

    const result = await syncPendingSales(scope(), async (queuedSale) => {
        assert.equal(queuedSale.items[0].price, 2)
        assert.equal(queuedSale.occurredAt, sale.occurredAt)
        throw new OfflineSaleValueMismatchError('O servidor registrou R$ 2,50 em vez de R$ 2,00.', 'remote-price-mismatch')
    })

    assert.deepEqual(result, { synced: 0, failed: 1, remaining: 0 })
    assert.deepEqual(
        getQueueSnapshot().find((queued) => queued.id === sale.id),
        {
            ...sale,
            status: 'failed',
            errorMessage: 'O servidor registrou R$ 2,50 em vez de R$ 2,00.',
            remoteSaleId: 'remote-price-mismatch',
        },
    )
})

test('preserves queued item snapshots when a product is unavailable during synchronization', async () => {
    const sale = createSale('sync-product-unavailable')
    enqueueSale(sale)
    reportNetworkSuccess()

    const result = await syncPendingSales(scope(), async (queuedSale) => {
        assert.deepEqual(queuedSale.items, sale.items)
        throw new Error('Every product must belong to the cashier bakery')
    })

    assert.deepEqual(result, { synced: 0, failed: 1, remaining: 0 })
    assert.deepEqual(getQueueSnapshot().find((queued) => queued.id === sale.id), {
        ...sale,
        status: 'failed',
        errorMessage: 'Every product must belong to the cashier bakery',
    })
})

test('does not mark a remotely accepted sale failed when removing it from storage fails', async () => {
    const sale = createSale('sync-storage-failure')
    enqueueSale(sale)
    reportNetworkSuccess()
    failWrites = true

    try {
        const result = await syncPendingSales(scope(), async () => 'remote-sale')
        assert.deepEqual(result, { synced: 0, failed: 0, remaining: 1 })
    } finally {
        failWrites = false
    }

    assert.equal(getQueueSnapshot().find((queued) => queued.id === sale.id)?.status, 'pending')
    assert.equal(JSON.parse(storedValues.get(STORAGE_KEY) ?? '[]').some((queued: QueuedSale) => queued.id === sale.id), true)
    removeQueuedSale(sale.id)
})

test('syncs only sales owned by the active operator and bakery', async () => {
    const owned = createSale('scope-owned')
    const otherOperator = createSale('scope-other-operator', 'operator-2')
    const otherBakery = createSale('scope-other-bakery', 'operator-1', 'bakery-2')
    const legacy = createSale('scope-legacy')
    delete legacy.operatorUserId
    enqueueSale(owned)
    enqueueSale(otherOperator)
    enqueueSale(otherBakery)
    enqueueSale(legacy)
    reportNetworkSuccess()
    const sent: string[] = []

    const result = await syncPendingSales(scope(), async (input) => {
        sent.push(input.idempotencyKey)
        return 'remote-sale'
    })

    assert.deepEqual(result, { synced: 1, failed: 0, remaining: 0 })
    assert.deepEqual(sent, [owned.idempotencyKey])
    assert.equal(getQueueSnapshot().some((queued) => queued.id === otherOperator.id), true)
    assert.equal(getQueueSnapshot().some((queued) => queued.id === otherBakery.id), true)
    assert.equal(getQueueSnapshot().some((queued) => queued.id === legacy.id), true)
})

test('resumes pending synchronization automatically when connectivity returns', async () => {
    const sale = createSale('sync-reconnect')
    enqueueSale(sale)
    reportNetworkFailure()
    const attemptedKeys: string[] = []
    const stop = startSalesSync(scope(), async (input) => {
        attemptedKeys.push(input.idempotencyKey)
        return 'remote-sale'
    })

    assert.deepEqual(attemptedKeys, [])
    assert.equal(timers.size, 1)

    reportNetworkSuccess()
    for (const listener of eventListeners.get('online') ?? []) {
        listener()
    }
    await waitFor(() => attemptedKeys.length === 1)
    stop()

    assert.deepEqual(attemptedKeys, [sale.idempotencyKey])
    assert.equal(timers.size, 0)
})

test('restarts queue synchronization after stop and a new operator session', async () => {
    reportNetworkSuccess()
    const firstSale = createSale('sync-session-first')
    let firstCalls = 0
    const stopFirst = startSalesSync(scope(), async () => {
        firstCalls++
        return 'remote-first'
    })
    enqueueSale(firstSale)
    await waitFor(() => firstCalls === 1)
    stopFirst()
    markSaleSynced(firstSale.id)

    const nextScope = scope('operator-2', 'bakery-2')
    const secondSale = createSale('sync-session-second', nextScope.operatorUserId, nextScope.bakeryId)
    let secondCalls = 0
    const stopSecond = startSalesSync(nextScope, async () => {
        secondCalls++
        return 'remote-second'
    })
    enqueueSale(secondSale)
    await waitFor(() => secondCalls === 1)
    stopSecond()

    assert.equal(firstCalls, 1)
    assert.equal(secondCalls, 1)
    assert.equal(getQueueSnapshot().some((queued) => queued.id === secondSale.id), false)
    assert.equal(eventListeners.get('online')?.size ?? 0, 0)
    assert.equal(timers.size, 0)
})
