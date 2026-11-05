export interface CashClosure {
    id: string
    cashRegisterId: string
    bakeryId?: string
    closureType: 'normal' | 'administrative'
    reconciliationStatus: 'reconciled' | 'pending'
    openedAt: string
    initialAmount: number
    closedAt: string
    countedAmount: number | null
    expectedAmount: number | null
    differenceAmount: number | null
    cashSalesAmount: number | null
    administrativeCloseReason?: string
    reconciliationReason?: string | null
    administratorName?: string
    reconciledAt?: string | null
}