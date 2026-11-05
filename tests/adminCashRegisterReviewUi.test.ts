import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
    formatAdminCashRegisterReviewError,
    listPendingLateOfflineSales,
    partitionAdminClosedCashRegisters,
    reconcileAdministrativelyClosedCashRegister,
    reviewLateOfflineSale,
    type AdminClosedCashRegister,
} from '../src/services/adminCashRegisterReview.ts'
import { mergeCashClosureHistory } from '../src/data/cashClosures.ts'

const migration = readFileSync(
    new URL('../supabase/migrations/20261103201700_add_late_sale_review_and_admin_reconciliation.sql', import.meta.url),
    'utf8',
)
const page = readFileSync(new URL('../src/pages/CaixasPendentes/CaixasPendentes.tsx', import.meta.url), 'utf8')
const service = readFileSync(new URL('../src/services/adminCashRegisterReview.ts', import.meta.url), 'utf8')
const activationService = readFileSync(
    new URL('../src/services/adminCashRegisterClosure.ts', import.meta.url),
    'utf8',
)

const REGISTER_ID = '40000000-0000-4000-8000-000000000001'
const EVENT_ID = '70000000-0000-4000-8000-000000000001'

function createRegister(overrides: Partial<AdminClosedCashRegister> = {}): AdminClosedCashRegister {
    return {
        cashRegisterId: REGISTER_ID,
        bakeryId: '10000000-0000-4000-8000-000000000001',
        bakeryName: 'Padaria Central',
        operatorUserId: '20000000-0000-4000-8000-000000000001',
        operatorName: 'Operador',
        openedAt: '2026-11-03T08:00:00.000Z',
        initialAmount: 50,
        closedAt: '2026-11-03T18:00:00.000Z',
        administratorUserId: '20000000-0000-4000-8000-000000000002',
        administratorName: 'Owner',
        closeReason: 'Operador inacessível',
        pendingSaleCount: 0,
        postReconciliationSaleCount: 0,
        postReconciliationPendingSaleCount: 0,
        reconciliation: null,
        ...overrides,
    }
}

test('separa caixas abertos fora de prazo, encerrados pendentes e com conferência', () => {
    const pending = createRegister()
    const reconciled = createRegister({
        cashRegisterId: '40000000-0000-4000-8000-000000000002',
        reconciliation: {
            id: '80000000-0000-4000-8000-000000000001',
            reconciledAt: '2026-11-03T19:00:00.000Z',
            reconciledBy: '20000000-0000-4000-8000-000000000002',
            countedAmount: 48,
            expectedAmount: 50,
            differenceAmount: -2,
            reason: 'Conferência excepcional',
            lateSalesReceivedAfterReconciliation: true,
        },
        postReconciliationSaleCount: 1,
        postReconciliationPendingSaleCount: 1,
    })
    const state = partitionAdminClosedCashRegisters([pending, reconciled])

    assert.deepEqual(state.awaitingReconciliation.map((register) => register.cashRegisterId), [REGISTER_ID])
    assert.deepEqual(state.reconciled.map((register) => register.cashRegisterId), [reconciled.cashRegisterId])
    assert.deepEqual(
        state.receivedSalesAfterReconciliation.map((register) => register.cashRegisterId),
        [reconciled.cashRegisterId],
    )
    assert.deepEqual(
        state.requiringPostReconciliationReview.map((register) => register.cashRegisterId),
        [reconciled.cashRegisterId],
    )
    assert.deepEqual(state.reconciledWithoutPendingPostSales, [])
    assert.match(page, /alerts\.map\(\(alert\)/)
    assert.match(page, /Encerrados administrativamente — aguardando conferência/)
    assert.match(page, /Vendas tardias recebidas após a conferência/)
    assert.match(page, /aria-label="Vendas tardias posteriores à conferência aguardando análise"/)
})

test('histórico combina os dois tipos sem duplicar caixas e não inventa valores não conferidos', () => {
    const normalClosure = {
        id: 'normal-closure',
        cashRegisterId: REGISTER_ID,
        bakeryId: '10000000-0000-4000-8000-000000000001',
        closureType: 'normal' as const,
        reconciliationStatus: 'reconciled' as const,
        openedAt: '2026-11-03T08:00:00.000Z',
        initialAmount: 50,
        closedAt: '2026-11-03T17:00:00.000Z',
        countedAmount: 75,
        expectedAmount: 75,
        differenceAmount: 0,
        cashSalesAmount: 25,
    }
    const pendingAdministrative = createRegister()
    const reconciledAdministrative = createRegister({
        cashRegisterId: '40000000-0000-4000-8000-000000000002',
        reconciliation: {
            id: '80000000-0000-4000-8000-000000000001',
            reconciledAt: '2026-11-03T19:00:00.000Z',
            reconciledBy: '20000000-0000-4000-8000-000000000002',
            countedAmount: 48.5,
            expectedAmount: 50,
            differenceAmount: -1.5,
            reason: 'Conferência presencial',
            lateSalesReceivedAfterReconciliation: false,
        },
    })

    const history = mergeCashClosureHistory(
        [normalClosure, { ...normalClosure, id: 'duplicate-normal' }],
        [pendingAdministrative, reconciledAdministrative],
    )

    assert.equal(history.length, 2)
    assert.deepEqual(history.map((closure) => closure.closureType), ['administrative', 'administrative'])
    assert.equal(history[0]?.countedAmount, null)
    assert.equal(history[0]?.differenceAmount, null)
    assert.equal(history[0]?.expectedAmount, null)
    assert.equal(history[0]?.reconciliationStatus, 'pending')
    assert.equal(history[0]?.administrativeCloseReason, 'Operador inacessível')
    assert.equal(history[1]?.countedAmount, 48.5)
    assert.equal(history[1]?.differenceAmount, -1.5)
    assert.equal(history[1]?.reconciliationReason, 'Conferência presencial')

    const mixedHistory = mergeCashClosureHistory([normalClosure], [])
    assert.equal(mixedHistory.length, 1)
    assert.equal(mixedHistory[0]?.closureType, 'normal')
    assert.match(service, /cash_register_admin_reconciliations/)
    assert.match(
        readFileSync(new URL('../src/pages/HistoricoFechamentos/HistoricoFechamentos.tsx', import.meta.url), 'utf8'),
        /Encerramento administrativo[\s\S]*?Fechamento normal/,
    )
})

test('somente owners com o gate ativo conseguem abrir a interface administrativa', async () => {
    let calls = 0
    const invoke = async () => {
        calls++
        return { data: [], error: null }
    }

    await assert.rejects(
        listPendingLateOfflineSales(REGISTER_ID, { isOwner: false, enabled: true, invoke }),
        /Somente um owner autorizado/,
    )
    await assert.rejects(
        listPendingLateOfflineSales(REGISTER_ID, { isOwner: true, enabled: false, invoke }),
        /desabilitadas/,
    )
    assert.equal(calls, 0)
    assert.match(activationService, /return import\.meta\.env\?\.VITE_ENABLE_ADMIN_CASH_REGISTER_CLOSURE === 'true'/)
    assert.doesNotMatch(activationService, /import\.meta\.env\?\.DEV/)
    assert.match(page, /const canReviewAdminClosures = isOwner && isAdminCashRegisterClosureEnabled\(\)/)
})

test('lista vendas tardias pela RPC real e preserva payload e horários distintos', async () => {
    let request: { name: string; args: Record<string, unknown> } | null = null
    const rows = await listPendingLateOfflineSales(REGISTER_ID, {
        isOwner: true,
        enabled: true,
        invoke: async (name, args) => {
            request = { name, args }
            return {
                data: [{
                    admin_event_id: EVENT_ID,
                    cash_register_id: REGISTER_ID,
                    bakery_id: '10000000-0000-4000-8000-000000000001',
                    operator_user_id: '20000000-0000-4000-8000-000000000001',
                    operator_name: 'Operador',
                    server_received_at: '2026-11-03T18:10:00.000Z',
                    claimed_occurred_at: '2026-11-03T17:10:00.000Z',
                    idempotency_key: '50000000-0000-4000-8000-000000000001',
                    offline_session_id: '60000000-0000-4000-8000-000000000001',
                    payload: {
                        total: 15,
                        paymentMethod: 'pix',
                        receivedAmount: null,
                        changeAmount: null,
                        items: [{
                            productId: '30000000-0000-4000-8000-000000000001',
                            name: 'Pão',
                            barcode: '123',
                            price: 15,
                            quantity: 1,
                        }],
                    },
                }],
                error: null,
            }
        },
    })

    assert.deepEqual(request, {
        name: 'list_pending_late_offline_sales',
        args: { p_cash_register_id: REGISTER_ID },
    })
    assert.equal(rows[0]?.claimedOccurredAt, '2026-11-03T17:10:00.000Z')
    assert.equal(rows[0]?.serverReceivedAt, '2026-11-03T18:10:00.000Z')
    assert.equal(rows[0]?.items[0]?.price, 15)
    assert.equal(rows[0]?.idempotencyKey, '50000000-0000-4000-8000-000000000001')
    assert.match(migration, /CREATE FUNCTION public\.list_pending_late_offline_sales/)
    assert.match(migration, /p_cash_register_id uuid/)
})

test('aprovação exige justificativa e reconhecimento histórico; chama a assinatura exata', async () => {
    let call: { name: string; args: Record<string, unknown> } | null = null
    const input = {
        adminEventId: EVENT_ID,
        decision: 'approved' as const,
        reason: 'Preço histórico revisado',
        acceptUnverifiedHistoricalValues: true,
        acceptPriceDivergence: true,
    }
    const result = await reviewLateOfflineSale(input, {
        isOwner: true,
        enabled: true,
        invoke: async (name, args) => {
            call = { name, args }
            return { data: REGISTER_ID, error: null }
        },
    })
    assert.equal(result, REGISTER_ID)
    assert.deepEqual(call, {
        name: 'review_late_offline_sale',
        args: {
            p_admin_event_id: EVENT_ID,
            p_decision: 'approved',
            p_reason: 'Preço histórico revisado',
            p_accept_unverified_historical_values: true,
            p_accept_price_divergence: true,
        },
    })

    await assert.rejects(
        reviewLateOfflineSale({ ...input, reason: ' ' }, {
            isOwner: true,
            enabled: true,
            invoke: async () => ({ data: REGISTER_ID, error: null }),
        }),
        /justificativa/,
    )
    await assert.rejects(
        reviewLateOfflineSale({ ...input, acceptUnverifiedHistoricalValues: false }, {
            isOwner: true,
            enabled: true,
            invoke: async () => ({ data: REGISTER_ID, error: null }),
        }),
        /Reconheça explicitamente/,
    )
    assert.match(migration, /public\.review_late_offline_sale\(\s*p_admin_event_id uuid,\s*p_decision text,\s*p_reason text,\s*p_accept_unverified_historical_values boolean DEFAULT false,\s*p_accept_price_divergence boolean DEFAULT false/s)
})

test('rejeição exige justificativa e não envia aceites financeiros', async () => {
    let args: Record<string, unknown> | null = null
    await reviewLateOfflineSale({
        adminEventId: EVENT_ID,
        decision: 'rejected',
        reason: 'Payload não corroborado',
        acceptUnverifiedHistoricalValues: false,
        acceptPriceDivergence: false,
    }, {
        isOwner: true,
        enabled: true,
        invoke: async (_name, rpcArgs) => {
            args = rpcArgs
            return { data: EVENT_ID, error: null }
        },
    })
    assert.equal(args?.p_decision, 'rejected')
    assert.equal(args?.p_reason, 'Payload não corroborado')
    assert.equal(args?.p_accept_unverified_historical_values, false)
    assert.equal(args?.p_accept_price_divergence, false)
    assert.match(page, /Justificativa obrigatória para rejeição/)
    assert.match(page, /currentPrice !== null && item\.currentPrice !== item\.price/)
    assert.match(service, /Estoque insuficiente ou não inicializado/)
})

test('conferência exige valor, motivo e reconhecimento da ressalva usando RPC real', async () => {
    let call: { name: string; args: Record<string, unknown> } | null = null
    const result = await reconcileAdministrativelyClosedCashRegister({
        cashRegisterId: REGISTER_ID,
        countedAmount: 48.5,
        reason: 'Conferência presencial excepcional',
        acknowledgeUnverifiedOfflineCompleteness: true,
    }, {
        isOwner: true,
        enabled: true,
        invoke: async (name, args) => {
            call = { name, args }
            return { data: EVENT_ID, error: null }
        },
    })

    assert.equal(result, EVENT_ID)
    assert.deepEqual(call, {
        name: 'reconcile_administratively_closed_cash_register',
        args: {
            p_cash_register_id: REGISTER_ID,
            p_counted_amount: 48.5,
            p_reason: 'Conferência presencial excepcional',
            p_acknowledge_unverified_offline_completeness: true,
        },
    })
    await assert.rejects(
        reconcileAdministrativelyClosedCashRegister({
            cashRegisterId: REGISTER_ID,
            countedAmount: 48.5,
            reason: ' ',
            acknowledgeUnverifiedOfflineCompleteness: true,
        }, { isOwner: true, enabled: true, invoke: async () => ({ data: EVENT_ID, error: null }) }),
        /justificativa/,
    )
    await assert.rejects(
        reconcileAdministrativelyClosedCashRegister({
            cashRegisterId: REGISTER_ID,
            countedAmount: 48.5,
            reason: 'Justificativa',
            acknowledgeUnverifiedOfflineCompleteness: false,
        }, { isOwner: true, enabled: true, invoke: async () => ({ data: EVENT_ID, error: null }) }),
        /Reconheça explicitamente/,
    )
    assert.match(migration, /public\.reconcile_administratively_closed_cash_register\(\s*p_cash_register_id uuid,\s*p_counted_amount numeric,\s*p_reason text,\s*p_acknowledge_unverified_offline_completeness boolean/s)
})

test('mostra bloqueio de pendências, problemas de estoque e conflito concorrente sem esconder o erro', () => {
    assert.match(formatAdminCashRegisterReviewError({
        code: '23514',
        message: 'Known late offline sales must be reviewed before reconciliation',
    }).message, /aguardando análise/)
    assert.match(formatAdminCashRegisterReviewError({
        code: '23514',
        message: 'Insufficient stock to approve historical sale',
    }).message, /Estoque insuficiente/)
    assert.match(formatAdminCashRegisterReviewError({
        code: '23505',
        message: 'This late sale already has a conflicting administrative decision',
    }).message, /conflita/)
    assert.match(formatAdminCashRegisterReviewError({
        code: '42501',
        message: 'Only an owner may decide late offline sales',
    }).message, /autorização/)
    assert.match(page, /actionInFlight\.current = true/)
    assert.match(page, /Conhecidas.*aguardando/i)
})

test('preserva snapshot original e sinaliza vendas recebidas depois sem oferecer segunda conferência', () => {
    assert.match(migration, /late_sales_received_after_reconciliation/)
    assert.match(page, /Snapshot da conferência original/)
    assert.match(page, /não foi recalculada/)
    assert.match(page, /!summary && pendingSales\.length === 0 && preview/)
    assert.match(service, /late_sales_received_after_reconciliation === true/)
})
