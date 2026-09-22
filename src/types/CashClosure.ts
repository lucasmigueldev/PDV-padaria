export interface CashClosure {
    id: string
    bakeryId?: string
    openedAt: string
    initialAmount: number
    closedAt: string
    countedAmount: number
    expectedAmount: number
    differenceAmount: number
    cashSalesAmount: number
}