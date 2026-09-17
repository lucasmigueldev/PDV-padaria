import type { CashClosure } from '../types/CashClosure'

const STORAGE_KEY = 'padaria-pdv-cash-closures'

export function getCashClosures(): CashClosure[] {
    const storedClosures = localStorage.getItem(STORAGE_KEY)

    if (!storedClosures) return []

    try {
        const parsedClosures = JSON.parse(storedClosures) as CashClosure[]
        return Array.isArray(parsedClosures) ? parsedClosures : []
    } catch {
        return []
    }
}

export function saveCashClosure(closure: CashClosure): CashClosure {
    const closures = getCashClosures()

    if (closures.some((storedClosure) => storedClosure.id === closure.id)) {
        throw new Error('Este caixa já foi fechado.')
    }

    closures.push(closure)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(closures))
    return closure
}