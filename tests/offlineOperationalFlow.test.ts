import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProductWithStock } from '../src/types/Product.ts'
import type { CashRegister } from '../src/types/CashRegister.ts'
import type { QueuedSale } from '../src/services/offlineSalesQueue.ts'
import {
    executeCashRegisterRpc,
    getCashRegisterCloseBlockMessage,
} from '../src/services/cashRegisterSafety.ts'
import { reportNetworkFailure, reportNetworkSuccess } from '../src/services/connection.ts'

test('completes mocked open, offline sale, reload, reconnect, stock reconciliation, and safe close', async () => {
    const storedValues = new Map<string, string>()
    const sessionValues = new Map<string, string>()
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: {
                getItem(key: string) {
                    return storedValues.get(key) ?? null
                },
                setItem(key: string, value: string) {
                    storedValues.set(key, value)
                },
            },
            sessionStorage: {
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
            },
            addEventListener(type: string, listener: (...args: unknown[]) => void) {
                const set = listeners.get(type) ?? new Set()
                set.add(listener)
                listeners.set(type, set)
            },
            removeEventListener(type: string, listener: (...args: unknown[]) => void) {
                listeners.get(type)?.delete(listener)
            },
            setTimeout(callback: () => void, delay: number) {
                return globalThis.setTimeout(callback, delay)
            },
            clearTimeout(timer: ReturnType<typeof setTimeout>) {
                globalThis.clearTimeout(timer)
            },
        },
    })

    const bakeryId = 'flow-bakery'
    const operatorUserId = 'flow-operator'
    const register: CashRegister = {
        id: 'flow-register',
        bakeryId,
        openedAt: '2026-10-30T10:00:00.000Z',
        initialAmount: 100,
        operatorName: 'Operador',
    }

    reportNetworkSuccess()
    const openedRegisterId = await executeCashRegisterRpc(
        'abrir',
        async () => ({ data: register.id, error: null }),
        (error) => {
            throw new Error(error.message)
        },
        'Abertura incerta',
    )
    assert.equal(openedRegisterId, register.id)

    const cache = await import('../src/services/offlinePdvCache.ts?flow=operational')
    assert.equal(
        cache.rememberConfirmedOpenCashRegister(bakeryId, operatorUserId, register),
        true,
    )
    const product: ProductWithStock = {
        id: 'flow-product',
        bakeryId,
        name: 'Pão',
        barcode: '789',
        price: 2,
        stock: 5,
    }
    assert.equal(cache.cacheProducts(bakeryId, [product]), true)

    reportNetworkFailure()
    const queue = await import('../src/services/offlineSalesQueue.ts')
    const sale: QueuedSale = {
        id: 'flow-sale',
        idempotencyKey: 'flow-idempotency-key',
        localRef: 'flow-sale',
        cashRegisterId: register.id,
        bakeryId,
        operatorUserId,
        occurredAt: '2026-10-30T10:05:00.000Z',
        paymentMethod: 'pix',
        receivedAmount: null,
        changeAmount: null,
        total: 4,
        items: [{
            productId: product.id,
            name: product.name,
            barcode: product.barcode,
            price: product.price,
            quantity: 2,
        }],
        status: 'pending',
        createdAt: '2026-10-30T10:05:00.000Z',
    }
    assert.deepEqual(
        cache.queueSaleForOfflineSession(sale, operatorUserId, [product], [product.id]),
        { saved: true },
    )
    assert.equal(
        JSON.parse(storedValues.get('pdv_offline_sales_v1') ?? '[]')
            .some((queued: QueuedSale) => queued.idempotencyKey === sale.idempotencyKey),
        true,
    )

    const reloadedCache = await import('../src/services/offlinePdvCache.ts?flow=reload')
    assert.deepEqual(reloadedCache.getCachedProducts(bakeryId), [product])
    assert.equal(queue.getQueueSnapshot().find((queued) => queued.id === sale.id)?.occurredAt, sale.occurredAt)

    const { startSalesSync } = await import('../src/services/syncOfflineSales.ts')
    let syncCalls = 0
    const stopSync = startSalesSync({ operatorUserId, bakeryId }, async (queuedSale) => {
        syncCalls++
        assert.equal(queuedSale.idempotencyKey, sale.idempotencyKey)
        assert.equal(queuedSale.occurredAt, sale.occurredAt)
        assert.equal(reloadedCache.applyConfirmedSaleToCachedStock(queuedSale), true)
        return 'flow-remote-sale'
    })
    reportNetworkSuccess()
    for (const listener of listeners.get('online') ?? []) {
        listener()
    }
    for (let attempt = 0; attempt < 50 && queue.getQueueSnapshot().some((queued) => queued.id === sale.id); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    stopSync()

    assert.equal(syncCalls, 1)
    assert.equal(queue.getQueueSnapshot().some((queued) => queued.id === sale.id), false)
    assert.equal(
        reloadedCache.getOfflineAvailableProducts(
            bakeryId,
            reloadedCache.getCachedProducts(bakeryId) ?? [],
            queue.getQueueSnapshot(),
        )[0].stock,
        3,
    )
    assert.equal(getCashRegisterCloseBlockMessage(queue.getQueueSnapshot(), register.id, null), null)

    const closureId = await executeCashRegisterRpc(
        'fechar',
        async () => ({ data: 'flow-closure', error: null }),
        (error) => {
            throw new Error(error.message)
        },
        'Fechamento incerto',
    )
    assert.equal(closureId, 'flow-closure')
})
