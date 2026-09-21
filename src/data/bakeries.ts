import type { Bakery } from '../types/Bakery'

export const BAKERIES_STORAGE_KEY = 'padaria-pdv-bakeries'

const initialBakeries: Bakery[] = [
    {
        id: 'bakery-1',
        name: 'Padaria 1',
        active: true,
    },
    {
        id: 'bakery-2',
        name: 'Padaria 2',
        active: true,
    },
]

function isBakery(value: unknown): value is Bakery {
    if (!value || typeof value !== 'object') return false

    const bakery = value as Record<string, unknown>

    return typeof bakery.id === 'string'
        && typeof bakery.name === 'string'
        && typeof bakery.active === 'boolean'
}

function persistBakeries(bakeryList: Bakery[]): void {
    localStorage.setItem(BAKERIES_STORAGE_KEY, JSON.stringify(bakeryList))
}

function readStoredBakeries(): Bakery[] {
    const storedBakeries = localStorage.getItem(BAKERIES_STORAGE_KEY)

    if (!storedBakeries) {
        persistBakeries(initialBakeries)
        return [...initialBakeries]
    }

    try {
        const parsedBakeries = JSON.parse(storedBakeries) as unknown
        const validBakeries = Array.isArray(parsedBakeries) ? parsedBakeries.filter(isBakery) : []

        if (validBakeries.length > 0) return validBakeries

        persistBakeries(initialBakeries)
        return [...initialBakeries]
    } catch {
        persistBakeries(initialBakeries)
        return [...initialBakeries]
    }
}

export function getBakeries(): Bakery[] {
    return [...readStoredBakeries()]
}

export function saveBakeries(bakeryList: Bakery[]): void {
    persistBakeries(bakeryList)
}

export function addBakery(bakery: Omit<Bakery, 'id'>): Bakery {
    const newBakery: Bakery = {
        ...bakery,
        id: crypto.randomUUID(),
    }
    const bakeries = getBakeries()

    bakeries.push(newBakery)
    saveBakeries(bakeries)
    return newBakery
}

export function updateBakery(id: string, bakery: Omit<Bakery, 'id'>): Bakery | undefined {
    const bakeries = getBakeries()
    const bakeryIndex = bakeries.findIndex((currentBakery) => currentBakery.id === id)

    if (bakeryIndex === -1) return undefined

    const updatedBakery: Bakery = { id, ...bakery }
    bakeries[bakeryIndex] = updatedBakery
    saveBakeries(bakeries)
    return updatedBakery
}

export function removeBakery(id: string): void {
    const bakeries = getBakeries().filter((bakery) => bakery.id !== id)
    saveBakeries(bakeries)
}