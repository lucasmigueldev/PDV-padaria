import assert from 'node:assert/strict'
import test from 'node:test'
import type { CashRegister } from '../src/types/CashRegister.ts'
import {
    getConfirmedCashRegisterState,
    getUnavailableCashRegisterState,
} from '../src/services/cashRegisterState.ts'

const register: CashRegister = {
    id: 'register-1',
    bakeryId: 'bakery-1',
    openedAt: '2026-10-30T12:00:00.000Z',
    initialAmount: 100,
    operatorName: 'Operador',
}

test('distinguishes a server-confirmed open or closed register from an unavailable lookup', () => {
    assert.deepEqual(getConfirmedCashRegisterState(register), { status: 'open', register })
    assert.deepEqual(getConfirmedCashRegisterState(null), { status: 'closed', register: null })
    assert.deepEqual(getUnavailableCashRegisterState(register), { status: 'open', register })
    assert.deepEqual(getUnavailableCashRegisterState(null), { status: 'unknown', register: null })
})
