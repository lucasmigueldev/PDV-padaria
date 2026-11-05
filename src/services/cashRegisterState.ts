import type { CashRegister } from '../types/CashRegister'

export type CashRegisterState =
    | { status: 'open'; register: CashRegister }
    | { status: 'closed'; register: null }
    | { status: 'unknown'; register: null }

export function getConfirmedCashRegisterState(register: CashRegister | null): CashRegisterState {
    return register
        ? { status: 'open', register }
        : { status: 'closed', register: null }
}

export function getUnavailableCashRegisterState(register: CashRegister | null): CashRegisterState {
    return register
        ? { status: 'open', register }
        : { status: 'unknown', register: null }
}
