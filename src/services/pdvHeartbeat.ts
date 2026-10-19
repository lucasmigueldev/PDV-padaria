import { getSupabaseClient } from '../lib/supabaseClient'
import { getConnectionState, reportNetworkSuccess } from './connection'
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
        const { error: upsertError } = await client.from('pdv_heartbeats').upsert(
            {
                user_id: userId,
                bakery_id: bakeryId,
                status: getPendingSyncCount() > 0 ? 'syncing' : 'online',
                pending_sales: getPendingSyncCount(),
                last_seen_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
        )
        if (upsertError) throw upsertError
        reportNetworkSuccess()
        return true
    } catch (error) {
        // O erro pode vir como Error ou como objeto PostgREST (ex.: PGRST205,
        // Could not find the table ... in the schema cache).
        const errorText = error instanceof Error ? error.message : JSON.stringify(error)
        const missingTable = /pdv_heartbeats/i.test(errorText)
            && (/does not exist/i.test(errorText) || /schema cache/i.test(errorText))
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
        // touchHeartbeat retorna false apenas quando a tabela ainda não existe
        // (migration pendente): nesse caso paramos o polling para não spammar
        // erros; com a tabela pronta o toque continua a cada 30s.
        const tableReady = await touchHeartbeat(bakeryId)
        if (!tableReady && !stopped) {
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
