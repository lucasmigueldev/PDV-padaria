export interface Bakery {
    id: string
    name: string
    active: boolean
    cashRegisterMonitoringEnabled: boolean
    cashRegisterDeadlineHour: number | null
}