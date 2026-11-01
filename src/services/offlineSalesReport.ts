import type { QueuedSale } from './offlineSalesQueue.ts'

export interface OfflineSalesReport {
    available: boolean
    pending: QueuedSale[]
    failed: QueuedSale[]
    duplicateRecords: number
    confirmedOfflineSalesIdentifiable: false
}

export function buildOfflineSalesReport(
    sales: readonly QueuedSale[],
    bakeryId: string | null,
    queueAvailable: boolean,
): OfflineSalesReport {
    if (!queueAvailable) {
        return {
            available: false,
            pending: [],
            failed: [],
            duplicateRecords: 0,
            confirmedOfflineSalesIdentifiable: false,
        }
    }

    const seenKeys = new Set<string>()
    const uniqueSales: QueuedSale[] = []
    let duplicateRecords = 0

    for (const sale of sales) {
        if (bakeryId && sale.bakeryId !== bakeryId) {
            continue
        }
        const key = `${sale.bakeryId}:${sale.operatorUserId ?? 'legacy'}:${sale.idempotencyKey || sale.id}`
        if (seenKeys.has(key)) {
            duplicateRecords++
            continue
        }
        seenKeys.add(key)
        uniqueSales.push(sale)
    }

    const byOccurredAtDescending = (first: QueuedSale, second: QueuedSale) =>
        Date.parse(second.occurredAt) - Date.parse(first.occurredAt)

    return {
        available: true,
        pending: uniqueSales
            .filter((sale) => sale.status === 'pending')
            .sort(byOccurredAtDescending),
        failed: uniqueSales
            .filter((sale) => sale.status === 'failed')
            .sort(byOccurredAtDescending),
        duplicateRecords,
        confirmedOfflineSalesIdentifiable: false,
    }
}
