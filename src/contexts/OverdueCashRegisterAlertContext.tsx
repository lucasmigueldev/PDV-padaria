import { createContext, useContext } from 'react'

export type OverdueCashRegisterAlertContextValue = {
    alertCount: number
    setAlertCount: (count: number) => void
    dismissedAlerts: ReadonlySet<string>
    setDismissedAlerts: (alerts: Set<string> | ((current: Set<string>) => Set<string>)) => void
    openDetails: () => void
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
