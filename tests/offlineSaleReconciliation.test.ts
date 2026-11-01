import assert from 'node:assert/strict'
import test from 'node:test'
import {
    assertOfflineSaleMatchesServer,
    OfflineSaleValueMismatchError,
    type ServerSaleSnapshot,
} from '../src/services/offlineSaleReconciliation.ts'
import type { QueuedSale } from '../src/services/offlineSalesQueue.ts'

const sale: QueuedSale = {
    id: 'offline-sale',
    idempotencyKey: 'offline-sale-key',
    localRef: 'offline-sale-ref',
    cashRegisterId: 'register-1',
    bakeryId: 'bakery-1',
    operatorUserId: 'operator-1',
    occurredAt: '2026-10-30T10:00:00.000Z',
    paymentMethod: 'pix',
    receivedAmount: null,
    changeAmount: null,
    total: 4,
    items: [{
        productId: 'product-1',
        name: 'Pão',
        barcode: '123',
        price: 2,
        quantity: 2,
    }],
    status: 'pending',
    createdAt: '2026-10-30T10:00:00.000Z',
}

const serverSale: ServerSaleSnapshot = {
    total: '4.00',
    occurredAt: sale.occurredAt,
    items: [{
        productId: 'product-1',
        price: '2.00',
        quantity: 2,
        subtotal: '4.00',
    }],
}

test('accepts a server sale whose prices, total and original timestamp match the offline snapshot', () => {
    assert.doesNotThrow(() => assertOfflineSaleMatchesServer(sale, 'remote-sale-1', serverSale))
})

test('rejects a changed server price and retains the original local price in the sale record', () => {
    assert.throws(
        () => assertOfflineSaleMatchesServer(sale, 'remote-sale-2', {
            ...serverSale,
            total: '5.00',
            items: [{ ...serverSale.items[0], price: '2.50', subtotal: '5.00' }],
        }),
        (error: unknown) => error instanceof OfflineSaleValueMismatchError
            && error.remoteSaleId === 'remote-sale-2'
            && error.message.includes('2 × R$ 2,00 local')
            && error.message.includes('total registrado R$ 5,00'),
    )
    assert.equal(sale.items[0].price, 2)
    assert.equal(sale.total, 4)
})

test('rejects a server timestamp that differs from the original occurrence time', () => {
    assert.throws(
        () => assertOfflineSaleMatchesServer(sale, 'remote-sale-3', {
            ...serverSale,
            occurredAt: '2026-10-30T11:00:00.000Z',
        }),
        /horário local .* horário registrado/,
    )
})
