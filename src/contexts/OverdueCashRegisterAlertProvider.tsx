import { useCallback, useState, type ReactNode } from 'react'

import { OverdueCashRegisterAlertContext } from './OverdueCashRegisterAlertContext'

export function OverdueCashRegisterAlertProvider({ children }: { children: ReactNode }) {
    const [alertCount, setAlertCount] = useState(0)
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => new Set())
    const openDetails = useCallback(() => setDismissedAlerts(new Set()), [])

    return (
        <OverdueCashRegisterAlertContext.Provider value={{
            alertCount,
            setAlertCount,
            dismissedAlerts,
            setDismissedAlerts,
            openDetails,
        }}>
            {children}
        </OverdueCashRegisterAlertContext.Provider>
    )
}
