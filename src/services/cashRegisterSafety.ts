import { getConnectionState, isNetworkError, reportNetworkFailure, reportNetworkSuccess } from './connection.ts'
import type { QueuedSale } from './offlineSalesQueue.ts'

export class CashRegisterOfflineOperationError extends Error {
    constructor(operation: 'abrir' | 'fechar') {
        super(`Não é possível ${operation} o caixa sem conexão confirmada com o sistema.`)
        this.name = 'CashRegisterOfflineOperationError'
    }
}

export function assertCashRegisterConnectionAvailable(operation: 'abrir' | 'fechar'): void {
    if (getConnectionState().status !== 'online') {
        throw new CashRegisterOfflineOperationError(operation)
    }
}

export class CashRegisterOperationOutcomeUnknownError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message, { cause })
        this.name = 'CashRegisterOperationOutcomeUnknownError'
    }
}

export interface CashRegisterRpcError {
    code?: string
    message: string
}

export async function executeCashRegisterRpc<T>(
    operation: 'abrir' | 'fechar',
    request: () => Promise<{ data: T; error: CashRegisterRpcError | null }>,
    rejectServerError: (error: CashRegisterRpcError) => never,
    unknownOutcomeMessage: string,
): Promise<T> {
    assertCashRegisterConnectionAvailable(operation)

    let response: { data: T; error: CashRegisterRpcError | null }
    try {
        response = await request()
    } catch (error) {
        if (isNetworkError(error)) {
            reportNetworkFailure()
        }
        throw new CashRegisterOperationOutcomeUnknownError(unknownOutcomeMessage, error)
    }

    if (response.error) {
        if (isNetworkError(response.error)) {
            reportNetworkFailure()
            throw new CashRegisterOperationOutcomeUnknownError(unknownOutcomeMessage, response.error)
        }
        rejectServerError(response.error)
    }

    reportNetworkSuccess()
    return response.data
}

export function getUnresolvedSalesForCashRegister(
    sales: readonly QueuedSale[],
    cashRegisterId: string,
): QueuedSale[] {
    return sales.filter((sale) => sale.cashRegisterId === cashRegisterId)
}

export function getCashRegisterCloseBlockMessage(
    sales: readonly QueuedSale[],
    cashRegisterId: string,
    queueLoadError: Error | null,
): string | null {
    if (queueLoadError) {
        return 'Não foi possível verificar todas as vendas locais. Não feche o caixa até recuperar ou reconciliar a fila offline.'
    }

    const unresolved = getUnresolvedSalesForCashRegister(sales, cashRegisterId)
    if (unresolved.length === 0) {
        return null
    }

    const pending = unresolved.filter((sale) => sale.status === 'pending').length
    const failed = unresolved.length - pending
    const details = [
        pending > 0 ? `${pending} pendente(s)` : '',
        failed > 0 ? `${failed} com falha ou aguardando reconciliação` : '',
    ].filter(Boolean).join(' e ')
    return `Há ${unresolved.length} venda(s) sem resolução neste caixa (${details}). Sincronize ou reconcilie antes de fechar.`
}
