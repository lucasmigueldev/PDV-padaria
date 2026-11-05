import { createContext, useContext } from 'react'

import type { OverdueCashRegisterAlert } from '../services/overdueCashRegisterAlerts'

export type OverdueCashRegisterAlertContextValue = {
    alertCount: number
    setAlertCount: (count: number) => void
    alerts: readonly OverdueCashRegisterAlert[]
    setAlerts: (alerts: OverdueCashRegisterAlert[]) => void
    isLoading: boolean
    setIsLoading: (isLoading: boolean) => void
    error: string | null
    setError: (error: string | null) => void
    dismissedAlerts: ReadonlySet<string>
    setDismissedAlerts: (alerts: Set<string> | ((current: Set<string>) => Set<string>)) => void
    requestedAlertId: string | null
    setRequestedAlertId: (id: string | null) => void
    openDetails: (cashRegisterId?: string) => void
}

export const OverdueCashRegisterAlertContext =
    createContext<OverdueCashRegisterAlertContextValue | null>(null)

export function useOverdueCashRegisterAlertContext(): OverdueCashRegisterAlertContextValue {
    const context = useContext(OverdueCashRegisterAlertContext)
    if (!context) {
        throw new Error('useOverdueCashRegisterAlertContext deve ser usado dentro do contexto de alertas.')
    }
    return context
}
