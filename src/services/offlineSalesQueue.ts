import type { PaymentMethod } from '../types/Sale'

export type QueuedSaleStatus = 'pending' | 'failed' | 'quarantined'

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
    offlineSessionId?: string | null
    cashRegisterId: string
    bakeryId: string
    operatorUserId?: string
    remoteSaleId?: string
    quarantineEventId?: string
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
let isLoaded = false
let loadError: Error | null = null
const listeners = new Set<() => void>()

export class OfflineSalesQueueStorageError extends Error {
    constructor(message: string, cause: unknown) {
        super(message, { cause })
        this.name = 'OfflineSalesQueueStorageError'
    }
}

function isQueuedSale(value: unknown): value is QueuedSale {
    if (typeof value !== 'object' || value === null) {
        return false
    }

    const sale = value as Record<string, unknown>
    const hasValidOfflineSessionId = sale.offlineSessionId === undefined
        || sale.offlineSessionId === null
        || (typeof sale.offlineSessionId === 'string'
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sale.offlineSessionId))
    return typeof sale.id === 'string'
        && typeof sale.idempotencyKey === 'string'
        && typeof sale.localRef === 'string'
        && hasValidOfflineSessionId
        && typeof sale.cashRegisterId === 'string'
        && typeof sale.bakeryId === 'string'
        && (sale.operatorUserId === undefined || typeof sale.operatorUserId === 'string')
        && (sale.remoteSaleId === undefined || typeof sale.remoteSaleId === 'string')
        && (sale.quarantineEventId === undefined || typeof sale.quarantineEventId === 'string')
        && typeof sale.occurredAt === 'string'
        && Number.isFinite(Date.parse(sale.occurredAt))
        && (sale.paymentMethod === 'cash' || sale.paymentMethod === 'pix' || sale.paymentMethod === 'card')
        && (sale.receivedAmount === null || (typeof sale.receivedAmount === 'number' && Number.isFinite(sale.receivedAmount)))
        && (sale.changeAmount === null || (typeof sale.changeAmount === 'number' && Number.isFinite(sale.changeAmount)))
        && typeof sale.total === 'number'
        && Number.isFinite(sale.total)
        && Array.isArray(sale.items)
        && sale.items.every((item: unknown) => {
            if (typeof item !== 'object' || item === null) {
                return false
            }
            const queuedItem = item as Record<string, unknown>
            return typeof queuedItem.productId === 'string'
                && typeof queuedItem.name === 'string'
                && typeof queuedItem.barcode === 'string'
                && typeof queuedItem.price === 'number'
                && Number.isFinite(queuedItem.price)
                && typeof queuedItem.quantity === 'number'
                && Number.isSafeInteger(queuedItem.quantity)
                && queuedItem.quantity > 0
        })
        && (sale.status === 'pending' || sale.status === 'failed' || sale.status === 'quarantined')
        && (sale.status !== 'quarantined'
            || (typeof sale.quarantineEventId === 'string' && sale.quarantineEventId.length > 0))
        && (sale.errorMessage === undefined || typeof sale.errorMessage === 'string')
        && typeof sale.createdAt === 'string'
        && Number.isFinite(Date.parse(sale.createdAt))
}

function parseStoredQueue(raw: string | null): QueuedSale[] {
    if (raw === null) {
        return []
    }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(isQueuedSale)) {
        throw new Error('Os dados armazenados não correspondem ao formato esperado.')
    }
    return parsed
}

function initialize(): QueuedSale[] {
    if (loadError) {
        throw loadError
    }
    if (isLoaded) {
        return cache
    }

    try {
        cache = parseStoredQueue(window.localStorage.getItem(STORAGE_KEY))
        snapshot = cache.slice()
        isLoaded = true
        return cache
    } catch (error) {
        loadError = new OfflineSalesQueueStorageError(
            'Não foi possível recuperar a fila de vendas offline. Os dados armazenados foram preservados para diagnóstico.',
            error,
        )
        console.error(loadError.message, error)
        throw loadError
    }
}

function notifyListeners(): void {
    for (const listener of listeners) {
        try {
            listener()
        } catch (error) {
            console.error('Falha ao notificar uma atualização da fila de vendas offline.', error)
        }
    }
}

function persist(next: QueuedSale[]): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
        console.error('Falha ao gravar a fila de vendas offline.', error)
        throw new OfflineSalesQueueStorageError(
            'Não foi possível salvar a venda neste dispositivo. Verifique o armazenamento e tente novamente.',
            error,
        )
    }

    cache = next
    snapshot = cache.slice()
    notifyListeners()
}

/** Cross-tab sync: other tabs/instancias write to the same key and this module stays consistent. */
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY) {
            return
        }
        try {
            cache = parseStoredQueue(event.newValue)
            snapshot = cache.slice()
            isLoaded = true
            loadError = null
            notifyListeners()
        } catch (error) {
            loadError = new OfflineSalesQueueStorageError(
                'Não foi possível recuperar a fila de vendas offline atualizada por outra aba. Os dados armazenados foram preservados para diagnóstico.',
                error,
            )
            console.error(loadError.message, error)
            notifyListeners()
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
    initialize()
    return snapshot
}

export function listQueuedSales(): QueuedSale[] {
    return getQueueSnapshot().slice()
}

export function getQueueLoadError(): Error | null {
    return loadError
}

export function getPendingSales(): QueuedSale[] {
    return initialize().filter((sale) => sale.status === 'pending')
}

export function getFailedSales(): QueuedSale[] {
    return initialize().filter((sale) => sale.status === 'failed')
}

export function getQuarantinedSales(): QueuedSale[] {
    return initialize().filter((sale) => sale.status === 'quarantined')
}

export function getPendingSyncCount(): number {
    return getPendingSales().length
}

function hasSameSalePayload(first: QueuedSale, second: QueuedSale): boolean {
    return first.id === second.id
        && first.idempotencyKey === second.idempotencyKey
        && first.localRef === second.localRef
        && (first.offlineSessionId ?? null) === (second.offlineSessionId ?? null)
        && first.cashRegisterId === second.cashRegisterId
        && first.bakeryId === second.bakeryId
        && first.operatorUserId === second.operatorUserId
        && first.occurredAt === second.occurredAt
        && first.paymentMethod === second.paymentMethod
        && first.receivedAmount === second.receivedAmount
        && first.changeAmount === second.changeAmount
        && first.total === second.total
        && JSON.stringify(first.items) === JSON.stringify(second.items)
}

export function enqueueSale(sale: QueuedSale): boolean {
    if (!isQueuedSale(sale)) {
        throw new Error('Não foi possível enfileirar a venda porque seus dados são inválidos.')
    }

    const current = initialize()
    const existing = current.find((item) => item.id === sale.id || item.idempotencyKey === sale.idempotencyKey)
    if (existing) {
        if (existing.status === 'pending' && hasSameSalePayload(existing, sale)) {
            return true
        }
        throw new Error('A venda não pode ser enfileirada porque seu identificador já pertence a outro registro.')
    }

    persist([...current, sale])
    return true
}

export function markSaleSynced(id: string): void {
    const current = initialize()
    const index = current.findIndex((sale) => sale.id === id)
    if (index === -1 || current[index]?.status === 'quarantined') {
        return
    }
    const next = current.slice()
    next.splice(index, 1)
    persist(next)
}

export function markSaleFailed(id: string, errorMessage: string, remoteSaleId?: string): void {
    const current = initialize()
    if (!current.some((sale) => sale.id === id && sale.status !== 'quarantined')) {
        return
    }
    persist(current.map((sale) => {
        if (sale.id !== id) {
            return sale
        }
        const failedSale: QueuedSale = { ...sale, status: 'failed', errorMessage }
        if (remoteSaleId) {
            failedSale.remoteSaleId = remoteSaleId
        }
        return failedSale
    }))
}

export function markSaleQuarantined(id: string, quarantineEventId: string): void {
    const current = initialize()
    const sale = current.find((item) => item.id === id)
    if (!sale || sale.status === 'quarantined') {
        return
    }
    if (!quarantineEventId) {
        throw new Error('O servidor não confirmou o identificador do evento em quarentena.')
    }

    persist(current.map((item) => {
        if (item.id !== id) return item
        const quarantinedSale: QueuedSale = {
            ...item,
            status: 'quarantined',
            quarantineEventId,
        }
        delete quarantinedSale.errorMessage
        delete quarantinedSale.remoteSaleId
        return quarantinedSale
    }))
}

export function retryFailedSale(id: string): void {
    const current = initialize()
    if (!current.some((sale) => sale.id === id && sale.status === 'failed')) {
        return
    }
    persist(current.map((sale): QueuedSale => {
        if (sale.id !== id) {
            return sale
        }
        const retryingSale: QueuedSale = { ...sale, status: 'pending' }
        delete retryingSale.errorMessage
        return retryingSale
    }))
}

export function removeQueuedSale(id: string): void {
    const current = initialize()
    const index = current.findIndex((sale) => sale.id === id)
    if (index === -1) {
        return
    }
    const next = current.slice()
    next.splice(index, 1)
    persist(next)
}
