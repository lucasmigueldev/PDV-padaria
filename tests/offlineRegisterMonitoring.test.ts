import assert from 'node:assert/strict'
import test from 'node:test'

import type { PdvHeartbeat, PdvOpenCashRegister } from '../src/hooks/usePdvHeartbeats.ts'
import type { PdvCashRegisterSessionEnding } from '../src/hooks/usePdvHeartbeats.ts'
import {
    getOpenRegistersWithoutHeartbeat,
    getPossibleOfflineRegisters,
} from '../src/services/offlineRegisterMonitoring.ts'

const now = Date.parse('2026-10-31T12:00:00.000Z')
const thresholdMs = 75_000
const bakeryId = 'bakery-1'
const operatorUserId = 'operator-1'

function openRegister(
    overrides: Partial<PdvOpenCashRegister> = {},
): PdvOpenCashRegister {
    return {
        id: 'register-1',
        bakeryId,
        operatorUserId,
        openedAt: '2026-10-31T10:00:00.000Z',
        ...overrides,
    }
}

function heartbeat(
    lastSeenAt: string,
    overrides: Partial<PdvHeartbeat> = {},
): PdvHeartbeat {
    return {
        userId: operatorUserId,
        bakeryId,
        status: 'online',
        pendingSales: 0,
        lastSeenAt,
        ...overrides,
    }
}

test('reports an open register when its matching operator heartbeat is older than 75 seconds', () => {
    const result = getPossibleOfflineRegisters(
        [openRegister()],
        [heartbeat('2026-10-31T11:58:30.000Z')],
        now,
        thresholdMs,
    )

    assert.deepEqual(result, [{
        cashRegisterId: 'register-1',
        bakeryId,
        operatorUserId,
        lastSeenAt: '2026-10-31T11:58:30.000Z',
        elapsedMs: 90_000,
    }])
})

test('does not report an open register with a recent heartbeat', () => {
    assert.deepEqual(
        getPossibleOfflineRegisters(
            [openRegister()],
            [heartbeat('2026-10-31T11:59:00.000Z')],
            now,
            thresholdMs,
        ),
        [],
    )
})

test('re-evaluates heartbeat age as time passes without changing remote data', () => {
    const registers = [openRegister()]
    const heartbeats = [heartbeat('2026-10-31T11:58:50.000Z')]
    const beforeThreshold = Date.parse('2026-10-31T12:00:05.000Z')
    const afterThreshold = Date.parse('2026-10-31T12:00:05.001Z')

    assert.deepEqual(
        getPossibleOfflineRegisters(registers, heartbeats, beforeThreshold, thresholdMs),
        [],
    )
    assert.deepEqual(
        getPossibleOfflineRegisters(registers, heartbeats, afterThreshold, thresholdMs),
        [{
            cashRegisterId: 'register-1',
            bakeryId,
            operatorUserId,
            lastSeenAt: '2026-10-31T11:58:50.000Z',
            elapsedMs: 75_001,
        }],
    )
})

test('does not infer an occurrence when an open register has no matching heartbeat', () => {
    const registers = [openRegister()]

    assert.deepEqual(getPossibleOfflineRegisters(registers, [], now, thresholdMs), [])
    assert.deepEqual(getOpenRegistersWithoutHeartbeat(registers, []), [{
        cashRegisterId: 'register-1',
        bakeryId,
        operatorUserId,
    }])
})

test('matches the heartbeat by both operator and bakery', () => {
    const mismatchedHeartbeats = [
        heartbeat('2026-10-31T11:58:00.000Z', { userId: 'other-operator' }),
        heartbeat('2026-10-31T11:58:00.000Z', { bakeryId: 'other-bakery' }),
    ]

    assert.deepEqual(
        getPossibleOfflineRegisters([openRegister()], mismatchedHeartbeats, now, thresholdMs),
        [],
    )
    assert.equal(
        getOpenRegistersWithoutHeartbeat([openRegister()], mismatchedHeartbeats).length,
        1,
    )
})

test('does not report a normally ended register session as offline', () => {
    const endedSession: PdvCashRegisterSessionEnding = {
        cashRegisterId: 'register-1',
        bakeryId,
        operatorUserId,
    }

    assert.deepEqual(
        getPossibleOfflineRegisters(
            [openRegister()],
            [heartbeat('2026-10-31T11:58:00.000Z')],
            now,
            thresholdMs,
            [endedSession],
        ),
        [],
    )
    assert.deepEqual(
        getOpenRegistersWithoutHeartbeat([openRegister()], [], [endedSession]),
        [],
    )
})

test('does not let a session ending for another register/operator/bakery suppress an alert', () => {
    const mismatchedEnding: PdvCashRegisterSessionEnding = {
        cashRegisterId: 'different-register',
        bakeryId: 'different-bakery',
        operatorUserId: 'different-operator',
    }

    assert.equal(
        getPossibleOfflineRegisters(
            [openRegister()],
            [heartbeat('2026-10-31T11:58:00.000Z')],
            now,
            thresholdMs,
            [mismatchedEnding],
        ).length,
        1,
    )
})

test('removes the occurrence after a matching heartbeat is updated on reconnection', () => {
    const registers = [openRegister()]
    const disconnectedHeartbeat = heartbeat('2026-10-31T11:58:30.000Z')
    const reconnectedHeartbeat = heartbeat('2026-10-31T11:59:50.000Z')

    assert.equal(
        getPossibleOfflineRegisters(registers, [disconnectedHeartbeat], now, thresholdMs).length,
        1,
    )
    assert.deepEqual(
        getPossibleOfflineRegisters(registers, [reconnectedHeartbeat], now, thresholdMs),
        [],
    )
})

test('does not classify a closed register or an invalid heartbeat timestamp', () => {
    const closedRegisters: PdvOpenCashRegister[] = []

    assert.deepEqual(
        getPossibleOfflineRegisters(
            closedRegisters,
            [heartbeat('2026-10-31T11:00:00.000Z')],
            now,
            thresholdMs,
        ),
        [],
    )
    assert.deepEqual(
        getPossibleOfflineRegisters([openRegister()], [heartbeat('invalid')], now, thresholdMs),
        [],
    )
})
