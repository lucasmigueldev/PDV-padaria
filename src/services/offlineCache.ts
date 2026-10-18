export interface CacheEnvelope<T> {
    savedAt: string
    data: T
}

/**
 * Local persistence used while the device has no connectivity.
 * Stored in `window.localStorage` (survives reload), never sessionStorage.
 */
export function writeCache<T>(key: string, data: T): void {
    try {
        const envelope: CacheEnvelope<T> = {
            savedAt: new Date().toISOString(),
            data,
        }
        window.localStorage.setItem(key, JSON.stringify(envelope))
    } catch (error) {
        console.warn(`Não foi possível gravar o cache local "${key}".`, error)
    }
}

export function readCache<T>(key: string): { savedAt: string; data: T } | null {
    try {
        const raw = window.localStorage.getItem(key)
        if (!raw) {
            return null
        }
        const parsed = JSON.parse(raw) as CacheEnvelope<T>
        if (!parsed || typeof parsed.savedAt !== 'string' || typeof parsed.data === 'undefined') {
            return null
        }
        return parsed
    } catch (error) {
        console.warn(`Não foi possível ler o cache local "${key}".`, error)
        return null
    }
}

/**
 * Cache key namespace for the PDV offline module.
 * One bucket per bakery, so multiple units can coexist on the same browser.
 */
export const PDV_CACHE_KEYS = {
    products: (bakeryId: string): string => `pdv_cache_products_${bakeryId}`,
    cashRegister: (bakeryId: string): string => `pdv_cache_cash_register_${bakeryId}`,
    bakeries: 'pdv_cache_bakeries',
} as const
