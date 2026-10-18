import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../lib/supabaseClient'

export interface PdvHeartbeat {
    userId: string
    bakeryId: string
    status: 'online' | 'syncing'
    pendingSales: number
    lastSeenAt: string
}

/**
 * Polls the current PDV's heartbeat table at a fixed interval. A row is
 * considered offline after `thresholdMs` without an update.
 */
export const PDV_OFFLINE_THRESHOLD_MS = 75_000

export function usePdvHeartbeats(enabled: boolean) {
    const [heartbeats, setHeartbeats] = useState<PdvHeartbeat[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    const refresh = useCallback(async () => {
        if (!enabled) {
            return
        }
        setIsLoading(true)
        try {
            const { data, error: queryError } = await getSupabaseClient()
                .from('pdv_heartbeats')
                .select('user_id, bakery_id, status, pending_sales, last_seen_at')
            if (queryError) {
                throw queryError
            }
            setHeartbeats(
                (data ?? []).map((row: Record<string, unknown>) => ({
                    userId: String(row.user_id),
                    bakeryId: String(row.bakery_id),
                    status: row.status === 'syncing' ? 'syncing' : 'online',
                    pendingSales: Number(row.pending_sales ?? 0),
                    lastSeenAt: String(row.last_seen_at),
                }))
            )
            setError('')
        } catch (err) {
            // Tabela ainda não criada (migration pendente): degrada com lista vazia,
            // mantém o painel respondendo sem explosões.
            console.warn('Não foi possível carregar os heartbeats dos PDVs.', err)
            setError('')
        } finally {
            setIsLoading(false)
        }
    }, [enabled])

    useEffect(() => {
        if (!enabled) {
            return
        }
        void refresh()
        const intervalId = window.setInterval(() => {
            if (document.visibilityState === 'visible') {
                void refresh()
            }
        }, 30_000)
        const handleOnline = () => {
            void refresh()
        }
        window.addEventListener('online', handleOnline)
        return () => {
            window.clearInterval(intervalId)
            window.removeEventListener('online', handleOnline)
        }
    }, [enabled, refresh])

    return { heartbeats, isLoading, error }
}
