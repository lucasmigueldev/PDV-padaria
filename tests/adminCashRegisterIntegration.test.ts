import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
    administrativelyCloseOverdueCashRegister,
    CashRegisterNotOpenError,
    createLateOfflineSalePayload,
    LateOfflineSaleRejectedError,
    receiveLateOfflineSale,
} from '../src/services/adminCashRegisterClosure.ts'
import { syncQueuedOfflineSale } from '../src/services/operations.ts'
import {
    enqueueSale,
    getQueueSnapshot,
    removeQueuedSale,
    type QueuedSale,
} from '../src/services/offlineSalesQueue.ts'
import { reportNetworkSuccess } from '../src/services/connection.ts'
import { OfflineSaleReconciliationPendingError } from '../src/services/offlineSaleReconciliation.ts'
import { syncPendingSales } from '../src/services/syncOfflineSales.ts'

const EVENT_ID = '70000000-0000-4000-8000-000000000001'
const MANAGER_SOURCE = readFileSync(
    new URL('../src/components/CashShortfallAlertManager/CashShortfallAlertManager.tsx', import.meta.url),
    'utf8',
)
const PENDING_REGISTERS_SOURCE = readFileSync(
    new URL('../src/pages/CaixasPendentes/CaixasPendentes.tsx', import.meta.url),
    'utf8',
)
const ADMIN_SERVICE_SOURCE = readFileSync(
    new URL('../src/services/adminCashRegisterClosure.ts', import.meta.url),
    'utf8',
)

const storage = new Map<string, string>()
let failQueueWrites = false
let saleSequence = 0
Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
        localStorage: {
            getItem(key: string) {
                return storage.get(key) ?? null
            },
            setItem(key: string, value: string) {
                if (failQueueWrites) throw new Error('Storage quota exceeded')
                storage.set(key, value)
            },
        },
        addEventListener() {},
        removeEventListener() {},
        setTimeout() {
            return 1
        },
        clearTimeout() {},
    },
})

function createSale(id?: string): QueuedSale {
    saleSequence++
    const suffix = String(saleSequence).padStart(12, '0')
    const saleId = id ?? `local-sale-${suffix}`
    return {
        id: saleId,
        idempotencyKey: `50000000-0000-4000-8000-${suffix}`,
        localRef: `local-${saleId}`,
        offlineSessionId: '60000000-0000-4000-8000-000000000001',
        cashRegisterId: `40000000-0000-4000-8000-${suffix}`,
        bakeryId: `10000000-0000-4000-8000-${suffix}`,
        operatorUserId: `20000000-0000-4000-8000-${suffix}`,
        occurredAt: '2026-11-03T18:00:00.000Z',
        createdAt: '2026-11-03T18:01:00.000Z',
        paymentMethod: 'cash',
        receivedAmount: 20,
        changeAmount: 10,
        total: 10,
        items: [{
            productId: '30000000-0000-4000-8000-000000000001',
            name: 'Pão',
            barcode: '123',
            price: 10,
            quantity: 1,
        }],
        status: 'pending',
    }
}

function queue(sale: QueuedSale) {
    enqueueSale(sale)
    if (!sale.operatorUserId) throw new Error('Test fixture requires an operator')
    return {
        operatorUserId: sale.operatorUserId,
        bakeryId: sale.bakeryId,
    }
}

test('administrative closure sends the exact RPC inputs only after a non-empty reason', async () => {
    let request: { cashRegisterId: string; reason: string } | null = null
    const result = await administrativelyCloseOverdueCashRegister(
        '40000000-0000-4000-8000-000000000001',
        '  Operador inacessível  ',
        {
            enabled: true,
            invoke: async (cashRegisterId, reason) => {
                request = { cashRegisterId, reason }
                return { data: EVENT_ID, error: null }
            },
        },
    )

    assert.equal(result, EVENT_ID)
    assert.deepEqual(request, {
        cashRegisterId: '40000000-0000-4000-8000-000000000001',
        reason: 'Operador inacessível',
    })
})

test('administrative closure is disabled by default and rejects a blank reason without calling the RPC', async () => {
    let calls = 0
    const invoke = async () => {
        calls++
        return { data: EVENT_ID, error: null }
    }

    await assert.rejects(
        administrativelyCloseOverdueCashRegister('register-1', 'reason', { enabled: false, invoke }),
        /desabilitado/,
    )
    await assert.rejects(
        administrativelyCloseOverdueCashRegister('register-1', '  ', { enabled: true, invoke }),
        /motivo/,
    )
    assert.equal(calls, 0)
})

test('administrative closure maps authorization, deadline, already-closed, and network errors', async () => {
    const responses = [
        { code: '42501', message: 'Only an owner may administratively close' },
        { code: '23514', message: 'The cash register has not reached its configured deadline' },
        { code: '23514', message: 'A normally closed cash register cannot be administratively closed' },
        new TypeError('Failed to fetch'),
    ]
    const expected = [/autorizado/, /prazo configurado/, /fluxo normal/, /conexão/]

    for (const [index, response] of responses.entries()) {
        const invoke = async () => {
            if (response instanceof Error) throw response
            return { data: null, error: response }
        }
        await assert.rejects(
            administrativelyCloseOverdueCashRegister('register-1', 'reason', {
                enabled: true,
                invoke,
            }),
            expected[index],
        )
    }
})

test('canceling the administrative confirmation only closes the form and does not invoke the RPC', () => {
    assert.match(MANAGER_SOURCE, /function cancelAdminCloseForm\(\)[\s\S]*?setIsAdminCloseFormOpen\(false\)[\s\S]*?setAdminCloseReason\(''\)/)
    assert.match(MANAGER_SOURCE, /onClick=\{cancelAdminCloseForm\}/)
    assert.match(MANAGER_SOURCE, /isAdminClosing \|\| !adminCloseReason\.trim\(\)/)
})

test('administrative action requires the explicit feature flag and is guarded against repeated clicks', () => {
    assert.match(ADMIN_SERVICE_SOURCE, /return import\.meta\.env\?\.VITE_ENABLE_ADMIN_CASH_REGISTER_CLOSURE === 'true'/)
    assert.doesNotMatch(ADMIN_SERVICE_SOURCE, /import\.meta\.env\?\.DEV/)
    assert.match(ADMIN_SERVICE_SOURCE, /VITE_ENABLE_ADMIN_CASH_REGISTER_CLOSURE === 'true'/)
    assert.match(MANAGER_SOURCE, /const canAdministrativelyClose = isOwner && isAdminCashRegisterClosureEnabled\(\)/)
    assert.match(MANAGER_SOURCE, /if \(!activeOverdueAlert \|\| !canAdministrativelyClose \|\| adminCloseInFlightRef\.current\) return/)
    assert.match(MANAGER_SOURCE, /adminCloseInFlightRef\.current = true/)
})

test('pending register cards expose a gated confirmation and reuse the administrative closure service', () => {
    assert.match(PENDING_REGISTERS_SOURCE, /const canReviewAdminClosures = isOwner && isAdminCashRegisterClosureEnabled\(\)/)
    assert.match(PENDING_REGISTERS_SOURCE, /canReviewAdminClosures && \([\s\S]*?Encerrar caixa/)
    assert.match(PENDING_REGISTERS_SOURCE, /Confirmar encerramento administrativo\?/)
    assert.match(PENDING_REGISTERS_SOURCE, /administrativelyCloseOverdueCashRegister\(registerId, reason\)/)
    assert.match(PENDING_REGISTERS_SOURCE, /closeInFlight\.current = true/)
    assert.match(PENDING_REGISTERS_SOURCE, /conferência financeira permanece pendente/)
    assert.match(MANAGER_SOURCE, /O operador pode fechar o caixa pelo fluxo normal/)
    assert.match(MANAGER_SOURCE, /!isAdminCloseFormOpen[\s\S]*?Entendi/)
})

test('late-sale payload preserves the original register, bakery, operator, time, items, payment, and idempotency key', () => {
    const sale = createSale()
    assert.deepEqual(createLateOfflineSalePayload(sale), {
        id: sale.id,
        idempotencyKey: sale.idempotencyKey,
        localRef: sale.localRef,
        offlineSessionId: sale.offlineSessionId,
        cashRegisterId: sale.cashRegisterId,
        bakeryId: sale.bakeryId,
        operatorUserId: sale.operatorUserId,
        occurredAt: sale.occurredAt,
        createdAt: sale.createdAt,
        paymentMethod: sale.paymentMethod,
        receivedAmount: sale.receivedAmount,
        changeAmount: sale.changeAmount,
        total: sale.total,
        items: sale.items,
        status: sale.status,
    })
    assert.match(ADMIN_SERVICE_SOURCE, /rpc\('receive_late_offline_sale', \{\s*p_sale_payload: salePayload/s)
})

test('late-sale RPC returns the persisted event id and receives the preserved payload', async () => {
    const sale = createSale()
    let received: ReturnType<typeof createLateOfflineSalePayload> | null = null
    const eventId = await receiveLateOfflineSale(sale, {
        lookup: async () => 'closed',
        invoke: async (payload) => {
            received = payload
            return { data: EVENT_ID, error: null }
        },
    })

    assert.equal(eventId, EVENT_ID)
    assert.deepEqual(received, createLateOfflineSalePayload(sale))
})

test('keeps normal offline sales on the existing path when the register is open', async () => {
    const sale = createSale()
    const scope = queue(sale)
    let lookupCalls = 0
    let lateCalls = 0
    reportNetworkSuccess()

    const result = await syncPendingSales(scope, (queuedSale) => syncQueuedOfflineSale(queuedSale, {
        enabled: true,
        syncNormally: async () => 'remote-sale',
        lookupRegisterStatus: async () => {
            lookupCalls++
            return 'open'
        },
        receiveLateSale: async () => {
            lateCalls++
            return EVENT_ID
        },
    }))

    assert.deepEqual(result, { synced: 1, failed: 0, remaining: 0 })
    assert.equal(lookupCalls, 0)
    assert.equal(lateCalls, 0)
    assert.equal(getQueueSnapshot().some((item) => item.id === sale.id), false)
})

test('does not quarantine a sale after a normal close and preserves the rejected sale', async () => {
    const sale = createSale()
    const scope = queue(sale)
    let lateCalls = 0
    reportNetworkSuccess()

    const result = await syncPendingSales(scope, (queuedSale) => syncQueuedOfflineSale(queuedSale, {
        enabled: true,
        syncNormally: async () => {
            throw new CashRegisterNotOpenError()
        },
        lookupRegisterStatus: async () => 'closed',
        receiveLateSale: async () => {
            lateCalls++
            throw new LateOfflineSaleRejectedError('O servidor confirmou um fechamento normal.')
        },
    }))

    assert.deepEqual(result, { synced: 0, failed: 1, remaining: 0 })
    assert.equal(lateCalls, 1)
    assert.deepEqual(getQueueSnapshot().find((item) => item.id === sale.id), {
        ...sale,
        status: 'failed',
        errorMessage: 'O servidor confirmou um fechamento normal.',
    })
})

test('records an administrative late-sale receipt as quarantine, not a financial sync', async () => {
    const sale = createSale()
    const scope = queue(sale)
    reportNetworkSuccess()

    const result = await syncPendingSales(scope, (queuedSale) => syncQueuedOfflineSale(queuedSale, {
        enabled: true,
        syncNormally: async () => {
            throw new CashRegisterNotOpenError()
        },
        lookupRegisterStatus: async () => 'closed',
        receiveLateSale: async () => EVENT_ID,
    }))

    assert.deepEqual(result, { synced: 0, failed: 0, remaining: 0, quarantined: 1 })
    assert.deepEqual(getQueueSnapshot().find((item) => item.id === sale.id), {
        ...sale,
        status: 'quarantined',
        quarantineEventId: EVENT_ID,
    })
})

test('retries a lost quarantine response with the same idempotency key and payload', async () => {
    const sale = createSale()
    const scope = queue(sale)
    const receivedPayloads: ReturnType<typeof createLateOfflineSalePayload>[] = []
    reportNetworkSuccess()

    const sync = () => syncPendingSales(scope, async (queuedSale) => await syncQueuedOfflineSale(queuedSale, {
        enabled: true,
        syncNormally: async () => {
            throw new CashRegisterNotOpenError()
        },
        lookupRegisterStatus: async () => 'closed',
        receiveLateSale: async (retrySale) => {
            receivedPayloads.push(createLateOfflineSalePayload(retrySale))
            if (receivedPayloads.length === 1) throw new TypeError('Failed to fetch')
            return EVENT_ID
        },
    }))

    assert.deepEqual(await sync(), { synced: 0, failed: 0, remaining: 1 })
    reportNetworkSuccess()
    assert.deepEqual(await sync(), { synced: 0, failed: 0, remaining: 0, quarantined: 1 })
    assert.deepEqual(receivedPayloads, [createLateOfflineSalePayload(sale), createLateOfflineSalePayload(sale)])
    assert.equal(receivedPayloads[0]?.idempotencyKey, sale.idempotencyKey)
    assert.equal(getQueueSnapshot().find((item) => item.id === sale.id)?.status, 'quarantined')
})

test('keeps a confirmed remote quarantine pending until its receipt is persisted locally', async () => {
    const sale = createSale()
    const scope = queue(sale)
    let receiveCalls = 0
    const sync = () => syncPendingSales(scope, (queuedSale) => syncQueuedOfflineSale(queuedSale, {
        enabled: true,
        syncNormally: async () => {
            throw new CashRegisterNotOpenError()
        },
        lookupRegisterStatus: async () => 'closed',
        receiveLateSale: async () => {
            receiveCalls++
            return EVENT_ID
        },
    }))
    reportNetworkSuccess()
    failQueueWrites = true
    try {
        assert.deepEqual(await sync(), { synced: 0, failed: 0, remaining: 1 })
        assert.equal(getQueueSnapshot().find((item) => item.id === sale.id)?.status, 'pending')
    } finally {
        failQueueWrites = false
    }

    assert.deepEqual(await sync(), { synced: 0, failed: 0, remaining: 0, quarantined: 1 })
    assert.equal(receiveCalls, 2)
    assert.equal(getQueueSnapshot().find((item) => item.id === sale.id)?.status, 'quarantined')
})

test('preserves a late-sale payload rejected as divergent for analysis', async () => {
    const sale = createSale()
    const scope = queue(sale)
    reportNetworkSuccess()

    const result = await syncPendingSales(scope, (queuedSale) => syncQueuedOfflineSale(queuedSale, {
        enabled: true,
        syncNormally: async () => {
            throw new CashRegisterNotOpenError()
        },
        lookupRegisterStatus: async () => 'closed',
        receiveLateSale: async () => {
            throw new LateOfflineSaleRejectedError('A chave foi usada com conteúdo divergente.')
        },
    }))

    assert.deepEqual(result, { synced: 0, failed: 1, remaining: 0 })
    assert.deepEqual(getQueueSnapshot().find((item) => item.id === sale.id), {
        ...sale,
        status: 'failed',
        errorMessage: 'A chave foi usada com conteúdo divergente.',
    })
})

test('does not call late-sale receipt when register state cannot be confirmed', async () => {
    const sale = createSale()
    const scope = queue(sale)
    let lateCalls = 0
    reportNetworkSuccess()

    const result = await syncPendingSales(scope, (queuedSale) => syncQueuedOfflineSale(queuedSale, {
        enabled: true,
        syncNormally: async () => {
            throw new CashRegisterNotOpenError()
        },
        lookupRegisterStatus: async () => {
            throw new OfflineSaleReconciliationPendingError('Estado remoto indisponível.')
        },
        receiveLateSale: async () => {
            lateCalls++
            return EVENT_ID
        },
    }))

    assert.deepEqual(result, { synced: 0, failed: 0, remaining: 1 })
    assert.equal(lateCalls, 0)
    assert.equal(getQueueSnapshot().find((item) => item.id === sale.id)?.status, 'pending')
    removeQueuedSale(sale.id)
})

test('does not inspect or route closed-register sales through late receipt when the feature flag is off', async () => {
    const sale = createSale()
    const scope = queue(sale)
    let lookupCalls = 0
    let lateCalls = 0
    reportNetworkSuccess()

    const result = await syncPendingSales(scope, (queuedSale) => syncQueuedOfflineSale(queuedSale, {
        enabled: false,
        syncNormally: async () => {
            throw new CashRegisterNotOpenError()
        },
        lookupRegisterStatus: async () => {
            lookupCalls++
            return 'closed'
        },
        receiveLateSale: async () => {
            lateCalls++
            return EVENT_ID
        },
    }))

    assert.deepEqual(result, { synced: 0, failed: 1, remaining: 0 })
    assert.equal(lookupCalls, 0)
    assert.equal(lateCalls, 0)
})
