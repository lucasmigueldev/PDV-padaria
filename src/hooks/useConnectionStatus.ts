import { useSyncExternalStore } from 'react'
import { getConnectionState, subscribeConnection } from '../services/connection'

export function useConnectionStatus() {
    return useSyncExternalStore(subscribeConnection, getConnectionState, getConnectionState)
}
