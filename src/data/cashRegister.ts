export interface CashRegister {
    id: string
    openedAt: string
    initialAmount: number
}

const STORAGE_KEY = 'padaria-pdv-open-cash-register'

export function getOpenCashRegister(): CashRegister | null {
    const storedCashRegister = localStorage.getItem(STORAGE_KEY)

    if (!storedCashRegister) return null

    try {
        const parsedCashRegister = JSON.parse(storedCashRegister) as CashRegister

        if (
            typeof parsedCashRegister.id !== 'string' ||
            typeof parsedCashRegister.openedAt !== 'string' ||
            typeof parsedCashRegister.initialAmount !== 'number' ||
            parsedCashRegister.initialAmount < 0
        ) {
            return null
        }

        return parsedCashRegister
    } catch {
        return null
    }
}

export function openCashRegister(initialAmount: number): CashRegister {
    const cashRegister: CashRegister = {
        id: crypto.randomUUID(),
        openedAt: new Date().toISOString(),
        initialAmount,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(cashRegister))
    return cashRegister
}

export function clearOpenCashRegister(): void {
    localStorage.removeItem(STORAGE_KEY)
}