import { useSyncExternalStore } from 'react'
import {
    getQueueSnapshot,
    getQueueLoadError,
    listQueuedSales,
    subscribeQueue,
} from '../services/offlineSalesQueue'

const EMPTY_QUEUE: ReturnType<typeof getQueueSnapshot> = []

function getSafeQueueSnapshot() {
    try {
        return getQueueSnapshot()
    } catch {
        return EMPTY_QUEUE
    }
}

function getSafeQueueList() {
    try {
        return listQueuedSales()
    } catch {
        return EMPTY_QUEUE
    }
}

function getQueueErrorSnapshot(): Error | null {
    try {
        getQueueSnapshot()
    } catch {
        return getQueueLoadError()
    }
    return null
}

/**
 * React subscription over the offline sales queue.
 * `getQueueSnapshot` is stable between updates (useSyncExternalStore guarantee),
 * while `listQueuedSales` is the live view the UI reads.
 */
export function useOfflineQueue() {
    return useSyncExternalStore(subscribeQueue, getSafeQueueSnapshot, getSafeQueueList)
}

export function useOfflineQueueError() {
    return useSyncExternalStore(subscribeQueue, getQueueErrorSnapshot, getQueueErrorSnapshot)
}
