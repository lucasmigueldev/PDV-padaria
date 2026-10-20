import { useEffect, useRef } from 'react'

export const AUTO_REFRESH_INTERVAL_MS = 30_000

/**
 * Runs `callback` on a fixed interval and whenever the tab becomes visible
 * again, so admin screens stay in sync with sales made on other devices
 * while they stay open. The latest callback is kept in a ref so a scheduled
 * run never invokes a stale closure.
 */
export function useAutoRefresh(callback: () => void, intervalMs = AUTO_REFRESH_INTERVAL_MS): void {
    const callbackRef = useRef(callback)

    useEffect(() => {
        callbackRef.current = callback
    }, [callback])

    useEffect(() => {
        function refresh() {
            callbackRef.current()
        }

        function handleVisibilityChange() {
            if (document.visibilityState === 'visible') {
                refresh()
            }
        }

        const intervalId = window.setInterval(refresh, intervalMs)
        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            window.clearInterval(intervalId)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [intervalMs])
}
