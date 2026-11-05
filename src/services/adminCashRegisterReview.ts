import { getSupabaseClient } from '../lib/supabaseClient.ts'
import { isAdminCashRegisterClosureEnabled } from './adminCashRegisterClosure.ts'

export interface AdminCashRegisterReviewItem {
    productId: string
    name: string
    barcode: string
    price: number
    quantity: number
    currentPrice: number | null
}

export interface PendingLateOfflineSale {
    adminEventId: string
    cashRegisterId: string
    bakeryId: string
    operatorUserId: string
    operatorName: string
    serverReceivedAt: string
    claimedOccurredAt: string
    idempotencyKey: string
    offlineSessionId: string | null
    paymentMethod: 'cash' | 'pix' | 'card'
    receivedAmount: number | null
    changeAmount: number | null
    total: number
    items: AdminCashRegisterReviewItem[]
}

export interface AdminReconciliationSnapshot {
    id: string
    reconciledAt: string
    reconciledBy: string
    countedAmount: number
    expectedAmount: number
    differenceAmount: number
    reason: string
    lateSalesReceivedAfterReconciliation: boolean
}

export interface AdminClosedCashRegister {
    cashRegisterId: string
    bakeryId: string
    bakeryName: string
    operatorUserId: string
    operatorName: string
    openedAt: string
    initialAmount: number
    closedAt: string
    administratorUserId: string
    administratorName: string
    closeReason: string
    pendingSaleCount: number
    postReconciliationSaleCount: number
    postReconciliationPendingSaleCount: number
    reconciliation: AdminReconciliationSnapshot | null
}

export interface AdminCashRegisterReconciliationPreview {
    initialAmount: number
    recognizedCashSales: number
    expectedAmount: number
}

export interface AdminCashRegisterReviewDetails {
    adminEventId: string
    reviewStatus: string
    payload: Record<string, unknown>
    operatorName: string
    serverReceivedAt: string
    claimedOccurredAt: string
    idempotencyKey: string
    offlineSessionId: string | null
}

export function partitionAdminClosedCashRegisters(registers: readonly AdminClosedCashRegister[]): {
    awaitingReconciliation: AdminClosedCashRegister[]
    reconciled: AdminClosedCashRegister[]
    receivedSalesAfterReconciliation: AdminClosedCashRegister[]
    requiringPostReconciliationReview: AdminClosedCashRegister[]
    reconciledWithoutPendingPostSales: AdminClosedCashRegister[]
} {
    const awaitingReconciliation = registers.filter((register) => register.reconciliation === null)
    const reconciled = registers.filter((register) => register.reconciliation !== null)
    const requiringPostReconciliationReview = reconciled.filter((register) =>
        register.postReconciliationPendingSaleCount > 0)
    return {
        awaitingReconciliation,
        reconciled,
        receivedSalesAfterReconciliation: reconciled.filter((register) =>
            register.reconciliation?.lateSalesReceivedAfterReconciliation === true),
        requiringPostReconciliationReview,
        reconciledWithoutPendingPostSales: reconciled.filter((register) =>
            register.postReconciliationPendingSaleCount === 0),
    }
}

interface RpcResult {
    data: unknown
    error: { code?: string; message?: string } | null
}

type RpcInvoker = (name: string, args: Record<string, unknown>) => Promise<RpcResult>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`O servidor retornou ${field} inválido.`)
    }
    return value
}

function getTimestamp(value: unknown, field: string): string {
    const timestamp = getString(value, field)
    if (!Number.isFinite(Date.parse(timestamp))) {
        throw new Error(`O servidor retornou ${field} inválido.`)
    }
    return timestamp
}

function getAmount(value: unknown, field: string, allowNull = false): number | null {
    if (allowNull && value === null) return null
    const amount = typeof value === 'number' || typeof value === 'string'
        ? Number(value)
        : Number.NaN
    if (!Number.isFinite(amount)) {
        throw new Error(`O servidor retornou ${field} inválido.`)
    }
    return amount
}

function getArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error(`O servidor retornou uma lista inválida de ${field}.`)
    }
    return value
}

function getRpcInvoker(): RpcInvoker {
    return async (name, args) => await getSupabaseClient().rpc(name, args)
}

function assertEnabled(enabled = isAdminCashRegisterClosureEnabled()): void {
    if (!enabled) {
        throw new Error('A revisão e conferência administrativa estão desabilitadas neste ambiente.')
    }
}

function assertOwner(isOwner: boolean): void {
    if (!isOwner) {
        throw new Error('Somente um owner autorizado pode revisar vendas tardias ou conferir este caixa.')
    }
}

async function invokeRpc(
    name: string,
    args: Record<string, unknown>,
    invoke: RpcInvoker,
): Promise<unknown> {
    let response: RpcResult
    try {
        response = await invoke(name, args)
    } catch (error) {
        throw formatAdminCashRegisterReviewError(error)
    }
    if (response.error) {
        throw formatAdminCashRegisterReviewError(response.error)
    }
    return response.data
}

export function formatAdminCashRegisterReviewError(error: unknown): Error {
    const candidate = isRecord(error) ? error : null
    const code = typeof candidate?.code === 'string' ? candidate.code : ''
    const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : ''

    if (code === '42501') {
        return new Error('Seu usuário não tem autorização para acessar este caixa ou esta padaria.')
    }
    if (code === '23505') {
        return new Error('Esta operação já foi concluída ou conflita com uma decisão registrada. Atualize os dados.')
    }
    if (code === '23514' && /pending|review|unresolved/.test(message)) {
        return new Error('Há vendas tardias aguardando análise. Revise-as antes de concluir a conferência.')
    }
    if (code === '23514' && /stock|insufficient/.test(message)) {
        return new Error('Estoque insuficiente ou não inicializado. A venda continua pendente e nenhuma alteração financeira parcial foi gravada.')
    }
    if (code === '23514') {
        return new Error('O estado do caixa mudou ou não atende às condições desta operação. Atualize os dados.')
    }
    if (code === '22023' && /price|historical/.test(message)) {
        return new Error('Os valores históricos ou a divergência de preço exigem reconhecimento explícito antes da aprovação.')
    }
    if (error instanceof TypeError || /network|fetch|connection|timeout/i.test(message)) {
        return new Error('Falha de conexão. O resultado pode ser desconhecido; atualize os dados antes de repetir.')
    }
    return new Error('Não foi possível concluir a operação administrativa. Atualize os dados e tente novamente.')
}

function parsePendingSale(value: unknown): PendingLateOfflineSale {
    if (!isRecord(value) || !isRecord(value.payload)) {
        throw new Error('O servidor retornou uma venda tardia inválida.')
    }

    const payload = value.payload
    const paymentMethod = payload.paymentMethod
    if (paymentMethod !== 'cash' && paymentMethod !== 'pix' && paymentMethod !== 'card') {
        throw new Error('A venda tardia contém uma forma de pagamento inválida.')
    }

    const items = getArray(payload.items, 'itens da venda').map((item) => {
        if (!isRecord(item)) throw new Error('O servidor retornou um item inválido.')
        return {
            productId: getString(item.productId, 'identificador do produto'),
            name: getString(item.name, 'nome do produto'),
            barcode: typeof item.barcode === 'string' ? item.barcode : '',
            price: getAmount(item.price, 'preço histórico')!,
            quantity: getAmount(item.quantity, 'quantidade')!,
            currentPrice: null,
        }
    })

    return {
        adminEventId: getString(value.admin_event_id, 'identificador da venda'),
        cashRegisterId: getString(value.cash_register_id, 'identificador do caixa'),
        bakeryId: getString(value.bakery_id, 'identificador da padaria'),
        operatorUserId: getString(value.operator_user_id, 'identificador do operador'),
        operatorName: typeof value.operator_name === 'string' ? value.operator_name : 'Não identificado',
        serverReceivedAt: getTimestamp(value.server_received_at, 'horário de recebimento'),
        claimedOccurredAt: getTimestamp(value.claimed_occurred_at, 'horário informado pelo dispositivo'),
        idempotencyKey: getString(value.idempotency_key, 'chave de idempotência'),
        offlineSessionId: typeof value.offline_session_id === 'string' ? value.offline_session_id : null,
        paymentMethod,
        receivedAmount: getAmount(payload.receivedAmount, 'valor recebido', true),
        changeAmount: getAmount(payload.changeAmount, 'troco', true),
        total: getAmount(payload.total, 'total histórico')!,
        items,
    }
}

async function lookupCurrentProductPrices(
    bakeryId: string,
    items: readonly AdminCashRegisterReviewItem[],
): Promise<AdminCashRegisterReviewItem[]> {
    const productIds = [...new Set(items.map((item) => item.productId))]
    if (productIds.length === 0) return [...items]

    const { data, error } = await getSupabaseClient()
        .from('products')
        .select('id, price')
        .eq('bakery_id', bakeryId)
        .in('id', productIds)

    if (error) {
        console.error('Não foi possível comparar preços atuais com o snapshot da venda tardia.', error)
        throw new Error('Não foi possível verificar divergência de preços. Tente novamente antes de aprovar.')
    }

    const prices = new Map<string, number>()
    for (const row of getArray(data, 'preços atuais')) {
        if (!isRecord(row) || typeof row.id !== 'string') continue
        const price = getAmount(row.price, 'preço atual')
        if (price !== null) prices.set(row.id, price)
    }

    return items.map((item) => ({
        ...item,
        currentPrice: prices.get(item.productId) ?? null,
    }))
}

export async function listAdminClosedCashRegisters(options: {
    isOwner: boolean
}): Promise<AdminClosedCashRegister[]> {
    assertOwner(options.isOwner)

    const client = getSupabaseClient()
    const { data: closeRows, error: closeError } = await client
        .from('cash_register_admin_events')
        .select('id, cash_register_id, bakery_id, operator_user_id, actor_user_id, server_recorded_at, reason, review_status')
        .eq('event_type', 'administrative_close')
        .order('server_recorded_at', { ascending: false })
    if (closeError) {
        console.error('Não foi possível carregar os encerramentos administrativos.', closeError)
        throw new Error('Não foi possível carregar os caixas encerrados administrativamente.')
    }

    const closures = getArray(closeRows, 'encerramentos administrativos')
    if (closures.length === 0) return []

    const ids = closures.flatMap((row) => isRecord(row) && typeof row.cash_register_id === 'string'
        ? [row.cash_register_id]
        : [])
    const bakeryIds = [...new Set(closures.flatMap((row) => isRecord(row) && typeof row.bakery_id === 'string'
        ? [row.bakery_id]
        : []))]
    const userIds = [...new Set(closures.flatMap((row) => isRecord(row)
        ? [row.operator_user_id, row.actor_user_id]
            .filter((id): id is string => typeof id === 'string')
        : []))]

    const [
        { data: registers, error: registerError },
        { data: bakeries, error: bakeryError },
        { data: users, error: userError },
        { data: reconciliations, error: reconciliationError },
        { data: lateSales, error: lateSalesError },
    ] = await Promise.all([
        client.from('cash_registers')
            .select('id, bakery_id, opened_by, opened_at, initial_amount, status')
            .in('id', ids),
        client.from('bakeries').select('id, name').in('id', bakeryIds),
        client.from('users').select('id, name').in('id', userIds),
        client.from('cash_register_admin_reconciliations')
            .select('id, cash_register_id, bakery_id, reconciled_by, reconciled_at, counted_amount, expected_amount, difference_amount, reason, late_sales_received_after_reconciliation')
            .in('cash_register_id', ids),
        client.from('cash_register_admin_events')
            .select('cash_register_id, bakery_id, review_status, server_recorded_at')
            .eq('event_type', 'late_sale')
            .in('cash_register_id', ids),
    ])

    const failedRead = registerError ?? bakeryError ?? userError ?? reconciliationError ?? lateSalesError
    if (failedRead) {
        console.error('Não foi possível carregar os detalhes financeiros dos caixas administrativos.', failedRead)
        throw new Error('Não foi possível carregar os detalhes financeiros dos caixas administrativos.')
    }

    const registerById = new Map(getArray(registers, 'caixas').filter(isRecord)
        .map((row) => [String(row.id), row]))
    const bakeryById = new Map(getArray(bakeries, 'padarias').filter(isRecord)
        .map((row) => [String(row.id), row]))
    const userById = new Map(getArray(users, 'usuários').filter(isRecord)
        .map((row) => [String(row.id), row]))
    const reconciliationByRegister = new Map(getArray(reconciliations, 'conferências').filter(isRecord)
        .map((row) => [String(row.cash_register_id), row]))
    const lateRows = getArray(lateSales, 'vendas tardias').filter(isRecord)

    return closures.map((value) => {
        if (!isRecord(value)) throw new Error('O servidor retornou um encerramento administrativo inválido.')
        const registerId = getString(value.cash_register_id, 'identificador do caixa')
        const bakeryId = getString(value.bakery_id, 'identificador da padaria')
        const operatorId = getString(value.operator_user_id, 'identificador do operador')
        const administratorId = getString(value.actor_user_id, 'identificador do administrador')
        const register = registerById.get(registerId)
        const bakery = bakeryById.get(bakeryId)
        const operator = userById.get(operatorId)
        const administrator = userById.get(administratorId)
        if (!register || !bakery || !operator || !administrator) {
            throw new Error('O servidor retornou dados incompletos para um caixa encerrado administrativamente.')
        }

        const reconciliationRow = reconciliationByRegister.get(registerId)
        const reconciliation = reconciliationRow
            ? {
                id: getString(reconciliationRow.id, 'identificador da conferência'),
                reconciledAt: getTimestamp(reconciliationRow.reconciled_at, 'horário da conferência'),
                reconciledBy: getString(reconciliationRow.reconciled_by, 'responsável pela conferência'),
                countedAmount: getAmount(reconciliationRow.counted_amount, 'valor contado')!,
                expectedAmount: getAmount(reconciliationRow.expected_amount, 'valor esperado')!,
                differenceAmount: getAmount(reconciliationRow.difference_amount, 'diferença financeira')!,
                reason: getString(reconciliationRow.reason, 'justificativa da conferência'),
                lateSalesReceivedAfterReconciliation:
                    reconciliationRow.late_sales_received_after_reconciliation === true,
            }
            : null

        const registerLateSales = lateRows.filter((lateSale) =>
            lateSale.cash_register_id === registerId && lateSale.bakery_id === bakeryId)
        const pendingSaleCount = registerLateSales.filter((lateSale) =>
            lateSale.review_status === 'pending_review').length
        const postReconciliationSaleCount = reconciliation
            ? registerLateSales.filter((lateSale) =>
                typeof lateSale.server_recorded_at === 'string'
                && Date.parse(lateSale.server_recorded_at) > Date.parse(reconciliation.reconciledAt)).length
            : 0
        const postReconciliationPendingSaleCount = reconciliation
            ? registerLateSales.filter((lateSale) =>
                lateSale.review_status === 'pending_review'
                && typeof lateSale.server_recorded_at === 'string'
                && Date.parse(lateSale.server_recorded_at) > Date.parse(reconciliation.reconciledAt)).length
            : 0

        return {
            cashRegisterId: registerId,
            bakeryId,
            bakeryName: getString(bakery.name, 'nome da padaria'),
            operatorUserId: operatorId,
            operatorName: getString(operator.name, 'nome do operador'),
            openedAt: getTimestamp(register.opened_at, 'horário de abertura'),
            initialAmount: getAmount(register.initial_amount, 'valor inicial')!,
            closedAt: getTimestamp(value.server_recorded_at, 'horário do encerramento'),
            administratorUserId: administratorId,
            administratorName: getString(administrator.name, 'nome do administrador'),
            closeReason: getString(value.reason, 'motivo do encerramento'),
            pendingSaleCount,
            postReconciliationSaleCount,
            postReconciliationPendingSaleCount,
            reconciliation,
        }
    })
}

export async function listPendingLateOfflineSales(
    cashRegisterId: string,
    options: { isOwner: boolean; enabled?: boolean; invoke?: RpcInvoker },
): Promise<PendingLateOfflineSale[]> {
    assertEnabled(options.enabled)
    assertOwner(options.isOwner)
    const data = await invokeRpc(
        'list_pending_late_offline_sales',
        { p_cash_register_id: cashRegisterId },
        options.invoke ?? getRpcInvoker(),
    )
    return getArray(data, 'vendas tardias pendentes').map(parsePendingSale)
}

export async function getLateOfflineSaleReviewDetails(
    adminEventId: string,
    options: { isOwner: boolean; enabled?: boolean; invoke?: RpcInvoker },
): Promise<AdminCashRegisterReviewDetails> {
    assertEnabled(options.enabled)
    assertOwner(options.isOwner)
    const data = await invokeRpc(
        'get_late_offline_sale_review_details',
        { p_admin_event_id: adminEventId },
        options.invoke ?? getRpcInvoker(),
    )
    const row = getArray(data, 'detalhes da venda tardia')[0]
    if (!isRecord(row) || !isRecord(row.payload)) {
        throw new Error('O servidor não retornou os detalhes da venda tardia.')
    }
    return {
        adminEventId: getString(row.admin_event_id, 'identificador da venda'),
        reviewStatus: getString(row.review_status, 'estado da revisão'),
        payload: row.payload,
        operatorName: typeof row.operator_name === 'string' ? row.operator_name : 'Não identificado',
        serverReceivedAt: getTimestamp(row.server_received_at, 'horário de recebimento'),
        claimedOccurredAt: getTimestamp(row.claimed_occurred_at, 'horário informado pelo dispositivo'),
        idempotencyKey: getString(row.idempotency_key, 'chave de idempotência'),
        offlineSessionId: typeof row.offline_session_id === 'string' ? row.offline_session_id : null,
    }
}

export async function getPendingLateOfflineSaleDetails(
    sale: PendingLateOfflineSale,
    options: { isOwner: boolean; enabled?: boolean },
): Promise<PendingLateOfflineSale> {
    const details = await getLateOfflineSaleReviewDetails(sale.adminEventId, options)
    const items = parsePendingSale({
        admin_event_id: details.adminEventId,
        cash_register_id: sale.cashRegisterId,
        bakery_id: sale.bakeryId,
        operator_user_id: sale.operatorUserId,
        operator_name: details.operatorName,
        server_received_at: details.serverReceivedAt,
        claimed_occurred_at: details.claimedOccurredAt,
        idempotency_key: details.idempotencyKey,
        offline_session_id: details.offlineSessionId,
        payload: details.payload,
    })
    return {
        ...items,
        items: await lookupCurrentProductPrices(sale.bakeryId, items.items),
    }
}

export async function reviewLateOfflineSale(input: {
    adminEventId: string
    decision: 'approved' | 'rejected'
    reason: string
    acceptUnverifiedHistoricalValues: boolean
    acceptPriceDivergence: boolean
}, options: { isOwner: boolean; enabled?: boolean; invoke?: RpcInvoker }): Promise<string> {
    assertEnabled(options.enabled)
    assertOwner(options.isOwner)
    if (!input.reason.trim() || input.reason.trim().length > 1000) {
        throw new Error('Informe uma justificativa de até 1000 caracteres para a decisão.')
    }
    if (input.decision === 'approved' && !input.acceptUnverifiedHistoricalValues) {
        throw new Error('Reconheça explicitamente que os valores históricos não foram comprovados pelo servidor.')
    }

    const data = await invokeRpc(
        'review_late_offline_sale',
        {
            p_admin_event_id: input.adminEventId,
            p_decision: input.decision,
            p_reason: input.reason.trim(),
            p_accept_unverified_historical_values: input.acceptUnverifiedHistoricalValues,
            p_accept_price_divergence: input.acceptPriceDivergence,
        },
        options.invoke ?? getRpcInvoker(),
    )
    if (typeof data !== 'string' || !UUID_PATTERN.test(data)) {
        throw new Error('O servidor não confirmou a decisão sobre a venda tardia.')
    }
    return data
}

export async function getAdminCashRegisterReconciliationPreview(
    register: Pick<AdminClosedCashRegister, 'cashRegisterId'>,
    options: { isOwner: boolean; enabled?: boolean },
): Promise<AdminCashRegisterReconciliationPreview> {
    assertEnabled(options.enabled)
    assertOwner(options.isOwner)
    const client = getSupabaseClient()
    const [{ data: registerRow, error: registerError }, { data: sales, error: salesError }] = await Promise.all([
        client.from('cash_registers')
            .select('id, initial_amount, status')
            .eq('id', register.cashRegisterId)
            .maybeSingle(),
        client.from('sales')
            .select('total, payment_method')
            .eq('cash_register_id', register.cashRegisterId),
    ])
    if (registerError || salesError) {
        const error = registerError ?? salesError
        console.error('Não foi possível carregar a prévia da conferência administrativa.', error)
        throw new Error('Não foi possível consultar os valores reconhecidos pelo servidor.')
    }
    if (!isRecord(registerRow) || registerRow.status !== 'closed') {
        throw new Error('O caixa não está mais encerrado. Atualize os dados.')
    }

    const initialAmount = getAmount(registerRow.initial_amount, 'valor inicial')!
    const recognizedCashSales = getArray(sales, 'vendas financeiras')
        .filter((sale) => isRecord(sale) && sale.payment_method === 'cash')
        .reduce<number>((sum, sale) => {
            const amount = getAmount(isRecord(sale) ? sale.total : null, 'venda reconhecida')!
            return sum + amount
        }, 0)
    return {
        initialAmount,
        recognizedCashSales,
        expectedAmount: initialAmount + recognizedCashSales,
    }
}

export async function reconcileAdministrativelyClosedCashRegister(input: {
    cashRegisterId: string
    countedAmount: number
    reason: string
    acknowledgeUnverifiedOfflineCompleteness: boolean
}, options: { isOwner: boolean; enabled?: boolean; invoke?: RpcInvoker }): Promise<string> {
    assertEnabled(options.enabled)
    assertOwner(options.isOwner)
    if (!Number.isFinite(input.countedAmount)
        || input.countedAmount < 0
        || input.countedAmount > 9999999999.99
        || Math.round(input.countedAmount * 100) !== input.countedAmount * 100) {
        throw new Error('Informe um valor contado válido, não negativo e com até duas casas decimais.')
    }
    if (!input.reason.trim() || input.reason.trim().length > 1000) {
        throw new Error('Informe uma justificativa de até 1000 caracteres para a conferência.')
    }
    if (!input.acknowledgeUnverifiedOfflineCompleteness) {
        throw new Error('Reconheça explicitamente que o servidor não pode comprovar a sincronização de todos os dispositivos.')
    }

    const data = await invokeRpc(
        'reconcile_administratively_closed_cash_register',
        {
            p_cash_register_id: input.cashRegisterId,
            p_counted_amount: input.countedAmount,
            p_reason: input.reason.trim(),
            p_acknowledge_unverified_offline_completeness:
                input.acknowledgeUnverifiedOfflineCompleteness,
        },
        options.invoke ?? getRpcInvoker(),
    )
    if (typeof data !== 'string' || !UUID_PATTERN.test(data)) {
        throw new Error('O servidor não confirmou a conferência financeira.')
    }
    return data
}
