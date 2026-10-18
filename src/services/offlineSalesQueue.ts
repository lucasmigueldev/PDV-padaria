import type { PaymentMethod } from '../types/Sale'
import { PDV_CACHE_KEYS, readCache, writeCache } from './offlineCache'

export type QueuedSaleStatus = 'pending' | 'failed'

export interface QueuedSaleItem {
    productId: string
    name: string
    barcode: string
    price: number
    quantity: number
}

export interface QueuedSale {
    id: string
    idempotencyKey: string
    localRef: string
    cashRegisterId: string
    bakeryId: string
    occurredAt: string
    paymentMethod: PaymentMethod
    receivedAmount: number | null
    changeAmount: number | null
    total: number
    items: QueuedSaleItem[]
    status: QueuedSaleStatus
    errorMessage?: string
    createdAt: string
}

const STORAGE_KEY = 'pdv_offline_sales_v1'

let cache: QueuedSale[] = []
let snapshot: QueuedSale[] = []
const listeners = new Set<() => void>()

function load(): QueuedSale[] {
    if (cache.length > 0) {
        return cache
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        cache = raw ? (JSON.parse(raw) as QueuedSale[]) : []
    } catch (error) {
        console.error('Falha ao ler a fila de vendas offline.', error)
        cache = []
    }
    snapshot = cache.slice()
    return cache
}

function persist(): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    } catch (error) {
        console.error('Falha ao gravar a fila de vendas offline.', error)
    }
    // Keep the stable snapshot in sync so subscribers always see the latest data.
    snapshot = cache.slice()
    for (const listener of listeners) {
        listener()
    }
}

/** Cross-tab sync: other tabs/instancias write to the same key and this module stays consistent. */
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY) {
            return
        }
        cache = load()
        snapshot = cache.slice()
        for (const listener of listeners) {
            listener()
        }
    })
}

export function subscribeQueue(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

/** Stable snapshot for React subscriptions (useSyncExternalStore guarantee). */
export function getQueueSnapshot(): QueuedSale[] {
    return snapshot
}

export function listQueuedSales(): QueuedSale[] {
    return snapshot.slice()
}

export function getPendingSales(): QueuedSale[] {
    return cache.filter((sale) => sale.status === 'pending')
}

export function getFailedSales(): QueuedSale[] {
    return cache.filter((sale) => sale.status === 'failed')
}

export function getPendingSyncCount(): number {
    return getPendingSales().length
}

export function enqueueSale(sale: QueuedSale): void {
    cache.push(sale)
    persist()
}

export function markSaleSynced(id: string): void {
    const index = cache.findIndex((sale) => sale.id === id)
    if (index === -1) {
        return
    }
    cache.splice(index, 1)
    persist()
}

export function markSaleFailed(id: string, errorMessage: string): void {
    const sale = cache.find((item) => item.id === id)
    if (!sale) {
        return
    }
    sale.status = 'failed'
    sale.errorMessage = errorMessage
    persist()
}

export function retryFailedSale(id: string): void {
    const sale = cache.find((item) => item.id === id)
    if (!sale) {
        return
    }
    sale.status = 'pending'
    sale.errorMessage = undefined
    persist()
}

export function removeQueuedSale(id: string): void {
    const index = cache.findIndex((sale) => sale.id === id)
    if (index === -1) {
        return
    }
    cache.splice(index, 1)
    persist()
}
