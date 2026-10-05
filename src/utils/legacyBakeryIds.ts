import type { Bakery } from '../types/Bakery'

const compatibilityStorageKey = 'padaria-pdv-legacy-bakery-id-map'
const localBakeriesStorageKey = 'padaria-pdv-bakeries'

// Temporary local-domain bridge; remove after product_stock and other local domains migrate.
export const defaultProductStockBakeryId = 'bakery-1'

const defaultLegacyBakeries = [
    { id: defaultProductStockBakeryId, name: 'Padaria 1' },
    { id: 'bakery-2', name: 'Padaria 2' },
]

function normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function readCompatibilityMap(): Record<string, string> {
    try {
        const storedMap = localStorage.getItem(compatibilityStorageKey)
        if (!storedMap) return {}

        const parsedMap = JSON.parse(storedMap) as unknown
        if (!parsedMap || typeof parsedMap !== 'object' || Array.isArray(parsedMap)) return {}

        return Object.fromEntries(
            Object.entries(parsedMap).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
    } catch {
        return {}
    }
}

function readLegacyBakeries(): Array<{ id: string; name: string }> {
    try {
        const storedBakeries = localStorage.getItem(localBakeriesStorageKey)
        if (!storedBakeries) return defaultLegacyBakeries

        const parsedBakeries = JSON.parse(storedBakeries) as unknown
        if (!Array.isArray(parsedBakeries)) return defaultLegacyBakeries

        const validBakeries = parsedBakeries.filter((bakery): bakery is { id: string; name: string } => (
            Boolean(bakery)
            && typeof bakery === 'object'
            && typeof bakery.id === 'string'
            && typeof bakery.name === 'string'
        ))

        return [...validBakeries, ...defaultLegacyBakeries]
    } catch {
        return defaultLegacyBakeries
    }
}

export function registerLegacyBakeryIds(bakeries: Bakery[]): void {
    const compatibilityMap = readCompatibilityMap()
    const legacyBakeries = readLegacyBakeries()
    let hasChanges = false

    bakeries.forEach((bakery) => {
        if (compatibilityMap[bakery.id]) return

        const legacyBakery = legacyBakeries.find((candidate) => (
            normalizeName(candidate.name) === normalizeName(bakery.name)
        ))

        if (!legacyBakery) return

        compatibilityMap[bakery.id] = legacyBakery.id
        hasChanges = true
    })

    if (hasChanges) {
        try {
            localStorage.setItem(compatibilityStorageKey, JSON.stringify(compatibilityMap))
        } catch (error) {
            console.error('Não foi possível persistir a compatibilidade temporária de unidades.', error)
        }
    }
}

export function getLocalBakeryId(bakeryId: string): string {
    return readCompatibilityMap()[bakeryId] ?? bakeryId
}