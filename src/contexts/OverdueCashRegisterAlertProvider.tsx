import { useCallback, useState, type ReactNode } from 'react'

import { OverdueCashRegisterAlertContext } from './OverdueCashRegisterAlertContext'
import type { OverdueCashRegisterAlert } from '../services/overdueCashRegisterAlerts'

export function OverdueCashRegisterAlertProvider({ children }: { children: ReactNode }) {
    const [alertCount, setAlertCount] = useState(0)
    const [alerts, setAlerts] = useState<OverdueCashRegisterAlert[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => new Set())
    const [requestedAlertId, setRequestedAlertId] = useState<string | null>(null)
    const openDetails = useCallback((cashRegisterId?: string) => {
        setRequestedAlertId(cashRegisterId ?? null)
        setDismissedAlerts((current) => {
            if (!cashRegisterId) return new Set()
            const next = new Set(current)
            next.delete(cashRegisterId)
            return next
        })
    }, [])

    return (
        <OverdueCashRegisterAlertContext.Provider value={{
            alertCount,
            setAlertCount,
            alerts,
            setAlerts,
            isLoading,
            setIsLoading,
            error,
            setError,
            dismissedAlerts,
            setDismissedAlerts,
            requestedAlertId,
            setRequestedAlertId,
            openDetails,
        }}>
            {children}
        </OverdueCashRegisterAlertContext.Provider>
    )
}
