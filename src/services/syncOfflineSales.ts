import { createSaleWithItems } from './operations'
import {
    getPendingSales,
    getFailedSales,
    getPendingSyncCount,
    getQueueSnapshot,
    markSaleFailed,
    markSaleSynced,
    retryFailedSale,
    subscribeQueue,
} from './offlineSalesQueue'
import { isNetworkError, reportNetworkFailure, reportNetworkSuccess } from './connection'
import { updateSyncState } from './syncState'

const RETRY_DELAYS_MS = [15_000, 60_000, 300_000]

let isSyncRunning = false
let retryTimer: number | null = null
let retryAttempt = 0
let started = false
let onSyncCompleted: (() => void) | null = null

export interface SyncResult {
    synced: number
    failed: number
    remaining: number
}

/**
 * Syncs every pending sale (FIFO order).
 * Stops at the first network failure (keeps the queue intact) and reschedules
 * the whole batch with exponential backoff when connectivity returns.
 */
export async function syncPendingSales(): Promise<SyncResult | null> {
    if (isSyncRunning) {
        return null
    }
    if (getConnectionState().status === 'offline' && getPendingSales().length > 0) {
        scheduleRetry()
        return null
    }
    isSyncRunning = true
    updateSyncState({ isSyncing: true })

    let synced = 0
    let failed = 0
    let stoppedByNetwork = false

    try {
        const pending = getQueueSnapshot()
        for (const sale of pending) {
            try {
                await createSaleWithItems({
                    cashRegisterId: sale.cashRegisterId,
                    paymentMethod: sale.paymentMethod,
                    receivedAmount: sale.receivedAmount,
                    changeAmount: sale.changeAmount,
                    items: sale.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
                    idempotencyKey: sale.idempotencyKey,
                    occurredAt: sale.occurredAt,
                })
                markSaleSynced(sale.id)
                synced++
                reportNetworkSuccess()
            } catch (error) {
                if (isNetworkError(error)) {
                    stoppedByNetwork = true
                    reportNetworkFailure()
                    break // preserva FIFO: reage a próxima conexão
                }
                markSaleFailed(sale.id, error instanceof Error ? error.message : 'Não foi possível sincronizar esta venda.')
                failed++
            }
        }
    } finally {
        isSyncRunning = false
        const remaining = getPendingSyncCount()
        updateSyncState({
            isSyncing: false,
            lastSyncAt: Date.now(),
            lastSyncSummary: { synced, failed, remaining },
        })

        if (stoppedByNetwork && remaining > 0) {
            // só reage se a mutilação foi de rede
            scheduleRetry()
            retryAttempt = Math.min(retryAttempt + 1, RETRY_DELAYS_MS.length - 1)
        } else {
            cancelRetry()
            retryAttempt = 0
        }
    }

    return { synced, failed, remaining: getPendingSyncCount() }
}

export function startSalesSync(): () => void {
    if (started) {
        return () => undefined
    }
    started = true
    const handleOnline = () => {
        retryAttempt = 0
        cancelRetry()
        void syncPendingSales().then(() => onSyncCompleted?.())
    }
    window.addEventListener('online', handleOnline)

    // Tentativa imediata ao iniciar; reage aos eventos posteriores via subscribeQueue.
    void (async () => {
        await syncPendingSales()
        onSyncCompleted?.()
    })()

    return () => {
        window.removeEventListener('online', handleOnline)
        onSyncCompleted = null
    }
}

function scheduleRetry(): void {
    cancelRetry()
    retryTimer = window.setTimeout(() => {
        retryTimer = null
        void syncPendingSales().then(() => onSyncCompleted?.())
    }, RETRY_DELAYS_MS[retryAttempt])
}

function cancelRetry(): void {
    if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
    }
}

/**
 * Returns a stable snapshot of the queue for React subscriptions.
 * The queue module maintains the snapshot internally, so this always returns
 * the same reference until the data actually changes (useSyncExternalStore rule).
 */
export function subscribeSalesSync(listener: () => void): () => void {
    return subscribeQueue(listener)
}

export { getQueueSnapshot }
