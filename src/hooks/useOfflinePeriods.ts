import { useSyncExternalStore } from 'react'
import {
    getOfflinePeriodSnapshot,
    subscribeOfflinePeriods,
    getTotalOfflineTimeMs,
    getOfflineCount,
} from '../services/offlinePeriods'

export function useOfflinePeriods() {
    const periods = useSyncExternalStore(
        subscribeOfflinePeriods,
        getOfflinePeriodSnapshot,
        getOfflinePeriodSnapshot,
    )
    return {
        periods,
        totalOfflineTimeMs: getTotalOfflineTimeMs(),
        offlineCount: getOfflineCount(),
    }
}
