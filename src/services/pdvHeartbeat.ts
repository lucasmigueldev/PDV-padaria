import { getSupabaseClient } from '../lib/supabaseClient'
import { getConnectionState, reportNetworkSuccess } from './connection'
import { getPendingSyncCount } from './offlineSalesQueue'
import { endPdvCashRegisterSessionOnPageHide, resumePdvCashRegisterSession } from './pdvCashRegisterSession'

const HEARTBEAT_INTERVAL_MS = 30_000

export interface PdvHeartbeatRow {
    userId: string
    bakeryId: string
    status: 'online' | 'syncing'
    pendingSales: number
    lastSeenAt: string
}

/**
 * Updates the shared operator heartbeat and tracks the open register session lifecycle.
 * Returns false while the legacy heartbeat table is unavailable.
 */
export async function touchHeartbeat(
    bakeryId: string,
    onCashRegisterSession?: (cashRegisterId: string | null, accessToken: string | null) => void,
    resumedCashRegisterIds: Set<string> = new Set(),
): Promise<boolean> {
    if (getConnectionState().status === 'offline') {
        if (import.meta.env.DEV) {
            console.debug('[PDV heartbeat] skipped_offline', {
                attemptedAt: new Date().toISOString(),
                bakery: bakeryId.slice(0, 8),
            })
        }
        return true // manter o toque; o próximo online executará um novo
    }
    try {
        const client = getSupabaseClient()
        const { data: sessionData } = await client.auth.getSession()
        const userId = sessionData.session?.user?.id
        if (!userId) {
            onCashRegisterSession?.(null, null)
            if (import.meta.env.DEV) {
                console.debug('[PDV heartbeat] skipped_without_session', {
                    attemptedAt: new Date().toISOString(),
                    bakery: bakeryId.slice(0, 8),
                })
            }
            return true
        }
        const lastSeenAt = new Date().toISOString()
        const pendingSales = getPendingSyncCount()
        let legacyTableMissing = false
        try {
            const { error: legacyHeartbeatError } = await client.from('pdv_heartbeats').upsert(
                {
                    user_id: userId,
                    bakery_id: bakeryId,
                    status: pendingSales > 0 ? 'syncing' : 'online',
                    pending_sales: pendingSales,
                    last_seen_at: lastSeenAt,
                },
                { onConflict: 'user_id' },
            )
            if (legacyHeartbeatError) throw legacyHeartbeatError
            reportNetworkSuccess()
        } catch (legacyHeartbeatError) {
            const errorText = legacyHeartbeatError instanceof Error
                ? legacyHeartbeatError.message
                : JSON.stringify(legacyHeartbeatError)
            legacyTableMissing = /pdv_heartbeats/i.test(errorText)
                && /does not exist|schema cache/i.test(errorText)
            if (!legacyTableMissing) {
                console.warn('Heartbeat legado do PDV não foi atualizado.', legacyHeartbeatError)
            }
        }

        try {
            const { data: cashRegister, error: cashRegisterError } = await client
                .from('cash_registers')
                .select('id')
                .eq('bakery_id', bakeryId)
                .eq('opened_by', userId)
                .eq('status', 'open')
                .maybeSingle()
            if (cashRegisterError) throw cashRegisterError

            if (cashRegister?.id) {
                onCashRegisterSession?.(cashRegister.id, sessionData.session?.access_token ?? null)
                if (!resumedCashRegisterIds.has(cashRegister.id)) {
                    await resumePdvCashRegisterSession(cashRegister.id)
                    resumedCashRegisterIds.add(cashRegister.id)
                }
            } else {
                onCashRegisterSession?.(null, sessionData.session?.access_token ?? null)
            }
        } catch (sessionLifecycleError) {
            console.warn('Não foi possível atualizar o ciclo de sessão do caixa.', sessionLifecycleError)
            if (import.meta.env.DEV) {
                console.debug('[PDV session lifecycle] failed', {
                    attemptedAt: new Date().toISOString(),
                    bakery: bakeryId.slice(0, 8),
                    errorType: sessionLifecycleError instanceof Error
                        ? sessionLifecycleError.name
                        : typeof sessionLifecycleError,
                })
            }
        }

        return !legacyTableMissing
    } catch (error) {
        console.warn('Não foi possível iniciar os heartbeats do PDV.', error)
        if (import.meta.env.DEV) {
            console.debug('[PDV heartbeat] failed', {
                attemptedAt: new Date().toISOString(),
                bakery: bakeryId.slice(0, 8),
                errorType: error instanceof Error ? error.name : typeof error,
            })
        }
        return true
    }
}

export function startPdvHeartbeat(bakeryId: string): () => void {
    let stopped = false
    let intervalId: number | null = null
    let activeCashRegisterId: string | null = null
    let activeAccessToken: string | null = null
    const resumedCashRegisterIds = new Set<string>()

    const run = async () => {
        // touchHeartbeat retorna false apenas quando a tabela ainda não existe
        // (migration pendente): nesse caso paramos o polling para não spammar
        // erros; com a tabela pronta o toque continua a cada 30s.
        const tableReady = await touchHeartbeat(
            bakeryId,
            (cashRegisterId, accessToken) => {
                activeCashRegisterId = cashRegisterId
                activeAccessToken = accessToken
            },
            resumedCashRegisterIds,
        )
        if (!tableReady && !stopped) {
            if (intervalId !== null) {
                window.clearInterval(intervalId)
                intervalId = null
            }
        }
    }

    const handlePageHide = (event: PageTransitionEvent) => {
        if (event.persisted || !activeCashRegisterId || !activeAccessToken) return

        void endPdvCashRegisterSessionOnPageHide(activeCashRegisterId, activeAccessToken)
            .catch((error: unknown) => {
                console.warn('Não foi possível sinalizar o encerramento da sessão do PDV.', error)
            })
    }

    void run()
    intervalId = window.setInterval(() => {
        if (!stopped) {
            void run()
        }
    }, HEARTBEAT_INTERVAL_MS)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
        stopped = true
        window.removeEventListener('pagehide', handlePageHide)
        if (intervalId !== null) {
            window.clearInterval(intervalId)
        }
    }
}
