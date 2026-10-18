import { getSupabaseClient } from '../lib/supabaseClient'
import { getConnectionState, reportNetworkFailure, reportNetworkSuccess } from './connection'
import { getPendingSyncCount } from './offlineSalesQueue'

const HEARTBEAT_INTERVAL_MS = 30_000

export interface PdvHeartbeatRow {
    userId: string
    bakeryId: string
    status: 'online' | 'syncing'
    pendingSales: number
    lastSeenAt: string
}

/**
 * Upserts a heartbeat for the current cashier session.
 * Returns false when the table is not reachable yet (migration pending).
 */
export async function touchHeartbeat(bakeryId: string): Promise<boolean> {
    if (getConnectionState().status === 'offline') {
        return true // manter o toque; o próximo online executará um novo
    }
    try {
        const client = getSupabaseClient()
        const { data: sessionData } = await client.auth.getSession()
        const userId = sessionData.session?.user?.id
        if (!userId) {
            return true
        }
        await client.from('pdv_heartbeats').upsert(
            {
                user_id: userId,
                bakery_id: bakeryId,
                status: getPendingSyncCount() > 0 ? 'syncing' : 'online',
                pending_sales: getPendingSyncCount(),
                last_seen_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
        )
        reportNetworkSuccess()
        return true
    } catch (error) {
        const missingTable = /relation "public.pdv_heartbeats" does not exist/i.test(String(error))
        if (missingTable) {
            return false // tabela não existe ainda (migration pendente)
        }
        console.warn('Heartbeat do PDV não foi atualizado.', error)
        return true
    }
}

export function startPdvHeartbeat(bakeryId: string): () => void {
    let stopped = false
    let intervalId: number | null = null

    const run = async () => {
        const missingTable = await touchHeartbeat(bakeryId)
        if (missingTable && !stopped) {
            if (intervalId !== null) {
                window.clearInterval(intervalId)
                intervalId = null
            }
        }
    }

    void run()
    intervalId = window.setInterval(() => {
        if (!stopped) {
            void run()
        }
    }, HEARTBEAT_INTERVAL_MS)

    return () => {
        stopped = true
        if (intervalId !== null) {
            window.clearInterval(intervalId)
        }
    }
}
