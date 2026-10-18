import { useSyncExternalStore } from 'react'
import {
    getQueueSnapshot,
    listQueuedSales,
    subscribeQueue,
} from '../services/offlineSalesQueue'

/**
 * React subscription over the offline sales queue.
 * `getQueueSnapshot` is stable between updates (useSyncExternalStore guarantee),
 * while `listQueuedSales` is the live view the UI reads.
 */
export function useOfflineQueue() {
    return useSyncExternalStore(subscribeQueue, getQueueSnapshot, listQueuedSales)
}
