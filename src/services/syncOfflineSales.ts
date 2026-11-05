import { syncQueuedOfflineSale, type QueuedOfflineSaleSyncResult } from './operations.ts'
import {
    getPendingSales,
    getQueueSnapshot,
    markSaleFailed,
    markSaleQuarantined,
    markSaleSynced,
    subscribeQueue,
    type QueuedSale,
} from './offlineSalesQueue.ts'
import { getConnectionState, isNetworkError, reportNetworkFailure, reportNetworkSuccess } from './connection.ts'
import {
    OfflineSaleReconciliationPendingError,
    OfflineSaleValueMismatchError,
} from './offlineSaleReconciliation.ts'
import { updateSyncState } from './syncState.ts'

const RETRY_DELAYS_MS = [15_000, 60_000, 300_000]

export interface SyncScope {
    operatorUserId: string
    bakeryId: string
}

export type SyncSale = (sale: QueuedSale) => Promise<QueuedOfflineSaleSyncResult>

export interface SyncResult {
    synced: number
    failed: number
    remaining: number
    quarantined?: number
}

let isSyncRunning = false
let retryTimer: number | null = null
let retryAttempt = 0
let started = false
let lifecycleId = 0
let activeScope: SyncScope | null = null
const defaultSyncSale: SyncSale = (sale) => syncQueuedOfflineSale(sale)
let activeSyncSale: SyncSale = defaultSyncSale
let unsubscribeQueue: (() => void) | null = null
let activeOnlineHandler: (() => void) | null = null
let syncRequested = false

function isInScope(sale: QueuedSale, scope: SyncScope): boolean {
    return sale.operatorUserId === scope.operatorUserId && sale.bakeryId === scope.bakeryId
}

function getScopedPendingSales(scope: SyncScope): QueuedSale[] {
    return getPendingSales().filter((sale) => isInScope(sale, scope))
}

function getScopedPendingCount(scope: SyncScope): number {
    return getScopedPendingSales(scope).length
}

function triggerSync(): void {
    if (!started || !activeScope) {
        return
    }
    if (isSyncRunning) {
        syncRequested = true
        return
    }

    const runId = lifecycleId
    const scope = activeScope
    const syncSale = activeSyncSale
    void syncPendingSales(scope, syncSale, () => started && lifecycleId === runId)
        .catch((error: unknown) => {
            console.error('Não foi possível iniciar a sincronização da fila de vendas offline.', error)
        })
}

/**
 * Syncs the current operator's sales for one bakery in FIFO order.
 * Legacy records without an operator ID are retained but are not sent under
 * another operator's authenticated session.
 */
export async function syncPendingSales(
    scope: SyncScope,
    syncSale: SyncSale = activeSyncSale,
    isCurrent: () => boolean = () => true,
): Promise<SyncResult | null> {
    if (isSyncRunning) {
        syncRequested = true
        return null
    }

    const pending = getScopedPendingSales(scope)
    if (!pending.length) {
        return { synced: 0, failed: 0, remaining: 0 }
    }
    if (getConnectionState().status === 'offline') {
        if (started && isCurrent()) {
            scheduleRetry()
        }
        return null
    }

    isSyncRunning = true
    updateSyncState({ isSyncing: true })

    let synced = 0
    let quarantined = 0
    let failed = 0
    let stoppedByNetwork = false
    let stoppedByStorage = false
    let stoppedByReconciliation = false

    try {
        for (const sale of pending) {
            if (!isCurrent()) {
                break
            }

            let result: QueuedOfflineSaleSyncResult
            try {
                result = await syncSale(sale)
            } catch (error) {
                if (!isCurrent()) {
                    break
                }
                if (isNetworkError(error)) {
                    stoppedByNetwork = true
                    reportNetworkFailure()
                    break
                }
                if (error instanceof OfflineSaleReconciliationPendingError) {
                    stoppedByReconciliation = true
                    if (isNetworkError(error)) {
                        reportNetworkFailure()
                    }
                    console.warn(error.message)
                    break
                }

                try {
                    markSaleFailed(
                        sale.id,
                        error instanceof Error ? error.message : 'Não foi possível sincronizar esta venda.',
                        error instanceof OfflineSaleValueMismatchError ? error.remoteSaleId : undefined,
                    )
                    failed++
                } catch (storageError) {
                    stoppedByStorage = true
                    console.error('A venda rejeitada não pôde ter seu estado persistido; ela permanece na fila para nova tentativa.', storageError)
                    break
                }
                continue
            }

            if (!isCurrent()) {
                break
            }

            if (typeof result !== 'string') {
                try {
                    markSaleQuarantined(sale.id, result.eventId)
                } catch (storageError) {
                    stoppedByStorage = true
                    console.error('A venda foi confirmada em quarentena, mas o estado local não pôde ser persistido. A mesma chave será reutilizada na próxima tentativa.', storageError)
                    break
                }
                quarantined++
                reportNetworkSuccess()
                continue
            }

            try {
                markSaleSynced(sale.id)
            } catch (storageError) {
                stoppedByStorage = true
                console.error('A venda foi confirmada pelo servidor, mas sua remoção da fila não pôde ser persistida. A mesma chave de idempotência será reutilizada na próxima tentativa.', storageError)
                break
            }
            synced++
            reportNetworkSuccess()
        }
    } finally {
        isSyncRunning = false

        if (started && activeScope && isCurrent()) {
            const remaining = getScopedPendingCount(activeScope)
            updateSyncState({
                isSyncing: false,
                lastSyncAt: Date.now(),
                lastSyncSummary: { synced, failed, remaining },
            })

            if ((stoppedByNetwork || stoppedByStorage || stoppedByReconciliation) && remaining > 0) {
                scheduleRetry()
                retryAttempt = Math.min(retryAttempt + 1, RETRY_DELAYS_MS.length - 1)
            } else {
                cancelRetry()
                retryAttempt = 0
            }
        } else {
            updateSyncState({ isSyncing: false })
        }

        if (syncRequested && started) {
            syncRequested = false
            triggerSync()
        }
    }

    const result = { synced, failed, remaining: getScopedPendingCount(scope) }
    return quarantined > 0 ? { ...result, quarantined } : result
}

export function startSalesSync(scope: SyncScope, syncSale?: SyncSale): () => void {
    if (!scope.operatorUserId || !scope.bakeryId) {
        throw new Error('A sincronização exige a identificação do operador e da padaria.')
    }

    stopActiveSync()
    started = true
    activeScope = { ...scope }
    activeSyncSale = syncSale ?? defaultSyncSale
    const runId = lifecycleId

    const handleOnline = () => {
        retryAttempt = 0
        cancelRetry()
        triggerSync()
    }
    activeOnlineHandler = handleOnline
    window.addEventListener('online', handleOnline)
    unsubscribeQueue = subscribeQueue(triggerSync)
    triggerSync()

    return () => {
        if (runId === lifecycleId) {
            stopActiveSync()
        } else {
            window.removeEventListener('online', handleOnline)
        }
    }
}

function stopActiveSync(): void {
    lifecycleId++
    started = false
    activeScope = null
    syncRequested = false
    activeSyncSale = defaultSyncSale
    if (activeOnlineHandler) {
        window.removeEventListener('online', activeOnlineHandler)
        activeOnlineHandler = null
    }
    unsubscribeQueue?.()
    unsubscribeQueue = null
    cancelRetry()
    retryAttempt = 0
    updateSyncState({ isSyncing: false })
}

function scheduleRetry(): void {
    if (!started || retryTimer !== null) {
        return
    }
    retryTimer = window.setTimeout(() => {
        retryTimer = null
        triggerSync()
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
 */
export function subscribeSalesSync(listener: () => void): () => void {
    return subscribeQueue(listener)
}

export { getQueueSnapshot }
