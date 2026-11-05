export const PDV_HEARTBEAT_POLL_INTERVAL_MS = 30_000

export function startPdvHeartbeatPolling(refresh: () => void): () => void {
    const intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
            refresh()
        }
    }, PDV_HEARTBEAT_POLL_INTERVAL_MS)
    const handleOnline = () => refresh()
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            refresh()
        }
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
        window.clearInterval(intervalId)
        window.removeEventListener('online', handleOnline)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
}
