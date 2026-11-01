import assert from 'node:assert/strict'
import test from 'node:test'
import type { QueuedSale } from '../src/services/offlineSalesQueue.ts'
import {
    CashRegisterOfflineOperationError,
    CashRegisterOperationOutcomeUnknownError,
    executeCashRegisterRpc,
    getCashRegisterCloseBlockMessage,
    getUnresolvedSalesForCashRegister,
} from '../src/services/cashRegisterSafety.ts'
import { getConnectionState, reportNetworkFailure, reportNetworkSuccess } from '../src/services/connection.ts'

function createSale(
    id: string,
    cashRegisterId: string,
    status: 'pending' | 'failed',
    operatorUserId?: string,
): QueuedSale {
    return {
        id,
        idempotencyKey: `key-${id}`,
        localRef: `local-${id}`,
        cashRegisterId,
        bakeryId: 'bakery-1',
        ...(operatorUserId ? { operatorUserId } : {}),
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
        status,
        createdAt: '2026-10-30T12:00:00.000Z',
    }
}

test('blocks closure for every unresolved sale tied to the register, including failed and legacy operator records', () => {
    const sales = [
        createSale('pending-other-operator', 'register-1', 'pending', 'operator-2'),
        createSale('failed-legacy', 'register-1', 'failed'),
        createSale('other-register', 'register-2', 'pending', 'operator-1'),
    ]

    assert.deepEqual(
        getUnresolvedSalesForCashRegister(sales, 'register-1').map((sale) => sale.id),
        ['pending-other-operator', 'failed-legacy'],
    )
    assert.match(
        getCashRegisterCloseBlockMessage(sales, 'register-1', null) ?? '',
        /2 venda\(s\) sem resolução neste caixa/,
    )
})

test('blocks closure when local queue recovery failed and allows it after all sales are reconciled', () => {
    assert.match(
        getCashRegisterCloseBlockMessage([], 'register-1', new Error('corrupt local queue')) ?? '',
        /Não foi possível verificar todas as vendas locais/,
    )
    assert.equal(getCashRegisterCloseBlockMessage([], 'register-1', null), null)
})

test('does not send an opening or closing RPC when the connection is offline', async () => {
    reportNetworkFailure()
    let requestCount = 0
    for (const operation of ['abrir', 'fechar'] as const) {
        await assert.rejects(
            executeCashRegisterRpc(
                operation,
                async () => {
                    requestCount++
                    return { data: 'register-id', error: null }
                },
                (error) => {
                    throw new Error(error.message)
                },
                'unknown',
            ),
            CashRegisterOfflineOperationError,
        )
    }
    assert.equal(requestCount, 0)
    reportNetworkSuccess()
})

test('classifies lost opening and closing responses as unknown without retrying', async () => {
    for (const operation of ['abrir', 'fechar'] as const) {
        reportNetworkSuccess()
        let requestCount = 0

        await assert.rejects(
            executeCashRegisterRpc(
                operation,
                async () => {
                    requestCount++
                    throw new TypeError('Failed to fetch')
                },
                (error) => {
                    throw new Error(error.message)
                },
                'Resultado desconhecido; consulte o estado do caixa.',
            ),
            (error: unknown) => error instanceof CashRegisterOperationOutcomeUnknownError
                && error.message.includes('Resultado desconhecido'),
        )

        assert.equal(requestCount, 1)
        assert.equal(getConnectionState().status, 'offline')
    }
    reportNetworkSuccess()
})

test('preserves a definite server rejection as a rejected operation, not an unknown result', async () => {
    reportNetworkSuccess()

    await assert.rejects(
        executeCashRegisterRpc(
            'fechar',
            async () => ({
                data: null,
                error: { code: '23514', message: 'Cash register is already closed' },
            }),
            (error) => {
                throw new Error(`rejected: ${error.message}`)
            },
            'unknown',
        ),
        /rejected: Cash register is already closed/,
    )
    assert.equal(getConnectionState().status, 'online')
})
