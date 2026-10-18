import { useSyncExternalStore } from 'react'
import { getSyncState, subscribeSyncState } from '../services/syncState'

export function useSyncStatus() {
    return useSyncExternalStore(subscribeSyncState, getSyncState, getSyncState)
}
