import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'
import { startPdvHeartbeatPolling } from '../services/pdvHeartbeatPolling'

export interface PdvHeartbeat {
    userId: string
    bakeryId: string
    status: 'online' | 'syncing'
    pendingSales: number
    lastSeenAt: string
}

export interface PdvOpenCashRegister {
    id: string
    bakeryId: string
    operatorUserId: string
    openedAt: string
}

export interface PdvCashRegisterSessionEnding {
    cashRegisterId: string
    bakeryId: string
    operatorUserId: string
}

/**
 * Polls the shared heartbeat table. An old heartbeat indicates no recent
 * communication, not proof that the operator's internet connection is down.
 */
export const PDV_OFFLINE_THRESHOLD_MS = 75_000

export function usePdvHeartbeats(enabled: boolean, includeOpenCashRegisters = false) {
    const [heartbeats, setHeartbeats] = useState<PdvHeartbeat[]>([])
    const [openCashRegisters, setOpenCashRegisters] = useState<PdvOpenCashRegister[]>([])
    const [endedCashRegisterSessions, setEndedCashRegisterSessions] = useState<PdvCashRegisterSessionEnding[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')
    const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
    const isRequestInProgress = useRef(false)
    const refreshRequested = useRef(false)
    const isMounted = useRef(false)
    const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve())
    const requestIdRef = useRef(0)

    const refresh = useCallback(async () => {
        if (!enabled) {
            return
        }
        if (isRequestInProgress.current) {
            refreshRequested.current = true
            return
        }
        isRequestInProgress.current = true
        setIsLoading(true)
        const requestId = ++requestIdRef.current
        const startedAt = Date.now()
        if (import.meta.env.DEV) {
            console.debug('[PDV offline monitor] polling_started', {
                requestId,
                startedAt: new Date(startedAt).toISOString(),
            })
        }
        try {
            const client = getSupabaseClient()
            const heartbeatRequest = client
                .from('pdv_heartbeats')
                .select('user_id, bakery_id, status, pending_sales, last_seen_at')
            const openRegistersRequest = includeOpenCashRegisters
                ? client
                    .from('cash_registers')
                    .select('id, bakery_id, opened_by, opened_at')
                    .eq('status', 'open')
                : Promise.resolve(null)
            const endedSessionsRequest = includeOpenCashRegisters
                ? client
                    .from('pdv_cash_register_session_endings')
                    .select('cash_register_id, bakery_id, operator_user_id')
                : Promise.resolve(null)
            const [heartbeatResult, openRegistersResult, endedSessionsResult] = await Promise.all([
                heartbeatRequest,
                openRegistersRequest,
                endedSessionsRequest,
            ])
            if (heartbeatResult.error) {
                throw heartbeatResult.error
            }
            if (openRegistersResult?.error) throw openRegistersResult.error
            if (endedSessionsResult?.error) throw endedSessionsResult.error

            const nextHeartbeats = (heartbeatResult.data ?? []).map((row: Record<string, unknown>) => {
                if (typeof row.user_id !== 'string'
                    || typeof row.bakery_id !== 'string'
                    || typeof row.last_seen_at !== 'string') {
                    throw new Error('O Supabase retornou um heartbeat com campos inválidos.')
                }
                return {
                    userId: row.user_id,
                    bakeryId: row.bakery_id,
                    status: row.status === 'syncing' ? 'syncing' as const : 'online' as const,
                    pendingSales: Number(row.pending_sales ?? 0),
                    lastSeenAt: row.last_seen_at,
                }
            })
            const nextOpenCashRegisters = (openRegistersResult?.data ?? []).map((row: Record<string, unknown>) => {
                if (typeof row.id !== 'string'
                    || typeof row.bakery_id !== 'string'
                    || typeof row.opened_by !== 'string'
                    || typeof row.opened_at !== 'string') {
                    throw new Error('O Supabase retornou um caixa aberto com campos inválidos.')
                }
                return {
                    id: row.id,
                    bakeryId: row.bakery_id,
                    operatorUserId: row.opened_by,
                    openedAt: row.opened_at,
                }
            })
            const nextEndedCashRegisterSessions = (endedSessionsResult?.data ?? []).map(
                (row: Record<string, unknown>) => {
                    if (typeof row.cash_register_id !== 'string'
                        || typeof row.bakery_id !== 'string'
                        || typeof row.operator_user_id !== 'string') {
                        throw new Error('O Supabase retornou um encerramento de sessão de caixa inválido.')
                    }
                    return {
                        cashRegisterId: row.cash_register_id,
                        bakeryId: row.bakery_id,
                        operatorUserId: row.operator_user_id,
                    }
                },
            )

            if (isMounted.current) {
                setHeartbeats(nextHeartbeats)
                setOpenCashRegisters(nextOpenCashRegisters)
                setEndedCashRegisterSessions(nextEndedCashRegisterSessions)
                setError('')
                setLastUpdatedAt(Date.now())
            }
            if (import.meta.env.DEV) {
                const receivedAt = Date.now()
                console.debug('[PDV offline monitor] polling_succeeded', {
                    requestId,
                    receivedAt: new Date(receivedAt).toISOString(),
                    durationMs: receivedAt - startedAt,
                    heartbeatCount: nextHeartbeats.length,
                    openRegisterCount: nextOpenCashRegisters.length,
                    endedSessionCount: nextEndedCashRegisterSessions.length,
                })
                for (const heartbeat of nextHeartbeats) {
                    console.debug('[PDV offline monitor] heartbeat_received', {
                        requestId,
                        operator: heartbeat.userId.slice(0, 8),
                        bakery: heartbeat.bakeryId.slice(0, 8),
                        lastSeenAt: heartbeat.lastSeenAt,
                        receivedAt: new Date(receivedAt).toISOString(),
                        apparentClockOffsetMs: receivedAt - Date.parse(heartbeat.lastSeenAt),
                    })
                }
            }
        } catch (err) {
            console.warn('Não foi possível carregar os heartbeats dos PDVs.', err)
            if (isMounted.current) {
                setError(err instanceof Error
                    ? err.message
                    : 'Não foi possível consultar os heartbeats no Supabase.')
            }
            if (import.meta.env.DEV) {
                const failedAt = Date.now()
                console.debug('[PDV offline monitor] polling_failed', {
                    requestId,
                    failedAt: new Date(failedAt).toISOString(),
                    durationMs: failedAt - startedAt,
                    errorType: err instanceof Error ? err.name : typeof err,
                })
            }
        } finally {
            isRequestInProgress.current = false
            if (isMounted.current) setIsLoading(false)
            if (refreshRequested.current && enabled && isMounted.current) {
                refreshRequested.current = false
                window.setTimeout(() => {
                    void refreshRef.current()
                }, 0)
            }
        }
    }, [enabled, includeOpenCashRegisters])
    useEffect(() => {
        refreshRef.current = refresh
    }, [refresh])

    useEffect(() => {
        if (!enabled) {
            return
        }
        isMounted.current = true
        const initialRefreshId = window.setTimeout(() => {
            void refresh()
        }, 0)
        const stopPolling = startPdvHeartbeatPolling(() => {
            void refreshRef.current()
        })
        return () => {
            isMounted.current = false
            window.clearTimeout(initialRefreshId)
            stopPolling()
        }
    }, [enabled, refresh])

    return {
        heartbeats,
        openCashRegisters,
        endedCashRegisterSessions,
        isLoading,
        error,
        lastUpdatedAt,
    }
}
