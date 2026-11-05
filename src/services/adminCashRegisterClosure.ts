import { getSupabaseClient } from '../lib/supabaseClient.ts'
import { isNetworkError, reportNetworkFailure, reportNetworkSuccess } from './connection.ts'
import { OfflineSaleReconciliationPendingError } from './offlineSaleReconciliation.ts'
import type { QueuedSale } from './offlineSalesQueue.ts'

export interface AdminCashRegisterRpcError {
    code?: string
    message: string
}

export interface LateOfflineSalePayload {
    id: string
    idempotencyKey: string
    localRef: string
    offlineSessionId: string | null
    cashRegisterId: string
    bakeryId: string
    operatorUserId: string
    occurredAt: string
    createdAt: string
    paymentMethod: QueuedSale['paymentMethod']
    receivedAmount: number | null
    changeAmount: number | null
    total: number
    items: QueuedSale['items']
    status: QueuedSale['status']
    errorMessage?: string
}

export type LateSaleRegisterStatus = 'open' | 'closed' | 'unknown'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isAdminCashRegisterClosureEnabled(): boolean {
    return import.meta.env?.VITE_ENABLE_ADMIN_CASH_REGISTER_CLOSURE === 'true'
}

export class CashRegisterNotOpenError extends Error {
    constructor(cause?: unknown) {
        super('Não há caixa aberto nesta unidade. A venda continua preservada para sincronização.', { cause })
        this.name = 'CashRegisterNotOpenError'
    }
}

export class LateOfflineSaleRejectedError extends Error {
    constructor(message: string, cause?: unknown) {
        super(message, { cause })
        this.name = 'LateOfflineSaleRejectedError'
    }
}

export type AdministrativeClosureRpc = (
    cashRegisterId: string,
    reason: string,
) => Promise<{ data: unknown; error: AdminCashRegisterRpcError | null }>

export async function administrativelyCloseOverdueCashRegister(
    cashRegisterId: string,
    reason: string,
    options: {
        enabled?: boolean
        invoke?: AdministrativeClosureRpc
    } = {},
): Promise<string> {
    const enabled = options.enabled ?? isAdminCashRegisterClosureEnabled()
    if (!enabled) {
        throw new Error('O encerramento administrativo está desabilitado neste ambiente.')
    }
    if (!cashRegisterId || typeof reason !== 'string' || reason.trim().length === 0 || reason.trim().length > 500) {
        throw new Error('Informe um motivo de até 500 caracteres para encerrar o caixa.')
    }

    const invoke = options.invoke ?? (async (registerId, closureReason) =>
        await getSupabaseClient().rpc('administratively_close_overdue_cash_register', {
            p_cash_register_id: registerId,
            p_reason: closureReason,
        }))

    let response: { data: unknown; error: AdminCashRegisterRpcError | null }
    try {
        response = await invoke(cashRegisterId, reason.trim())
    } catch (error) {
        throw getAdministrativeClosureError(error)
    }

    if (response.error) {
        throw getAdministrativeClosureError(response.error)
    }
    if (typeof response.data !== 'string' || !UUID_PATTERN.test(response.data)) {
        throw new Error('O servidor não confirmou o encerramento administrativo do caixa.')
    }
    reportNetworkSuccess()
    return response.data
}

function getAdministrativeClosureError(error: unknown): Error {
    if (isNetworkError(error)) {
        reportNetworkFailure()
        return new Error('Falha de conexão ao solicitar o encerramento. O resultado é desconhecido; atualize os dados antes de tentar novamente.', { cause: error })
    }

    const candidate = typeof error === 'object' && error !== null
        ? error as { code?: unknown; message?: unknown }
        : null
    const code = typeof candidate?.code === 'string' ? candidate.code : ''
    const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''

    if (code === '42501') {
        return new Error('Seu usuário não está autorizado a encerrar este caixa ou a padaria não pertence ao seu escopo.')
    }
    if (code === '23514' && /deadline|configured deadline|not reached/.test(message)) {
        return new Error('O prazo configurado para este caixa ainda não venceu. Atualize os dados e tente novamente.')
    }
    if (code === '23514' && /normally closed|already closed/.test(message)) {
        return new Error('Este caixa já foi fechado pelo fluxo normal e não pode ser encerrado administrativamente.')
    }
    if (code === '23514') {
        return new Error('O caixa não está mais aberto ou não atende às condições de encerramento administrativo.')
    }
    return new Error('Não foi possível encerrar o caixa administrativamente. Atualize os dados e tente novamente.', { cause: error })
}

export function createLateOfflineSalePayload(sale: QueuedSale): LateOfflineSalePayload {
    if (!sale.operatorUserId) {
        throw new LateOfflineSaleRejectedError('A venda não tem um operador identificado e foi preservada para análise.')
    }
    return {
        id: sale.id,
        idempotencyKey: sale.idempotencyKey,
        localRef: sale.localRef,
        offlineSessionId: sale.offlineSessionId ?? null,
        cashRegisterId: sale.cashRegisterId,
        bakeryId: sale.bakeryId,
        operatorUserId: sale.operatorUserId,
        occurredAt: sale.occurredAt,
        createdAt: sale.createdAt,
        paymentMethod: sale.paymentMethod,
        receivedAmount: sale.receivedAmount,
        changeAmount: sale.changeAmount,
        total: sale.total,
        items: sale.items,
        status: sale.status,
        ...(sale.errorMessage ? { errorMessage: sale.errorMessage } : {}),
    }
}

export type LateSaleRegisterLookup = (sale: QueuedSale) => Promise<LateSaleRegisterStatus>
export type LateSaleReceiptRpc = (payload: LateOfflineSalePayload) => Promise<{
    data: unknown
    error: AdminCashRegisterRpcError | null
}>

export async function getLateSaleRegisterStatus(sale: QueuedSale): Promise<LateSaleRegisterStatus> {
    let result
    try {
        result = await getSupabaseClient()
            .from('cash_registers')
            .select('id, bakery_id, opened_by, status')
            .eq('id', sale.cashRegisterId)
            .eq('bakery_id', sale.bakeryId)
            .maybeSingle()
    } catch (error) {
        if (isNetworkError(error)) reportNetworkFailure()
        throw new OfflineSaleReconciliationPendingError(
            'Não foi possível confirmar o estado do caixa no servidor. A venda permanece na fila local.',
            error,
        )
    }

    if (result.error) {
        if (isNetworkError(result.error)) reportNetworkFailure()
        throw new OfflineSaleReconciliationPendingError(
            'Não foi possível confirmar o estado do caixa no servidor. A venda permanece na fila local.',
            result.error,
        )
    }

    const row = result.data as {
        id?: unknown
        bakery_id?: unknown
        opened_by?: unknown
        status?: unknown
    } | null
    if (!row
        || row.id !== sale.cashRegisterId
        || row.bakery_id !== sale.bakeryId
        || row.opened_by !== sale.operatorUserId
        || (row.status !== 'open' && row.status !== 'closed')) {
        return 'unknown'
    }
    reportNetworkSuccess()
    return row.status
}

export async function receiveLateOfflineSale(
    sale: QueuedSale,
    options: {
        lookup?: LateSaleRegisterLookup
        invoke?: LateSaleReceiptRpc
    } = {},
): Promise<string> {
    const lookup = options.lookup ?? getLateSaleRegisterStatus
    const registerStatus = await lookup(sale)
    if (registerStatus !== 'closed') {
        throw new OfflineSaleReconciliationPendingError(
            registerStatus === 'open'
                ? 'O servidor ainda informa o caixa como aberto. A venda permanece na fila para sincronização normal.'
                : 'Não foi possível confirmar que o caixa pertence ao operador e está fechado. A venda permanece na fila local.',
        )
    }

    const payload = createLateOfflineSalePayload(sale)
    const invoke = options.invoke ?? (async (salePayload) =>
        await getSupabaseClient().rpc('receive_late_offline_sale', {
            p_sale_payload: salePayload,
        }))

    let response: { data: unknown; error: AdminCashRegisterRpcError | null }
    try {
        response = await invoke(payload)
    } catch (error) {
        if (isNetworkError(error)) {
            reportNetworkFailure()
            throw error
        }
        throw getLateSaleReceiptError(error)
    }

    if (response.error) {
        if (isNetworkError(response.error)) {
            reportNetworkFailure()
            throw response.error
        }
        throw getLateSaleReceiptError(response.error)
    }
    if (typeof response.data !== 'string' || !UUID_PATTERN.test(response.data)) {
        throw new OfflineSaleReconciliationPendingError(
            'O servidor não confirmou o recebimento em quarentena. A venda permanece na fila para nova tentativa com a mesma chave.',
        )
    }
    reportNetworkSuccess()
    return response.data
}

function getLateSaleReceiptError(error: unknown): Error {
    const candidate = typeof error === 'object' && error !== null
        ? error as { code?: unknown; message?: unknown }
        : null
    const code = typeof candidate?.code === 'string' ? candidate.code : ''
    const message = typeof candidate?.message === 'string' ? candidate.message : ''
    if (code === '42501') {
        return new LateOfflineSaleRejectedError('A venda não corresponde ao operador, à padaria ou ao caixa. Foi preservada para análise.', error)
    }
    if (code === '23514' && /only accepted for administratively closed/i.test(message)) {
        return new LateOfflineSaleRejectedError('O servidor confirmou um fechamento sem encerramento administrativo. A venda foi preservada para análise.', error)
    }
    return new LateOfflineSaleRejectedError(
        'O servidor rejeitou a venda tardia. Ela permanece preservada na fila para análise; nenhuma venda financeira foi criada por este fluxo.',
        error,
    )
}
