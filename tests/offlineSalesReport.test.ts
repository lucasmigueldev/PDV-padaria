import assert from 'node:assert/strict'
import test from 'node:test'
import type { QueuedSale } from '../src/services/offlineSalesQueue.ts'
import { buildOfflineSalesReport } from '../src/services/offlineSalesReport.ts'

function createSale(
    id: string,
    bakeryId: string,
    status: 'pending' | 'failed',
    occurredAt: string,
): QueuedSale {
    return {
        id,
        idempotencyKey: `key-${id}`,
        localRef: `local-${id}`,
        cashRegisterId: `register-${bakeryId}`,
        bakeryId,
        operatorUserId: `operator-${bakeryId}`,
        occurredAt,
        paymentMethod: 'pix',
        receivedAmount: null,
        changeAmount: null,
        total: 12.5,
        items: [{
            productId: 'product-1',
            name: 'Pão',
            barcode: '123',
            price: 12.5,
            quantity: 1,
        }],
        status,
        ...(status === 'failed' ? { errorMessage: 'Produto indisponível' } : {}),
        createdAt: occurredAt,
    }
}

test('separates pending and failed device-local sales and preserves original occurrence time', () => {
    const pending = createSale('pending-1', 'bakery-1', 'pending', '2026-10-30T10:00:00.000Z')
    const failed = createSale('failed-1', 'bakery-1', 'failed', '2026-10-30T09:00:00.000Z')
    const report = buildOfflineSalesReport([pending, failed], null, true)

    assert.deepEqual(report.pending.map((sale) => sale.id), ['pending-1'])
    assert.deepEqual(report.failed.map((sale) => sale.id), ['failed-1'])
    assert.equal(report.failed[0].errorMessage, 'Produto indisponível')
    assert.equal(report.pending[0].occurredAt, '2026-10-30T10:00:00.000Z')
    assert.equal(report.confirmedOfflineSalesIdentifiable, false)
})

test('filters local queue entries by bakery without exposing them as shared or confirmed', () => {
    const firstBakerySale = createSale('bakery-one', 'bakery-1', 'pending', '2026-10-30T10:00:00.000Z')
    const secondBakerySale = createSale('bakery-two', 'bakery-2', 'failed', '2026-10-30T11:00:00.000Z')
    const report = buildOfflineSalesReport([firstBakerySale, secondBakerySale], 'bakery-1', true)

    assert.deepEqual(report.pending.map((sale) => sale.id), ['bakery-one'])
    assert.deepEqual(report.failed, [])
    assert.equal(report.confirmedOfflineSalesIdentifiable, false)
})

test('counts duplicate idempotency keys once and reports duplicate local records', () => {
    const original = createSale('duplicate-original', 'bakery-1', 'pending', '2026-10-30T10:00:00.000Z')
    const duplicate = { ...original, id: 'duplicate-copy', localRef: 'duplicate-copy' }
    const report = buildOfflineSalesReport([original, duplicate], null, true)

    assert.equal(report.pending.length, 1)
    assert.equal(report.duplicateRecords, 1)
})

test('does not deduplicate equal idempotency keys across separate bakeries', () => {
    const first = createSale('key-reused', 'bakery-1', 'pending', '2026-10-30T10:00:00.000Z')
    const second = { ...createSale('key-reused', 'bakery-2', 'pending', '2026-10-30T11:00:00.000Z'), idempotencyKey: first.idempotencyKey }
    const report = buildOfflineSalesReport([first, second], null, true)

    assert.equal(report.pending.length, 2)
    assert.equal(report.duplicateRecords, 0)
})

test('represents an empty queue distinctly from unavailable local storage', () => {
    const emptyReport = buildOfflineSalesReport([], null, true)
    assert.equal(emptyReport.available, true)
    assert.deepEqual(emptyReport.pending, [])
    assert.deepEqual(emptyReport.failed, [])

    const unavailableReport = buildOfflineSalesReport([], null, false)
    assert.equal(unavailableReport.available, false)
    assert.deepEqual(unavailableReport.pending, [])
    assert.deepEqual(unavailableReport.failed, [])
})

test('updates the report as queue statuses change after reconnection', () => {
    const pending = createSale('status-change', 'bakery-1', 'pending', '2026-10-30T10:00:00.000Z')
    const beforeSync = buildOfflineSalesReport([pending], null, true)
    const afterSync = buildOfflineSalesReport([], null, true)
    const rejected = { ...pending, status: 'failed' as const, errorMessage: 'Estoque insuficiente' }
    const afterFailure = buildOfflineSalesReport([rejected], null, true)

    assert.equal(beforeSync.pending.length, 1)
    assert.equal(afterSync.pending.length, 0)
    assert.equal(afterFailure.failed.length, 1)
})

test('builds the device report from sales restored from persisted queue data', async () => {
    const restoredSale = createSale(
        'restored-after-reload',
        'bakery-1',
        'pending',
        '2026-10-30T08:30:00.000Z',
    )
    const values = new Map([['pdv_offline_sales_v1', JSON.stringify([restoredSale])]])
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: {
                getItem(key: string) {
                    return values.get(key) ?? null
                },
                setItem(key: string, value: string) {
                    values.set(key, value)
                },
            },
            addEventListener() {},
        },
    })

    const queue = await import('../src/services/offlineSalesQueue.ts?offline-report-reload')
    const report = buildOfflineSalesReport(queue.getQueueSnapshot(), 'bakery-1', true)

    assert.deepEqual(report.pending.map((sale) => sale.id), ['restored-after-reload'])
    assert.equal(report.pending[0].occurredAt, restoredSale.occurredAt)
})
