import type { QueuedSale } from './offlineSalesQueue.ts'

export interface ServerSaleSnapshot {
    total: number | string
    occurredAt: string
    items: {
        productId: string | null
        price: number | string
        quantity: number
        subtotal: number | string
    }[]
}

export class OfflineSaleReconciliationPendingError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message, { cause })
        this.name = 'OfflineSaleReconciliationPendingError'
    }
}

export class OfflineSaleValueMismatchError extends Error {
    readonly remoteSaleId: string

    constructor(message: string, remoteSaleId: string) {
        super(message)
        this.name = 'OfflineSaleValueMismatchError'
        this.remoteSaleId = remoteSaleId
    }
}

function toCents(value: number | string): number | null {
    const amount = Number(value)
    if (!Number.isFinite(amount)) {
        return null
    }
    return Math.round(amount * 100)
}

function money(value: number | string): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
}

export function assertOfflineSaleMatchesServer(
    sale: QueuedSale,
    remoteSaleId: string,
    serverSale: ServerSaleSnapshot,
): void {
    const mismatches: string[] = []
    const expectedTotal = toCents(sale.total)
    const actualTotal = toCents(serverSale.total)
    if (expectedTotal === null || expectedTotal !== actualTotal) {
        mismatches.push(`total local ${money(sale.total)}; total registrado ${money(serverSale.total)}`)
    }

    const expectedTime = Date.parse(sale.occurredAt)
    const actualTime = Date.parse(serverSale.occurredAt)
    if (!Number.isFinite(expectedTime) || expectedTime !== actualTime) {
        mismatches.push(`horário local ${sale.occurredAt}; horário registrado ${serverSale.occurredAt}`)
    }

    if (sale.items.length !== serverSale.items.length) {
        mismatches.push(`quantidade de itens local ${sale.items.length}; quantidade registrada ${serverSale.items.length}`)
    }

    const remoteItemsByProductId = new Map(serverSale.items.map((item) => [item.productId, item]))
    for (const localItem of sale.items) {
        const remoteItem = remoteItemsByProductId.get(localItem.productId)
        if (!remoteItem) {
            mismatches.push(`produto ${localItem.productId} ausente na venda registrada`)
            continue
        }

        const localPrice = toCents(localItem.price)
        const remotePrice = toCents(remoteItem.price)
        const expectedSubtotal = localPrice === null ? null : localPrice * localItem.quantity
        const remoteSubtotal = toCents(remoteItem.subtotal)
        if (remoteItem.quantity !== localItem.quantity
            || localPrice === null
            || remotePrice !== localPrice
            || expectedSubtotal !== remoteSubtotal) {
            mismatches.push(
                `produto ${localItem.name}: ${localItem.quantity} × ${money(localItem.price)} local; `
                + `${remoteItem.quantity} × ${money(remoteItem.price)} registrado`,
            )
        }
    }

    if (mismatches.length > 0) {
        throw new OfflineSaleValueMismatchError(
            `Divergência na venda sincronizada (${remoteSaleId}): ${mismatches.join('; ')}. `
            + 'A venda foi preservada para revisão e não foi marcada como sincronizada.',
            remoteSaleId,
        )
    }
}
