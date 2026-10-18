export interface SyncSummary {
    synced: number
    failed: number
    remaining: number
}

export interface SyncState {
    isSyncing: boolean
    lastSyncAt: number | null
    lastSyncSummary: SyncSummary | null
}

let state: SyncState = {
    isSyncing: false,
    lastSyncAt: null,
    lastSyncSummary: null,
}

const listeners = new Set<() => void>()

export function getSyncState(): SyncState {
    return state
}

export function subscribeSyncState(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function updateSyncState(next: Partial<SyncState>): void {
    state = { ...state, ...next }
    for (const listener of listeners) {
        listener()
    }
}
