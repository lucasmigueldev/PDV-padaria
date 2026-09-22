export interface CashRegister {
    id: string
    bakeryId?: string
    openedAt: string
    initialAmount: number
}

const STORAGE_KEY = 'padaria-pdv-open-cash-register'

function isCashRegister(value: unknown): value is CashRegister {
    if (!value || typeof value !== 'object') return false

    const cashRegister = value as Record<string, unknown>

    return typeof cashRegister.id === 'string'
        && typeof cashRegister.openedAt === 'string'
        && typeof cashRegister.initialAmount === 'number'
        && cashRegister.initialAmount >= 0
        && (cashRegister.bakeryId === undefined || typeof cashRegister.bakeryId === 'string')
}

function readCashRegisters(): CashRegister[] {
    const storedCashRegister = localStorage.getItem(STORAGE_KEY)

    if (!storedCashRegister) return []

    try {
        const parsedCashRegisters = JSON.parse(storedCashRegister) as unknown

        if (Array.isArray(parsedCashRegisters)) return parsedCashRegisters.filter(isCashRegister)
        return isCashRegister(parsedCashRegisters) ? [parsedCashRegisters] : []
    } catch {
        return []
    }
}

export function getOpenCashRegister(bakeryId?: string): CashRegister | null {
    const cashRegisters = readCashRegisters()
    const matchingCashRegister = bakeryId
        ? cashRegisters.find((cashRegister) => cashRegister.bakeryId === bakeryId)
        : cashRegisters.find((cashRegister) => cashRegister.bakeryId)

    return matchingCashRegister ?? null
}

export function openCashRegister(initialAmount: number, bakeryId: string): CashRegister {
    const cashRegister: CashRegister = {
        id: crypto.randomUUID(),
        bakeryId,
        openedAt: new Date().toISOString(),
        initialAmount,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify([...readCashRegisters(), cashRegister]))
    return cashRegister
}

export function clearOpenCashRegister(id: string): void {
    const remainingCashRegisters = readCashRegisters().filter((cashRegister) => cashRegister.id !== id)

    if (remainingCashRegisters.length === 0) {
        localStorage.removeItem(STORAGE_KEY)
        return
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(remainingCashRegisters))
}